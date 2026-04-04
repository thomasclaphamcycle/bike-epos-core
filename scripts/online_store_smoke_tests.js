#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { createSmokeServerController } = require("./smoke_server_helper");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3100";
const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
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
const serverController = createSmokeServerController({
  label: "online-store-smoke",
  baseUrl: BASE_URL,
  databaseUrl: DATABASE_URL,
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

const run = async () => {
  const token = `smoke-${Date.now()}`;
  const orderNumber = `WEB-${token}`.toUpperCase();
  let createdOrderId = null;

  try {
    await serverController.startIfNeeded();

    const createOrderRes = await fetchJson("/api/online-store/orders", {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orderNumber,
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
      }),
    });
    assert.equal(createOrderRes.status, 201, JSON.stringify(createOrderRes.json));
    assert.equal(createOrderRes.json.order.orderNumber, orderNumber);
    assert.equal(createOrderRes.json.order.status, "READY_FOR_DISPATCH");
    createdOrderId = createOrderRes.json.order.id;

    const listRes = await fetchJson(`/api/online-store/orders?q=${encodeURIComponent(orderNumber)}`, {
      headers: MANAGER_HEADERS,
    });
    assert.equal(listRes.status, 200, JSON.stringify(listRes.json));
    assert.equal(listRes.json.orders.length, 1);
    assert.equal(listRes.json.orders[0].orderNumber, orderNumber);
    assert.equal(listRes.json.summary.readyForDispatchCount >= 1, true);
    assert.equal(Array.isArray(listRes.json.supportedProviders), true);

    const detailRes = await fetchJson(`/api/online-store/orders/${encodeURIComponent(createdOrderId)}`, {
      headers: MANAGER_HEADERS,
    });
    assert.equal(detailRes.status, 200, JSON.stringify(detailRes.json));
    assert.equal(detailRes.json.order.shipments.length, 0);

    const createShipmentRes = await fetchJson(`/api/online-store/orders/${encodeURIComponent(createdOrderId)}/shipments`, {
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

    const duplicateShipmentRes = await fetchJson(`/api/online-store/orders/${encodeURIComponent(createdOrderId)}/shipments`, {
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
        printerName: "Dispatch Zebra GK420d",
        copies: 2,
      }),
    });
    assert.equal(preparePrintRes.status, 200, JSON.stringify(preparePrintRes.json));
    assert.equal(preparePrintRes.json.shipment.status, "PRINT_PREPARED");
    assert.equal(preparePrintRes.json.printRequest.printer.transport, "WINDOWS_LOCAL_AGENT");
    assert.equal(preparePrintRes.json.printRequest.printer.printerFamily, "ZEBRA_LABEL");
    assert.equal(preparePrintRes.json.printRequest.printer.printerName, "Dispatch Zebra GK420d");
    assert.equal(preparePrintRes.json.printRequest.printer.copies, 2);
    assert.equal(preparePrintRes.json.printRequest.document.format, "ZPL");

    const recordPrintedRes = await fetchJson(`/api/online-store/shipments/${encodeURIComponent(shipmentId)}/record-printed`, {
      method: "POST",
      headers: MANAGER_HEADERS,
    });
    assert.equal(recordPrintedRes.status, 200, JSON.stringify(recordPrintedRes.json));
    assert.equal(recordPrintedRes.json.shipment.status, "PRINTED");
    assert.equal(Boolean(recordPrintedRes.json.shipment.printedAt), true);
    assert.equal(recordPrintedRes.json.shipment.reprintCount, 0);

    const reprintRes = await fetchJson(`/api/online-store/shipments/${encodeURIComponent(shipmentId)}/record-printed`, {
      method: "POST",
      headers: MANAGER_HEADERS,
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

    const dispatchedDetailRes = await fetchJson(`/api/online-store/orders/${encodeURIComponent(createdOrderId)}`, {
      headers: MANAGER_HEADERS,
    });
    assert.equal(dispatchedDetailRes.status, 200, JSON.stringify(dispatchedDetailRes.json));
    assert.equal(dispatchedDetailRes.json.order.status, "DISPATCHED");
    assert.equal(dispatchedDetailRes.json.order.shipments[0].status, "DISPATCHED");
  } finally {
    if (createdOrderId) {
      await prisma.webOrder.deleteMany({
        where: { id: createdOrderId },
      });
    } else {
      await prisma.webOrder.deleteMany({
        where: { orderNumber },
      });
    }

    await prisma.$disconnect();
    await serverController.stop();
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
