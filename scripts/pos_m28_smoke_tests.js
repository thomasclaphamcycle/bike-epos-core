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
console.log(`[m28-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m28-smoke] DATABASE_URL=${safeDbUrl}`);

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

  let saleItemIds = [];

  if (saleIds.length > 0) {
    const saleItems = await prisma.saleItem.findMany({
      where: {
        saleId: {
          in: saleIds,
        },
      },
      select: {
        id: true,
      },
    });
    saleItemIds = saleItems.map((row) => row.id);

    await prisma.saleReturnItem.deleteMany({
      where: {
        saleItemId: {
          in: saleItemIds,
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

    await prisma.payment.deleteMany({
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
        username: `m28-manager-${uniqueRef()}`,
        passwordHash: "m28-smoke",
        role: "ADMIN",
      },
    });
    state.userIds.add(managerUser.id);

    const staffUser = await prisma.user.create({
      data: {
        username: `m28-staff-${uniqueRef()}`,
        passwordHash: "m28-smoke",
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

    const productRes = await fetchJson("/api/products", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        name: `M28 Product ${uniqueRef()}`,
      }),
    });
    assert.equal(productRes.status, 201, JSON.stringify(productRes.json));
    state.productIds.add(productRes.json.id);

    const variantRes = await fetchJson("/api/variants", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        productId: productRes.json.id,
        sku: `M28-SKU-${uniqueRef()}`,
        retailPricePence: 899,
      }),
    });
    assert.equal(variantRes.status, 201, JSON.stringify(variantRes.json));
    state.variantIds.add(variantRes.json.id);

    const stockSeedRes = await fetchJson("/api/inventory/movements", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        variantId: variantRes.json.id,
        type: "PURCHASE",
        quantity: 10,
        unitCost: 500,
        referenceType: "M28_TEST",
        referenceId: `seed_${uniqueRef()}`,
      }),
    });
    assert.equal(stockSeedRes.status, 201, JSON.stringify(stockSeedRes.json));

    const createBasketRes = await fetchJson("/api/baskets", {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(createBasketRes.status, 201, JSON.stringify(createBasketRes.json));
    const basketId = createBasketRes.json.id;
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
    assert.equal(addLineRes.json.items.length, 1);
    const basketLineId = addLineRes.json.items[0].id;

    const patchLineRes = await fetchJson(`/api/baskets/${basketId}/lines/${basketLineId}`, {
      method: "PATCH",
      headers: staffHeaders,
      body: JSON.stringify({ quantity: 3 }),
    });
    assert.equal(patchLineRes.status, 200, JSON.stringify(patchLineRes.json));
    assert.equal(patchLineRes.json.items[0].quantity, 3);

    const expectedTotal = patchLineRes.json.totals.totalPence;

    const checkoutRes = await fetchJson(`/api/baskets/${basketId}/checkout`, {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        paymentMethod: "CARD",
        amountPence: expectedTotal,
        providerRef: `m28-checkout-${uniqueRef()}`,
      }),
    });
    assert.equal(checkoutRes.status, 201, JSON.stringify(checkoutRes.json));
    assert.ok(checkoutRes.json.sale);
    assert.equal(checkoutRes.json.sale.totalPence, expectedTotal);
    assert.equal(checkoutRes.json.saleItems.length, 1);
    assert.equal(checkoutRes.json.saleItems[0].quantity, 3);
    state.saleIds.add(checkoutRes.json.sale.id);

    const checkoutAgainRes = await fetchJson(`/api/baskets/${basketId}/checkout`, {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        paymentMethod: "CARD",
        amountPence: expectedTotal,
      }),
    });
    assert.equal(checkoutAgainRes.status, 200, JSON.stringify(checkoutAgainRes.json));
    assert.equal(checkoutAgainRes.json.sale.id, checkoutRes.json.sale.id);

    const saleRes = await fetchJson(`/api/sales/${checkoutRes.json.sale.id}`, {
      headers: staffHeaders,
    });
    assert.equal(saleRes.status, 200, JSON.stringify(saleRes.json));
    assert.equal(saleRes.json.sale.id, checkoutRes.json.sale.id);

    const onHandRes = await fetchJson(
      `/api/inventory/on-hand?variantId=${encodeURIComponent(variantRes.json.id)}`,
      {
        headers: staffHeaders,
      },
    );
    assert.equal(onHandRes.status, 200, JSON.stringify(onHandRes.json));
    assert.equal(onHandRes.json.onHand, 7);

    const saleMovement = await prisma.inventoryMovement.findFirst({
      where: {
        type: "SALE",
        referenceType: "SALE_ITEM",
        referenceId: checkoutRes.json.saleItems[0].id,
      },
    });
    assert.ok(saleMovement, "Expected SALE movement for checkout line");
    assert.equal(saleMovement.quantity, -3);

    console.log("PASS m28 POS basket + checkout smoke tests");
  } finally {
    await cleanup(state);

    if (startedServer && serverProcess) {
      serverProcess.kill("SIGTERM");
      await sleep(300);
      if (!serverProcess.killed) {
        serverProcess.kill("SIGKILL");
      }
    }

    await prisma.$disconnect();
  }
};

run().catch((error) => {
  console.error("[m28-smoke] FAIL", error);
  process.exitCode = 1;
});
