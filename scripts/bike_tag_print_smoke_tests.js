#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { PrismaClient, Prisma } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { register } = require("ts-node");
const { createSmokeServerController } = require("./smoke_server_helper");

register({ transpileOnly: true });

const { startPrintAgentServer } = require(path.join(__dirname, "..", "print-agent", "src", "app.ts"));
const { buildBikeTagRenderData } = require(path.join(__dirname, "..", "shared", "bikeTagRenderData.ts"));

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3100";
const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

const ADMIN_HEADERS = {
  "X-Staff-Role": "ADMIN",
  "X-Staff-Id": "bike-tag-admin",
};

const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": "bike-tag-manager",
};

const STAFF_HEADERS = {
  "X-Staff-Role": "STAFF",
  "X-Staff-Id": "bike-tag-staff",
};

if (!DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
}
if (process.env.NODE_ENV !== "test") {
  throw new Error("Refusing to run: NODE_ENV must be 'test'.");
}
if (process.env.ALLOW_NON_TEST_DB !== "1" && !DATABASE_URL.toLowerCase().includes("test")) {
  throw new Error("Refusing to run against non-test database URL.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const fetchJson = async (pathName, options = {}) => {
  const response = await fetch(`${BASE_URL}${pathName}`, options);
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, json };
};

const listenServer = (server, host = "127.0.0.1") =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Server did not expose a TCP address."));
        return;
      }
      resolve(address);
    });
  });

const closeServer = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const run = async () => {
  const envFallbackPrintAgent = await startPrintAgentServer({
    bindHost: "127.0.0.1",
    port: 0,
    sharedSecret: "bike-tag-env-fallback-secret",
    dryRunOutputDir: path.resolve(process.cwd(), "tmp", "bike-tag-smoke-agent", "env-fallback"),
    rawTcpTimeoutMs: 5000,
  });
  const persistedSettingsPrintAgent = await startPrintAgentServer({
    bindHost: "127.0.0.1",
    port: 0,
    sharedSecret: "bike-tag-settings-secret",
    dryRunOutputDir: path.resolve(process.cwd(), "tmp", "bike-tag-smoke-agent", "settings"),
    rawTcpTimeoutMs: 5000,
  });
  const invalidRequestHelper = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/jobs/bike-tag") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: {
          code: "PRINT_AGENT_REQUEST_INVALID",
          message: "body.printRequest is required.",
        },
      }));
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found" } }));
  });
  const invalidRequestHelperAddress = await listenServer(invalidRequestHelper);
  const serverController = createSmokeServerController({
    label: "bike-tag-print-smoke",
    baseUrl: BASE_URL,
    databaseUrl: DATABASE_URL,
    envOverrides: {
      COREPOS_BIKE_TAG_PRINT_AGENT_URL: `http://${envFallbackPrintAgent.host}:${envFallbackPrintAgent.port}`,
      COREPOS_BIKE_TAG_PRINT_AGENT_SHARED_SECRET: "bike-tag-env-fallback-secret",
    },
  });

  const createdProductIds = [];
  const createdVariantIds = [];
  const createdPrinterIds = [];

  try {
    await serverController.startIfNeeded();

    const uniqueToken = Date.now().toString(36);
    const product = await prisma.product.create({
      data: {
        name: `Bike Tag Smoke Bike ${uniqueToken}`,
        brand: "CorePOS",
        category: "Road Bikes",
        description: "Carbon frame, Shimano 105 Di2, hydraulic disc brakes, tubeless-ready wheels",
        isActive: true,
        variants: {
          create: {
            sku: `BIKE-TAG-${uniqueToken}`.toUpperCase(),
            barcode: `210000${uniqueToken.slice(-6).padStart(6, "0")}`.slice(0, 12),
            name: "54cm",
            option: "Slate Blue",
            retailPrice: new Prisma.Decimal("2499.00"),
            retailPricePence: 249900,
            isActive: true,
          },
        },
      },
      include: {
        variants: {
          select: {
            id: true,
            sku: true,
          },
        },
      },
    });
    createdProductIds.push(product.id);
    createdVariantIds.push(product.variants[0].id);

    const generatedRenderData = buildBikeTagRenderData(
      {
        sku: product.variants[0].sku,
        barcode: `210000${uniqueToken.slice(-6).padStart(6, "0")}`.slice(0, 12),
        manufacturerBarcode: null,
        internalBarcode: null,
        name: "54cm",
        option: "Slate Blue",
        retailPricePence: 249900,
        product: {
          name: product.name,
          category: product.category,
          brand: product.brand,
          keySellingPoints: null,
        },
      },
      {
        name: product.name,
        category: product.category,
        brand: product.brand,
        description: product.description,
        keySellingPoints: null,
      },
    );
    assert.deepEqual(generatedRenderData.specLines, [
      "CorePOS",
      "Road bike",
      "Carbon frame",
      "Shimano 105 Di2",
    ]);

    const manualSellingPoints = [
      "Hand-built in London",
      "4-speed gearing",
      "Integrated battery",
      "Hand-built in London",
    ].join("\n");

    const saveSellingPointsRes = await fetchJson(`/api/products/${encodeURIComponent(product.id)}`, {
      method: "PATCH",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        keySellingPoints: manualSellingPoints,
      }),
    });
    assert.equal(saveSellingPointsRes.status, 200, JSON.stringify(saveSellingPointsRes.json));
    assert.equal(saveSellingPointsRes.json.keySellingPoints, manualSellingPoints);

    const productDetailRes = await fetchJson(`/api/products/${encodeURIComponent(product.id)}`, {
      headers: STAFF_HEADERS,
    });
    assert.equal(productDetailRes.status, 200, JSON.stringify(productDetailRes.json));
    assert.equal(productDetailRes.json.keySellingPoints, manualSellingPoints);

    const manualRenderData = buildBikeTagRenderData(
      {
        sku: product.variants[0].sku,
        barcode: `210000${uniqueToken.slice(-6).padStart(6, "0")}`.slice(0, 12),
        manufacturerBarcode: null,
        internalBarcode: null,
        name: "54cm",
        option: "Slate Blue",
        retailPricePence: 249900,
        product: {
          name: productDetailRes.json.name,
          category: productDetailRes.json.category,
          brand: productDetailRes.json.brand,
          keySellingPoints: productDetailRes.json.keySellingPoints,
        },
      },
      productDetailRes.json,
    );
    assert.deepEqual(manualRenderData.specLines, [
      "Hand-built in London",
      "4-speed gearing",
      "Integrated battery",
    ]);

    const nonBikeRenderData = buildBikeTagRenderData(
      {
        sku: `HELMET-${uniqueToken}`.toUpperCase(),
        barcode: "5012345678901",
        manufacturerBarcode: null,
        internalBarcode: null,
        name: "Medium",
        option: "Gloss Black",
        retailPricePence: 8999,
        product: {
          name: "Metro Helmet",
          category: "Helmets",
          brand: "CorePOS",
          keySellingPoints: "Should not appear",
        },
      },
      {
        name: "Metro Helmet",
        category: "Helmets",
        brand: "CorePOS",
        description: "MIPS safety, lightweight shell, everyday commuter fit",
        keySellingPoints: "Should not appear",
      },
    );
    assert.equal(nonBikeRenderData.specLines.includes("Should not appear"), false);
    assert.deepEqual(nonBikeRenderData.specLines.slice(0, 3), [
      "MIPS safety",
      "lightweight shell",
      "everyday commuter fit",
    ]);

    const createPrinterRes = await fetchJson("/api/settings/printers", {
      method: "POST",
      headers: {
        ...ADMIN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Xerox VersaLink C405",
        key: `BIKE_TAG_XEROX_${uniqueToken.toUpperCase()}`,
        printerFamily: "OFFICE_DOCUMENT",
        transportMode: "DRY_RUN",
        location: "Back office",
        notes: "Smoke-test bike-tag printer",
        setAsDefaultBikeTag: true,
      }),
    });
    assert.equal(createPrinterRes.status, 201, JSON.stringify(createPrinterRes.json));
    const printerId = createPrinterRes.json.printer.id;
    createdPrinterIds.push(printerId);
    assert.equal(createPrinterRes.json.defaultBikeTagPrinterId, printerId);
    assert.equal(createPrinterRes.json.printer.supportsBikeTags, true);

    const initialConfigRes = await fetchJson("/api/settings/bike-tag-print-agent", {
      headers: MANAGER_HEADERS,
    });
    assert.equal(initialConfigRes.status, 200, JSON.stringify(initialConfigRes.json));
    assert.equal(initialConfigRes.json.config.url, null);
    assert.equal(initialConfigRes.json.config.effectiveSource, "environment");
    assert.equal(
      initialConfigRes.json.config.envFallbackUrl,
      `http://${envFallbackPrintAgent.host}:${envFallbackPrintAgent.port}`,
    );
    assert.equal(initialConfigRes.json.config.envFallbackHasSharedSecret, true);

    const saveConfigRes = await fetchJson("/api/settings/bike-tag-print-agent", {
      method: "PUT",
      headers: {
        ...ADMIN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: `http://${persistedSettingsPrintAgent.host}:${persistedSettingsPrintAgent.port}`,
        sharedSecret: "bike-tag-settings-secret",
      }),
    });
    assert.equal(saveConfigRes.status, 200, JSON.stringify(saveConfigRes.json));
    assert.equal(
      saveConfigRes.json.config.url,
      `http://${persistedSettingsPrintAgent.host}:${persistedSettingsPrintAgent.port}`,
    );
    assert.equal(saveConfigRes.json.config.effectiveSource, "settings");
    assert.equal(saveConfigRes.json.config.hasSharedSecret, true);
    assert.match(saveConfigRes.json.config.sharedSecretHint, /^••••/);

    const printRes = await fetchJson(`/api/variants/${encodeURIComponent(product.variants[0].id)}/bike-tag/print`, {
      method: "POST",
      headers: {
        ...STAFF_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        copies: 2,
      }),
    });
    assert.equal(printRes.status, 201, JSON.stringify(printRes.json));
    assert.equal(printRes.json.printer.transportMode, "DRY_RUN");
    assert.equal(printRes.json.printJob.simulated, true);
    assert.equal(printRes.json.printJob.copies, 2);
    assert.equal(printRes.json.printJob.outputPath.endsWith(".png"), true);
    assert.match(printRes.json.printJob.outputPath, /bike-tag-smoke-agent\/settings\//);

    const renderedBikeTag = await fs.readFile(printRes.json.printJob.outputPath);
    assert.equal(renderedBikeTag.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");

    const previewRes = await fetch(`${BASE_URL}/api/variants/${encodeURIComponent(product.variants[0].id)}/bike-tag/document`, {
      headers: STAFF_HEADERS,
    });
    assert.equal(previewRes.status, 200);
    assert.equal(previewRes.headers.get("content-type"), "image/png");
    const previewBuffer = Buffer.from(await previewRes.arrayBuffer());
    assert.equal(previewBuffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");

    const clearStoredConfigRes = await fetchJson("/api/settings/bike-tag-print-agent", {
      method: "PUT",
      headers: {
        ...ADMIN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: null,
        clearSharedSecret: true,
      }),
    });
    assert.equal(clearStoredConfigRes.status, 200, JSON.stringify(clearStoredConfigRes.json));
    assert.equal(clearStoredConfigRes.json.config.url, null);
    assert.equal(clearStoredConfigRes.json.config.effectiveSource, "environment");

    const envFallbackPrintRes = await fetchJson(`/api/variants/${encodeURIComponent(product.variants[0].id)}/bike-tag/print`, {
      method: "POST",
      headers: {
        ...STAFF_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        copies: 1,
      }),
    });
    assert.equal(envFallbackPrintRes.status, 201, JSON.stringify(envFallbackPrintRes.json));
    assert.match(envFallbackPrintRes.json.printJob.outputPath, /bike-tag-smoke-agent\/env-fallback\//);

    const invalidHelperConfigRes = await fetchJson("/api/settings/bike-tag-print-agent", {
      method: "PUT",
      headers: {
        ...ADMIN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: `http://${invalidRequestHelperAddress.address}:${invalidRequestHelperAddress.port}`,
        clearSharedSecret: true,
      }),
    });
    assert.equal(invalidHelperConfigRes.status, 200, JSON.stringify(invalidHelperConfigRes.json));
    assert.equal(
      invalidHelperConfigRes.json.config.url,
      `http://${invalidRequestHelperAddress.address}:${invalidRequestHelperAddress.port}`,
    );
    assert.equal(invalidHelperConfigRes.json.config.effectiveSource, "settings");

    const invalidHelperPrintRes = await fetchJson(`/api/variants/${encodeURIComponent(product.variants[0].id)}/bike-tag/print`, {
      method: "POST",
      headers: {
        ...STAFF_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        copies: 1,
      }),
    });
    assert.equal(invalidHelperPrintRes.status, 502, JSON.stringify(invalidHelperPrintRes.json));
    assert.equal(invalidHelperPrintRes.json.error.code, "BIKE_TAG_PRINT_AGENT_REQUEST_INVALID");
    assert.equal(invalidHelperPrintRes.json.error.message, "body.printRequest is required.");

    const invalidCopiesRes = await fetchJson(`/api/variants/${encodeURIComponent(product.variants[0].id)}/bike-tag/print`, {
      method: "POST",
      headers: {
        ...STAFF_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        copies: 0,
      }),
    });
    assert.equal(invalidCopiesRes.status, 400, JSON.stringify(invalidCopiesRes.json));
    assert.equal(invalidCopiesRes.json.error.code, "INVALID_BIKE_TAG_PRINT");

    const clearDefaultRes = await fetchJson("/api/settings/printers/default-bike-tag", {
      method: "PUT",
      headers: {
        ...ADMIN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        printerId: null,
      }),
    });
    assert.equal(clearDefaultRes.status, 200, JSON.stringify(clearDefaultRes.json));
    assert.equal(clearDefaultRes.json.defaultBikeTagPrinterId, null);

    const missingDefaultRes = await fetchJson(`/api/variants/${encodeURIComponent(product.variants[0].id)}/bike-tag/print`, {
      method: "POST",
      headers: {
        ...STAFF_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    assert.equal(missingDefaultRes.status, 409, JSON.stringify(missingDefaultRes.json));
    assert.equal(missingDefaultRes.json.error.code, "DEFAULT_BIKE_TAG_PRINTER_NOT_CONFIGURED");

    console.log("bike-tag direct print path passed");
  } finally {
    if (createdVariantIds.length > 0) {
      await prisma.variant.deleteMany({
        where: {
          id: {
            in: createdVariantIds,
          },
        },
      });
    }
    if (createdProductIds.length > 0) {
      await prisma.product.deleteMany({
        where: {
          id: {
            in: createdProductIds,
          },
        },
      });
    }
    if (createdPrinterIds.length > 0) {
      await prisma.printer.deleteMany({
        where: {
          id: {
            in: createdPrinterIds,
          },
        },
      });
    }
    await prisma.appConfig.deleteMany({
      where: {
        key: {
          in: [
            "documents.defaultBikeTagPrinterId",
            "documents.bikeTagPrintAgent",
          ],
        },
      },
    });

    await Promise.allSettled([
      prisma.$disconnect(),
      serverController.stop(),
      envFallbackPrintAgent.close(),
      persistedSettingsPrintAgent.close(),
      closeServer(invalidRequestHelper),
    ]);
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
