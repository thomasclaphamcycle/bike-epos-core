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
const EASYPOST_API_KEY = "EZTKshippingprovidersmoketest";
const EASYPOST_CARRIER_ACCOUNT_ID = "ca_shipping_provider_smoke";
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

const buildEasyPostLabelContent = (trackingNumber, orderReference) => [
  "^XA",
  "^CI28",
  "^PW812",
  "^LL1218",
  `^FO36,36^A0N,34,34^FDEASYPOST ${orderReference}^FS`,
  `^FO36,96^A0N,28,28^FDTracking: ${trackingNumber}^FS`,
  `^FO36,150^A0N,28,28^FDCarrier account: ${EASYPOST_CARRIER_ACCOUNT_ID}^FS`,
  "^FO36,206^GB740,0,2^FS",
  `^FO36,272^BCN,120,Y,N,N^FD${trackingNumber}^FS`,
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

const startFakeEasyPostProvider = async () => {
  const requests = {
    create: [],
    buy: [],
    refresh: [],
    refund: [],
    labelDownloads: [],
  };
  const shipments = new Map();
  const labels = new Map();

  const serializeShipment = (baseUrl, shipment) => ({
    id: shipment.shipmentId,
    mode: "test",
    status: shipment.status,
    refund_status: shipment.refundStatus,
    tracking_code: shipment.trackingNumber,
    selected_rate: shipment.purchased
      ? {
          id: shipment.rateId,
          service: "GroundAdvantage",
          carrier: "USPS",
          carrier_account_id: EASYPOST_CARRIER_ACCOUNT_ID,
          rate: "8.25",
          currency: "USD",
        }
      : null,
    tracker: shipment.purchased
      ? {
          id: shipment.trackerId,
          status: shipment.trackerStatus,
        }
      : null,
    postage_label: shipment.purchased
      ? {
          id: shipment.labelId,
          label_file_type: "application/zpl",
          label_url: `${baseUrl}/labels/${encodeURIComponent(shipment.shipmentId)}.zpl`,
          label_zpl_url: `${baseUrl}/labels/${encodeURIComponent(shipment.shipmentId)}.zpl`,
          label_size: "4x6",
        }
      : null,
    rates: [
      {
        id: shipment.rateId,
        service: "GroundAdvantage",
        carrier: "USPS",
        carrier_account_id: EASYPOST_CARRIER_ACCOUNT_ID,
        rate: "8.25",
        currency: "USD",
      },
    ],
  });

  const server = http.createServer(async (req, res) => {
    const baseUrl = `http://${req.headers.host || "127.0.0.1"}`;
    const url = new URL(req.url || "/", baseUrl);
    const expectedAuthorization = `Basic ${Buffer.from(`${EASYPOST_API_KEY}:`, "utf8").toString("base64")}`;

    if (req.method === "POST" && url.pathname === "/shipments") {
      if (req.headers.authorization !== expectedAuthorization) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Unauthorized" } }));
        return;
      }
      const payload = await readJsonBody(req);
      requests.create.push({
        headers: req.headers,
        payload,
      });

      const shipmentPayload = payload?.shipment ?? {};
      const reference = String(shipmentPayload.reference ?? "WEB-UNKNOWN / 1");
      const token = reference.replace(/[^A-Za-z0-9]/g, "").slice(-18).toUpperCase() || "EASYPOST";
      const shipmentId = `shp_${token}`;
      const rateId = `rate_${token}`;

      shipments.set(shipmentId, {
        shipmentId,
        rateId,
        reference,
        purchased: false,
        status: "unknown",
        refundStatus: null,
        trackingNumber: null,
        trackerId: null,
        trackerStatus: null,
        labelId: null,
        pendingRefundFinalization: false,
      });

      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        id: shipmentId,
        mode: "test",
        status: "unknown",
        rates: [
          {
            id: rateId,
            service: "GroundAdvantage",
            carrier: "USPS",
            carrier_account_id: EASYPOST_CARRIER_ACCOUNT_ID,
            rate: "8.25",
            currency: "USD",
          },
        ],
      }));
      return;
    }

    const buyMatch = req.method === "POST" ? url.pathname.match(/^\/shipments\/([^/]+)\/buy$/) : null;
    if (buyMatch) {
      if (req.headers.authorization !== expectedAuthorization) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Unauthorized" } }));
        return;
      }
      const shipmentId = buyMatch[1];
      const payload = await readJsonBody(req);
      requests.buy.push({
        headers: req.headers,
        payload,
        shipmentId,
      });

      const shipment = shipments.get(shipmentId);
      if (!shipment) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Shipment not found" } }));
        return;
      }
      if (payload?.rate?.id !== shipment.rateId) {
        res.writeHead(422, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Unknown rate ID" } }));
        return;
      }

      const trackingNumber = `EZ${shipment.reference.replace(/[^A-Za-z0-9]/g, "").slice(-14).toUpperCase()}`;
      const trackerId = `trk_${shipment.reference.replace(/[^A-Za-z0-9]/g, "").slice(-14).toLowerCase()}`;
      const labelId = `pl_${shipment.reference.replace(/[^A-Za-z0-9]/g, "").slice(-14).toLowerCase()}`;
      labels.set(shipmentId, buildEasyPostLabelContent(trackingNumber, shipment.reference));
      shipment.purchased = true;
      shipment.status = "pre_transit";
      shipment.trackingNumber = trackingNumber;
      shipment.trackerId = trackerId;
      shipment.trackerStatus = "pre_transit";
      shipment.labelId = labelId;

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(serializeShipment(baseUrl, shipment)));
      return;
    }

    const refreshMatch = req.method === "GET" ? url.pathname.match(/^\/shipments\/([^/]+)$/) : null;
    if (refreshMatch) {
      if (req.headers.authorization !== expectedAuthorization) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Unauthorized" } }));
        return;
      }

      const shipmentId = refreshMatch[1];
      const shipment = shipments.get(shipmentId);
      requests.refresh.push({
        headers: req.headers,
        shipmentId,
      });

      if (!shipment) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Shipment not found" } }));
        return;
      }

      if (shipment.pendingRefundFinalization && shipment.refundStatus === "submitted") {
        shipment.pendingRefundFinalization = false;
        shipment.refundStatus = "refunded";
        shipment.status = "cancelled";
        shipment.trackerStatus = "cancelled";
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(serializeShipment(baseUrl, shipment)));
      return;
    }

    const refundMatch = req.method === "POST" ? url.pathname.match(/^\/shipments\/([^/]+)\/refund$/) : null;
    if (refundMatch) {
      if (req.headers.authorization !== expectedAuthorization) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Unauthorized" } }));
        return;
      }

      const shipmentId = refundMatch[1];
      const shipment = shipments.get(shipmentId);
      requests.refund.push({
        headers: req.headers,
        shipmentId,
      });

      if (!shipment) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Shipment not found" } }));
        return;
      }

      shipment.refundStatus = "submitted";
      shipment.pendingRefundFinalization = true;

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(serializeShipment(baseUrl, shipment)));
      return;
    }

    const labelMatch = req.method === "GET" ? url.pathname.match(/^\/labels\/([^/]+)\.zpl$/) : null;
    if (labelMatch) {
      const shipmentId = decodeURIComponent(labelMatch[1]);
      requests.labelDownloads.push({
        headers: req.headers,
        shipmentId,
      });
      const labelContent = labels.get(shipmentId);
      if (!labelContent) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Label not found");
        return;
      }

      res.writeHead(200, { "Content-Type": "application/zpl" });
      res.end(labelContent);
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
    throw new Error("Fake EasyPost provider did not expose a TCP address");
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
  const fakeEasyPost = await startFakeEasyPostProvider();
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

    const storeInfoRes = await fetchJson("/api/settings/store-info", {
      method: "PATCH",
      headers: {
        ...ADMIN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "CorePOS Demo Store",
        businessName: "CorePOS Demo Store Ltd",
        email: "hello@corepos.demo",
        phone: "01234 567890",
        addressLine1: "1 Demo High Street",
        city: "Clapham",
        region: "Greater London",
        postcode: "SW4 0HY",
        country: "United Kingdom",
      }),
    });
    assert.equal(storeInfoRes.status, 200, JSON.stringify(storeInfoRes.json));

    const listBefore = await fetchJson("/api/settings/shipping-providers", {
      headers: MANAGER_HEADERS,
    });
    assert.equal(listBefore.status, 200, JSON.stringify(listBefore.json));
    assert.equal(listBefore.json.defaultProviderKey, "INTERNAL_MOCK_ZPL");
    assert.equal(listBefore.json.providers.some((provider) => provider.key === "GENERIC_HTTP_ZPL"), true);
    assert.equal(listBefore.json.providers.some((provider) => provider.key === "EASYPOST"), true);
    assert.equal(
      listBefore.json.providers.find((provider) => provider.key === "EASYPOST").supportsShipmentRefresh,
      true,
    );
    assert.equal(
      listBefore.json.providers.find((provider) => provider.key === "EASYPOST").supportsShipmentVoid,
      true,
    );

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

    const invalidEasyPostConfig = await fetchJson("/api/settings/shipping-providers/EASYPOST", {
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
    assert.equal(invalidEasyPostConfig.status, 409, JSON.stringify(invalidEasyPostConfig.json));
    assert.equal(invalidEasyPostConfig.json.error.code, "SHIPPING_PROVIDER_NOT_CONFIGURED");

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

    const packOrderRes = await fetchJson(`/api/online-store/orders/${encodeURIComponent(createOrderRes.json.order.id)}/packing`, {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ packed: true }),
    });
    assert.equal(packOrderRes.status, 200, JSON.stringify(packOrderRes.json));

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

    const packFailureOrderRes = await fetchJson(`/api/online-store/orders/${encodeURIComponent(failureOrderRes.json.order.id)}/packing`, {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ packed: true }),
    });
    assert.equal(packFailureOrderRes.status, 200, JSON.stringify(packFailureOrderRes.json));

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

    const validEasyPostConfig = await fetchJson("/api/settings/shipping-providers/EASYPOST", {
      method: "PUT",
      headers: {
        ...ADMIN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
        environment: "SANDBOX",
        displayName: "EasyPost Sandbox",
        apiBaseUrl: fakeEasyPost.url,
        carrierAccountId: EASYPOST_CARRIER_ACCOUNT_ID,
        defaultServiceCode: "GroundAdvantage",
        defaultServiceName: "Ground Advantage",
        parcelWeightOz: 24,
        parcelLengthIn: 10,
        parcelWidthIn: 8,
        parcelHeightIn: 4,
        apiKey: EASYPOST_API_KEY,
      }),
    });
    assert.equal(validEasyPostConfig.status, 200, JSON.stringify(validEasyPostConfig.json));
    assert.equal(validEasyPostConfig.json.provider.isAvailable, true);
    assert.equal(validEasyPostConfig.json.provider.configuration.carrierAccountId, EASYPOST_CARRIER_ACCOUNT_ID);

    const setEasyPostDefault = await fetchJson("/api/settings/shipping-providers/default", {
      method: "PUT",
      headers: {
        ...ADMIN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ providerKey: "EASYPOST" }),
    });
    assert.equal(setEasyPostDefault.status, 200, JSON.stringify(setEasyPostDefault.json));
    assert.equal(setEasyPostDefault.json.defaultProviderKey, "EASYPOST");

    const easyPostToken = `EP-${randomUUID().slice(0, 8).toUpperCase()}`;
    const easyPostOrderRes = await fetchJson("/api/online-store/orders", {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(createOrderBody(easyPostToken)),
    });
    assert.equal(easyPostOrderRes.status, 201, JSON.stringify(easyPostOrderRes.json));
    createdOrderIds.push(easyPostOrderRes.json.order.id);

    const packEasyPostOrderRes = await fetchJson(`/api/online-store/orders/${encodeURIComponent(easyPostOrderRes.json.order.id)}/packing`, {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ packed: true }),
    });
    assert.equal(packEasyPostOrderRes.status, 200, JSON.stringify(packEasyPostOrderRes.json));

    const easyPostShipmentRes = await fetchJson(
      `/api/online-store/orders/${encodeURIComponent(easyPostOrderRes.json.order.id)}/shipments`,
      {
        method: "POST",
        headers: {
          ...MANAGER_HEADERS,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );
    assert.equal(easyPostShipmentRes.status, 201, JSON.stringify(easyPostShipmentRes.json));
    assert.equal(easyPostShipmentRes.json.shipment.providerKey, "EASYPOST");
    assert.equal(easyPostShipmentRes.json.shipment.providerDisplayName, "EasyPost Sandbox");
    assert.equal(easyPostShipmentRes.json.shipment.providerEnvironment, "SANDBOX");
    assert.equal(easyPostShipmentRes.json.shipment.serviceCode, "GroundAdvantage");
    assert.equal(easyPostShipmentRes.json.shipment.serviceName, "GroundAdvantage");
    assert.equal(easyPostShipmentRes.json.shipment.providerShipmentReference.startsWith("shp_"), true);
    assert.equal(easyPostShipmentRes.json.shipment.providerTrackingReference.startsWith("trk_"), true);
    assert.equal(easyPostShipmentRes.json.shipment.providerLabelReference.startsWith("pl_"), true);
    assert.equal(easyPostShipmentRes.json.shipment.providerStatus, "PRE_TRANSIT");
    assert.equal(easyPostShipmentRes.json.shipment.providerRefundStatus, null);
    assert.equal(Boolean(easyPostShipmentRes.json.shipment.providerSyncedAt), true);
    const easyPostShipmentId = easyPostShipmentRes.json.shipment.id;

    assert.equal(fakeEasyPost.requests.create.length, 1);
    assert.equal(fakeEasyPost.requests.buy.length, 1);
    assert.equal(fakeEasyPost.requests.labelDownloads.length, 1);
    assert.equal(
      fakeEasyPost.requests.create[0].headers.authorization,
      `Basic ${Buffer.from(`${EASYPOST_API_KEY}:`, "utf8").toString("base64")}`,
    );
    assert.equal(
      fakeEasyPost.requests.create[0].payload.shipment.carrier_accounts[0],
      EASYPOST_CARRIER_ACCOUNT_ID,
    );
    assert.equal(fakeEasyPost.requests.create[0].payload.shipment.to_address.email, easyPostOrderRes.json.order.customerEmail);
    assert.equal(fakeEasyPost.requests.create[0].payload.shipment.to_address.phone, easyPostOrderRes.json.order.customerPhone);
    assert.equal(fakeEasyPost.requests.create[0].payload.shipment.from_address.country, "GB");
    assert.equal(fakeEasyPost.requests.create[0].payload.shipment.from_address.street1, "1 Demo High Street");
    assert.equal(
      String(fakeEasyPost.requests.create[0].payload.shipment.from_address.name).includes("CorePOS"),
      true,
    );
    assert.equal(fakeEasyPost.requests.create[0].payload.shipment.options.label_format, "ZPL");
    assert.equal(fakeEasyPost.requests.create[0].payload.shipment.parcel.weight, 24);
    assert.equal(fakeEasyPost.requests.buy[0].payload.rate.id.startsWith("rate_"), true);

    const easyPostRefreshRes = await fetchJson(
      `/api/online-store/shipments/${encodeURIComponent(easyPostShipmentId)}/refresh`,
      {
        method: "POST",
        headers: MANAGER_HEADERS,
      },
    );
    assert.equal(easyPostRefreshRes.status, 200, JSON.stringify(easyPostRefreshRes.json));
    assert.equal(easyPostRefreshRes.json.shipment.status, "LABEL_READY");
    assert.equal(easyPostRefreshRes.json.shipment.providerStatus, "PRE_TRANSIT");
    assert.equal(easyPostRefreshRes.json.shipment.providerRefundStatus, null);

    const easyPostVoidRes = await fetchJson(
      `/api/online-store/shipments/${encodeURIComponent(easyPostShipmentId)}/cancel`,
      {
        method: "POST",
        headers: MANAGER_HEADERS,
      },
    );
    assert.equal(easyPostVoidRes.status, 200, JSON.stringify(easyPostVoidRes.json));
    assert.equal(easyPostVoidRes.json.shipment.status, "VOID_PENDING");
    assert.equal(easyPostVoidRes.json.shipment.providerRefundStatus, "SUBMITTED");
    assert.equal(Boolean(easyPostVoidRes.json.shipment.voidRequestedAt), true);

    const blockedVoidPrintRes = await fetchJson(
      `/api/online-store/shipments/${encodeURIComponent(easyPostShipmentId)}/print`,
      {
        method: "POST",
        headers: {
          ...MANAGER_HEADERS,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ printerId: printer.id, copies: 1 }),
      },
    );
    assert.equal(blockedVoidPrintRes.status, 409, JSON.stringify(blockedVoidPrintRes.json));
    assert.equal(blockedVoidPrintRes.json.error.code, "SHIPMENT_VOID_PENDING");

    const easyPostVoidRefreshRes = await fetchJson(
      `/api/online-store/shipments/${encodeURIComponent(easyPostShipmentId)}/refresh`,
      {
        method: "POST",
        headers: MANAGER_HEADERS,
      },
    );
    assert.equal(easyPostVoidRefreshRes.status, 200, JSON.stringify(easyPostVoidRefreshRes.json));
    assert.equal(easyPostVoidRefreshRes.json.shipment.status, "VOIDED");
    assert.equal(easyPostVoidRefreshRes.json.shipment.providerRefundStatus, "REFUNDED");
    assert.equal(Boolean(easyPostVoidRefreshRes.json.shipment.voidedAt), true);

    const easyPostReplacementRes = await fetchJson(
      `/api/online-store/shipments/${encodeURIComponent(easyPostShipmentId)}/regenerate`,
      {
        method: "POST",
        headers: MANAGER_HEADERS,
      },
    );
    assert.equal(easyPostReplacementRes.status, 201, JSON.stringify(easyPostReplacementRes.json));
    assert.equal(easyPostReplacementRes.json.shipment.shipmentNumber, 2);
    assert.equal(easyPostReplacementRes.json.shipment.status, "LABEL_READY");
    assert.equal(easyPostReplacementRes.json.shipment.providerKey, "EASYPOST");
    const easyPostReplacementShipmentId = easyPostReplacementRes.json.shipment.id;

    const easyPostPreparePrintRes = await fetchJson(
      `/api/online-store/shipments/${encodeURIComponent(easyPostReplacementShipmentId)}/prepare-print`,
      {
        method: "POST",
        headers: {
          ...MANAGER_HEADERS,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ printerId: printer.id, copies: 1 }),
      },
    );
    assert.equal(easyPostPreparePrintRes.status, 200, JSON.stringify(easyPostPreparePrintRes.json));
    assert.equal(easyPostPreparePrintRes.json.printRequest.metadata.providerKey, "EASYPOST");
    assert.equal(easyPostPreparePrintRes.json.printRequest.metadata.serviceCode, "GroundAdvantage");

    const easyPostPrintRes = await fetchJson(
      `/api/online-store/shipments/${encodeURIComponent(easyPostReplacementShipmentId)}/print`,
      {
        method: "POST",
        headers: {
          ...MANAGER_HEADERS,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ printerId: printer.id, copies: 1 }),
      },
    );
    assert.equal(easyPostPrintRes.status, 200, JSON.stringify(easyPostPrintRes.json));
    assert.equal(easyPostPrintRes.json.shipment.status, "PRINTED");
    assert.equal(Boolean(easyPostPrintRes.json.shipment.printedAt), true);
    assert.equal(easyPostPrintRes.json.printJob.transportMode, "DRY_RUN");
    assert.equal(fakeEasyPost.requests.refresh.length >= 2, true);
    assert.equal(fakeEasyPost.requests.refund.length, 1);

    const easyPostFailureToken = `EPFAIL-${randomUUID().slice(0, 6).toUpperCase()}`;
    const easyPostFailureOrderRes = await fetchJson("/api/online-store/orders", {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(createOrderBody(easyPostFailureToken)),
    });
    assert.equal(easyPostFailureOrderRes.status, 201, JSON.stringify(easyPostFailureOrderRes.json));
    createdOrderIds.push(easyPostFailureOrderRes.json.order.id);

    const packEasyPostFailureOrderRes = await fetchJson(`/api/online-store/orders/${encodeURIComponent(easyPostFailureOrderRes.json.order.id)}/packing`, {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ packed: true }),
    });
    assert.equal(packEasyPostFailureOrderRes.status, 200, JSON.stringify(packEasyPostFailureOrderRes.json));

    const easyPostFailureShipmentRes = await fetchJson(
      `/api/online-store/orders/${encodeURIComponent(easyPostFailureOrderRes.json.order.id)}/shipments`,
      {
        method: "POST",
        headers: {
          ...MANAGER_HEADERS,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerKey: "EASYPOST",
          serviceCode: "Priority",
          serviceName: "Priority",
        }),
      },
    );
    assert.equal(easyPostFailureShipmentRes.status, 502, JSON.stringify(easyPostFailureShipmentRes.json));
    assert.equal(easyPostFailureShipmentRes.json.error.code, "SHIPPING_PROVIDER_REJECTED");

    const easyPostFailureDetail = await fetchJson(
      `/api/online-store/orders/${encodeURIComponent(easyPostFailureOrderRes.json.order.id)}`,
      { headers: MANAGER_HEADERS },
    );
    assert.equal(easyPostFailureDetail.status, 200, JSON.stringify(easyPostFailureDetail.json));
    assert.equal(easyPostFailureDetail.json.order.shipments.length, 0);

    console.log("shipping provider foundation, EasyPost adapter flow, and provider-backed shipment printing passed");
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
            "shipping.provider.easyPost",
          ],
        },
      },
    });
    await serverController.stop();
    await Promise.allSettled([fakeEasyPost.close(), fakeProvider.close(), fakePrintAgent.close(), prisma.$disconnect()]);
  }
};

run().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
