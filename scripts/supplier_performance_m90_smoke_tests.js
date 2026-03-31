#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

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

const RUN_REF = `m90_${Date.now()}`;
const STAFF_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": `m90-manager-${RUN_REF}`,
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
  if (state.purchaseOrderIds.length) {
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: state.purchaseOrderIds } } });
  }
  if (state.variantIds.length) {
    await prisma.barcode.deleteMany({ where: { variantId: { in: state.variantIds } } });
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
    const [supplierA, supplierB] = await Promise.all([
      prisma.supplier.create({ data: { name: `M90 Acme ${RUN_REF}` } }),
      prisma.supplier.create({ data: { name: `M90 Beacon ${RUN_REF}` } }),
    ]);
    state.supplierIds.push(supplierA.id, supplierB.id);

    const [productA, productB] = await Promise.all([
      prisma.product.create({
        data: {
          name: `M90 Product A ${RUN_REF}`,
          variants: { create: { sku: `M90-A-${RUN_REF}`, retailPricePence: 1000 } },
        },
        include: { variants: true },
      }),
      prisma.product.create({
        data: {
          name: `M90 Product B ${RUN_REF}`,
          variants: { create: { sku: `M90-B-${RUN_REF}`, retailPricePence: 2000 } },
        },
        include: { variants: true },
      }),
    ]);
    state.productIds.push(productA.id, productB.id);
    state.variantIds.push(productA.variants[0].id, productB.variants[0].id);

    const poA = await prisma.purchaseOrder.create({
      data: {
        supplierId: supplierA.id,
        status: "PARTIALLY_RECEIVED",
        expectedAt: new Date(Date.now() - 86_400_000),
        items: {
          create: [
            {
              variantId: productA.variants[0].id,
              quantityOrdered: 10,
              quantityReceived: 6,
              unitCostPence: 500,
            },
          ],
        },
      },
    });

    const poB = await prisma.purchaseOrder.create({
      data: {
        supplierId: supplierB.id,
        status: "RECEIVED",
        items: {
          create: [
            {
              variantId: productB.variants[0].id,
              quantityOrdered: 4,
              quantityReceived: 4,
              unitCostPence: 1500,
            },
          ],
        },
      },
    });

    state.purchaseOrderIds.push(poA.id, poB.id);

    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const { status, json } = await fetchJson(`/api/reports/suppliers/performance?from=${from}&to=${today}&take=5`);

    assert.equal(status, 200);
    assert.equal(json.summary.supplierCount, 2);
    assert.ok(json.suppliers.some((row) => row.supplierName === supplierA.name && row.overdueOpenCount >= 1));
    assert.ok(json.topSuppliers.some((row) => row.supplierName === supplierA.name));
    assert.equal(json.revenueContributionSupported, false);

    console.log("[m90-smoke] supplier performance analytics passed");
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
