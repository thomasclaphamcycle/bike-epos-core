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
  label: "m122-smoke",
  baseUrl: BASE_URL,
  databaseUrl: DATABASE_URL,
});

const RUN_REF = `m122_${Date.now()}`;
const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": `m122-manager-${RUN_REF}`,
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
  if (state.purchaseOrderIds.length) {
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: state.purchaseOrderIds } } });
  }
  if (state.variantIds.length) {
    await prisma.variant.deleteMany({ where: { id: { in: state.variantIds } } });
  }
  if (state.productIds.length) {
    await prisma.product.deleteMany({ where: { id: { in: state.productIds } } });
  }
  if (state.supplierIds.length) {
    await prisma.supplier.deleteMany({ where: { id: { in: state.supplierIds } } });
  }
};

const main = async () => {
  const state = { supplierIds: [], productIds: [], variantIds: [], purchaseOrderIds: [] };
  try {
    await serverController.startIfNeeded();

    const [missingRetail, atCost, lowMargin, healthy] = await Promise.all([
      prisma.product.create({
        data: {
          name: `M122 Missing Retail ${RUN_REF}`,
          variants: {
            create: {
              sku: `M122-MISSING-${RUN_REF}`,
              retailPricePence: 0,
              costPricePence: 1000,
            },
          },
        },
        include: { variants: true },
      }),
      prisma.product.create({
        data: {
          name: `M122 At Cost ${RUN_REF}`,
          variants: {
            create: {
              sku: `M122-ATCOST-${RUN_REF}`,
              retailPricePence: 1200,
              costPricePence: 1200,
            },
          },
        },
        include: { variants: true },
      }),
      prisma.product.create({
        data: {
          name: `M122 Low Margin ${RUN_REF}`,
          variants: {
            create: {
              sku: `M122-LOW-${RUN_REF}`,
              retailPricePence: 1000,
            },
          },
        },
        include: { variants: true },
      }),
      prisma.product.create({
        data: {
          name: `M122 Healthy ${RUN_REF}`,
          variants: {
            create: {
              sku: `M122-HEALTHY-${RUN_REF}`,
              retailPricePence: 1500,
              costPricePence: 900,
            },
          },
        },
        include: { variants: true },
      }),
    ]);

    state.productIds.push(missingRetail.id, atCost.id, lowMargin.id, healthy.id);
    state.variantIds.push(
      missingRetail.variants[0].id,
      atCost.variants[0].id,
      lowMargin.variants[0].id,
      healthy.variants[0].id,
    );

    const supplier = await prisma.supplier.create({
      data: { name: `M122 Supplier ${RUN_REF}` },
    });
    state.supplierIds.push(supplier.id);

    const purchaseOrder = await prisma.purchaseOrder.create({
      data: {
        poNumber: `PO26${RUN_REF.slice(-6)}22`,
        supplierId: supplier.id,
        status: "RECEIVED",
        items: {
          create: [
            {
              variantId: lowMargin.variants[0].id,
              quantityOrdered: 6,
              quantityReceived: 6,
              unitCostPence: 850,
            },
          ],
        },
      },
    });
    state.purchaseOrderIds.push(purchaseOrder.id);

    const { status, json } = await fetchJson("/api/reports/pricing/exceptions");

    assert.equal(status, 200);
    assert.ok(json.summary.missingRetailPriceCount >= 1);
    assert.ok(json.summary.retailAtOrBelowCostCount >= 1);
    assert.ok(json.summary.lowMarginCount >= 1);

    const missingRetailRow = json.items.find((row) => row.sku === missingRetail.variants[0].sku);
    const atCostRow = json.items.find((row) => row.sku === atCost.variants[0].sku);
    const lowMarginRow = json.items.find((row) => row.sku === lowMargin.variants[0].sku);
    const healthyRow = json.items.find((row) => row.sku === healthy.variants[0].sku);

    assert.ok(missingRetailRow, "expected missing retail row");
    assert.equal(missingRetailRow.exceptionType, "MISSING_RETAIL_PRICE");
    assert.equal(missingRetailRow.cost, 1000);
    assert.equal(missingRetailRow.retailPrice, 0);
    assert.equal(missingRetailRow.apparentMarginPence, null);
    assert.equal(missingRetailRow.apparentMarginPercent, null);

    assert.ok(atCostRow, "expected at-cost row");
    assert.equal(atCostRow.exceptionType, "RETAIL_AT_OR_BELOW_COST");
    assert.equal(atCostRow.cost, 1200);
    assert.equal(atCostRow.retailPrice, 1200);
    assert.equal(atCostRow.apparentMarginPence, 0);
    assert.equal(atCostRow.apparentMarginPercent, 0);

    assert.ok(lowMarginRow, "expected low-margin row");
    assert.equal(lowMarginRow.exceptionType, "LOW_MARGIN");
    assert.equal(lowMarginRow.cost, 850);
    assert.equal(lowMarginRow.retailPrice, 1000);
    assert.equal(lowMarginRow.apparentMarginPence, 150);
    assert.equal(lowMarginRow.apparentMarginPercent, 15);

    assert.equal(healthyRow, undefined);

    console.log("[m122-smoke] pricing exceptions report passed");
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
