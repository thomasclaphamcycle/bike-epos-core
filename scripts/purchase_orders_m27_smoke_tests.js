#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { createSmokeServerController } = require("./smoke_server_helper");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
}
if (process.env.NODE_ENV !== "test") {
  throw new Error("Refusing to run: NODE_ENV must be 'test'.");
}
if (process.env.ALLOW_NON_TEST_DB !== "1" && !DATABASE_URL.toLowerCase().includes("test")) {
  throw new Error(
    "Refusing to run against non-test database URL. Set TEST_DATABASE_URL or ALLOW_NON_TEST_DB=1.",
  );
}

const safeDbUrl = DATABASE_URL.replace(
  /(postgres(?:ql)?:\/\/[^:/@]+:)[^@]+@/i,
  "$1***@",
);
console.log(`[m27-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m27-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_STARTUP_LOG_CHARS = 4000;
const APP_REQUEST_RETRIES = 8;
const appBaseUrlCandidates = (() => {
  const primary = new URL(BASE_URL).toString().replace(/\/$/, "");
  const urls = [primary];

  try {
    const fallback = new URL(primary);
    if (fallback.hostname === "localhost") {
      fallback.hostname = "127.0.0.1";
      urls.push(fallback.toString().replace(/\/$/, ""));
    }
  } catch {
    // Keep the primary URL only if parsing fails unexpectedly.
  }

  return urls;
})();
let activeAppBaseUrl = appBaseUrlCandidates[0];
const serverStartedPattern = /Server running on http:\/\/localhost:\d+/i;
let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;
const serverController = createSmokeServerController({
  label: "m27-smoke",
  baseUrls: appBaseUrlCandidates,
  databaseUrl: DATABASE_URL,
  captureStartupLog: true,
  startupLogCharLimit: MAX_STARTUP_LOG_CHARS,
  startupReadyPattern: serverStartedPattern,
  envOverrides: {
    PORT: new URL(BASE_URL).port || "3100",
  },
});

const fetchFromApp = async (path, options = {}) => {
  let lastError = null;

  for (let attempt = 0; attempt < APP_REQUEST_RETRIES; attempt += 1) {
    try {
      activeAppBaseUrl = serverController.getBaseUrl();
      return await fetch(`${activeAppBaseUrl}${path}`, options);
    } catch (error) {
      lastError = error;

      const healthyBaseUrl = await serverController.probeHealthyBaseUrl();
      if (healthyBaseUrl) {
        activeAppBaseUrl = healthyBaseUrl;
      }
    }

    if (attempt < APP_REQUEST_RETRIES - 1) {
      await sleep(250);
    }
  }

  if (lastError instanceof Error) {
    lastError.message = `${lastError.message} while requesting ${activeAppBaseUrl}${path}`;
    throw lastError;
  }

  throw new Error(`Failed to fetch ${activeAppBaseUrl}${path}`);
};

const fetchJson = async (path, options = {}) => {
  const response = await fetchFromApp(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  return { status: response.status, json };
};

const cleanup = async (state) => {
  const purchaseOrderItemIds = Array.from(state.purchaseOrderItemIds);
  const purchaseOrderIds = Array.from(state.purchaseOrderIds);
  const supplierIds = Array.from(state.supplierIds);
  const variantIds = Array.from(state.variantIds);
  const productIds = Array.from(state.productIds);
  const locationIds = Array.from(state.locationIds);
  const userIds = Array.from(state.userIds);

  if (variantIds.length > 0) {
    await prisma.stockLedgerEntry.deleteMany({
      where: {
        variantId: {
          in: variantIds,
        },
      },
    });

    await prisma.inventoryMovement.deleteMany({
      where: {
        variantId: {
          in: variantIds,
        },
      },
    });
  }

  if (purchaseOrderIds.length > 0) {
    await prisma.auditEvent.deleteMany({
      where: {
        entityType: "PURCHASE_ORDER",
        entityId: {
          in: purchaseOrderIds,
        },
      },
    });

    await prisma.purchaseOrderItem.deleteMany({
      where: {
        purchaseOrderId: {
          in: purchaseOrderIds,
        },
      },
    });

    await prisma.purchaseOrder.deleteMany({
      where: {
        id: {
          in: purchaseOrderIds,
        },
      },
    });
  }

  if (supplierIds.length > 0) {
    await prisma.supplier.deleteMany({
      where: {
        id: {
          in: supplierIds,
        },
      },
    });
  }

  if (variantIds.length > 0) {
    await prisma.barcode.deleteMany({
      where: {
        variantId: {
          in: variantIds,
        },
      },
    });

    await prisma.variant.deleteMany({
      where: {
        id: {
          in: variantIds,
        },
      },
    });
  }

  if (productIds.length > 0) {
    await prisma.product.deleteMany({
      where: {
        id: {
          in: productIds,
        },
      },
    });
  }

  if (locationIds.length > 0) {
    await prisma.stockLocation.deleteMany({
      where: {
        id: {
          in: locationIds,
        },
      },
    });
  }

  if (userIds.length > 0) {
    await prisma.user.deleteMany({
      where: {
        id: {
          in: userIds,
        },
      },
    });
  }

  if (purchaseOrderItemIds.length > 0) {
    // no-op marker to keep explicit state collection usage for debug visibility
  }
};

const run = async () => {
  const state = {
    supplierIds: new Set(),
    purchaseOrderIds: new Set(),
    purchaseOrderItemIds: new Set(),
    productIds: new Set(),
    variantIds: new Set(),
    locationIds: new Set(),
    userIds: new Set(),
  };

  try {
    await serverController.startIfNeeded();
    activeAppBaseUrl = serverController.getBaseUrl();

    const managerUser = await prisma.user.create({
      data: {
        username: `m27-manager-${uniqueRef()}`,
        passwordHash: "m27-smoke",
        role: "ADMIN",
      },
    });
    state.userIds.add(managerUser.id);

    const staffUser = await prisma.user.create({
      data: {
        username: `m27-staff-${uniqueRef()}`,
        passwordHash: "m27-smoke",
        role: "STAFF",
      },
    });
    state.userIds.add(staffUser.id);

    const managerHeaders = {
      "X-Staff-Role": "MANAGER",
      "X-Staff-Id": managerUser.id,
    };
    const staffHeaders = {
      "X-Staff-Role": "STAFF",
      "X-Staff-Id": staffUser.id,
    };

    const location = await prisma.stockLocation.create({
      data: {
        name: `M27 Location ${uniqueRef()}`,
      },
    });
    state.locationIds.add(location.id);

    const supplierRes = await fetchJson("/api/suppliers", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        name: `M27 Supplier ${uniqueRef()}`,
        contactName: "Jamie Buyer",
        email: `m27.${uniqueRef()}@supplier.test`,
      }),
    });
    assert.equal(supplierRes.status, 201, JSON.stringify(supplierRes.json));
    state.supplierIds.add(supplierRes.json.id);
    assert.equal(supplierRes.json.contactName, "Jamie Buyer");

    const patchSupplierRes = await fetchJson(`/api/suppliers/${supplierRes.json.id}`, {
      method: "PATCH",
      headers: managerHeaders,
      body: JSON.stringify({
        contactName: "Jamie Procurement",
        notes: "Updated supplier note",
      }),
    });
    assert.equal(patchSupplierRes.status, 200, JSON.stringify(patchSupplierRes.json));
    assert.equal(patchSupplierRes.json.contactName, "Jamie Procurement");

    const productRes = await fetchJson("/api/products", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        name: `M27 Product ${uniqueRef()}`,
      }),
    });
    assert.equal(productRes.status, 201, JSON.stringify(productRes.json));
    state.productIds.add(productRes.json.id);

    const variantRes = await fetchJson("/api/variants", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        productId: productRes.json.id,
        sku: `M27-SKU-${uniqueRef()}`,
        barcode: `M27-BC-${uniqueRef()}`,
        retailPricePence: 3499,
        costPricePence: 2200,
      }),
    });
    assert.equal(variantRes.status, 201, JSON.stringify(variantRes.json));
    state.variantIds.add(variantRes.json.id);

    const poRes = await fetchJson("/api/purchase-orders", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        supplierId: supplierRes.json.id,
        notes: "M27 test PO",
      }),
    });
    assert.equal(poRes.status, 201, JSON.stringify(poRes.json));
    assert.equal(poRes.json.status, "DRAFT");
    assert.match(poRes.json.poNumber, /^PO\d{8}$/);
    state.purchaseOrderIds.add(poRes.json.id);

    const addItemsRes = await fetchJson(`/api/purchase-orders/${poRes.json.id}/items`, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        lines: [
          {
            variantId: variantRes.json.id,
            quantityOrdered: 10,
            unitCostPence: 2700,
          },
        ],
      }),
    });
    assert.equal(addItemsRes.status, 200, JSON.stringify(addItemsRes.json));
    assert.equal(addItemsRes.json.items.length, 1);
    assert.equal(addItemsRes.json.items[0].barcode, variantRes.json.barcode);
    const purchaseOrderItemId = addItemsRes.json.items[0].id;
    state.purchaseOrderItemIds.add(purchaseOrderItemId);

    const stockBeforeReceiveRes = await fetchJson(
      `/api/inventory/on-hand?variantId=${encodeURIComponent(variantRes.json.id)}`,
      {
        headers: staffHeaders,
      },
    );
    assert.equal(stockBeforeReceiveRes.status, 200, JSON.stringify(stockBeforeReceiveRes.json));
    assert.equal(stockBeforeReceiveRes.json.onHand, 0);

    const patchLineRes = await fetchJson(
      `/api/purchase-orders/${poRes.json.id}/lines/${purchaseOrderItemId}`,
      {
        method: "PATCH",
        headers: managerHeaders,
        body: JSON.stringify({
          quantityOrdered: 12,
          unitCostPence: 2750,
        }),
      },
    );
    assert.equal(patchLineRes.status, 200, JSON.stringify(patchLineRes.json));
    assert.equal(patchLineRes.json.items[0].quantityOrdered, 12);
    assert.equal(patchLineRes.json.items[0].unitCostPence, 2750);

    const receiveDraftRes = await fetchJson(`/api/purchase-orders/${poRes.json.id}/receive`, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        locationId: location.id,
        lines: [
          {
            purchaseOrderItemId,
            quantity: 1,
          },
        ],
      }),
    });
    assert.equal(receiveDraftRes.status, 409, JSON.stringify(receiveDraftRes.json));
    assert.equal(receiveDraftRes.json.error?.code, "PURCHASE_ORDER_NOT_SENT");

    const listRes = await fetchJson(
      `/api/purchase-orders?status=DRAFT&q=${encodeURIComponent("M27 test")}&take=20&skip=0`,
      {
        headers: staffHeaders,
      },
    );
    assert.equal(listRes.status, 200, JSON.stringify(listRes.json));
    assert.ok(Array.isArray(listRes.json.purchaseOrders));
    assert.ok(listRes.json.purchaseOrders.some((po) => po.id === poRes.json.id));
    assert.ok(listRes.json.purchaseOrders.some((po) => po.poNumber === poRes.json.poNumber));

    const barcodeQueryRes = await fetchJson(
      `/api/purchase-orders?status=DRAFT&q=${encodeURIComponent(variantRes.json.barcode)}&take=20&skip=0`,
      {
        headers: staffHeaders,
      },
    );
    assert.equal(barcodeQueryRes.status, 200, JSON.stringify(barcodeQueryRes.json));
    assert.ok(barcodeQueryRes.json.purchaseOrders.some((po) => po.id === poRes.json.id));

    const patchPoRes = await fetchJson(`/api/purchase-orders/${poRes.json.id}`, {
      method: "PATCH",
      headers: managerHeaders,
      body: JSON.stringify({
        status: "SENT",
        notes: "Sent to supplier",
      }),
    });
    assert.equal(patchPoRes.status, 200, JSON.stringify(patchPoRes.json));
    assert.equal(patchPoRes.json.status, "SENT");

    const receivePartialRes = await fetchJson(`/api/purchase-orders/${poRes.json.id}/receive`, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        locationId: location.id,
        lines: [
          {
            purchaseOrderItemId,
            quantity: 5,
            unitCostPence: 2800,
          },
        ],
      }),
    });
    assert.equal(receivePartialRes.status, 200, JSON.stringify(receivePartialRes.json));
    assert.equal(receivePartialRes.json.status, "PARTIALLY_RECEIVED");
    assert.equal(receivePartialRes.json.items[0].quantityReceived, 5);
    assert.equal(receivePartialRes.json.items[0].quantityRemaining, 7);
    assert.equal(receivePartialRes.json.items[0].unitCostPence, 2800);

    const onHandAfterPartialRes = await fetchJson(
      `/api/inventory/on-hand?variantId=${encodeURIComponent(variantRes.json.id)}`,
      {
        headers: staffHeaders,
      },
    );
    assert.equal(onHandAfterPartialRes.status, 200, JSON.stringify(onHandAfterPartialRes.json));
    assert.equal(onHandAfterPartialRes.json.onHand, 5);

    const poAfterPartialRes = await fetchJson(`/api/purchase-orders/${poRes.json.id}`, {
      headers: staffHeaders,
    });
    assert.equal(poAfterPartialRes.status, 200, JSON.stringify(poAfterPartialRes.json));
    assert.equal(poAfterPartialRes.json.status, "PARTIALLY_RECEIVED");
    assert.equal(poAfterPartialRes.json.totals.quantityOrdered, 12);
    assert.equal(poAfterPartialRes.json.totals.quantityReceived, 5);
    assert.equal(poAfterPartialRes.json.totals.quantityRemaining, 7);
    assert.equal(poAfterPartialRes.json.items[0].barcode, variantRes.json.barcode);

    const partialMovementRows = await prisma.inventoryMovement.findMany({
      where: {
        referenceType: "PURCHASE_ORDER_ITEM",
        referenceId: purchaseOrderItemId,
      },
      orderBy: { createdAt: "asc" },
    });
    assert.equal(partialMovementRows.length, 1);
    assert.equal(partialMovementRows[0].type, "PURCHASE");
    assert.equal(partialMovementRows[0].quantity, 5);
    assert.equal(Number(partialMovementRows[0].unitCost), 2800);

    const receiveFinalRes = await fetchJson(`/api/purchase-orders/${poRes.json.id}/receive`, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        locationId: location.id,
        lines: [
          {
            purchaseOrderItemId,
            quantity: 7,
          },
        ],
      }),
    });
    assert.equal(receiveFinalRes.status, 200, JSON.stringify(receiveFinalRes.json));
    assert.equal(receiveFinalRes.json.status, "RECEIVED");
    assert.equal(receiveFinalRes.json.items[0].quantityReceived, 12);
    assert.equal(receiveFinalRes.json.items[0].quantityRemaining, 0);

    const auditRes = await fetchJson(
      `/api/audit?entityType=PURCHASE_ORDER&entityId=${encodeURIComponent(poRes.json.id)}&action=PURCHASE_ORDER_RECEIVED&limit=10`,
      {
        headers: managerHeaders,
      },
    );
    assert.equal(auditRes.status, 200, JSON.stringify(auditRes.json));
    assert.ok(Array.isArray(auditRes.json.events), JSON.stringify(auditRes.json));
    assert.ok(auditRes.json.events.length >= 2, JSON.stringify(auditRes.json));

    const onHandAfterFinalRes = await fetchJson(
      `/api/inventory/on-hand?variantId=${encodeURIComponent(variantRes.json.id)}`,
      {
        headers: staffHeaders,
      },
    );
    assert.equal(onHandAfterFinalRes.status, 200, JSON.stringify(onHandAfterFinalRes.json));
    assert.equal(onHandAfterFinalRes.json.onHand, 12);

    const movementRows = await prisma.inventoryMovement.findMany({
      where: {
        referenceType: "PURCHASE_ORDER_ITEM",
        referenceId: purchaseOrderItemId,
      },
      orderBy: { createdAt: "asc" },
    });
    assert.equal(movementRows.length, 2);
    assert.equal(movementRows[0].quantity, 5);
    assert.equal(movementRows[1].quantity, 7);

    const getPoRes = await fetchJson(`/api/purchase-orders/${poRes.json.id}`, {
      headers: staffHeaders,
    });
    assert.equal(getPoRes.status, 200, JSON.stringify(getPoRes.json));
    assert.equal(getPoRes.json.poNumber, poRes.json.poNumber);
    assert.equal(getPoRes.json.status, "RECEIVED");
    assert.equal(getPoRes.json.totals.quantityOrdered, 12);
    assert.equal(getPoRes.json.totals.quantityReceived, 12);
    assert.equal(getPoRes.json.totals.quantityRemaining, 0);

    console.log("PASS m27 purchase order workflow smoke tests");
  } finally {
    await cleanup(state);
    await serverController.stop();
    await prisma.$disconnect();
  }
};

run().catch((error) => {
  console.error("[m27-smoke] FAIL", error);
  process.exitCode = 1;
});
