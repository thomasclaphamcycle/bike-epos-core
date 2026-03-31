#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { createSmokeServerController } = require("./smoke_server_helper");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3100";
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
console.log(`[m18-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m18-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});
const serverController = createSmokeServerController({
  label: "m18-smoke",
  baseUrl: BASE_URL,
  databaseUrl: DATABASE_URL,
  captureStartupLog: true,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;
const RUN_REF = uniqueRef();
const STAFF_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": `m18-smoke-manager-${RUN_REF}`,
};

const fetchJson = async (path, options = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...STAFF_HEADERS,
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
  for (let i = 0; i < 60; i++) {
    if (await serverIsHealthy()) {
      return;
    }
    await sleep(500);
  }
  throw new Error("Server did not become healthy on /health");
};

const cleanup = async (state) => {
  const stocktakeIds = Array.from(state.stocktakeIds);
  const locationIds = Array.from(state.locationIds);
  const variantIds = Array.from(state.variantIds);
  const productIds = Array.from(state.productIds);

  let stocktakeLineIds = Array.from(state.stocktakeLineIds);

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

    stocktakeLineIds = Array.from(new Set([...stocktakeLineIds, ...dbLines.map((line) => line.id)]));
  }

  if (stocktakeLineIds.length > 0) {
    await prisma.stockLedgerEntry.deleteMany({
      where: {
        referenceType: "STOCKTAKE_LINE",
        referenceId: {
          in: stocktakeLineIds,
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
    await prisma.stockLedgerEntry.deleteMany({
      where: {
        variantId: {
          in: variantIds,
        },
      },
    });
    await prisma.inventoryMovement.deleteMany({
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
    stocktakeIds: new Set(),
    stocktakeLineIds: new Set(),
    locationIds: new Set(),
    variantIds: new Set(),
    productIds: new Set(),
  };

  const runTest = async (name, fn, results) => {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log(`PASS ${name}`);
    } catch (error) {
      results.push({ name, ok: false, error });
      console.error(`FAIL ${name}`);
      console.error(error instanceof Error ? error.message : String(error));
    }
  };

  try {
    await serverController.startIfNeeded();

    const results = [];

    await runTest(
      "post stocktake writes ADJUSTMENT entries and sets on-hand to counted qty",
      async () => {
        const location = await prisma.stockLocation.create({
          data: {
            name: `M18 Location ${uniqueRef()}`,
          },
        });
        state.locationIds.add(location.id);

        const productRes = await fetchJson("/api/products", {
          method: "POST",
          body: JSON.stringify({
            name: `M18 Product ${uniqueRef()}`,
          }),
        });
        assert.equal(productRes.status, 201);
        state.productIds.add(productRes.json.id);

        const variantARes = await fetchJson("/api/variants", {
          method: "POST",
          body: JSON.stringify({
            productId: productRes.json.id,
            sku: `M18-SKU-A-${uniqueRef()}`,
            retailPricePence: 1999,
          }),
        });
        assert.equal(variantARes.status, 201);
        state.variantIds.add(variantARes.json.id);

        const variantBRes = await fetchJson("/api/variants", {
          method: "POST",
          body: JSON.stringify({
            productId: productRes.json.id,
            sku: `M18-SKU-B-${uniqueRef()}`,
            retailPricePence: 2499,
          }),
        });
        assert.equal(variantBRes.status, 201);
        state.variantIds.add(variantBRes.json.id);

        const seedARes = await fetchJson("/api/stock/adjustments", {
          method: "POST",
          body: JSON.stringify({
            variantId: variantARes.json.id,
            locationId: location.id,
            quantityDelta: 10,
            referenceType: "M18_TEST_SEED",
            referenceId: `seed-${uniqueRef()}`,
          }),
        });
        assert.equal(seedARes.status, 201);

        const seedBRes = await fetchJson("/api/stock/adjustments", {
          method: "POST",
          body: JSON.stringify({
            variantId: variantBRes.json.id,
            locationId: location.id,
            quantityDelta: 3,
            referenceType: "M18_TEST_SEED",
            referenceId: `seed-${uniqueRef()}`,
          }),
        });
        assert.equal(seedBRes.status, 201);

        const createStocktakeRes = await fetchJson("/api/stocktakes", {
          method: "POST",
          body: JSON.stringify({
            locationId: location.id,
            notes: "M18 count",
          }),
        });
        assert.equal(createStocktakeRes.status, 201);
        assert.equal(createStocktakeRes.json.status, "OPEN");
        const stocktakeId = createStocktakeRes.json.id;
        state.stocktakeIds.add(stocktakeId);

        const lineARes = await fetchJson(`/api/stocktakes/${stocktakeId}/lines`, {
          method: "POST",
          body: JSON.stringify({
            variantId: variantARes.json.id,
            countedQty: 7,
          }),
        });
        assert.equal(lineARes.status, 200);

        const lineBRes = await fetchJson(`/api/stocktakes/${stocktakeId}/lines`, {
          method: "POST",
          body: JSON.stringify({
            variantId: variantBRes.json.id,
            countedQty: 5,
          }),
        });
        assert.equal(lineBRes.status, 200);

        const previewRes = await fetchJson(`/api/stocktakes/${stocktakeId}`);
        assert.equal(previewRes.status, 200);
        assert.equal(previewRes.json.lines.length, 2);

        const lineAPreview = previewRes.json.lines.find((line) => line.variantId === variantARes.json.id);
        const lineBPreview = previewRes.json.lines.find((line) => line.variantId === variantBRes.json.id);
        assert.ok(lineAPreview);
        assert.ok(lineBPreview);
        assert.equal(lineAPreview.currentOnHand, 10);
        assert.equal(lineAPreview.deltaNeeded, -3);
        assert.equal(lineBPreview.currentOnHand, 3);
        assert.equal(lineBPreview.deltaNeeded, 2);

        state.stocktakeLineIds.add(lineAPreview.id);
        state.stocktakeLineIds.add(lineBPreview.id);

        const postRes = await fetchJson(`/api/stocktakes/${stocktakeId}/post`, {
          method: "POST",
        });
        assert.equal(postRes.status, 200);
        assert.equal(postRes.json.status, "POSTED");
        assert.ok(postRes.json.postedAt);

        const postedLineA = postRes.json.lines.find((line) => line.variantId === variantARes.json.id);
        const postedLineB = postRes.json.lines.find((line) => line.variantId === variantBRes.json.id);
        assert.ok(postedLineA);
        assert.ok(postedLineB);
        assert.equal(postedLineA.currentOnHand, 7);
        assert.equal(postedLineA.deltaNeeded, 0);
        assert.equal(postedLineB.currentOnHand, 5);
        assert.equal(postedLineB.deltaNeeded, 0);

        const ledgerRows = await prisma.stockLedgerEntry.findMany({
          where: {
            referenceType: "STOCKTAKE_LINE",
            referenceId: {
              in: [postedLineA.id, postedLineB.id],
            },
          },
          orderBy: [{ referenceId: "asc" }],
        });

        assert.equal(ledgerRows.length, 2);

        const ledgerByReferenceId = new Map(ledgerRows.map((row) => [row.referenceId, row]));
        assert.equal(ledgerByReferenceId.get(postedLineA.id).quantityDelta, -3);
        assert.equal(ledgerByReferenceId.get(postedLineB.id).quantityDelta, 2);

        const stockAAfter = await fetchJson(
          `/api/stock/variants/${variantARes.json.id}?locationId=${location.id}`,
        );
        assert.equal(stockAAfter.status, 200);
        assert.equal(stockAAfter.json.onHand, 7);

        const stockBAfter = await fetchJson(
          `/api/stock/variants/${variantBRes.json.id}?locationId=${location.id}`,
        );
        assert.equal(stockBAfter.status, 200);
        assert.equal(stockBAfter.json.onHand, 5);

        const postAgainRes = await fetchJson(`/api/stocktakes/${stocktakeId}/post`, {
          method: "POST",
        });
        assert.equal(postAgainRes.status, 409);
        assert.equal(postAgainRes.json.error.code, "STOCKTAKE_NOT_OPEN");
      },
      results,
    );

    await runTest(
      "cancel stocktake only allowed while OPEN",
      async () => {
        const location = await prisma.stockLocation.create({
          data: {
            name: `M18 Cancel Location ${uniqueRef()}`,
          },
        });
        state.locationIds.add(location.id);

        const stocktakeRes = await fetchJson("/api/stocktakes", {
          method: "POST",
          body: JSON.stringify({
            locationId: location.id,
            notes: "Cancel me",
          }),
        });
        assert.equal(stocktakeRes.status, 201);
        const stocktakeId = stocktakeRes.json.id;
        state.stocktakeIds.add(stocktakeId);

        const cancelRes = await fetchJson(`/api/stocktakes/${stocktakeId}/cancel`, {
          method: "POST",
        });
        assert.equal(cancelRes.status, 200);
        assert.equal(cancelRes.json.status, "CANCELLED");

        const cancelAgainRes = await fetchJson(`/api/stocktakes/${stocktakeId}/cancel`, {
          method: "POST",
        });
        assert.equal(cancelAgainRes.status, 409);
        assert.equal(cancelAgainRes.json.error.code, "STOCKTAKE_NOT_OPEN");

        const postCancelledRes = await fetchJson(`/api/stocktakes/${stocktakeId}/post`, {
          method: "POST",
        });
        assert.equal(postCancelledRes.status, 409);
        assert.equal(postCancelledRes.json.error.code, "STOCKTAKE_NOT_OPEN");
      },
      results,
    );

    const failed = results.filter((result) => !result.ok);
    if (failed.length > 0) {
      process.exitCode = 1;
      return;
    }
  } finally {
    await cleanup(state).catch((error) => {
      console.error("Cleanup failed:", error instanceof Error ? error.message : String(error));
    });
    await serverController.stop();
    await prisma.$disconnect();
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
