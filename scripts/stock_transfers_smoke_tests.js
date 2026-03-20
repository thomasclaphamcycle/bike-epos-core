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

const safeDbUrl = DATABASE_URL.replace(
  /(postgres(?:ql)?:\/\/[^:/@]+:)[^@]+@/i,
  "$1***@",
);
console.log(`[transfer-smoke] BASE_URL=${BASE_URL}`);
console.log(`[transfer-smoke] DATABASE_URL=${safeDbUrl}`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const APP_REQUEST_RETRIES = 8;
const RUN_REF = `transfer_${Date.now()}`;
const MANAGER_ID = `transfer-manager-${RUN_REF}`;
const MANAGER_HEADERS = {
  "Content-Type": "application/json",
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": MANAGER_ID,
};

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
const serverController = createSmokeServerController({
  label: "transfer-smoke",
  baseUrls: appBaseUrlCandidates,
  databaseUrl: DATABASE_URL,
  captureStartupLog: true,
  startupReadyPattern: /Server running on http:\/\/localhost:\d+/i,
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
      ...MANAGER_HEADERS,
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

const cleanup = async (state) => {
  if (state.transferIds.length > 0) {
    await prisma.stockTransferLine.deleteMany({
      where: {
        stockTransferId: {
          in: state.transferIds,
        },
      },
    });
    await prisma.stockTransfer.deleteMany({
      where: {
        id: {
          in: state.transferIds,
        },
      },
    });
  }

  if (state.variantIds.length > 0) {
    await prisma.stockLedgerEntry.deleteMany({
      where: {
        variantId: {
          in: state.variantIds,
        },
      },
    });
    await prisma.inventoryMovement.deleteMany({
      where: {
        variantId: {
          in: state.variantIds,
        },
      },
    });
    await prisma.barcode.deleteMany({
      where: {
        variantId: {
          in: state.variantIds,
        },
      },
    });
    await prisma.variant.deleteMany({
      where: {
        id: {
          in: state.variantIds,
        },
      },
    });
  }

  if (state.productIds.length > 0) {
    await prisma.product.deleteMany({
      where: {
        id: {
          in: state.productIds,
        },
      },
    });
  }

  if (state.locationIds.length > 0) {
    await prisma.stockLocation.deleteMany({
      where: {
        id: {
          in: state.locationIds,
        },
      },
    });
  }

  if (state.userIds.length > 0) {
    await prisma.user.deleteMany({
      where: {
        id: {
          in: state.userIds,
        },
      },
    });
  }
};

const main = async () => {
  const state = {
    transferIds: [],
    variantIds: [],
    productIds: [],
    locationIds: [],
    userIds: [MANAGER_ID],
  };

  try {
    await serverController.startIfNeeded();
    activeAppBaseUrl = serverController.getBaseUrl();

    const [sourceLocation, targetLocation] = await Promise.all([
      prisma.stockLocation.create({
        data: {
          name: `Transfer Source ${RUN_REF}`,
          isDefault: false,
        },
      }),
      prisma.stockLocation.create({
        data: {
          name: `Transfer Target ${RUN_REF}`,
          isDefault: false,
        },
      }),
    ]);
    state.locationIds.push(sourceLocation.id, targetLocation.id);

    const product = await prisma.product.create({
      data: {
        name: `Transfer Helmet ${RUN_REF}`,
        variants: {
          create: {
            sku: `TRANSFER-${RUN_REF}`,
            barcode: `TR-${RUN_REF}`,
            retailPricePence: 5999,
          },
        },
      },
      include: {
        variants: true,
      },
    });
    state.productIds.push(product.id);
    state.variantIds.push(product.variants[0].id);

    const seedRes = await fetchJson("/api/inventory/movements", {
      method: "POST",
      body: JSON.stringify({
        variantId: product.variants[0].id,
        locationId: sourceLocation.id,
        type: "PURCHASE",
        quantity: 5,
        referenceType: "TRANSFER_SMOKE",
        referenceId: RUN_REF,
      }),
    });
    assert.equal(seedRes.status, 201, JSON.stringify(seedRes.json));

    const createRes = await fetchJson("/api/stock-transfers", {
      method: "POST",
      body: JSON.stringify({
        fromLocationId: sourceLocation.id,
        toLocationId: targetLocation.id,
        notes: "Smoke transfer",
        lines: [
          {
            variantId: product.variants[0].id,
            quantity: 2,
          },
        ],
      }),
    });
    assert.equal(createRes.status, 201, JSON.stringify(createRes.json));
    assert.equal(createRes.json.status, "DRAFT");
    state.transferIds.push(createRes.json.id);

    const sendRes = await fetchJson(`/api/stock-transfers/${encodeURIComponent(createRes.json.id)}/send`, {
      method: "POST",
    });
    assert.equal(sendRes.status, 200, JSON.stringify(sendRes.json));
    assert.equal(sendRes.json.status, "SENT");

    const receiveRes = await fetchJson(`/api/stock-transfers/${encodeURIComponent(createRes.json.id)}/receive`, {
      method: "POST",
    });
    assert.equal(receiveRes.status, 200, JSON.stringify(receiveRes.json));
    assert.equal(receiveRes.json.status, "RECEIVED");

    const listRes = await fetchJson("/api/stock-transfers?status=RECEIVED");
    assert.equal(listRes.status, 200, JSON.stringify(listRes.json));
    assert.ok(listRes.json.transfers.some((transfer) => transfer.id === createRes.json.id));

    const stockRes = await fetchJson(`/api/stock/variants/${encodeURIComponent(product.variants[0].id)}`);
    assert.equal(stockRes.status, 200, JSON.stringify(stockRes.json));
    assert.equal(stockRes.json.onHand, 5);
    assert.equal(stockRes.json.locations.find((location) => location.id === sourceLocation.id)?.onHand, 3);
    assert.equal(stockRes.json.locations.find((location) => location.id === targetLocation.id)?.onHand, 2);

    const movementRes = await fetchJson(
      `/api/inventory/movements?variantId=${encodeURIComponent(product.variants[0].id)}&type=TRANSFER`,
    );
    assert.equal(movementRes.status, 200, JSON.stringify(movementRes.json));
    assert.equal(movementRes.json.movements.length, 2);
    assert.ok(
      movementRes.json.movements.some(
        (movement) => movement.locationId === sourceLocation.id && movement.quantity === -2,
      ),
    );
    assert.ok(
      movementRes.json.movements.some(
        (movement) => movement.locationId === targetLocation.id && movement.quantity === 2,
      ),
    );

    const insufficientTransferRes = await fetchJson("/api/stock-transfers", {
      method: "POST",
      body: JSON.stringify({
        fromLocationId: sourceLocation.id,
        toLocationId: targetLocation.id,
        notes: "Insufficient stock transfer",
        lines: [
          {
            variantId: product.variants[0].id,
            quantity: 3,
          },
        ],
      }),
    });
    assert.equal(insufficientTransferRes.status, 201, JSON.stringify(insufficientTransferRes.json));
    state.transferIds.push(insufficientTransferRes.json.id);

    const insufficientSendRes = await fetchJson(
      `/api/stock-transfers/${encodeURIComponent(insufficientTransferRes.json.id)}/send`,
      {
        method: "POST",
      },
    );
    assert.equal(insufficientSendRes.status, 200, JSON.stringify(insufficientSendRes.json));

    const consumeRes = await fetchJson("/api/inventory/adjustments", {
      method: "POST",
      body: JSON.stringify({
        variantId: product.variants[0].id,
        locationId: sourceLocation.id,
        quantityDelta: -2,
        reason: "COUNT_CORRECTION",
        note: "Reduce source stock before transfer receive",
      }),
    });
    assert.equal(consumeRes.status, 201, JSON.stringify(consumeRes.json));

    const blockedReceiveRes = await fetchJson(
      `/api/stock-transfers/${encodeURIComponent(insufficientTransferRes.json.id)}/receive`,
      {
        method: "POST",
      },
    );
    assert.equal(blockedReceiveRes.status, 409, JSON.stringify(blockedReceiveRes.json));
    assert.equal(blockedReceiveRes.json.error.code, "STOCK_TRANSFER_INSUFFICIENT_STOCK");

    console.log("[transfer-smoke] stock transfer workflow passed");
  } finally {
    try {
      await cleanup(state);
    } catch (error) {
      console.error("[transfer-smoke] cleanup error:", error);
    }

    await prisma.$disconnect();
    await serverController.stop();
  }
};

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
