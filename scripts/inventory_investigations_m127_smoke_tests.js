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
  label: "m127-smoke",
  baseUrl: BASE_URL,
  databaseUrl: DATABASE_URL,
});

const RUN_REF = `m127_${Date.now()}`;
const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": `m127-manager-${RUN_REF}`,
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
  if (state.inventoryMovementVariantIds.length) {
    await prisma.inventoryMovement.deleteMany({
      where: { variantId: { in: state.inventoryMovementVariantIds } },
    });
  }
  if (state.variantIds.length) {
    await prisma.variant.deleteMany({ where: { id: { in: state.variantIds } } });
  }
  if (state.productIds.length) {
    await prisma.product.deleteMany({ where: { id: { in: state.productIds } } });
  }
};

const main = async () => {
  const state = {
    productIds: [],
    variantIds: [],
    inventoryMovementVariantIds: [],
  };
  try {
    await serverController.startIfNeeded();

    const before = await fetchJson("/api/reports/inventory/investigations");
    assert.equal(before.status, 200);

    const [negativeProduct, deadStockProduct, missingRetailProduct, belowCostProduct] = await Promise.all([
      prisma.product.create({
        data: {
          name: `M127 Negative ${RUN_REF}`,
          variants: {
            create: {
              sku: `M127-NEG-${RUN_REF}`,
              retailPricePence: 2200,
              costPricePence: 900,
            },
          },
        },
        include: { variants: true },
      }),
      prisma.product.create({
        data: {
          name: `M127 Dead ${RUN_REF}`,
          variants: {
            create: {
              sku: `M127-DEAD-${RUN_REF}`,
              retailPricePence: 2500,
              costPricePence: 1000,
            },
          },
        },
        include: { variants: true },
      }),
      prisma.product.create({
        data: {
          name: `M127 Missing Retail ${RUN_REF}`,
          variants: {
            create: {
              sku: `M127-NOPRICE-${RUN_REF}`,
              retailPricePence: 0,
              costPricePence: 1300,
            },
          },
        },
        include: { variants: true },
      }),
      prisma.product.create({
        data: {
          name: `M127 Below Cost ${RUN_REF}`,
          variants: {
            create: {
              sku: `M127-BELOW-${RUN_REF}`,
              retailPricePence: 1500,
              costPricePence: 1500,
            },
          },
        },
        include: { variants: true },
      }),
    ]);

    state.productIds.push(
      negativeProduct.id,
      deadStockProduct.id,
      missingRetailProduct.id,
      belowCostProduct.id,
    );
    state.variantIds.push(
      negativeProduct.variants[0].id,
      deadStockProduct.variants[0].id,
      missingRetailProduct.variants[0].id,
      belowCostProduct.variants[0].id,
    );

    await prisma.inventoryMovement.createMany({
      data: [
        {
          variantId: negativeProduct.variants[0].id,
          type: "ADJUSTMENT",
          quantity: -3,
          referenceType: "M127",
          referenceId: RUN_REF,
        },
        {
          variantId: deadStockProduct.variants[0].id,
          type: "PURCHASE",
          quantity: 6,
          referenceType: "M127",
          referenceId: RUN_REF,
        },
      ],
    });
    state.inventoryMovementVariantIds.push(
      negativeProduct.variants[0].id,
      deadStockProduct.variants[0].id,
    );

    const after = await fetchJson("/api/reports/inventory/investigations");
    assert.equal(after.status, 200);

    const negativeRow = after.json.items.find((row) => row.variantId === negativeProduct.variants[0].id);
    const deadStockRow = after.json.items.find((row) => row.variantId === deadStockProduct.variants[0].id);
    const missingRetailRow = after.json.items.find((row) => row.variantId === missingRetailProduct.variants[0].id);
    const belowCostRow = after.json.items.find((row) => row.variantId === belowCostProduct.variants[0].id);

    assert.ok(negativeRow, "expected negative stock row");
    assert.equal(negativeRow.issueType, "NEGATIVE_STOCK");
    assert.equal(negativeRow.severity, "CRITICAL");
    assert.equal(negativeRow.link, `/inventory/${negativeProduct.variants[0].id}`);

    assert.ok(deadStockRow, "expected dead stock row");
    assert.equal(deadStockRow.issueType, "DEAD_STOCK");
    assert.equal(deadStockRow.severity, "WARNING");
    assert.equal(deadStockRow.link, `/inventory/${deadStockProduct.variants[0].id}`);

    assert.ok(missingRetailRow, "expected missing retail row");
    assert.equal(missingRetailRow.issueType, "MISSING_RETAIL_PRICE");
    assert.equal(missingRetailRow.severity, "WARNING");
    assert.equal(missingRetailRow.link, "/management/pricing");

    assert.ok(belowCostRow, "expected retail at or below cost row");
    assert.equal(belowCostRow.issueType, "RETAIL_AT_OR_BELOW_COST");
    assert.equal(belowCostRow.severity, "CRITICAL");
    assert.equal(belowCostRow.link, "/management/pricing");

    assert.ok(after.json.summary.total >= before.json.summary.total + 4);
    assert.ok(after.json.summary.negativeStockCount >= 1);
    assert.ok(after.json.summary.deadStockCount >= 1);
    assert.ok(after.json.summary.missingRetailPriceCount >= 1);
    assert.ok(after.json.summary.retailAtOrBelowCostCount >= 1);

    console.log("[m127-smoke] inventory investigations report passed");
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
