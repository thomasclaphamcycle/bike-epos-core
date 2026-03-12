#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const HEALTH_URL = `${BASE_URL}/health`;
const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
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
console.log(`[m32-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m32-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
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

  return { status: response.status, json, text };
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

const closeAnyOpenCashSession = async (headers) => {
  const currentSessionRes = await fetchJson("/api/till/sessions/current", {
    headers,
  });
  assert.equal(currentSessionRes.status, 200, JSON.stringify(currentSessionRes.json));

  const currentSessionId = currentSessionRes.json.session?.id;
  if (!currentSessionId) {
    return;
  }

  const countRes = await fetchJson(`/api/till/sessions/${currentSessionId}/count`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      countedCashPence: currentSessionRes.json.totals?.expectedCashPence ?? 0,
      notes: "m32 pre-close",
    }),
  });
  assert.equal(countRes.status, 201, JSON.stringify(countRes.json));

  const closeRes = await fetchJson(`/api/till/sessions/${currentSessionId}/close`, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
  assert.ok(closeRes.status === 200 || closeRes.status === 201, JSON.stringify(closeRes.json));
};

const cleanup = async (state) => {
  const saleIds = Array.from(state.saleIds);
  const basketIds = Array.from(state.basketIds);
  const variantIds = Array.from(state.variantIds);
  const productIds = Array.from(state.productIds);
  const userIds = Array.from(state.userIds);
  const cashSessionIds = Array.from(state.cashSessionIds);

  if (cashSessionIds.length > 0) {
    await prisma.cashSession.deleteMany({
      where: {
        id: {
          in: cashSessionIds,
        },
      },
    });
  }

  if (saleIds.length > 0) {
    await prisma.paymentIntent.deleteMany({
      where: {
        saleId: {
          in: saleIds,
        },
      },
    });

    await prisma.payment.deleteMany({
      where: {
        saleId: {
          in: saleIds,
        },
      },
    });

    await prisma.saleReturnItem.deleteMany({
      where: {
        saleItem: {
          saleId: {
            in: saleIds,
          },
        },
      },
    });

    await prisma.saleReturn.deleteMany({
      where: {
        saleId: {
          in: saleIds,
        },
      },
    });

    await prisma.saleItem.deleteMany({
      where: {
        saleId: {
          in: saleIds,
        },
      },
    });

    await prisma.sale.deleteMany({
      where: {
        id: {
          in: saleIds,
        },
      },
    });
  }

  if (basketIds.length > 0) {
    await prisma.basketItem.deleteMany({
      where: {
        basketId: {
          in: basketIds,
        },
      },
    });

    await prisma.basket.deleteMany({
      where: {
        id: {
          in: basketIds,
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
    saleIds: new Set(),
    basketIds: new Set(),
    variantIds: new Set(),
    productIds: new Set(),
    userIds: new Set(),
    cashSessionIds: new Set(),
  };

  let startedServer = false;
  let serverProcess = null;

  try {
    const existing = await serverIsHealthy();
    if (existing && process.env.ALLOW_EXISTING_SERVER !== "1") {
      throw new Error(
        "Refusing to run against an already-running server. Stop it first or set ALLOW_EXISTING_SERVER=1.",
      );
    }

    if (!existing) {
      serverProcess = spawn("npm", ["run", "dev"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          NODE_ENV: "test",
          DATABASE_URL,
        },
      });
      serverProcess.stdout.on("data", () => {});
      serverProcess.stderr.on("data", () => {});
      startedServer = true;
      await waitForServer();
    }

    const managerUser = await prisma.user.create({
      data: {
        username: `m32-manager-${uniqueRef()}`,
        passwordHash: "m32-smoke",
        role: "ADMIN",
      },
    });
    state.userIds.add(managerUser.id);

    const staffUser = await prisma.user.create({
      data: {
        username: `m32-staff-${uniqueRef()}`,
        passwordHash: "m32-smoke",
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

    await closeAnyOpenCashSession(managerHeaders);

    const openTillRes = await fetchJson("/api/till/sessions/open", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({ openingFloatPence: 0 }),
    });
    assert.equal(openTillRes.status, 201, JSON.stringify(openTillRes.json));
    state.cashSessionIds.add(openTillRes.json.session.id);

    const productRes = await fetchJson("/api/products", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        name: `M32 Product ${uniqueRef()}`,
      }),
    });
    assert.equal(productRes.status, 201, JSON.stringify(productRes.json));
    state.productIds.add(productRes.json.id);

    const variantRes = await fetchJson("/api/variants", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        productId: productRes.json.id,
        sku: `M32-SKU-${uniqueRef()}`,
        retailPricePence: 1399,
      }),
    });
    assert.equal(variantRes.status, 201, JSON.stringify(variantRes.json));
    state.variantIds.add(variantRes.json.id);

    const stockRes = await fetchJson("/api/inventory/movements", {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        variantId: variantRes.json.id,
        type: "PURCHASE",
        quantity: 10,
        referenceType: "M32_TEST",
        referenceId: `seed_${uniqueRef()}`,
      }),
    });
    assert.equal(stockRes.status, 201, JSON.stringify(stockRes.json));

    const basketRes = await fetchJson("/api/baskets", {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(basketRes.status, 201, JSON.stringify(basketRes.json));
    const basketId = basketRes.json.id;
    state.basketIds.add(basketId);

    const addLineRes = await fetchJson(`/api/baskets/${basketId}/lines`, {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        variantId: variantRes.json.id,
        quantity: 2,
      }),
    });
    assert.equal(addLineRes.status, 201, JSON.stringify(addLineRes.json));

    const checkoutRes = await fetchJson(`/api/baskets/${basketId}/checkout`, {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(checkoutRes.status, 201, JSON.stringify(checkoutRes.json));
    const saleId = checkoutRes.json.sale.id;
    state.saleIds.add(saleId);

    const totalPence = checkoutRes.json.sale.totalPence;
    const createIntentRes = await fetchJson("/api/payments/intents", {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        saleId,
        provider: "CASH",
        amountPence: totalPence,
      }),
    });
    assert.equal(createIntentRes.status, 201, JSON.stringify(createIntentRes.json));
    assert.equal(createIntentRes.json.intent.status, "CAPTURED");

    const intentId = createIntentRes.json.intent.id;
    const captureIntentRes = await fetchJson(`/api/payments/intents/${intentId}/capture`, {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(captureIntentRes.status, 200, JSON.stringify(captureIntentRes.json));
    assert.equal(captureIntentRes.json.intent.status, "CAPTURED");

    const completeRes = await fetchJson(`/api/sales/${saleId}/complete`, {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(completeRes.status, 200, JSON.stringify(completeRes.json));
    assert.equal(completeRes.json.saleId, saleId);
    assert.ok(completeRes.json.completedAt);

    const saleInDb = await prisma.sale.findUnique({
      where: { id: saleId },
      select: {
        completedAt: true,
        receiptNumber: true,
      },
    });
    assert.ok(saleInDb, "Expected sale in DB");
    assert.ok(saleInDb.completedAt, "Expected completedAt to be set");

    const receiptRes = await fetchJson(`/api/sales/${saleId}/receipt`, {
      headers: staffHeaders,
    });
    assert.equal(receiptRes.status, 200, JSON.stringify(receiptRes.json));
    assert.equal(receiptRes.json.saleId, saleId);
    assert.ok(typeof receiptRes.json.receiptNumber === "string");
    assert.ok(receiptRes.json.completedAt);
    assert.ok(receiptRes.json.createdAt);
    assert.ok(receiptRes.json.staff);
    assert.equal(Array.isArray(receiptRes.json.items), true);
    assert.equal(receiptRes.json.items.length, 1);
    assert.equal(receiptRes.json.items[0].variantId, variantRes.json.id);
    assert.equal(receiptRes.json.totals.subtotal, totalPence);
    assert.equal(receiptRes.json.totals.tax, 0);
    assert.equal(receiptRes.json.totals.total, totalPence);
    assert.equal(Array.isArray(receiptRes.json.payments), true);
    assert.ok(
      receiptRes.json.payments.some((entry) => entry.intentId === intentId && entry.status === "CAPTURED"),
      "Expected captured payment intent in receipt",
    );

    const htmlRes = await fetchJson(`/sales/${saleId}/receipt`, {
      headers: staffHeaders,
    });
    assert.equal(htmlRes.status, 200);
    assert.ok(
      typeof htmlRes.text === "string" && htmlRes.text.includes("Receipt"),
      "Expected receipt HTML page",
    );

    console.log("M32 smoke tests passed.");
  } finally {
    try {
      await cleanup(state);
    } catch (error) {
      console.error("[m32-smoke] cleanup error:", error);
    }

    await prisma.$disconnect();

    if (startedServer && serverProcess) {
      serverProcess.kill("SIGTERM");
      await sleep(600);
      if (!serverProcess.killed) {
        serverProcess.kill("SIGKILL");
      }
    }
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
