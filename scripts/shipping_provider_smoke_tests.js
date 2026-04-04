#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const http = require("node:http");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { createSmokeServerController } = require("./smoke_server_helper");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3100";
const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const PRINT_AGENT_SECRET = "shipping-provider-smoke-print-secret";
const PROVIDER_API_KEY = "shipping-provider-smoke-api-key";
const ADMIN_HEADERS = {
  "X-Staff-Role": "ADMIN",
  "X-Staff-Id": "shipping-provider-smoke-admin",
};
const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": "shipping-provider-smoke-manager",
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

const fetchJson = async (path, options = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, options);
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, json };
};

const readJsonBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : null;
};

const startFakePrintAgent = async () => {
  const server = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/jobs/shipment-label") {
      if (req.headers["x-corepos-print-agent-secret"] !== PRINT_AGENT_SECRET) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "PRINT_AGENT_UNAUTHORIZED", message: "Secret mismatch" } }));
        return;
      }

      const payload = await readJsonBody(req);
      const printRequest = payload?.printRequest;
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        job: {
          jobId: `fake-provider-print-${randomUUID()}`,
          acceptedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          transportMode: "DRY_RUN",
          printerId: printRequest?.printer?.printerId ?? "unknown-printer-id",
          printerKey: printRequest?.printer?.printerKey ?? "UNKNOWN_PRINTER",
          printerName: printRequest?.printer?.printerName ?? "Dispatch Zebra GK420d",
          printerTarget: "dry-run://shipping-provider-smoke",
          copies: Number(printRequest?.printer?.copies ?? 1),
          documentFormat: "ZPL",
          bytesSent: Buffer.byteLength(String(printRequest?.document?.content ?? ""), "utf8"),
          simulated: true,
          outputPath: null,
        },
      }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found" } }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fake print agent did not expose a TCP address");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
};

const buildLabelContent = (trackingNumber, orderNumber) => [
  "^XA",
  "^CI28",
  "^PW812",
  "^LL1218",
  `^FO36,36^A0N,36,36^FDGENERIC HTTP PROVIDER ${orderNumber}^FS`,
  `^FO36,96^A0N,28,28^FDTracking: ${trackingNumber}^FS`,
  "^FO36,156^GB740,0,2^FS",
  `^FO36,220^BCN,120,Y,N,N^FD${trackingNumber}^FS`,
  "^XZ",
].join("\n");

const startFakeCourierProvider = async () => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/shipments") {
      if (req.headers.authorization !== `Bearer ${PROVIDER_API_KEY}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Unauthorized" } }));
        return;
      }

      const payload = await readJsonBody(req);
      requests.push({
        headers: req.headers,
        payload,
      });

      const orderNumber = String(payload?.shipment?.orderNumber ?? "UNKNOWN");
      if (orderNumber.includes("FAIL")) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: {
            message: "Simulated courier refusal",
          },
        }));
        return;
      }

      const trackingNumber = `GEN${orderNumber.replace(/[^A-Z0-9]/gi, "").slice(-10).toUpperCase()}`;
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        shipment: {
          trackingNumber,
          providerReference: `generic-ref-${orderNumber}`,
          providerShipmentReference: `generic-shp-${orderNumber}`,
          providerTrackingReference: `generic-track-${trackingNumber}`,
          providerLabelReference: `generic-label-${trackingNumber}`,
          providerStatus: "PURCHASED",
          serviceCode: payload?.shipment?.serviceCode ?? "STANDARD",
          serviceName: payload?.shipment?.serviceName ?? "Standard Dispatch",
        },
        document: {
          format: "ZPL",
          mimeType: "application/zpl",
          fileName: `shipment-${orderNumber}.zpl`,
          content: buildLabelContent(trackingNumber, orderNumber),
        },
        metadata: {
          requestId: randomUUID(),
          carrierCode: "GENERIC_HTTP_ZPL",
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

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fake courier provider did not expose a TCP address");
  }

  return {
    requests,
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
};

const createOrderBody = (token) => ({
  orderNumber: `WEB-${token}`.toUpperCase(),
  sourceChannel: "INTERNAL_MOCK_WEB_STORE",
  externalOrderRef: `checkout-${token}`,
  customerName: "Courier Provider Smoke",
  customerEmail: `${token}@example.com`,
  customerPhone: "07123 456789",
  shippingRecipientName: "Courier Provider Smoke",
  shippingAddressLine1: "22 Dispatch Lane",
  shippingCity: "Clapham",
  shippingRegion: "London",
  shippingPostcode: "SW4 0HY",
  shippingCountry: "United Kingdom",
  shippingPricePence: 495,
  items: [
    {
      sku: `PROVIDER-${token}`.toUpperCase(),
      productName: "Provider Test Product",
      variantName: "Standard",
      quantity: 1,
      unitPricePence: 2499,
    },
  ],
});

const createPrinter = async (body) => {
  const response = await fetchJson("/api/settings/printers", {
    method: "POST",
    headers: {
      ...ADMIN_HEADERS,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 201, JSON.stringify(response.json));
  return response.json.printer;
};

const run = async () => {
  const createdOrderIds = [];
  const createdPrinterIds = [];
  const fakePrintAgent = await startFakePrintAgent();
  const fakeProvider = await startFakeCourierProvider();
  const serverController = createSmokeServerController({
    label: "shipping-provider-smoke",
    baseUrl: BASE_URL,
    databaseUrl: DATABASE_URL,
    envOverrides: {
      COREPOS_SHIPPING_PRINT_AGENT_URL: fakePrintAgent.url,
      COREPOS_SHIPPING_PRINT_AGENT_SHARED_SECRET: PRINT_AGENT_SECRET,
    },
  });

  try {
    await serverController.startIfNeeded();

    const listBefore = await fetchJson("/api/settings/shipping-providers", {
      headers: MANAGER_HEADERS,
    });
    assert.equal(listBefore.status, 200, JSON.stringify(listBefore.json));
    assert.equal(listBefore.json.defaultProviderKey, "INTERNAL_MOCK_ZPL");
    assert.equal(listBefore.json.providers.some((provider) => provider.key === "GENERIC_HTTP_ZPL"), true);

    const invalidConfig = await fetchJson("/api/settings/shipping-providers/GENERIC_HTTP_ZPL", {
      method: "PUT",
      headers: {
        ...ADMIN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
        environment: "SANDBOX",
      }),
    });
    assert.equal(invalidConfig.status, 409, JSON.stringify(invalidConfig.json));
    assert.equal(invalidConfig.json.error.code, "SHIPPING_PROVIDER_NOT_CONFIGURED");

    const validConfig = await fetchJson("/api/settings/shipping-providers/GENERIC_HTTP_ZPL", {
      method: "PUT",
      headers: {
        ...ADMIN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
        environment: "SANDBOX",
        displayName: "Generic Courier Sandbox",
        endpointBaseUrl: fakeProvider.url,
        accountId: "sandbox-account-1",
        apiKey: PROVIDER_API_KEY,
      }),
    });
    assert.equal(validConfig.status, 200, JSON.stringify(validConfig.json));
    assert.equal(validConfig.json.provider.isAvailable, true);

    const setDefaultProvider = await fetchJson("/api/settings/shipping-providers/default", {
      method: "PUT",
      headers: {
        ...ADMIN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ providerKey: "GENERIC_HTTP_ZPL" }),
    });
    assert.equal(setDefaultProvider.status, 200, JSON.stringify(setDefaultProvider.json));
    assert.equal(setDefaultProvider.json.defaultProviderKey, "GENERIC_HTTP_ZPL");

    const printer = await createPrinter({
      name: "Courier Provider Zebra",
      key: "COURIER_PROVIDER_ZEBRA",
      transportMode: "DRY_RUN",
      location: "Dispatch bench",
      setAsDefaultShippingLabel: true,
    });
    createdPrinterIds.push(printer.id);

    const successToken = randomUUID().slice(0, 8).toUpperCase();
    const createOrderRes = await fetchJson("/api/online-store/orders", {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(createOrderBody(successToken)),
    });
    assert.equal(createOrderRes.status, 201, JSON.stringify(createOrderRes.json));
    createdOrderIds.push(createOrderRes.json.order.id);

    const createShipmentRes = await fetchJson(
      `/api/online-store/orders/${encodeURIComponent(createOrderRes.json.order.id)}/shipments`,
      {
        method: "POST",
        headers: {
          ...MANAGER_HEADERS,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          serviceCode: "NEXT_DAY",
          serviceName: "Next Day Dispatch",
        }),
      },
    );
    assert.equal(createShipmentRes.status, 201, JSON.stringify(createShipmentRes.json));
    assert.equal(createShipmentRes.json.shipment.providerKey, "GENERIC_HTTP_ZPL");
    assert.equal(createShipmentRes.json.shipment.providerDisplayName, "Generic Courier Sandbox");
    assert.equal(createShipmentRes.json.shipment.providerEnvironment, "SANDBOX");
    assert.equal(createShipmentRes.json.shipment.providerShipmentReference.startsWith("generic-shp-"), true);
    assert.equal(createShipmentRes.json.shipment.providerStatus, "PURCHASED");
    const shipmentId = createShipmentRes.json.shipment.id;

    assert.equal(fakeProvider.requests.length, 1);
    assert.equal(fakeProvider.requests[0].headers.authorization, `Bearer ${PROVIDER_API_KEY}`);
    assert.equal(fakeProvider.requests[0].headers["x-corepos-shipping-environment"], "SANDBOX");
    assert.equal(fakeProvider.requests[0].headers["x-corepos-shipping-account"], "sandbox-account-1");
    assert.equal(fakeProvider.requests[0].payload.shipment.orderNumber, createOrderRes.json.order.orderNumber);
    assert.equal(fakeProvider.requests[0].payload.shipment.serviceCode, "NEXT_DAY");
    assert.equal(fakeProvider.requests[0].payload.recipient.postcode, "SW4 0HY");

    const preparePrintRes = await fetchJson(
      `/api/online-store/shipments/${encodeURIComponent(shipmentId)}/prepare-print`,
      {
        method: "POST",
        headers: {
          ...MANAGER_HEADERS,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ printerId: printer.id, copies: 1 }),
      },
    );
    assert.equal(preparePrintRes.status, 200, JSON.stringify(preparePrintRes.json));
    assert.equal(preparePrintRes.json.printRequest.metadata.providerKey, "GENERIC_HTTP_ZPL");
    assert.equal(preparePrintRes.json.printRequest.metadata.providerDisplayName, "Generic Courier Sandbox");

    const printRes = await fetchJson(
      `/api/online-store/shipments/${encodeURIComponent(shipmentId)}/print`,
      {
        method: "POST",
        headers: {
          ...MANAGER_HEADERS,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ printerId: printer.id, copies: 1 }),
      },
    );
    assert.equal(printRes.status, 200, JSON.stringify(printRes.json));
    assert.equal(printRes.json.shipment.status, "PRINTED");
    assert.equal(Boolean(printRes.json.shipment.printedAt), true);
    assert.equal(printRes.json.printJob.transportMode, "DRY_RUN");

    const failureToken = `FAIL-${randomUUID().slice(0, 6).toUpperCase()}`;
    const failureOrderRes = await fetchJson("/api/online-store/orders", {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(createOrderBody(failureToken)),
    });
    assert.equal(failureOrderRes.status, 201, JSON.stringify(failureOrderRes.json));
    createdOrderIds.push(failureOrderRes.json.order.id);

    const failureShipmentRes = await fetchJson(
      `/api/online-store/orders/${encodeURIComponent(failureOrderRes.json.order.id)}/shipments`,
      {
        method: "POST",
        headers: {
          ...MANAGER_HEADERS,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerKey: "GENERIC_HTTP_ZPL",
          serviceCode: "STANDARD",
          serviceName: "Standard Dispatch",
        }),
      },
    );
    assert.equal(failureShipmentRes.status, 502, JSON.stringify(failureShipmentRes.json));
    assert.equal(failureShipmentRes.json.error.code, "SHIPPING_PROVIDER_REJECTED");

    const failureDetail = await fetchJson(
      `/api/online-store/orders/${encodeURIComponent(failureOrderRes.json.order.id)}`,
      { headers: MANAGER_HEADERS },
    );
    assert.equal(failureDetail.status, 200, JSON.stringify(failureDetail.json));
    assert.equal(failureDetail.json.order.shipments.length, 0);

    console.log("shipping provider foundation and provider-backed shipment printing passed");
  } finally {
    await prisma.webOrderShipment.deleteMany({
      where: {
        webOrderId: { in: createdOrderIds },
      },
    });
    await prisma.webOrderItem.deleteMany({
      where: {
        webOrderId: { in: createdOrderIds },
      },
    });
    await prisma.webOrder.deleteMany({
      where: {
        id: { in: createdOrderIds },
      },
    });
    await prisma.printer.deleteMany({
      where: {
        id: { in: createdPrinterIds },
      },
    });
    await prisma.appConfig.deleteMany({
      where: {
        key: {
          in: [
            "dispatch.defaultShippingLabelPrinterId",
            "shipping.defaultProviderKey",
            "shipping.provider.genericHttpZpl",
          ],
        },
      },
    });
    await serverController.stop();
    await Promise.allSettled([fakeProvider.close(), fakePrintAgent.close(), prisma.$disconnect()]);
  }
};

run().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
