#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { ensureMainLocationId } = require("./default_location_helper");
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
  label: "m120-smoke",
  baseUrl: BASE_URL,
  databaseUrl: DATABASE_URL,
});

const RUN_REF = `m120_${Date.now()}`;
const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": `m120-manager-${RUN_REF}`,
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
  if (state.variantIds.length) {
    await prisma.inventoryMovement.deleteMany({ where: { variantId: { in: state.variantIds } } });
    await prisma.variant.deleteMany({ where: { id: { in: state.variantIds } } });
  }
  if (state.productIds.length) {
    await prisma.product.deleteMany({ where: { id: { in: state.productIds } } });
  }
};

const main = async () => {
  const state = { productIds: [], variantIds: [], saleIds: [] };
  try {
    await serverController.startIfNeeded();
    const locationId = await ensureMainLocationId(prisma);

    const [fast, normal, slow, dead] = await Promise.all([
      prisma.product.create({
        data: {
          name: `M120 Fast ${RUN_REF}`,
          variants: { create: { sku: `M120-FAST-${RUN_REF}`, retailPricePence: 1200 } },
        },
        include: { variants: true },
      }),
      prisma.product.create({
        data: {
          name: `M120 Normal ${RUN_REF}`,
          variants: { create: { sku: `M120-NORMAL-${RUN_REF}`, retailPricePence: 1200 } },
        },
        include: { variants: true },
      }),
      prisma.product.create({
        data: {
          name: `M120 Slow ${RUN_REF}`,
          variants: { create: { sku: `M120-SLOW-${RUN_REF}`, retailPricePence: 1200 } },
        },
        include: { variants: true },
      }),
      prisma.product.create({
        data: {
          name: `M120 Dead ${RUN_REF}`,
          variants: { create: { sku: `M120-DEAD-${RUN_REF}`, retailPricePence: 1200 } },
        },
        include: { variants: true },
      }),
    ]);

    state.productIds.push(fast.id, normal.id, slow.id, dead.id);
    state.variantIds.push(fast.variants[0].id, normal.variants[0].id, slow.variants[0].id, dead.variants[0].id);

    await prisma.inventoryMovement.createMany({
      data: [
        { variantId: fast.variants[0].id, type: "PURCHASE", quantity: 4, referenceType: "M120", referenceId: RUN_REF },
        { variantId: normal.variants[0].id, type: "PURCHASE", quantity: 6, referenceType: "M120", referenceId: RUN_REF },
        { variantId: slow.variants[0].id, type: "PURCHASE", quantity: 5, referenceType: "M120", referenceId: RUN_REF },
        { variantId: dead.variants[0].id, type: "PURCHASE", quantity: 8, referenceType: "M120", referenceId: RUN_REF },
      ],
    });

    const sale = await prisma.sale.create({
      data: {
        locationId,
        subtotalPence: 21600,
        taxPence: 0,
        totalPence: 21600,
        completedAt: new Date(),
        items: {
          create: [
            { variantId: fast.variants[0].id, quantity: 10, unitPricePence: 1200, lineTotalPence: 12000 },
            { variantId: normal.variants[0].id, quantity: 4, unitPricePence: 1200, lineTotalPence: 4800 },
            { variantId: slow.variants[0].id, quantity: 2, unitPricePence: 1200, lineTotalPence: 2400 },
          ],
        },
      },
    });
    state.saleIds.push(sale.id);

    const { status, json } = await fetchJson("/api/reports/inventory-velocity");

    assert.equal(status, 200);

    const fastRow = json.items.find((row) => row.sku === fast.variants[0].sku);
    const normalRow = json.items.find((row) => row.sku === normal.variants[0].sku);
    const slowRow = json.items.find((row) => row.sku === slow.variants[0].sku);
    const deadRow = json.items.find((row) => row.sku === dead.variants[0].sku);

    assert.equal(fastRow.sales30Days, 10);
    assert.equal(fastRow.sales90Days, 10);
    assert.equal(fastRow.velocityClass, "FAST_MOVER");

    assert.equal(normalRow.sales30Days, 4);
    assert.equal(normalRow.velocityClass, "NORMAL");

    assert.equal(slowRow.sales30Days, 2);
    assert.equal(slowRow.velocityClass, "SLOW_MOVER");

    assert.equal(deadRow.sales30Days, 0);
    assert.equal(deadRow.sales90Days, 0);
    assert.equal(deadRow.onHand, 8);
    assert.equal(deadRow.velocityClass, "DEAD_STOCK");

    console.log("[m120-smoke] inventory velocity classification passed");
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
