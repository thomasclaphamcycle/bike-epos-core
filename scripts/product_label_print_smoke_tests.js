#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { PrismaClient, Prisma } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { register } = require("ts-node");
const { createSmokeServerController } = require("./smoke_server_helper");

register({ transpileOnly: true });

const { startPrintAgentServer } = require(path.join(__dirname, "..", "print-agent", "src", "app.ts"));

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3100";
const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

const ADMIN_HEADERS = {
  "X-Staff-Role": "ADMIN",
  "X-Staff-Id": "product-label-admin",
};

const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": "product-label-manager",
};

const STAFF_HEADERS = {
  "X-Staff-Role": "STAFF",
  "X-Staff-Id": "product-label-staff",
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

const run = async () => {
  const envFallbackPrintAgent = await startPrintAgentServer({
    bindHost: "127.0.0.1",
    port: 0,
    sharedSecret: "product-label-env-fallback-secret",
    dryRunOutputDir: path.resolve(process.cwd(), "tmp", "product-label-smoke-agent", "env-fallback"),
    rawTcpTimeoutMs: 5000,
  });
  const persistedSettingsPrintAgent = await startPrintAgentServer({
    bindHost: "127.0.0.1",
    port: 0,
    sharedSecret: "product-label-settings-secret",
    dryRunOutputDir: path.resolve(process.cwd(), "tmp", "product-label-smoke-agent", "settings"),
    rawTcpTimeoutMs: 5000,
  });
  const serverController = createSmokeServerController({
    label: "product-label-print-smoke",
    baseUrl: BASE_URL,
    databaseUrl: DATABASE_URL,
    envOverrides: {
      COREPOS_PRODUCT_LABEL_PRINT_AGENT_URL: `http://${envFallbackPrintAgent.host}:${envFallbackPrintAgent.port}`,
      COREPOS_PRODUCT_LABEL_PRINT_AGENT_SHARED_SECRET: "product-label-env-fallback-secret",
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
        name: `Dymo Smoke Product ${uniqueToken}`,
        brand: "CorePOS",
        isActive: true,
        variants: {
          create: {
            sku: `DYMO-SMOKE-${uniqueToken}`,
            barcode: `200000${uniqueToken.slice(-6).padStart(6, "0")}`.slice(0, 12),
            retailPrice: new Prisma.Decimal("12.99"),
            retailPricePence: 1299,
            isActive: true,
          },
        },
      },
      include: {
        variants: {
          select: {
            id: true,
          },
        },
      },
    });
    createdProductIds.push(product.id);
    createdVariantIds.push(product.variants[0].id);

    const createPrinterRes = await fetchJson("/api/settings/printers", {
      method: "POST",
      headers: {
        ...ADMIN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Packing Bench Dymo",
        key: `DYMO_SMOKE_${uniqueToken.toUpperCase()}`,
        printerFamily: "DYMO_LABEL",
        transportMode: "DRY_RUN",
        location: "Packing bench",
        notes: "Smoke-test Dymo printer",
        setAsDefaultProductLabel: true,
      }),
    });
    assert.equal(createPrinterRes.status, 201, JSON.stringify(createPrinterRes.json));
    const printerId = createPrinterRes.json.printer.id;
    createdPrinterIds.push(printerId);
    assert.equal(createPrinterRes.json.defaultProductLabelPrinterId, printerId);

    const initialConfigRes = await fetchJson("/api/settings/product-label-print-agent", {
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

    const saveConfigRes = await fetchJson("/api/settings/product-label-print-agent", {
      method: "PUT",
      headers: {
        ...ADMIN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: `http://${persistedSettingsPrintAgent.host}:${persistedSettingsPrintAgent.port}`,
        sharedSecret: "product-label-settings-secret",
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

    const printRes = await fetchJson(`/api/variants/${encodeURIComponent(product.variants[0].id)}/product-label/print`, {
      method: "POST",
      headers: {
        ...STAFF_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        copies: 3,
      }),
    });
    assert.equal(printRes.status, 201, JSON.stringify(printRes.json));
    assert.equal(printRes.json.printer.transportMode, "DRY_RUN");
    assert.equal(printRes.json.printJob.simulated, true);
    assert.equal(printRes.json.printJob.copies, 3);
    assert.equal(printRes.json.printJob.outputPath.endsWith(".png"), true);
    assert.match(printRes.json.printJob.outputPath, /product-label-smoke-agent\/settings\//);

    const renderedLabel = await fs.readFile(printRes.json.printJob.outputPath);
    assert.equal(renderedLabel.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");

    const previewRes = await fetch(`${BASE_URL}/api/variants/${encodeURIComponent(product.variants[0].id)}/product-label/document`, {
      headers: STAFF_HEADERS,
    });
    assert.equal(previewRes.status, 200);
    assert.equal(previewRes.headers.get("content-type"), "image/png");
    const previewBuffer = Buffer.from(await previewRes.arrayBuffer());
    assert.equal(previewBuffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");

    const clearStoredConfigRes = await fetchJson("/api/settings/product-label-print-agent", {
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

    const envFallbackPrintRes = await fetchJson(`/api/variants/${encodeURIComponent(product.variants[0].id)}/product-label/print`, {
      method: "POST",
      headers: {
        ...STAFF_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        copies: 2,
      }),
    });
    assert.equal(envFallbackPrintRes.status, 201, JSON.stringify(envFallbackPrintRes.json));
    assert.equal(envFallbackPrintRes.json.printJob.copies, 2);
    assert.match(envFallbackPrintRes.json.printJob.outputPath, /product-label-smoke-agent\/env-fallback\//);

    const invalidCopiesRes = await fetchJson(`/api/variants/${encodeURIComponent(product.variants[0].id)}/product-label/print`, {
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
    assert.equal(invalidCopiesRes.json.error.code, "INVALID_PRODUCT_LABEL_PRINT");

    const clearDefaultRes = await fetchJson("/api/settings/printers/default-product-label", {
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
    assert.equal(clearDefaultRes.json.defaultProductLabelPrinterId, null);

    const missingDefaultRes = await fetchJson(`/api/variants/${encodeURIComponent(product.variants[0].id)}/product-label/print`, {
      method: "POST",
      headers: {
        ...STAFF_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    assert.equal(missingDefaultRes.status, 409, JSON.stringify(missingDefaultRes.json));
    assert.equal(missingDefaultRes.json.error.code, "DEFAULT_PRODUCT_LABEL_PRINTER_NOT_CONFIGURED");

    console.log("product-label direct print path passed");
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
            "labels.defaultProductLabelPrinterId",
            "labels.productLabelPrintAgent",
          ],
        },
      },
    });

    await Promise.allSettled([
      prisma.$disconnect(),
      serverController.stop(),
      envFallbackPrintAgent.close(),
      persistedSettingsPrintAgent.close(),
    ]);
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
