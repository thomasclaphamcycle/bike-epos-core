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
const PRINT_AGENT_SECRET = "online-store-smoke-print-secret";
const ADMIN_HEADERS = {
  "X-Staff-Role": "ADMIN",
  "X-Staff-Id": "online-store-smoke-admin",
};
const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": "online-store-smoke-manager",
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

const fetchText = async (path, options = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, options);
  const text = await response.text();
  return {
    status: response.status,
    text,
    headers: response.headers,
  };
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
  const requests = [];
  const server = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/jobs/shipment-label") {
      if (req.headers["x-corepos-print-agent-secret"] !== PRINT_AGENT_SECRET) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "PRINT_AGENT_UNAUTHORIZED", message: "Secret mismatch" } }));
        return;
      }

      const payload = await readJsonBody(req);
      requests.push(payload);
      const printRequest = payload?.printRequest;

      if (printRequest?.printer?.printerKey === "FORCE_FAILING_ZEBRA") {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: {
            code: "PRINT_AGENT_TRANSPORT_FAILED",
            message: "Simulated print transport failure",
          },
        }));
        return;
      }

      const documentContent = String(printRequest?.document?.content ?? "");
      const copies = Number(printRequest?.printer?.copies ?? 1);
      const printableContent = Array.from({ length: copies }, () => documentContent).join("\n");
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        job: {
          jobId: `fake-agent-${randomUUID()}`,
          acceptedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          transportMode: "DRY_RUN",
          printerId: printRequest?.printer?.printerId ?? "unknown-printer-id",
          printerKey: printRequest?.printer?.printerKey ?? "UNKNOWN_PRINTER",
          printerName: printRequest?.printer?.printerName ?? "Dispatch Zebra GK420d",
          printerTarget: "dry-run://online-store-smoke",
          copies,
          documentFormat: "ZPL",
          bytesSent: Buffer.byteLength(printableContent, "utf8"),
          simulated: true,
          outputPath: null,
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
    throw new Error("Fake print agent did not expose a TCP address");
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

const createOrderBody = (token, overrides = {}) => ({
  orderNumber: `WEB-${token}`.toUpperCase(),
  sourceChannel: "INTERNAL_MOCK_WEB_STORE",
  externalOrderRef: `checkout-${token}`,
  customerName: "Online Store Smoke",
  customerEmail: `${token}@example.com`,
  customerPhone: "07123 456789",
  shippingRecipientName: "Online Store Smoke",
  shippingAddressLine1: "12 Dispatch Lane",
  shippingCity: "Clapham",
  shippingRegion: "London",
  shippingPostcode: "SW4 0HY",
  shippingCountry: "United Kingdom",
  shippingPricePence: 495,
  items: [
    {
      sku: `SHIP-${token}`.toUpperCase(),
      productName: "Shipping Test Product",
      variantName: "Standard",
      quantity: 2,
      unitPricePence: 1499,
    },
  ],
  ...overrides,
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
  const serverController = createSmokeServerController({
    label: "online-store-smoke",
    baseUrl: BASE_URL,
    databaseUrl: DATABASE_URL,
    envOverrides: {
      COREPOS_SHIPPING_PRINT_AGENT_URL: fakePrintAgent.url,
      COREPOS_SHIPPING_PRINT_AGENT_SHARED_SECRET: PRINT_AGENT_SECRET,
    },
  });

  try {
    await serverController.startIfNeeded();

    const defaultPrinter = await createPrinter({
      name: "Dispatch Zebra GK420d",
      key: "DISPATCH_ZEBRA_GK420D",
      transportMode: "DRY_RUN",
      location: "Dispatch bench",
    });
    createdPrinterIds.push(defaultPrinter.id);
    const failingPrinter = await createPrinter({
      name: "Force Failing Zebra",
      key: "FORCE_FAILING_ZEBRA",
      transportMode: "DRY_RUN",
      location: "Dispatch bench backup",
    });
    createdPrinterIds.push(failingPrinter.id);
    const inactivePrinter = await createPrinter({
      name: "Inactive Zebra",
      key: "INACTIVE_ZEBRA",
      transportMode: "DRY_RUN",
      isActive: false,
    });
    createdPrinterIds.push(inactivePrinter.id);
    const nonShippingPrinter = await createPrinter({
      name: "Back Office Printer",
      key: "BACK_OFFICE_ONLY",
      transportMode: "DRY_RUN",
      supportsShippingLabels: false,
    });
    createdPrinterIds.push(nonShippingPrinter.id);

    const setDefaultPrinterRes = await fetchJson("/api/settings/printers/default-shipping-label", {
      method: "PUT",
      headers: {
        ...ADMIN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        printerId: defaultPrinter.id,
      }),
    });
    assert.equal(setDefaultPrinterRes.status, 200, JSON.stringify(setDefaultPrinterRes.json));
    assert.equal(setDefaultPrinterRes.json.defaultShippingLabelPrinterId, defaultPrinter.id);

    const successToken = `smoke-${Date.now()}`;
    const successOrderBody = createOrderBody(successToken);
    const createOrderRes = await fetchJson("/api/online-store/orders", {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(successOrderBody),
    });
    assert.equal(createOrderRes.status, 201, JSON.stringify(createOrderRes.json));
    assert.equal(createOrderRes.json.order.orderNumber, successOrderBody.orderNumber);
    assert.equal(createOrderRes.json.order.status, "READY_FOR_DISPATCH");
    createdOrderIds.push(createOrderRes.json.order.id);

    const listRes = await fetchJson(`/api/online-store/orders?q=${encodeURIComponent(successOrderBody.orderNumber)}`, {
      headers: MANAGER_HEADERS,
    });
    assert.equal(listRes.status, 200, JSON.stringify(listRes.json));
    assert.equal(listRes.json.orders.length, 1);
    assert.equal(listRes.json.orders[0].orderNumber, successOrderBody.orderNumber);
    assert.equal(listRes.json.summary.readyForDispatchCount >= 1, true);
    assert.equal(Array.isArray(listRes.json.supportedProviders), true);

    const detailRes = await fetchJson(`/api/online-store/orders/${encodeURIComponent(createOrderRes.json.order.id)}`, {
      headers: MANAGER_HEADERS,
    });
    assert.equal(detailRes.status, 200, JSON.stringify(detailRes.json));
    assert.equal(detailRes.json.order.shipments.length, 0);

    const createShipmentRes = await fetchJson(`/api/online-store/orders/${encodeURIComponent(createOrderRes.json.order.id)}/shipments`, {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        providerKey: "INTERNAL_MOCK_ZPL",
        serviceCode: "STANDARD",
        serviceName: "Standard Dispatch",
      }),
    });
    assert.equal(createShipmentRes.status, 201, JSON.stringify(createShipmentRes.json));
    assert.equal(createShipmentRes.json.shipment.status, "LABEL_READY");
    assert.equal(createShipmentRes.json.shipment.providerKey, "INTERNAL_MOCK_ZPL");
    assert.equal(createShipmentRes.json.shipment.labelFormat, "ZPL");
    assert.match(createShipmentRes.json.shipment.trackingNumber, /^MOCK/);
    const shipmentId = createShipmentRes.json.shipment.id;

    const duplicateShipmentRes = await fetchJson(`/api/online-store/orders/${encodeURIComponent(createOrderRes.json.order.id)}/shipments`, {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    assert.equal(duplicateShipmentRes.status, 409, JSON.stringify(duplicateShipmentRes.json));
    assert.equal(duplicateShipmentRes.json.error.code, "ACTIVE_SHIPMENT_EXISTS");

    const labelPayloadRes = await fetchJson(`/api/online-store/shipments/${encodeURIComponent(shipmentId)}/label`, {
      headers: MANAGER_HEADERS,
    });
    assert.equal(labelPayloadRes.status, 200, JSON.stringify(labelPayloadRes.json));
    assert.equal(labelPayloadRes.json.shipment.id, shipmentId);
    assert.equal(labelPayloadRes.json.document.format, "ZPL");
    assert.match(labelPayloadRes.json.document.content, /\^XA/);
    assert.match(labelPayloadRes.json.document.content, /COREPOS DEV SHIPMENT LABEL/);

    const labelContentRes = await fetchText(`/api/online-store/shipments/${encodeURIComponent(shipmentId)}/label/content`, {
      headers: MANAGER_HEADERS,
    });
    assert.equal(labelContentRes.status, 200, labelContentRes.text);
    assert.match(labelContentRes.text, /^\^XA/m);
    assert.equal(labelContentRes.headers.get("x-corepos-label-format"), "ZPL");

    const preparePrintRes = await fetchJson(`/api/online-store/shipments/${encodeURIComponent(shipmentId)}/prepare-print`, {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        copies: 2,
      }),
    });
    assert.equal(preparePrintRes.status, 200, JSON.stringify(preparePrintRes.json));
    assert.equal(preparePrintRes.json.shipment.status, "PRINT_PREPARED");
    assert.equal(preparePrintRes.json.printRequest.printer.transport, "WINDOWS_LOCAL_AGENT");
    assert.equal(preparePrintRes.json.printRequest.printer.printerFamily, "ZEBRA_LABEL");
    assert.equal(preparePrintRes.json.printRequest.printer.printerId, defaultPrinter.id);
    assert.equal(preparePrintRes.json.printRequest.printer.printerKey, defaultPrinter.key);
    assert.equal(preparePrintRes.json.printRequest.printer.printerName, "Dispatch Zebra GK420d");
    assert.equal(preparePrintRes.json.printRequest.printer.transportMode, "DRY_RUN");
    assert.equal(preparePrintRes.json.printRequest.printer.rawTcpHost, null);
    assert.equal(preparePrintRes.json.printRequest.printer.rawTcpPort, null);
    assert.equal(preparePrintRes.json.printRequest.printer.copies, 2);
    assert.equal(preparePrintRes.json.printRequest.document.format, "ZPL");

    const printRes = await fetchJson(`/api/online-store/shipments/${encodeURIComponent(shipmentId)}/print`, {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        copies: 2,
      }),
    });
    assert.equal(printRes.status, 200, JSON.stringify(printRes.json));
    assert.equal(printRes.json.shipment.status, "PRINTED");
    assert.equal(Boolean(printRes.json.shipment.printedAt), true);
    assert.equal(printRes.json.shipment.reprintCount, 0);
    assert.equal(printRes.json.printJob.transportMode, "DRY_RUN");
    assert.equal(printRes.json.printJob.simulated, true);
    assert.equal(printRes.json.printJob.printerId, defaultPrinter.id);
    assert.equal(printRes.json.printJob.printerKey, defaultPrinter.key);
    assert.equal(printRes.json.printJob.printerTarget, "dry-run://online-store-smoke");

    const reprintRes = await fetchJson(`/api/online-store/shipments/${encodeURIComponent(shipmentId)}/print`, {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        printerId: defaultPrinter.id,
        copies: 1,
      }),
    });
    assert.equal(reprintRes.status, 200, JSON.stringify(reprintRes.json));
    assert.equal(reprintRes.json.shipment.status, "PRINTED");
    assert.equal(reprintRes.json.shipment.reprintCount, 1);

    const dispatchRes = await fetchJson(`/api/online-store/shipments/${encodeURIComponent(shipmentId)}/dispatch`, {
      method: "POST",
      headers: MANAGER_HEADERS,
    });
    assert.equal(dispatchRes.status, 200, JSON.stringify(dispatchRes.json));
    assert.equal(dispatchRes.json.shipment.status, "DISPATCHED");
    assert.equal(Boolean(dispatchRes.json.shipment.dispatchedAt), true);

    const dispatchedDetailRes = await fetchJson(`/api/online-store/orders/${encodeURIComponent(createOrderRes.json.order.id)}`, {
      headers: MANAGER_HEADERS,
    });
    assert.equal(dispatchedDetailRes.status, 200, JSON.stringify(dispatchedDetailRes.json));
    assert.equal(dispatchedDetailRes.json.order.status, "DISPATCHED");
    assert.equal(dispatchedDetailRes.json.order.shipments[0].status, "DISPATCHED");

    const failureToken = `smoke-failure-${Date.now()}`;
    const failureOrderBody = createOrderBody(failureToken, {
      customerName: "Online Store Print Failure",
      shippingRecipientName: "Online Store Print Failure",
    });
    const createFailureOrderRes = await fetchJson("/api/online-store/orders", {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(failureOrderBody),
    });
    assert.equal(createFailureOrderRes.status, 201, JSON.stringify(createFailureOrderRes.json));
    createdOrderIds.push(createFailureOrderRes.json.order.id);

    const createFailureShipmentRes = await fetchJson(`/api/online-store/orders/${encodeURIComponent(createFailureOrderRes.json.order.id)}/shipments`, {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        providerKey: "INTERNAL_MOCK_ZPL",
      }),
    });
    assert.equal(createFailureShipmentRes.status, 201, JSON.stringify(createFailureShipmentRes.json));
    const failureShipmentId = createFailureShipmentRes.json.shipment.id;

    const clearDefaultPrinterRes = await fetchJson("/api/settings/printers/default-shipping-label", {
      method: "PUT",
      headers: {
        ...ADMIN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        printerId: null,
      }),
    });
    assert.equal(clearDefaultPrinterRes.status, 200, JSON.stringify(clearDefaultPrinterRes.json));

    const missingDefaultPrepareRes = await fetchJson(`/api/online-store/shipments/${encodeURIComponent(failureShipmentId)}/prepare-print`, {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        copies: 1,
      }),
    });
    assert.equal(missingDefaultPrepareRes.status, 409, JSON.stringify(missingDefaultPrepareRes.json));
    assert.equal(missingDefaultPrepareRes.json.error.code, "DEFAULT_SHIPPING_LABEL_PRINTER_NOT_CONFIGURED");

    const inactivePrinterPrepareRes = await fetchJson(`/api/online-store/shipments/${encodeURIComponent(failureShipmentId)}/prepare-print`, {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        printerId: inactivePrinter.id,
        copies: 1,
      }),
    });
    assert.equal(inactivePrinterPrepareRes.status, 409, JSON.stringify(inactivePrinterPrepareRes.json));
    assert.equal(inactivePrinterPrepareRes.json.error.code, "PRINTER_INACTIVE");

    const nonShippingPrinterPrepareRes = await fetchJson(`/api/online-store/shipments/${encodeURIComponent(failureShipmentId)}/prepare-print`, {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        printerId: nonShippingPrinter.id,
        copies: 1,
      }),
    });
    assert.equal(nonShippingPrinterPrepareRes.status, 409, JSON.stringify(nonShippingPrinterPrepareRes.json));
    assert.equal(nonShippingPrinterPrepareRes.json.error.code, "PRINTER_NOT_SHIPPING_LABEL_CAPABLE");

    const resetDefaultPrinterRes = await fetchJson("/api/settings/printers/default-shipping-label", {
      method: "PUT",
      headers: {
        ...ADMIN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        printerId: defaultPrinter.id,
      }),
    });
    assert.equal(resetDefaultPrinterRes.status, 200, JSON.stringify(resetDefaultPrinterRes.json));

    const failedPrintRes = await fetchJson(`/api/online-store/shipments/${encodeURIComponent(failureShipmentId)}/print`, {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        printerId: failingPrinter.id,
        copies: 1,
      }),
    });
    assert.equal(failedPrintRes.status, 502, JSON.stringify(failedPrintRes.json));
    assert.equal(failedPrintRes.json.error.code, "SHIPPING_PRINT_AGENT_REJECTED");

    const failedDetailRes = await fetchJson(`/api/online-store/orders/${encodeURIComponent(createFailureOrderRes.json.order.id)}`, {
      headers: MANAGER_HEADERS,
    });
    assert.equal(failedDetailRes.status, 200, JSON.stringify(failedDetailRes.json));
    assert.equal(failedDetailRes.json.order.shipments[0].status, "PRINT_PREPARED");
    assert.equal(failedDetailRes.json.order.shipments[0].printedAt, null);
    assert.equal(failedDetailRes.json.order.shipments[0].reprintCount, 0);

    assert.equal(fakePrintAgent.requests.length >= 3, true);
  } finally {
    if (createdOrderIds.length > 0) {
      await prisma.webOrder.deleteMany({
        where: { id: { in: createdOrderIds } },
      });
    }
    if (createdPrinterIds.length > 0) {
      await prisma.printer.deleteMany({
        where: { id: { in: createdPrinterIds } },
      });
    }
    await prisma.appConfig.deleteMany({
      where: {
        key: "dispatch.defaultShippingLabelPrinterId",
      },
    });

    await prisma.$disconnect();
    await Promise.allSettled([
      serverController.stop(),
      fakePrintAgent.close(),
    ]);
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
