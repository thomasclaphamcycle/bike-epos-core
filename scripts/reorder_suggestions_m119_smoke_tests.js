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
  throw new Error("Refusing to run against non-test database URL.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});
const serverController = createSmokeServerController({
  label: "m119-smoke",
  baseUrl: BASE_URL,
  databaseUrl: DATABASE_URL,
});

const RUN_REF = `m119_${Date.now()}`;
const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": `m119-manager-${RUN_REF}`,
  "Content-Type": "application/json",
};

const fetchJson = async (path) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: MANAGER_HEADERS,
  });
  const json = await response.json();
  return { status: response.status, json };
};

const cleanup = async (state) => {
  if (state.saleIds.length) {
    await prisma.sale.deleteMany({ where: { id: { in: state.saleIds } } });
  }
  if (state.purchaseOrderIds.length) {
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: state.purchaseOrderIds } } });
  }
  if (state.supplierIds.length) {
    await prisma.supplier.deleteMany({ where: { id: { in: state.supplierIds } } });
  }
  if (state.variantIds.length) {
    await prisma.inventoryMovement.deleteMany({ where: { variantId: { in: state.variantIds } } });
    await prisma.variant.deleteMany({ where: { id: { in: state.variantIds } } });
  }
  if (state.productIds.length) {
    await prisma.product.deleteMany({ where: { id: { in: state.productIds } } });
  }
};

const main = async () => {
  const state = { productIds: [], variantIds: [], saleIds: [], supplierIds: [], purchaseOrderIds: [] };
  try {
    await serverController.startIfNeeded();

    const reorderProduct = await prisma.product.create({
      data: {
        name: `M119 Brake Pads ${RUN_REF}`,
        variants: {
          create: {
            sku: `M119-BRAKE-${RUN_REF}`,
            name: "Shimano pads",
            retailPricePence: 1800,
          },
        },
      },
      include: { variants: true },
    });

    const coveredProduct = await prisma.product.create({
      data: {
        name: `M119 Chain Oil ${RUN_REF}`,
        variants: {
          create: {
            sku: `M119-OIL-${RUN_REF}`,
            name: "Wet lube",
            retailPricePence: 900,
          },
        },
      },
      include: { variants: true },
    });

    state.productIds.push(reorderProduct.id, coveredProduct.id);
    state.variantIds.push(reorderProduct.variants[0].id, coveredProduct.variants[0].id);

    await prisma.inventoryMovement.createMany({
      data: [
        {
          variantId: reorderProduct.variants[0].id,
          type: "PURCHASE",
          quantity: 2,
          referenceType: "M119",
          referenceId: RUN_REF,
        },
        {
          variantId: coveredProduct.variants[0].id,
          type: "PURCHASE",
          quantity: 1,
          referenceType: "M119",
          referenceId: RUN_REF,
        },
      ],
    });

    const sale = await prisma.sale.create({
      data: {
        subtotalPence: 16200,
        taxPence: 0,
        totalPence: 16200,
        completedAt: new Date(),
        items: {
          create: [
            {
              variantId: reorderProduct.variants[0].id,
              quantity: 7,
              unitPricePence: 1800,
              lineTotalPence: 12600,
            },
            {
              variantId: coveredProduct.variants[0].id,
              quantity: 4,
              unitPricePence: 900,
              lineTotalPence: 3600,
            },
          ],
        },
      },
    });
    state.saleIds.push(sale.id);

    const supplier = await prisma.supplier.create({
      data: {
        name: `M119 Supplier ${RUN_REF}`,
      },
    });
    state.supplierIds.push(supplier.id);

    const openPo = await prisma.purchaseOrder.create({
      data: {
        poNumber: `PO26${RUN_REF.slice(-6)}`,
        supplierId: supplier.id,
        status: "SENT",
        expectedAt: new Date(Date.now() + 86_400_000),
        items: {
          create: [
            {
              variantId: coveredProduct.variants[0].id,
              quantityOrdered: 6,
              quantityReceived: 0,
            },
          ],
        },
      },
    });
    state.purchaseOrderIds.push(openPo.id);

    const { status, json } = await fetchJson(`/api/reports/inventory/reorder-suggestions?take=200&q=${encodeURIComponent(RUN_REF)}`);

    assert.equal(status, 200);
    assert.equal(json.heuristic.lookbackDays, 30);
    assert.equal(json.heuristic.targetCoverageDays, 30);

    const reorderRow = json.items.find((row) => row.sku === reorderProduct.variants[0].sku);
    assert.ok(reorderRow, "expected reorder row");
    assert.equal(reorderRow.currentOnHand, 2);
    assert.equal(reorderRow.recentSalesQty, 7);
    assert.equal(reorderRow.suggestedReorderQty, 5);
    assert.equal(reorderRow.urgency, "Reorder Soon");

    const coveredRow = json.items.find((row) => row.sku === coveredProduct.variants[0].sku);
    assert.ok(coveredRow, "expected on-order row");
    assert.equal(coveredRow.onOpenPurchaseOrders, 6);
    assert.equal(coveredRow.suggestedReorderQty, 0);
    assert.equal(coveredRow.urgency, "On Order");
    assert.equal(coveredRow.openPurchaseOrders[0].id, openPo.id);
    assert.ok(json.summary.onOrderCount >= 1);

    console.log("[m119-smoke] reorder suggestions report passed");
  } finally {
    await cleanup(state);
    await prisma.$disconnect();
    await serverController.stop();
  }
};

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
