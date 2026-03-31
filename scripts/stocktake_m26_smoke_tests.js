#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { createSmokeServerController } = require("./smoke_server_helper");

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
console.log(`[m26-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m26-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});
const serverController = createSmokeServerController({
  label: "m26-smoke",
  baseUrl: BASE_URL,
  databaseUrl: DATABASE_URL,
  captureStartupLog: true,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;

const fetchJson = async (path, options = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, {
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

const serverIsHealthy = async () => {
  try {
    const response = await fetch(HEALTH_URL);
    return response.ok;
  } catch {
    return false;
  }
};

const waitForServer = async () => {
  for (let i = 0; i < 60; i += 1) {
    if (await serverIsHealthy()) {
      return;
    }
    await sleep(500);
  }
  throw new Error("Server did not become healthy on /health");
};

const cleanup = async (state) => {
  const stocktakeIds = Array.from(state.stocktakeIds);
  const lineIds = Array.from(state.stocktakeLineIds);
  const locationIds = Array.from(state.locationIds);
  const variantIds = Array.from(state.variantIds);
  const productIds = Array.from(state.productIds);
  const userIds = Array.from(state.userIds);

  if (stocktakeIds.length > 0) {
    const dbLines = await prisma.stocktakeLine.findMany({
      where: {
        stocktakeId: {
          in: stocktakeIds,
        },
      },
      select: {
        id: true,
      },
    });

    for (const row of dbLines) {
      state.stocktakeLineIds.add(row.id);
    }
  }

  const allLineIds = Array.from(state.stocktakeLineIds);

  if (variantIds.length > 0) {
    const stockLedgerDeleteWhere =
      allLineIds.length > 0
        ? {
            OR: [
              {
                variantId: {
                  in: variantIds,
                },
              },
              {
                referenceType: "STOCKTAKE_LINE",
                referenceId: {
                  in: allLineIds,
                },
              },
            ],
          }
        : {
            variantId: {
              in: variantIds,
            },
          };

    await prisma.stockLedgerEntry.deleteMany({
      where: stockLedgerDeleteWhere,
    });

    await prisma.inventoryMovement.deleteMany({
      where: {
        variantId: {
          in: variantIds,
        },
      },
    });
  }

  if (stocktakeIds.length > 0) {
    await prisma.auditEvent.deleteMany({
      where: {
        entityType: "STOCKTAKE",
        entityId: {
          in: stocktakeIds,
        },
      },
    });

    await prisma.stocktakeLine.deleteMany({
      where: {
        stocktakeId: {
          in: stocktakeIds,
        },
      },
    });

    await prisma.stocktake.deleteMany({
      where: {
        id: {
          in: stocktakeIds,
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
};

const run = async () => {
  const state = {
    stocktakeIds: new Set(),
    stocktakeLineIds: new Set(),
    locationIds: new Set(),
    variantIds: new Set(),
    productIds: new Set(),
    userIds: new Set(),
  };

  try {
    await serverController.startIfNeeded();

    const managerUser = await prisma.user.create({
      data: {
        username: `m26-manager-${uniqueRef()}`,
        passwordHash: "m26-smoke",
        role: "ADMIN",
      },
    });
    state.userIds.add(managerUser.id);

    const staffUser = await prisma.user.create({
      data: {
        username: `m26-staff-${uniqueRef()}`,
        passwordHash: "m26-smoke",
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
        name: `M26 Location ${uniqueRef()}`,
      },
    });
    state.locationIds.add(location.id);

    const createProductRes = await fetchJson("/api/products", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        name: `M26 Product ${uniqueRef()}`,
      }),
    });
    assert.equal(createProductRes.status, 201, JSON.stringify(createProductRes.json));
    state.productIds.add(createProductRes.json.id);

    const createVariantRes = await fetchJson("/api/variants", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        productId: createProductRes.json.id,
        sku: `M26-SKU-${uniqueRef()}`,
        barcode: `26${Date.now().toString().slice(-11)}`,
        retailPricePence: 899,
      }),
    });
    assert.equal(createVariantRes.status, 201, JSON.stringify(createVariantRes.json));
    const inventoryVariantId = createVariantRes.json.id;
    state.variantIds.add(inventoryVariantId);

    const seedPurchaseRes = await fetchJson("/api/inventory/movements", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        variantId: inventoryVariantId,
        type: "PURCHASE",
        quantity: 10,
        unitCost: 500,
        referenceType: "M26_TEST",
        referenceId: `purchase_${uniqueRef()}`,
      }),
    });
    assert.equal(seedPurchaseRes.status, 201, JSON.stringify(seedPurchaseRes.json));

    const onHandSearchRes = await fetchJson(
      `/api/inventory/on-hand/search?q=${encodeURIComponent(createVariantRes.json.sku)}&take=25&skip=0`,
      {
        headers: staffHeaders,
      },
    );
    assert.equal(onHandSearchRes.status, 200, JSON.stringify(onHandSearchRes.json));
    const searchRow = onHandSearchRes.json.rows.find(
      (row) => row.variantId === inventoryVariantId,
    );
    assert.ok(searchRow, "Expected search row for created variant");
    assert.equal(searchRow.onHand, 10);

    const blockedAdjustRes = await fetchJson("/api/inventory/movements", {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        variantId: inventoryVariantId,
        type: "ADJUSTMENT",
        quantity: -1,
        referenceType: "M26_TEST",
        referenceId: `blocked_adjust_${uniqueRef()}`,
      }),
    });
    assert.equal(blockedAdjustRes.status, 403, JSON.stringify(blockedAdjustRes.json));

    const adjustRes = await fetchJson("/api/inventory/movements", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        variantId: inventoryVariantId,
        type: "ADJUSTMENT",
        quantity: -3,
        note: "Cycle count correction",
        referenceType: "M26_TEST",
        referenceId: `adjust_${uniqueRef()}`,
      }),
    });
    assert.equal(adjustRes.status, 201, JSON.stringify(adjustRes.json));

    const onHandAfterAdjustRes = await fetchJson(
      `/api/inventory/on-hand?variantId=${encodeURIComponent(inventoryVariantId)}`,
      {
        headers: staffHeaders,
      },
    );
    assert.equal(onHandAfterAdjustRes.status, 200, JSON.stringify(onHandAfterAdjustRes.json));
    assert.equal(onHandAfterAdjustRes.json.onHand, 7);

    const createStocktakeVariantRes = await fetchJson("/api/variants", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        productId: createProductRes.json.id,
        sku: `M26-STK-SKU-${uniqueRef()}`,
        barcode: `27${Date.now().toString().slice(-11)}`,
        retailPricePence: 999,
      }),
    });
    assert.equal(createStocktakeVariantRes.status, 201, JSON.stringify(createStocktakeVariantRes.json));
    const stocktakeVariantId = createStocktakeVariantRes.json.id;
    state.variantIds.add(stocktakeVariantId);

    const seedStocktakeLocationRes = await fetchJson("/api/stock/adjustments", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        variantId: stocktakeVariantId,
        locationId: location.id,
        quantityDelta: 7,
        note: "M26 stocktake seed",
        referenceType: "M26_TEST",
        referenceId: `location_seed_${uniqueRef()}`,
      }),
    });
    assert.equal(seedStocktakeLocationRes.status, 201, JSON.stringify(seedStocktakeLocationRes.json));

    const createSessionRes = await fetchJson("/api/stocktake/sessions", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        locationId: location.id,
        notes: "M26 smoke cycle count",
      }),
    });
    assert.equal(createSessionRes.status, 201, JSON.stringify(createSessionRes.json));
    const stocktakeId = createSessionRes.json.id;
    state.stocktakeIds.add(stocktakeId);
    assert.equal(createSessionRes.json.workflowState, "DRAFT");

    const listSessionRes = await fetchJson("/api/stocktake/sessions?status=OPEN&take=20&skip=0", {
      headers: staffHeaders,
    });
    assert.equal(listSessionRes.status, 200, JSON.stringify(listSessionRes.json));
    assert.ok(
      listSessionRes.json.stocktakes.some((session) => session.id === stocktakeId),
      "Expected stocktake session in listing",
    );

    const upsertLineRes = await fetchJson(`/api/stocktake/sessions/${stocktakeId}/lines`, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        variantId: stocktakeVariantId,
        countedQty: 5,
      }),
    });
    assert.equal(upsertLineRes.status, 200, JSON.stringify(upsertLineRes.json));
    assert.equal(upsertLineRes.json.lines.length, 1);
    const stocktakeLineId = upsertLineRes.json.lines[0].id;
    state.stocktakeLineIds.add(stocktakeLineId);
    assert.equal(upsertLineRes.json.workflowState, "COUNTING");
    assert.equal(upsertLineRes.json.lines[0].expectedQty, 7);
    assert.equal(upsertLineRes.json.lines[0].varianceQty, -2);
    assert.equal(upsertLineRes.json.lines[0].deltaNeeded, -2);

    const midSessionAdjustmentRes = await fetchJson("/api/stock/adjustments", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        variantId: stocktakeVariantId,
        locationId: location.id,
        quantityDelta: 1,
        note: "M26 mid-session live change",
        referenceType: "M26_TEST",
        referenceId: `location_live_${uniqueRef()}`,
      }),
    });
    assert.equal(midSessionAdjustmentRes.status, 201, JSON.stringify(midSessionAdjustmentRes.json));

    const sessionDetailRes = await fetchJson(
      `/api/stocktake/sessions/${stocktakeId}?includePreview=true`,
      {
        headers: staffHeaders,
      },
    );
    assert.equal(sessionDetailRes.status, 200, JSON.stringify(sessionDetailRes.json));
    assert.equal(sessionDetailRes.json.lines[0].expectedQty, 7);
    assert.equal(sessionDetailRes.json.lines[0].varianceQty, -2);
    assert.equal(sessionDetailRes.json.lines[0].currentOnHand, 8);
    assert.equal(sessionDetailRes.json.lines[0].deltaNeeded, -3);
    assert.equal(sessionDetailRes.json.lines[0].hasLiveDrift, true);

    const reviewRes = await fetchJson(`/api/stocktake/sessions/${stocktakeId}/review`, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(reviewRes.status, 200, JSON.stringify(reviewRes.json));
    assert.equal(reviewRes.json.workflowState, "REVIEW");
    assert.ok(reviewRes.json.reviewRequestedAt, "Expected reviewRequestedAt on stocktake");

    const finalizeRes = await fetchJson(`/api/stocktake/sessions/${stocktakeId}/finalize`, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(finalizeRes.status, 200, JSON.stringify(finalizeRes.json));
    assert.equal(finalizeRes.json.status, "POSTED");
    assert.equal(finalizeRes.json.workflowState, "COMPLETED");

    const onHandAfterFinalizeRes = await fetchJson(
      `/api/inventory/on-hand?variantId=${encodeURIComponent(stocktakeVariantId)}`,
      {
        headers: staffHeaders,
      },
    );
    assert.equal(onHandAfterFinalizeRes.status, 200, JSON.stringify(onHandAfterFinalizeRes.json));
    assert.equal(onHandAfterFinalizeRes.json.onHand, 5);

    const stocktakeMovement = await prisma.inventoryMovement.findFirst({
      where: {
        referenceType: "STOCKTAKE_LINE",
        referenceId: stocktakeLineId,
      },
    });
    assert.ok(stocktakeMovement, "Expected STOCKTAKE_LINE inventory movement");
    assert.equal(stocktakeMovement.quantity, -3);
    assert.equal(stocktakeMovement.createdByStaffId, managerUser.id);

    const finalizationAuditEvent = await prisma.auditEvent.findFirst({
      where: {
        entityType: "STOCKTAKE",
        entityId: stocktakeId,
        action: "STOCKTAKE_FINALIZED",
      },
    });
    assert.ok(finalizationAuditEvent, "Expected STOCKTAKE_FINALIZED audit event");

    console.log("PASS m26 stock adjustments + stocktake session smoke tests");
  } finally {
    await cleanup(state);
    await serverController.stop();
    await prisma.$disconnect();
  }
};

run().catch((error) => {
  console.error("[m26-smoke] FAIL", error);
  process.exitCode = 1;
});
