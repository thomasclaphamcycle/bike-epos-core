#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { ensureMainLocationId } = require("./default_location_helper");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3100";
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

const RUN_REF = `m89_${Date.now()}`;
const STAFF_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": `m89-manager-${RUN_REF}`,
  "Content-Type": "application/json",
};

const fetchJson = async (path) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: STAFF_HEADERS,
  });
  const json = await response.json();
  return { status: response.status, json };
};

const cleanup = async (state) => {
  if (state.saleIds.length) {
    await prisma.sale.deleteMany({ where: { id: { in: state.saleIds } } });
  }
  if (state.variantIds.length) {
    await prisma.inventoryMovement.deleteMany({ where: { variantId: { in: state.variantIds } } });
    await prisma.barcode.deleteMany({ where: { variantId: { in: state.variantIds } } });
    await prisma.variant.deleteMany({ where: { id: { in: state.variantIds } } });
  }
  if (state.productIds.length) {
    await prisma.product.deleteMany({ where: { id: { in: state.productIds } } });
  }
};

const main = async () => {
  const state = { productIds: [], variantIds: [], saleIds: [] };
  try {
    const locationId = await ensureMainLocationId(prisma);
    const [fast, slow, dead] = await Promise.all([
      prisma.product.create({
        data: {
          name: `M89 Fast Chain ${RUN_REF}`,
          variants: {
            create: {
              sku: `M89-A-${RUN_REF}`,
              retailPricePence: 1800,
            },
          },
        },
        include: { variants: true },
      }),
      prisma.product.create({
        data: {
          name: `M89 Slow Tyre ${RUN_REF}`,
          variants: {
            create: {
              sku: `M89-B-${RUN_REF}`,
              retailPricePence: 3200,
            },
          },
        },
        include: { variants: true },
      }),
      prisma.product.create({
        data: {
          name: `M89 Dead Saddle ${RUN_REF}`,
          variants: {
            create: {
              sku: `M89-C-${RUN_REF}`,
              retailPricePence: 4500,
            },
          },
        },
        include: { variants: true },
      }),
    ]);

    state.productIds.push(fast.id, slow.id, dead.id);
    state.variantIds.push(fast.variants[0].id, slow.variants[0].id, dead.variants[0].id);

    await prisma.inventoryMovement.createMany({
      data: [
        { variantId: fast.variants[0].id, type: "PURCHASE", quantity: 20, referenceType: "M89", referenceId: RUN_REF },
        { variantId: slow.variants[0].id, type: "PURCHASE", quantity: 10, referenceType: "M89", referenceId: RUN_REF },
        { variantId: dead.variants[0].id, type: "PURCHASE", quantity: 8, referenceType: "M89", referenceId: RUN_REF },
      ],
    });

    const sale = await prisma.sale.create({
      data: {
        locationId,
        subtotalPence: 14000,
        taxPence: 0,
        totalPence: 14000,
        completedAt: new Date(),
        items: {
          create: [
            {
              variantId: fast.variants[0].id,
              quantity: 6,
              unitPricePence: 1800,
              lineTotalPence: 10800,
            },
            {
              variantId: slow.variants[0].id,
              quantity: 1,
              unitPricePence: 3200,
              lineTotalPence: 3200,
            },
          ],
        },
      },
    });
    state.saleIds.push(sale.id);

    const today = new Date().toISOString().slice(0, 10);
    const { status, json } = await fetchJson(`/api/reports/inventory/velocity?from=${today}&to=${today}&take=5`);

    assert.equal(status, 200);
    assert.equal(json.fastMovingProducts[0].productName, fast.name);
    assert.ok(json.slowMovingProducts.some((row) => row.productName === slow.name));
    assert.ok(json.deadStockCandidates.some((row) => row.productName === dead.name));
    assert.ok(json.summary.deadStockCount >= 1);

    console.log("[m89-smoke] inventory velocity analytics passed");
  } finally {
    await cleanup(state);
    await prisma.$disconnect();
  }
};

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
