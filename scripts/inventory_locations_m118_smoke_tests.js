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

const RUN_REF = `m118_${Date.now()}`;
const STAFF_HEADERS = {
  "X-Staff-Role": "STAFF",
  "X-Staff-Id": `m118-staff-${RUN_REF}`,
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
  if (state.stockEntryIds.length) {
    await prisma.stockLedgerEntry.deleteMany({ where: { id: { in: state.stockEntryIds } } });
  }
  if (state.variantIds.length) {
    await prisma.barcode.deleteMany({ where: { variantId: { in: state.variantIds } } });
    await prisma.variant.deleteMany({ where: { id: { in: state.variantIds } } });
  }
  if (state.productIds.length) {
    await prisma.product.deleteMany({ where: { id: { in: state.productIds } } });
  }
  if (state.locationIds.length) {
    await prisma.stockLocation.deleteMany({ where: { id: { in: state.locationIds } } });
  }
};

const main = async () => {
  const state = {
    locationIds: [],
    productIds: [],
    variantIds: [],
    stockEntryIds: [],
  };

  try {
    const [locationA, locationB] = await Promise.all([
      prisma.stockLocation.create({
        data: {
          name: `M118 Front ${RUN_REF}`,
          isDefault: false,
        },
      }),
      prisma.stockLocation.create({
        data: {
          name: `M118 Back ${RUN_REF}`,
          isDefault: false,
        },
      }),
    ]);
    state.locationIds.push(locationA.id, locationB.id);

    const product = await prisma.product.create({
      data: {
        name: `M118 Tube ${RUN_REF}`,
        variants: {
          create: {
            sku: `M118-SKU-${RUN_REF}`,
            retailPricePence: 999,
          },
        },
      },
      include: { variants: true },
    });
    state.productIds.push(product.id);
    state.variantIds.push(product.variants[0].id);

    const [entryA, entryB] = await Promise.all([
      prisma.stockLedgerEntry.create({
        data: {
          variantId: product.variants[0].id,
          locationId: locationA.id,
          type: "ADJUSTMENT",
          quantityDelta: 5,
          referenceType: "M118",
          referenceId: RUN_REF,
        },
      }),
      prisma.stockLedgerEntry.create({
        data: {
          variantId: product.variants[0].id,
          locationId: locationB.id,
          type: "ADJUSTMENT",
          quantityDelta: -1,
          referenceType: "M118",
          referenceId: RUN_REF,
        },
      }),
    ]);
    state.stockEntryIds.push(entryA.id, entryB.id);

    const byLocation = await fetchJson(`/api/reports/inventory/location-summary?q=${encodeURIComponent(product.variants[0].sku)}&take=10`);
    assert.equal(byLocation.status, 200);
    assert.ok(Array.isArray(byLocation.json.rows));

    const row = byLocation.json.rows.find((candidate) => candidate.variantId === product.variants[0].id);
    assert.ok(row, "expected variant row in location summary");
    assert.equal(row.totalOnHand, 4);
    assert.equal(row.locations.find((location) => location.id === locationA.id)?.onHand, 5);
    assert.equal(row.locations.find((location) => location.id === locationB.id)?.onHand, -1);

    const singleLocation = await fetchJson(
      `/api/reports/inventory/location-summary?q=${encodeURIComponent(product.variants[0].sku)}&locationId=${encodeURIComponent(locationB.id)}&take=10`,
    );
    assert.equal(singleLocation.status, 200);
    const filteredRow = singleLocation.json.rows.find((candidate) => candidate.variantId === product.variants[0].id);
    assert.ok(filteredRow, "expected variant row in filtered location summary");
    assert.equal(filteredRow.totalOnHand, -1);
    assert.equal(filteredRow.locations.length, 1);
    assert.equal(filteredRow.locations[0].id, locationB.id);

    console.log("[m118-smoke] inventory location summary passed");
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
