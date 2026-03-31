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
if (process.env.ALLOW_NON_TEST_DB !== "1" && !DATABASE_URL.toLowerCase().includes("test")) {
  throw new Error(
    "Refusing to run against non-test database URL. Set TEST_DATABASE_URL or ALLOW_NON_TEST_DB=1.",
  );
}

const safeDbUrl = DATABASE_URL.replace(
  /(postgres(?:ql)?:\/\/[^:/@]+:)[^@]+@/i,
  "$1***@",
);
console.log(`[m31-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m31-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});
const serverController = createSmokeServerController({
  label: "m31-smoke",
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
  const saleIds = Array.from(state.saleIds);
  const basketIds = Array.from(state.basketIds);
  const variantIds = Array.from(state.variantIds);
  const productIds = Array.from(state.productIds);
  const userIds = Array.from(state.userIds);

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
  };

  try {
    await serverController.startIfNeeded();

    const managerUser = await prisma.user.create({
      data: {
        username: `m31-manager-${uniqueRef()}`,
        passwordHash: "m31-smoke",
        role: "ADMIN",
      },
    });
    state.userIds.add(managerUser.id);

    const staffUser = await prisma.user.create({
      data: {
        username: `m31-staff-${uniqueRef()}`,
        passwordHash: "m31-smoke",
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

    const currentSessionRes = await fetchJson("/api/till/sessions/current", {
      headers: managerHeaders,
    });
    assert.equal(currentSessionRes.status, 200, JSON.stringify(currentSessionRes.json));

    if (!currentSessionRes.json.session?.id) {
      const openSessionRes = await fetchJson("/api/till/sessions/open", {
        method: "POST",
        headers: managerHeaders,
        body: JSON.stringify({
          openingFloatPence: 0,
        }),
      });
      assert.equal(openSessionRes.status, 201, JSON.stringify(openSessionRes.json));
    }

    const productRes = await fetchJson("/api/products", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        name: `M31 Product ${uniqueRef()}`,
      }),
    });
    assert.equal(productRes.status, 201, JSON.stringify(productRes.json));
    state.productIds.add(productRes.json.id);

    const variantRes = await fetchJson("/api/variants", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        productId: productRes.json.id,
        sku: `M31-SKU-${uniqueRef()}`,
        retailPricePence: 1899,
      }),
    });
    assert.equal(variantRes.status, 201, JSON.stringify(variantRes.json));
    state.variantIds.add(variantRes.json.id);

    const seedRes = await fetchJson("/api/inventory/movements", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        variantId: variantRes.json.id,
        type: "PURCHASE",
        quantity: 15,
        unitCost: 900,
        referenceType: "M31_TEST",
        referenceId: `seed_${uniqueRef()}`,
      }),
    });
    assert.equal(seedRes.status, 201, JSON.stringify(seedRes.json));

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
    const totalPence = addLineRes.json.totals.totalPence;
    assert.equal(totalPence, 3798);

    const checkoutRes = await fetchJson(`/api/baskets/${basketId}/checkout`, {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(checkoutRes.status, 201, JSON.stringify(checkoutRes.json));
    const saleId = checkoutRes.json.sale.id;
    state.saleIds.add(saleId);

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
    assert.equal(createIntentRes.json.salePayment.paid, true);
    assert.equal(createIntentRes.json.salePayment.capturedTotalPence, totalPence);

    const listIntentRes = await fetchJson(
      `/api/payments/intents?provider=CASH&status=CAPTURED`,
      {
        headers: managerHeaders,
      },
    );
    assert.equal(listIntentRes.status, 200, JSON.stringify(listIntentRes.json));
    assert.ok(
      listIntentRes.json.intents.some((intent) => intent.id === createIntentRes.json.intent.id),
      "Expected captured intent in manager list endpoint",
    );

    const paymentRows = await prisma.payment.findMany({
      where: {
        saleId,
      },
      orderBy: { createdAt: "asc" },
    });
    assert.ok(paymentRows.length >= 1, "Expected at least one payment row");
    const matchedPayment = paymentRows.find(
      (payment) => payment.providerRef === createIntentRes.json.intent.externalRef || payment.providerRef === `intent:${createIntentRes.json.intent.id}`,
    );
    assert.ok(matchedPayment, "Expected payment row linked to captured intent");
    assert.equal(matchedPayment.amountPence, totalPence);

    console.log("M31 smoke tests passed.");
  } finally {
    try {
      await cleanup(state);
    } catch (error) {
      console.error("[m31-smoke] cleanup error:", error);
    }
    await serverController.stop();
    await prisma.$disconnect();
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
