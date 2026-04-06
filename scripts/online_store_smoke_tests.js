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
const ENV_PRINT_AGENT_SECRET = "online-store-smoke-env-print-secret";
const PERSISTED_PRINT_AGENT_SECRET = "online-store-smoke-settings-print-secret";
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

const startFakePrintAgent = async ({ sharedSecret }) => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/jobs/shipment-label") {
      if (req.headers["x-corepos-print-agent-secret"] !== sharedSecret) {
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
          transportMode: printRequest?.printer?.transportMode ?? "DRY_RUN",
          printerId: printRequest?.printer?.printerId ?? "unknown-printer-id",
          printerKey: printRequest?.printer?.printerKey ?? "UNKNOWN_PRINTER",
          printerName: printRequest?.printer?.printerName ?? "Dispatch Zebra GK420d",
          printerTarget:
            printRequest?.printer?.transportMode === "WINDOWS_PRINTER"
              ? printRequest?.printer?.windowsPrinterName ?? "ZDesigner GK420d"
              : "dry-run://online-store-smoke",
          copies,
          documentFormat: "ZPL",
          bytesSent: Buffer.byteLength(printableContent, "utf8"),
          simulated: printRequest?.printer?.transportMode !== "WINDOWS_PRINTER",
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
  const envFallbackPrintAgent = await startFakePrintAgent({
    sharedSecret: ENV_PRINT_AGENT_SECRET,
  });
  const persistedSettingsPrintAgent = await startFakePrintAgent({
    sharedSecret: PERSISTED_PRINT_AGENT_SECRET,
  });
  const serverController = createSmokeServerController({
    label: "online-store-smoke",
    baseUrl: BASE_URL,
    databaseUrl: DATABASE_URL,
    envOverrides: {
      COREPOS_SHIPPING_PRINT_AGENT_URL: envFallbackPrintAgent.url,
      COREPOS_SHIPPING_PRINT_AGENT_SHARED_SECRET: ENV_PRINT_AGENT_SECRET,
    },
  });

  try {
    await prisma.appConfig.deleteMany({
      where: {
        key: {
          in: [
            "dispatch.defaultShippingLabelPrinterId",
            "dispatch.shippingPrintAgent",
          ],
        },
      },
    });

    await serverController.startIfNeeded();

    const initialConfigRes = await fetchJson("/api/settings/shipping-print-agent", {
      headers: MANAGER_HEADERS,
    });
    assert.equal(initialConfigRes.status, 200, JSON.stringify(initialConfigRes.json));
    assert.equal(initialConfigRes.json.config.url, null);
    assert.equal(initialConfigRes.json.config.effectiveSource, "environment");
    assert.equal(initialConfigRes.json.config.envFallbackUrl, envFallbackPrintAgent.url);
    assert.equal(initialConfigRes.json.config.envFallbackHasSharedSecret, true);

    const saveConfigRes = await fetchJson("/api/settings/shipping-print-agent", {
      method: "PUT",
      headers: {
        ...ADMIN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: persistedSettingsPrintAgent.url,
        sharedSecret: PERSISTED_PRINT_AGENT_SECRET,
      }),
    });
    assert.equal(saveConfigRes.status, 200, JSON.stringify(saveConfigRes.json));
    assert.equal(saveConfigRes.json.config.url, persistedSettingsPrintAgent.url);
    assert.equal(saveConfigRes.json.config.effectiveSource, "settings");
    assert.equal(saveConfigRes.json.config.hasSharedSecret, true);
    assert.match(saveConfigRes.json.config.sharedSecretHint, /^••••/);

    const defaultPrinter = await createPrinter({
      name: "Dispatch Zebra GK420d",
      key: "DISPATCH_ZEBRA_GK420D",
      transportMode: "DRY_RUN",
      location: "Dispatch bench",
    });
    createdPrinterIds.push(defaultPrinter.id);
    const windowsPrinter = await createPrinter({
      name: "Dispatch Zebra USB Helper",
      key: "DISPATCH_ZEBRA_USB_HELPER",
      transportMode: "WINDOWS_PRINTER",
      windowsPrinterName: "ZDesigner GK420d",
      location: "Dispatch bench",
      notes: "USB Zebra on Windows helper host",
    });
    createdPrinterIds.push(windowsPrinter.id);
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
    assert.equal(createOrderRes.json.order.packedAt, null);
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
    assert.equal(detailRes.json.order.packedAt, null);

    const unpackedCreateShipmentRes = await fetchJson(`/api/online-store/orders/${encodeURIComponent(createOrderRes.json.order.id)}/shipments`, {
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
    assert.equal(unpackedCreateShipmentRes.status, 409, JSON.stringify(unpackedCreateShipmentRes.json));
    assert.equal(unpackedCreateShipmentRes.json.error.code, "WEB_ORDER_NOT_PACKED");

    const packOrderRes = await fetchJson(`/api/online-store/orders/${encodeURIComponent(createOrderRes.json.order.id)}/packing`, {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ packed: true }),
    });
    assert.equal(packOrderRes.status, 200, JSON.stringify(packOrderRes.json));
    assert.equal(Boolean(packOrderRes.json.order.packedAt), true);

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
    assert.equal(createShipmentRes.json.shipment.providerRefundStatus, null);
    assert.equal(Boolean(createShipmentRes.json.shipment.providerSyncedAt), true);
    const shipmentId = createShipmentRes.json.shipment.id;

    const blockedScanRes = await fetchJson("/api/online-store/dispatch-scan", {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        value: createShipmentRes.json.shipment.trackingNumber,
      }),
    });
    assert.equal(blockedScanRes.status, 200, JSON.stringify(blockedScanRes.json));
    assert.equal(blockedScanRes.json.status, "MATCHED");
    assert.equal(blockedScanRes.json.matchedBy, "TRACKING_NUMBER");
    assert.equal(blockedScanRes.json.order.orderNumber, successOrderBody.orderNumber);
    assert.equal(blockedScanRes.json.dispatchable, false);
    assert.equal(blockedScanRes.json.dispatchBlockedCode, "SHIPMENT_NOT_PRINTED");

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
    assert.match(labelPayloadRes.json.document.content, /\^PW812/);
    assert.match(labelPayloadRes.json.document.content, /\^LL1218/);
    assert.match(labelPayloadRes.json.document.content, /SHIP TO/);
    assert.match(labelPayloadRes.json.document.content, /TRACKING NUMBER/);
    assert.match(labelPayloadRes.json.document.content, /\^BCN,156,N,N,N/);
    assert.doesNotMatch(labelPayloadRes.json.document.content, /COREPOS DEV SHIPMENT LABEL/);

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

    const dispatchableScanRes = await fetchJson("/api/online-store/dispatch-scan", {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        value: printRes.json.shipment.providerShipmentReference,
      }),
    });
    assert.equal(dispatchableScanRes.status, 200, JSON.stringify(dispatchableScanRes.json));
    assert.equal(dispatchableScanRes.json.status, "MATCHED");
    assert.equal(dispatchableScanRes.json.matchedBy, "PROVIDER_SHIPMENT_REFERENCE");
    assert.equal(dispatchableScanRes.json.order.id, createOrderRes.json.order.id);
    assert.equal(dispatchableScanRes.json.shipment.id, shipmentId);
    assert.equal(dispatchableScanRes.json.dispatchable, true);
    assert.equal(dispatchableScanRes.json.dispatchBlockedCode, null);

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

    const dispatchedScanRes = await fetchJson("/api/online-store/dispatch-scan", {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        value: dispatchedDetailRes.json.order.shipments[0].trackingNumber,
      }),
    });
    assert.equal(dispatchedScanRes.status, 200, JSON.stringify(dispatchedScanRes.json));
    assert.equal(dispatchedScanRes.json.status, "MATCHED");
    assert.equal(dispatchedScanRes.json.dispatchable, false);
    assert.equal(dispatchedScanRes.json.dispatchBlockedCode, "SHIPMENT_ALREADY_DISPATCHED");

    const helperToken = `smoke-helper-${Date.now()}`;
    const helperOrderBody = createOrderBody(helperToken, {
      customerName: "Online Store Zebra Helper",
      shippingRecipientName: "Online Store Zebra Helper",
    });
    const createHelperOrderRes = await fetchJson("/api/online-store/orders", {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(helperOrderBody),
    });
    assert.equal(createHelperOrderRes.status, 201, JSON.stringify(createHelperOrderRes.json));
    createdOrderIds.push(createHelperOrderRes.json.order.id);

    const packHelperOrderRes = await fetchJson(`/api/online-store/orders/${encodeURIComponent(createHelperOrderRes.json.order.id)}/packing`, {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ packed: true }),
    });
    assert.equal(packHelperOrderRes.status, 200, JSON.stringify(packHelperOrderRes.json));

    const createHelperShipmentRes = await fetchJson(`/api/online-store/orders/${encodeURIComponent(createHelperOrderRes.json.order.id)}/shipments`, {
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
    assert.equal(createHelperShipmentRes.status, 201, JSON.stringify(createHelperShipmentRes.json));
    const helperShipmentId = createHelperShipmentRes.json.shipment.id;

    const prepareHelperPrintRes = await fetchJson(`/api/online-store/shipments/${encodeURIComponent(helperShipmentId)}/prepare-print`, {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        printerId: windowsPrinter.id,
        copies: 1,
      }),
    });
    assert.equal(prepareHelperPrintRes.status, 200, JSON.stringify(prepareHelperPrintRes.json));
    assert.equal(prepareHelperPrintRes.json.printRequest.printer.transportMode, "WINDOWS_PRINTER");
    assert.equal(prepareHelperPrintRes.json.printRequest.printer.windowsPrinterName, "ZDesigner GK420d");
    assert.equal(prepareHelperPrintRes.json.printRequest.printer.rawTcpHost, null);
    assert.equal(prepareHelperPrintRes.json.printRequest.printer.rawTcpPort, null);

    const helperPrintRes = await fetchJson(`/api/online-store/shipments/${encodeURIComponent(helperShipmentId)}/print`, {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        printerId: windowsPrinter.id,
        copies: 1,
      }),
    });
    assert.equal(helperPrintRes.status, 200, JSON.stringify(helperPrintRes.json));
    assert.equal(helperPrintRes.json.shipment.status, "PRINTED");
    assert.equal(helperPrintRes.json.printJob.transportMode, "WINDOWS_PRINTER");
    assert.equal(helperPrintRes.json.printJob.simulated, false);
    assert.equal(helperPrintRes.json.printJob.printerTarget, "ZDesigner GK420d");

    const helperPrintAgentRequest = persistedSettingsPrintAgent.requests.at(-1);
    assert.equal(helperPrintAgentRequest?.printRequest?.printer?.transportMode, "WINDOWS_PRINTER");
    assert.equal(helperPrintAgentRequest?.printRequest?.printer?.windowsPrinterName, "ZDesigner GK420d");
    assert.equal(helperPrintAgentRequest?.printRequest?.printer?.printerId, windowsPrinter.id);

    const clearStoredConfigRes = await fetchJson("/api/settings/shipping-print-agent", {
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
    assert.equal(clearStoredConfigRes.json.config.envFallbackUrl, envFallbackPrintAgent.url);

    const noMatchScanRes = await fetchJson("/api/online-store/dispatch-scan", {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        value: `missing-${Date.now()}`,
      }),
    });
    assert.equal(noMatchScanRes.status, 200, JSON.stringify(noMatchScanRes.json));
    assert.equal(noMatchScanRes.json.status, "NO_MATCH");
    assert.equal(noMatchScanRes.json.order, null);
    assert.equal(noMatchScanRes.json.shipment, null);

    const voidToken = `smoke-void-${Date.now()}`;
    const voidOrderBody = createOrderBody(voidToken, {
      customerName: "Online Store Void Flow",
      shippingRecipientName: "Online Store Void Flow",
    });
    const createVoidOrderRes = await fetchJson("/api/online-store/orders", {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(voidOrderBody),
    });
    assert.equal(createVoidOrderRes.status, 201, JSON.stringify(createVoidOrderRes.json));
    createdOrderIds.push(createVoidOrderRes.json.order.id);

    const packVoidOrderRes = await fetchJson(`/api/online-store/orders/${encodeURIComponent(createVoidOrderRes.json.order.id)}/packing`, {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ packed: true }),
    });
    assert.equal(packVoidOrderRes.status, 200, JSON.stringify(packVoidOrderRes.json));

    const createVoidShipmentRes = await fetchJson(
      `/api/online-store/orders/${encodeURIComponent(createVoidOrderRes.json.order.id)}/shipments`,
      {
        method: "POST",
        headers: {
          ...MANAGER_HEADERS,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerKey: "INTERNAL_MOCK_ZPL",
        }),
      },
    );
    assert.equal(createVoidShipmentRes.status, 201, JSON.stringify(createVoidShipmentRes.json));
    const voidShipmentId = createVoidShipmentRes.json.shipment.id;

    const cancelShipmentRes = await fetchJson(
      `/api/online-store/shipments/${encodeURIComponent(voidShipmentId)}/cancel`,
      {
        method: "POST",
        headers: MANAGER_HEADERS,
      },
    );
    assert.equal(cancelShipmentRes.status, 200, JSON.stringify(cancelShipmentRes.json));
    assert.equal(cancelShipmentRes.json.shipment.status, "VOIDED");
    assert.equal(cancelShipmentRes.json.shipment.providerRefundStatus, "REFUNDED");
    assert.equal(Boolean(cancelShipmentRes.json.shipment.voidedAt), true);

    const blockedVoidedPrepareRes = await fetchJson(
      `/api/online-store/shipments/${encodeURIComponent(voidShipmentId)}/prepare-print`,
      {
        method: "POST",
        headers: {
          ...MANAGER_HEADERS,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ copies: 1 }),
      },
    );
    assert.equal(blockedVoidedPrepareRes.status, 409, JSON.stringify(blockedVoidedPrepareRes.json));
    assert.equal(blockedVoidedPrepareRes.json.error.code, "SHIPMENT_VOIDED");

    const regenerateShipmentRes = await fetchJson(
      `/api/online-store/shipments/${encodeURIComponent(voidShipmentId)}/regenerate`,
      {
        method: "POST",
        headers: MANAGER_HEADERS,
      },
    );
    assert.equal(regenerateShipmentRes.status, 201, JSON.stringify(regenerateShipmentRes.json));
    assert.equal(regenerateShipmentRes.json.shipment.shipmentNumber, 2);
    assert.equal(regenerateShipmentRes.json.shipment.status, "LABEL_READY");
    assert.equal(regenerateShipmentRes.json.shipment.providerKey, "INTERNAL_MOCK_ZPL");

    const regeneratedDetailRes = await fetchJson(
      `/api/online-store/orders/${encodeURIComponent(createVoidOrderRes.json.order.id)}`,
      {
        headers: MANAGER_HEADERS,
      },
    );
    assert.equal(regeneratedDetailRes.status, 200, JSON.stringify(regeneratedDetailRes.json));
    assert.equal(regeneratedDetailRes.json.order.shipments[0].shipmentNumber, 2);
    assert.equal(regeneratedDetailRes.json.order.shipments[0].status, "LABEL_READY");
    assert.equal(regeneratedDetailRes.json.order.shipments[1].status, "VOIDED");

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

    const packFailureOrderRes = await fetchJson(`/api/online-store/orders/${encodeURIComponent(createFailureOrderRes.json.order.id)}/packing`, {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ packed: true }),
    });
    assert.equal(packFailureOrderRes.status, 200, JSON.stringify(packFailureOrderRes.json));

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
    const envFallbackPrintAgentRequest = envFallbackPrintAgent.requests.at(-1);
    assert.equal(envFallbackPrintAgentRequest?.printRequest?.printer?.printerKey, "FORCE_FAILING_ZEBRA");

    const failedDetailRes = await fetchJson(`/api/online-store/orders/${encodeURIComponent(createFailureOrderRes.json.order.id)}`, {
      headers: MANAGER_HEADERS,
    });
    assert.equal(failedDetailRes.status, 200, JSON.stringify(failedDetailRes.json));
    assert.equal(failedDetailRes.json.order.shipments[0].status, "PRINT_PREPARED");
    assert.equal(failedDetailRes.json.order.shipments[0].printedAt, null);
    assert.equal(failedDetailRes.json.order.shipments[0].reprintCount, 0);

    const bulkReadyToken = `smoke-bulk-ready-${Date.now()}`;
    const bulkReadyOrderRes = await fetchJson("/api/online-store/orders", {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(createOrderBody(bulkReadyToken, {
        customerName: "Bulk Ready Dispatch",
        shippingRecipientName: "Bulk Ready Dispatch",
      })),
    });
    assert.equal(bulkReadyOrderRes.status, 201, JSON.stringify(bulkReadyOrderRes.json));
    createdOrderIds.push(bulkReadyOrderRes.json.order.id);

    const bulkUnpackedToken = `smoke-bulk-unpacked-${Date.now()}`;
    const bulkUnpackedOrderRes = await fetchJson("/api/online-store/orders", {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(createOrderBody(bulkUnpackedToken, {
        customerName: "Bulk Unpacked Dispatch",
        shippingRecipientName: "Bulk Unpacked Dispatch",
      })),
    });
    assert.equal(bulkUnpackedOrderRes.status, 201, JSON.stringify(bulkUnpackedOrderRes.json));
    createdOrderIds.push(bulkUnpackedOrderRes.json.order.id);

    const markBulkReadyPackedRes = await fetchJson(`/api/online-store/orders/${encodeURIComponent(bulkReadyOrderRes.json.order.id)}/packing`, {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ packed: true }),
    });
    assert.equal(markBulkReadyPackedRes.status, 200, JSON.stringify(markBulkReadyPackedRes.json));
    assert.equal(Boolean(markBulkReadyPackedRes.json.order.packedAt), true);

    const packedListRes = await fetchJson("/api/online-store/orders?packed=true", {
      headers: MANAGER_HEADERS,
    });
    assert.equal(packedListRes.status, 200, JSON.stringify(packedListRes.json));
    assert.equal(packedListRes.json.orders.some((order) => order.id === bulkReadyOrderRes.json.order.id), true);
    assert.equal(packedListRes.json.orders.some((order) => order.id === bulkUnpackedOrderRes.json.order.id), false);

    const bulkCreateRes = await fetchJson("/api/online-store/orders/bulk/shipments", {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orderIds: [bulkReadyOrderRes.json.order.id, bulkUnpackedOrderRes.json.order.id, randomUUID()],
        providerKey: "INTERNAL_MOCK_ZPL",
        serviceCode: "STANDARD",
        serviceName: "Standard Dispatch",
      }),
    });
    assert.equal(bulkCreateRes.status, 200, JSON.stringify(bulkCreateRes.json));
    assert.equal(bulkCreateRes.json.action, "CREATE_SHIPMENTS");
    assert.equal(bulkCreateRes.json.summary.requestedCount, 3);
    assert.equal(bulkCreateRes.json.summary.succeededCount, 1);
    assert.equal(bulkCreateRes.json.summary.skippedCount, 1);
    assert.equal(bulkCreateRes.json.summary.failedCount, 1);

    const bulkCreatedOrderDetailRes = await fetchJson(`/api/online-store/orders/${encodeURIComponent(bulkReadyOrderRes.json.order.id)}`, {
      headers: MANAGER_HEADERS,
    });
    assert.equal(bulkCreatedOrderDetailRes.status, 200, JSON.stringify(bulkCreatedOrderDetailRes.json));
    assert.equal(bulkCreatedOrderDetailRes.json.order.shipments[0].status, "LABEL_READY");

    const bulkPrintRes = await fetchJson("/api/online-store/orders/bulk/print", {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orderIds: [bulkReadyOrderRes.json.order.id, bulkUnpackedOrderRes.json.order.id, randomUUID()],
        printerId: defaultPrinter.id,
        copies: 1,
      }),
    });
    assert.equal(bulkPrintRes.status, 200, JSON.stringify(bulkPrintRes.json));
    assert.equal(bulkPrintRes.json.action, "PRINT_SHIPMENTS");
    assert.equal(bulkPrintRes.json.summary.requestedCount, 3);
    assert.equal(bulkPrintRes.json.summary.succeededCount, 1);
    assert.equal(bulkPrintRes.json.summary.skippedCount, 1);
    assert.equal(bulkPrintRes.json.summary.failedCount, 1);

    const bulkDispatchRes = await fetchJson("/api/online-store/orders/bulk/dispatch", {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orderIds: [bulkReadyOrderRes.json.order.id, bulkUnpackedOrderRes.json.order.id, randomUUID()],
      }),
    });
    assert.equal(bulkDispatchRes.status, 200, JSON.stringify(bulkDispatchRes.json));
    assert.equal(bulkDispatchRes.json.action, "DISPATCH_SHIPMENTS");
    assert.equal(bulkDispatchRes.json.summary.requestedCount, 3);
    assert.equal(bulkDispatchRes.json.summary.succeededCount, 1);
    assert.equal(bulkDispatchRes.json.summary.skippedCount, 1);
    assert.equal(bulkDispatchRes.json.summary.failedCount, 1);

    const bulkDispatchedOrderDetailRes = await fetchJson(`/api/online-store/orders/${encodeURIComponent(bulkReadyOrderRes.json.order.id)}`, {
      headers: MANAGER_HEADERS,
    });
    assert.equal(bulkDispatchedOrderDetailRes.status, 200, JSON.stringify(bulkDispatchedOrderDetailRes.json));
    assert.equal(bulkDispatchedOrderDetailRes.json.order.status, "DISPATCHED");
    assert.equal(bulkDispatchedOrderDetailRes.json.order.shipments[0].status, "DISPATCHED");

    assert.equal(persistedSettingsPrintAgent.requests.length >= 3, true);
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
        key: {
          in: [
            "dispatch.defaultShippingLabelPrinterId",
            "dispatch.shippingPrintAgent",
          ],
        },
      },
    });

    await prisma.$disconnect();
    await Promise.allSettled([
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
