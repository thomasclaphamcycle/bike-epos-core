#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { createSmokeServerController } = require("./smoke_server_helper");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3100";
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
console.log(`[m24-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m24-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const uniqueRef = () => `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
const MAX_STARTUP_LOG_CHARS = 4000;
const APP_REQUEST_RETRIES = 8;
const appBaseUrlCandidates = (() => {
  const primary = new URL(BASE_URL).toString().replace(/\/$/, "");
  const urls = [primary];

  try {
    const fallback = new URL(primary);
    if (fallback.hostname === "localhost") {
      fallback.hostname = "127.0.0.1";
      urls.push(fallback.toString().replace(/\/$/, ""));
    }
  } catch {
    // Keep the primary URL only if parsing fails unexpectedly.
  }

  return urls;
})();
let activeAppBaseUrl = appBaseUrlCandidates[0];
const serverStartedPattern = /Server running on http:\/\/localhost:\d+/i;
const serverController = createSmokeServerController({
  label: "m24-smoke",
  baseUrls: appBaseUrlCandidates,
  databaseUrl: DATABASE_URL,
  captureStartupLog: true,
  startupLogCharLimit: MAX_STARTUP_LOG_CHARS,
  startupReadyPattern: serverStartedPattern,
  envOverrides: {
    PORT: new URL(BASE_URL).port || "3100",
  },
});

const fetchFromApp = async (path, options = {}) => {
  let lastError = null;

  for (let attempt = 0; attempt < APP_REQUEST_RETRIES; attempt += 1) {
    try {
      activeAppBaseUrl = serverController.getBaseUrl();
      return await fetch(`${activeAppBaseUrl}${path}`, options);
    } catch (error) {
      lastError = error;

      const healthyBaseUrl = await serverController.probeHealthyBaseUrl();
      if (healthyBaseUrl) {
        activeAppBaseUrl = healthyBaseUrl;
      }
    }

    if (attempt < APP_REQUEST_RETRIES - 1) {
      await sleep(250);
    }
  }

  if (lastError instanceof Error) {
    lastError.message = `${lastError.message} while requesting ${activeAppBaseUrl}${path}`;
    throw lastError;
  }

  throw new Error(`Failed to fetch ${activeAppBaseUrl}${path}`);
};

const fetchJson = async (path, options = {}) => {
  const response = await fetchFromApp(path, {
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

  return {
    status: response.status,
    json,
  };
};

const cleanup = async (state) => {
  const variantIds = Array.from(state.variantIds);
  const productIds = Array.from(state.productIds);
  const locationIds = Array.from(state.locationIds);

  if (variantIds.length > 0) {
    await prisma.inventoryMovement.deleteMany({
      where: {
        variantId: {
          in: variantIds,
        },
      },
    });
    await prisma.stockLedgerEntry.deleteMany({
      where: {
        variantId: {
          in: variantIds,
        },
      },
    });
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
};

const run = async () => {
  const state = {
    productIds: new Set(),
    variantIds: new Set(),
    locationIds: new Set(),
  };

  try {
    await serverController.startIfNeeded();
    activeAppBaseUrl = serverController.getBaseUrl();

    const managerHeaders = {
      "X-Staff-Role": "MANAGER",
      "X-Staff-Id": "m24-smoke-manager",
    };
    const staffHeaders = {
      "X-Staff-Role": "STAFF",
      "X-Staff-Id": "m24-smoke-staff",
    };

    const productRes = await fetchJson("/api/products", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        name: `M24 Product ${uniqueRef()}`,
      }),
    });
    assert.equal(productRes.status, 201, JSON.stringify(productRes.json));
    state.productIds.add(productRes.json.id);
    const productName = productRes.json.name;

    const barcode = `24${Date.now().toString().slice(-11)}`;
    const sku = `M24-SKU-${uniqueRef()}`;
    const variantRes = await fetchJson("/api/variants", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        productId: productRes.json.id,
        sku,
        barcode,
        option: "M24 option",
        retailPricePence: 1299,
        costPricePence: 750,
      }),
    });
    assert.equal(variantRes.status, 201, JSON.stringify(variantRes.json));
    const variantId = variantRes.json.id;
    state.variantIds.add(variantId);

    const blockedPurchaseRes = await fetchJson("/api/inventory/movements", {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        variantId,
        type: "PURCHASE",
        quantity: 1,
        unitCost: 100,
        referenceType: "M24_TEST",
        referenceId: `purchase_blocked_${uniqueRef()}`,
      }),
    });
    assert.equal(blockedPurchaseRes.status, 403, JSON.stringify(blockedPurchaseRes.json));

    const purchaseRes = await fetchJson("/api/inventory/movements", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        variantId,
        type: "PURCHASE",
        quantity: 10,
        unitCost: 100,
        referenceType: "M24_TEST",
        referenceId: `purchase_${uniqueRef()}`,
      }),
    });
    assert.equal(purchaseRes.status, 201, JSON.stringify(purchaseRes.json));

    const locationsRes = await fetchJson("/api/locations", {
      headers: staffHeaders,
    });
    assert.equal(locationsRes.status, 200, JSON.stringify(locationsRes.json));
    const reportLocationId = locationsRes.json.locations?.[0]?.id;
    assert.ok(reportLocationId, "Expected at least one stock location after inventory seed");
    assert.equal(purchaseRes.json.locationId, reportLocationId);

    const saleRes = await fetchJson("/api/inventory/movements", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        variantId,
        type: "SALE",
        quantity: -2,
        referenceType: "M24_TEST",
        referenceId: `sale_${uniqueRef()}`,
      }),
    });
    assert.equal(saleRes.status, 201, JSON.stringify(saleRes.json));
    assert.equal(saleRes.json.locationId, reportLocationId);

    const blockedAdjustmentRes = await fetchJson("/api/inventory/movements", {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        variantId,
        type: "ADJUSTMENT",
        quantity: 1,
        referenceType: "M24_TEST",
        referenceId: `adjustment_blocked_${uniqueRef()}`,
      }),
    });
    assert.equal(blockedAdjustmentRes.status, 403, JSON.stringify(blockedAdjustmentRes.json));

    const adjustmentRes = await fetchJson("/api/inventory/movements", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        variantId,
        type: "ADJUSTMENT",
        quantity: 1,
        referenceType: "M24_TEST",
        referenceId: `adjustment_${uniqueRef()}`,
      }),
    });
    assert.equal(adjustmentRes.status, 201, JSON.stringify(adjustmentRes.json));
    assert.equal(adjustmentRes.json.locationId, reportLocationId);

    const onHandRes = await fetchJson(
      `/api/inventory/on-hand?variantId=${encodeURIComponent(variantId)}`,
      {
        headers: staffHeaders,
      },
    );
    assert.equal(onHandRes.status, 200, JSON.stringify(onHandRes.json));
    assert.equal(onHandRes.json.variantId, variantId);
    assert.equal(onHandRes.json.onHand, 9);

    const onHandAtLocationRes = await fetchJson(
      `/api/inventory/on-hand?variantId=${encodeURIComponent(variantId)}&locationId=${encodeURIComponent(reportLocationId)}`,
      {
        headers: staffHeaders,
      },
    );
    assert.equal(onHandAtLocationRes.status, 200, JSON.stringify(onHandAtLocationRes.json));
    assert.equal(onHandAtLocationRes.json.locationId, reportLocationId);
    assert.equal(onHandAtLocationRes.json.onHand, 9);

    const blockedMovementsRes = await fetchJson(
      `/api/inventory/movements?variantId=${encodeURIComponent(variantId)}`,
      {
        headers: staffHeaders,
      },
    );
    assert.equal(blockedMovementsRes.status, 403, JSON.stringify(blockedMovementsRes.json));

    const movementsRes = await fetchJson(
      `/api/inventory/movements?variantId=${encodeURIComponent(variantId)}`,
      {
        headers: managerHeaders,
      },
    );
    assert.equal(movementsRes.status, 200, JSON.stringify(movementsRes.json));
    assert.equal(Array.isArray(movementsRes.json.movements), true);
    assert.equal(movementsRes.json.movements.length, 3);
    const quantityByType = new Map(
      movementsRes.json.movements.map((entry) => [entry.type, entry.quantity]),
    );
    assert.equal(quantityByType.get("PURCHASE"), 10);
    assert.equal(quantityByType.get("SALE"), -2);
    assert.equal(quantityByType.get("ADJUSTMENT"), 1);
    assert.equal(movementsRes.json.movements.every((entry) => entry.locationId === reportLocationId), true);

    const locationMovementsRes = await fetchJson(
      `/api/inventory/movements?variantId=${encodeURIComponent(variantId)}&locationId=${encodeURIComponent(reportLocationId)}`,
      {
        headers: managerHeaders,
      },
    );
    assert.equal(locationMovementsRes.status, 200, JSON.stringify(locationMovementsRes.json));
    assert.equal(locationMovementsRes.json.locationId, reportLocationId);
    assert.equal(locationMovementsRes.json.movements.length, 3);

    const onHandSearchRes = await fetchJson(
      `/api/inventory/on-hand/search?q=${encodeURIComponent(sku)}&locationId=${encodeURIComponent(reportLocationId)}&take=25&skip=0`,
      {
        headers: staffHeaders,
      },
    );
    assert.equal(onHandSearchRes.status, 200, JSON.stringify(onHandSearchRes.json));
    const onHandSearchRow = onHandSearchRes.json.rows.find((row) => row.variantId === variantId);
    assert.ok(onHandSearchRow, "Expected inventory on-hand search row for test variant");
    assert.equal(onHandSearchRes.json.locationId, reportLocationId);
    assert.equal(onHandSearchRow.onHand, 9);

    const onHandReportRes = await fetchJson(
      `/api/reports/inventory/on-hand?locationId=${encodeURIComponent(reportLocationId)}`,
      {
        headers: managerHeaders,
      },
    );
    assert.equal(onHandReportRes.status, 200, JSON.stringify(onHandReportRes.json));
    const onHandRow = onHandReportRes.json.find((row) => row.variantId === variantId);
    assert.ok(onHandRow, "Expected inventory on-hand report row for test variant");
    assert.equal(onHandRow.onHand, 9);

    const valueReportRes = await fetchJson(
      `/api/reports/inventory/value?locationId=${encodeURIComponent(reportLocationId)}`,
      {
        headers: managerHeaders,
      },
    );
    assert.equal(valueReportRes.status, 200, JSON.stringify(valueReportRes.json));
    const valueRow = valueReportRes.json.breakdown.find((row) => row.variantId === variantId);
    assert.ok(valueRow, "Expected inventory value report row for test variant");
    assert.equal(valueRow.onHand, 9);
    assert.equal(valueRow.avgUnitCostPence, 100);
    assert.equal(valueRow.valuePence, 900);

    const valueSnapshotRes = await fetchJson(
      "/api/reports/inventory/value-snapshot",
      {
        headers: managerHeaders,
      },
    );
    assert.equal(valueSnapshotRes.status, 200, JSON.stringify(valueSnapshotRes.json));
    assert.ok(valueSnapshotRes.json.summary.totalValuePence >= 900);
    const snapshotRow = valueSnapshotRes.json.breakdown.find((row) => row.variantId === variantId);
    assert.ok(snapshotRow, "Expected inventory value snapshot row for test variant");
    assert.equal(snapshotRow.productName, productName);
    assert.equal(snapshotRow.sku, sku);
    assert.equal(snapshotRow.valuePence, 900);

    console.log("PASS m24 inventory movement ledger smoke tests");
  } finally {
    await cleanup(state);
    await serverController.stop();
    await prisma.$disconnect();
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
