#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const HEALTH_URL = `${BASE_URL}/health`;
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
console.log(`[m17-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m17-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;

const fetchJson = async (path, options = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Staff-Role": "MANAGER",
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

const serverIsHealthy = async () => {
  try {
    const response = await fetch(HEALTH_URL);
    return response.ok;
  } catch {
    return false;
  }
};

const waitForServer = async () => {
  for (let i = 0; i < 60; i++) {
    if (await serverIsHealthy()) {
      return;
    }
    await sleep(500);
  }
  throw new Error("Server did not become healthy on /health");
};

const cleanup = async (state) => {
  const purchaseOrderItemIds = Array.from(state.purchaseOrderItemIds);
  const purchaseOrderIds = Array.from(state.purchaseOrderIds);
  const supplierIds = Array.from(state.supplierIds);
  const variantIds = Array.from(state.variantIds);
  const productIds = Array.from(state.productIds);
  const locationIds = Array.from(state.locationIds);

  if (purchaseOrderItemIds.length > 0) {
    await prisma.stockLedgerEntry.deleteMany({
      where: {
        referenceType: "PURCHASE_ORDER_ITEM",
        referenceId: {
          in: purchaseOrderItemIds,
        },
      },
    });
  }

  if (purchaseOrderIds.length > 0) {
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
    await prisma.barcode.deleteMany({ where: { variantId: { in: variantIds } } });
    await prisma.stockLedgerEntry.deleteMany({ where: { variantId: { in: variantIds } } });
    await prisma.inventoryMovement.deleteMany({ where: { variantId: { in: variantIds } } });
    await prisma.variant.deleteMany({ where: { id: { in: variantIds } } });
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
};

const run = async () => {
  const state = {
    supplierIds: new Set(),
    purchaseOrderIds: new Set(),
    purchaseOrderItemIds: new Set(),
    productIds: new Set(),
    variantIds: new Set(),
    locationIds: new Set(),
  };

  let startedServer = false;
  let serverProcess = null;

  const runTest = async (name, fn, results) => {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log(`PASS ${name}`);
    } catch (error) {
      results.push({ name, ok: false, error });
      console.error(`FAIL ${name}`);
      console.error(error instanceof Error ? error.message : String(error));
    }
  };

  try {
    const existing = await serverIsHealthy();
    if (existing && process.env.ALLOW_EXISTING_SERVER !== "1") {
      throw new Error(
        "Refusing to run against an already-running server. Stop it first or set ALLOW_EXISTING_SERVER=1.",
      );
    }

    if (!existing) {
      serverProcess = spawn("npm", ["run", "dev"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          NODE_ENV: "test",
          DATABASE_URL,
        },
      });
      serverProcess.stdout.on("data", () => {});
      serverProcess.stderr.on("data", () => {});
      startedServer = true;
      await waitForServer();
    }

    const results = [];

    await runTest(
      "supplier -> PO -> add items -> partial/full receive updates stock and status",
      async () => {
        const location = await prisma.stockLocation.create({
          data: {
            name: `M17 Location ${uniqueRef()}`,
            isDefault: false,
          },
        });
        state.locationIds.add(location.id);

        const supplierRes = await fetchJson("/api/suppliers", {
          method: "POST",
          body: JSON.stringify({
            name: `M17 Supplier ${uniqueRef()}`,
            email: `m17.${uniqueRef()}@supplier.test`,
          }),
        });
        assert.equal(supplierRes.status, 201);
        state.supplierIds.add(supplierRes.json.id);

        const productRes = await fetchJson("/api/products", {
          method: "POST",
          body: JSON.stringify({
            name: `M17 Product ${uniqueRef()}`,
          }),
        });
        assert.equal(productRes.status, 201);
        state.productIds.add(productRes.json.id);

        const variantRes = await fetchJson("/api/variants", {
          method: "POST",
          body: JSON.stringify({
            productId: productRes.json.id,
            sku: `M17-SKU-${uniqueRef()}`,
            retailPricePence: 4999,
            costPricePence: 2800,
          }),
        });
        assert.equal(variantRes.status, 201);
        state.variantIds.add(variantRes.json.id);

        const poRes = await fetchJson("/api/purchase-orders", {
          method: "POST",
          body: JSON.stringify({
            supplierId: supplierRes.json.id,
            notes: "M17 test PO",
          }),
        });
        assert.equal(poRes.status, 201);
        assert.equal(poRes.json.status, "DRAFT");
        state.purchaseOrderIds.add(poRes.json.id);

        const addItemsRes = await fetchJson(`/api/purchase-orders/${poRes.json.id}/items`, {
          method: "POST",
          body: JSON.stringify({
            lines: [
              {
                variantId: variantRes.json.id,
                quantityOrdered: 10,
                unitCostPence: 2750,
              },
            ],
          }),
        });
        assert.equal(addItemsRes.status, 200);
        assert.equal(addItemsRes.json.items.length, 1);
        assert.equal(addItemsRes.json.items[0].quantityOrdered, 10);
        const purchaseOrderItemId = addItemsRes.json.items[0].id;
        state.purchaseOrderItemIds.add(purchaseOrderItemId);

        const receivePartialRes = await fetchJson(`/api/purchase-orders/${poRes.json.id}/receive`, {
          method: "POST",
          body: JSON.stringify({
            locationId: location.id,
            lines: [
              {
                purchaseOrderItemId,
                quantity: 4,
              },
            ],
          }),
        });
        assert.equal(receivePartialRes.status, 200);
        assert.equal(receivePartialRes.json.status, "PARTIALLY_RECEIVED");
        assert.equal(receivePartialRes.json.items[0].quantityReceived, 4);

        const partialLedgerRows = await prisma.stockLedgerEntry.findMany({
          where: {
            referenceType: "PURCHASE_ORDER_ITEM",
            referenceId: purchaseOrderItemId,
          },
          orderBy: { createdAt: "asc" },
        });
        assert.equal(partialLedgerRows.length, 1);
        assert.equal(partialLedgerRows[0].unitCostPence, 2750);

        const stockAfterPartial = await fetchJson(
          `/api/stock/variants/${variantRes.json.id}?locationId=${location.id}`,
        );
        assert.equal(stockAfterPartial.status, 200);
        assert.equal(stockAfterPartial.json.onHand, 4);

        const receiveRemainingRes = await fetchJson(`/api/purchase-orders/${poRes.json.id}/receive`, {
          method: "POST",
          body: JSON.stringify({
            locationId: location.id,
            lines: [
              {
                purchaseOrderItemId,
                quantity: 6,
              },
            ],
          }),
        });
        assert.equal(receiveRemainingRes.status, 200);
        assert.equal(receiveRemainingRes.json.status, "RECEIVED");
        assert.equal(receiveRemainingRes.json.items[0].quantityReceived, 10);

        const finalLedgerRows = await prisma.stockLedgerEntry.findMany({
          where: {
            referenceType: "PURCHASE_ORDER_ITEM",
            referenceId: purchaseOrderItemId,
          },
          orderBy: { createdAt: "asc" },
        });
        assert.equal(finalLedgerRows.length, 2);
        assert.equal(finalLedgerRows[0].unitCostPence, 2750);
        assert.equal(finalLedgerRows[1].unitCostPence, 2750);

        const stockAfterFinal = await fetchJson(
          `/api/stock/variants/${variantRes.json.id}?locationId=${location.id}`,
        );
        assert.equal(stockAfterFinal.status, 200);
        assert.equal(stockAfterFinal.json.onHand, 10);
      },
      results,
    );

    await runTest(
      "receiving cost fallback: variant cost then null when absent",
      async () => {
        const location = await prisma.stockLocation.create({
          data: {
            name: `M17.1 Cost Location ${uniqueRef()}`,
          },
        });
        state.locationIds.add(location.id);

        const supplierRes = await fetchJson("/api/suppliers", {
          method: "POST",
          body: JSON.stringify({
            name: `M17.1 Supplier ${uniqueRef()}`,
          }),
        });
        assert.equal(supplierRes.status, 201);
        state.supplierIds.add(supplierRes.json.id);

        const productWithCostRes = await fetchJson("/api/products", {
          method: "POST",
          body: JSON.stringify({
            name: `M17.1 Product With Cost ${uniqueRef()}`,
          }),
        });
        assert.equal(productWithCostRes.status, 201);
        state.productIds.add(productWithCostRes.json.id);

        const variantWithCostRes = await fetchJson("/api/variants", {
          method: "POST",
          body: JSON.stringify({
            productId: productWithCostRes.json.id,
            sku: `M17.1-SKU-COST-${uniqueRef()}`,
            retailPricePence: 3500,
            costPricePence: 1900,
          }),
        });
        assert.equal(variantWithCostRes.status, 201);
        state.variantIds.add(variantWithCostRes.json.id);

        const productNoCostRes = await fetchJson("/api/products", {
          method: "POST",
          body: JSON.stringify({
            name: `M17.1 Product No Cost ${uniqueRef()}`,
          }),
        });
        assert.equal(productNoCostRes.status, 201);
        state.productIds.add(productNoCostRes.json.id);

        const variantNoCostRes = await fetchJson("/api/variants", {
          method: "POST",
          body: JSON.stringify({
            productId: productNoCostRes.json.id,
            sku: `M17.1-SKU-NOCOST-${uniqueRef()}`,
            retailPricePence: 1200,
          }),
        });
        assert.equal(variantNoCostRes.status, 201);
        state.variantIds.add(variantNoCostRes.json.id);

        const poRes = await fetchJson("/api/purchase-orders", {
          method: "POST",
          body: JSON.stringify({
            supplierId: supplierRes.json.id,
          }),
        });
        assert.equal(poRes.status, 201);
        state.purchaseOrderIds.add(poRes.json.id);

        const addItemsRes = await fetchJson(`/api/purchase-orders/${poRes.json.id}/items`, {
          method: "POST",
          body: JSON.stringify({
            lines: [
              {
                variantId: variantWithCostRes.json.id,
                quantityOrdered: 2,
              },
              {
                variantId: variantNoCostRes.json.id,
                quantityOrdered: 1,
              },
            ],
          }),
        });
        assert.equal(addItemsRes.status, 200);
        assert.equal(addItemsRes.json.items.length, 2);

        const withCostItem = addItemsRes.json.items.find(
          (item) => item.variantId === variantWithCostRes.json.id,
        );
        const noCostItem = addItemsRes.json.items.find(
          (item) => item.variantId === variantNoCostRes.json.id,
        );
        assert.ok(withCostItem);
        assert.ok(noCostItem);
        state.purchaseOrderItemIds.add(withCostItem.id);
        state.purchaseOrderItemIds.add(noCostItem.id);

        const receiveRes = await fetchJson(`/api/purchase-orders/${poRes.json.id}/receive`, {
          method: "POST",
          body: JSON.stringify({
            locationId: location.id,
            lines: [
              {
                purchaseOrderItemId: withCostItem.id,
                quantity: 2,
              },
              {
                purchaseOrderItemId: noCostItem.id,
                quantity: 1,
              },
            ],
          }),
        });
        assert.equal(receiveRes.status, 200);
        assert.equal(receiveRes.json.status, "RECEIVED");

        const withCostLedgerRows = await prisma.stockLedgerEntry.findMany({
          where: {
            referenceType: "PURCHASE_ORDER_ITEM",
            referenceId: withCostItem.id,
          },
          orderBy: { createdAt: "asc" },
        });
        assert.equal(withCostLedgerRows.length, 1);
        assert.equal(withCostLedgerRows[0].unitCostPence, 1900);

        const noCostLedgerRows = await prisma.stockLedgerEntry.findMany({
          where: {
            referenceType: "PURCHASE_ORDER_ITEM",
            referenceId: noCostItem.id,
          },
          orderBy: { createdAt: "asc" },
        });
        assert.equal(noCostLedgerRows.length, 1);
        assert.equal(noCostLedgerRows[0].unitCostPence, null);
      },
      results,
    );

    await runTest(
      "cancelled purchase order cannot be received",
      async () => {
        const location = await prisma.stockLocation.create({
          data: {
            name: `M17 Cancel Location ${uniqueRef()}`,
          },
        });
        state.locationIds.add(location.id);

        const supplierRes = await fetchJson("/api/suppliers", {
          method: "POST",
          body: JSON.stringify({
            name: `M17 Cancel Supplier ${uniqueRef()}`,
          }),
        });
        assert.equal(supplierRes.status, 201);
        state.supplierIds.add(supplierRes.json.id);

        const productRes = await fetchJson("/api/products", {
          method: "POST",
          body: JSON.stringify({
            name: `M17 Cancel Product ${uniqueRef()}`,
          }),
        });
        assert.equal(productRes.status, 201);
        state.productIds.add(productRes.json.id);

        const variantRes = await fetchJson("/api/variants", {
          method: "POST",
          body: JSON.stringify({
            productId: productRes.json.id,
            sku: `M17-CANCEL-SKU-${uniqueRef()}`,
            retailPricePence: 1999,
          }),
        });
        assert.equal(variantRes.status, 201);
        state.variantIds.add(variantRes.json.id);

        const poRes = await fetchJson("/api/purchase-orders", {
          method: "POST",
          body: JSON.stringify({
            supplierId: supplierRes.json.id,
          }),
        });
        assert.equal(poRes.status, 201);
        state.purchaseOrderIds.add(poRes.json.id);

        const addItemsRes = await fetchJson(`/api/purchase-orders/${poRes.json.id}/items`, {
          method: "POST",
          body: JSON.stringify({
            lines: [
              {
                variantId: variantRes.json.id,
                quantityOrdered: 2,
              },
            ],
          }),
        });
        assert.equal(addItemsRes.status, 200);
        const purchaseOrderItemId = addItemsRes.json.items[0].id;
        state.purchaseOrderItemIds.add(purchaseOrderItemId);

        await prisma.purchaseOrder.update({
          where: { id: poRes.json.id },
          data: { status: "CANCELLED" },
        });

        const receiveRes = await fetchJson(`/api/purchase-orders/${poRes.json.id}/receive`, {
          method: "POST",
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

        assert.equal(receiveRes.status, 409);
        assert.equal(receiveRes.json.error.code, "PURCHASE_ORDER_CANCELLED");
      },
      results,
    );

    const failed = results.filter((result) => !result.ok);
    if (failed.length > 0) {
      process.exitCode = 1;
      return;
    }
  } finally {
    await cleanup(state).catch((error) => {
      console.error("Cleanup failed:", error instanceof Error ? error.message : String(error));
    });

    if (startedServer && serverProcess) {
      serverProcess.kill("SIGTERM");
      await sleep(500);
    }

    await prisma.$disconnect();
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
