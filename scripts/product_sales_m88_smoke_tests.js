#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

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

const RUN_REF = `m88_${Date.now()}`;
const STAFF_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": `m88-manager-${RUN_REF}`,
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
    await prisma.variant.deleteMany({ where: { id: { in: state.variantIds } } });
  }
  if (state.productIds.length) {
    await prisma.product.deleteMany({ where: { id: { in: state.productIds } } });
  }
};

const main = async () => {
  const state = { productIds: [], variantIds: [], saleIds: [] };
  try {
    const [alpha, beta, gamma] = await Promise.all([
      prisma.product.create({
        data: {
          name: `M88 Alpha Bike ${RUN_REF}`,
          variants: {
            create: {
              sku: `M88-A-${RUN_REF}`,
              retailPricePence: 50000,
            },
          },
        },
        include: { variants: true },
      }),
      prisma.product.create({
        data: {
          name: `M88 Beta Helmet ${RUN_REF}`,
          variants: {
            create: {
              sku: `M88-B-${RUN_REF}`,
              retailPricePence: 7500,
            },
          },
        },
        include: { variants: true },
      }),
      prisma.product.create({
        data: {
          name: `M88 Gamma Gloves ${RUN_REF}`,
          variants: {
            create: {
              sku: `M88-C-${RUN_REF}`,
              retailPricePence: 2500,
            },
          },
        },
        include: { variants: true },
      }),
    ]);

    state.productIds.push(alpha.id, beta.id, gamma.id);
    state.variantIds.push(alpha.variants[0].id, beta.variants[0].id, gamma.variants[0].id);

    const saleOne = await prisma.sale.create({
      data: {
        subtotalPence: 62500,
        taxPence: 0,
        totalPence: 62500,
        completedAt: new Date(),
        items: {
          create: [
            {
              variantId: alpha.variants[0].id,
              quantity: 1,
              unitPricePence: 50000,
              lineTotalPence: 50000,
            },
            {
              variantId: beta.variants[0].id,
              quantity: 1,
              unitPricePence: 7500,
              lineTotalPence: 7500,
            },
            {
              variantId: gamma.variants[0].id,
              quantity: 2,
              unitPricePence: 2500,
              lineTotalPence: 5000,
            },
          ],
        },
      },
    });

    const saleTwo = await prisma.sale.create({
      data: {
        subtotalPence: 55000,
        taxPence: 0,
        totalPence: 55000,
        completedAt: new Date(),
        items: {
          create: [
            {
              variantId: alpha.variants[0].id,
              quantity: 1,
              unitPricePence: 50000,
              lineTotalPence: 50000,
            },
            {
              variantId: gamma.variants[0].id,
              quantity: 2,
              unitPricePence: 2500,
              lineTotalPence: 5000,
            },
          ],
        },
      },
    });

    state.saleIds.push(saleOne.id, saleTwo.id);

    const today = new Date().toISOString().slice(0, 10);
    const { status, json } = await fetchJson(`/api/reports/sales/products?from=${today}&to=${today}&take=5`);

    assert.equal(status, 200);
    assert.ok(json.summary.productCount >= 3);
    assert.equal(json.topSellingProducts[0].productName, gamma.name);
    assert.equal(json.topSellingProducts[0].quantitySold, 4);
    assert.ok(json.products.some((row) => row.productName === gamma.name && row.quantitySold === 4));
    assert.ok(json.lowestSellingProducts.some((row) => row.productName === beta.name));

    console.log("[m88-smoke] product sales analytics passed");
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
