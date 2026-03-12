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
console.log(`[m29-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m29-smoke] DATABASE_URL=${safeDbUrl}`);

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
  const basketIds = Array.from(state.basketIds);
  const variantIds = Array.from(state.variantIds);
  const productIds = Array.from(state.productIds);
  const userIds = Array.from(state.userIds);

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
        username: `m29-manager-${uniqueRef()}`,
        passwordHash: "m29-smoke",
        role: "ADMIN",
      },
    });
    state.userIds.add(managerUser.id);

    const staffUser = await prisma.user.create({
      data: {
        username: `m29-staff-${uniqueRef()}`,
        passwordHash: "m29-smoke",
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
        name: `M29 Product ${uniqueRef()}`,
        category: "Components",
        defaultVariant: {
          sku: `M29-SKU-${uniqueRef()}`,
          barcode: `29${Date.now().toString().slice(-11)}`,
          retailPricePence: 1599,
          isActive: true,
        },
      }),
    });
    assert.equal(productRes.status, 201, JSON.stringify(productRes.json));
    state.productIds.add(productRes.json.id);
    assert.equal(productRes.json.category, "Components");

    const createdVariantsRes = await fetchJson(
      `/api/variants?productId=${encodeURIComponent(productRes.json.id)}&take=10&skip=0`,
      {
        method: "GET",
        headers: managerHeaders,
      },
    );
    assert.equal(createdVariantsRes.status, 200, JSON.stringify(createdVariantsRes.json));
    assert.equal(createdVariantsRes.json.variants.length, 1, JSON.stringify(createdVariantsRes.json));
    const [variantRes] = createdVariantsRes.json.variants;
    state.variantIds.add(variantRes.id);
    assert.equal(variantRes.product.category, "Components");
    const barcode = variantRes.barcode;

    const seedRes = await fetchJson("/api/inventory/movements", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        variantId: variantRes.id,
        type: "PURCHASE",
        quantity: 7,
        unitCost: 800,
        referenceType: "M29_TEST",
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

    const searchByQRes = await fetchJson(
      `/api/products/search?q=${encodeURIComponent("M29 Product")}&take=10&skip=0`,
      {
        headers: staffHeaders,
      },
    );
    assert.equal(searchByQRes.status, 200, JSON.stringify(searchByQRes.json));
    const rowByQ = searchByQRes.json.rows.find((row) => row.id === variantRes.id);
    assert.ok(rowByQ, "Expected query search row");
    assert.equal(rowByQ.pricePence, 1599);
    assert.equal(rowByQ.onHandQty, 7);

    const searchByBarcodeRes = await fetchJson(
      `/api/products/search?barcode=${encodeURIComponent(barcode)}`,
      {
        headers: staffHeaders,
      },
    );
    assert.equal(searchByBarcodeRes.status, 200, JSON.stringify(searchByBarcodeRes.json));
    const rowByBarcode = searchByBarcodeRes.json.rows.find(
      (row) => row.id === variantRes.id,
    );
    assert.ok(rowByBarcode, "Expected barcode search row");

    const addToBasketRes = await fetchJson(`/api/baskets/${basketId}/lines`, {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        variantId: rowByBarcode.id,
        quantity: 2,
      }),
    });
    assert.equal(addToBasketRes.status, 201, JSON.stringify(addToBasketRes.json));
    assert.equal(addToBasketRes.json.items.length, 1);
    assert.equal(addToBasketRes.json.items[0].variantId, variantRes.id);
    assert.equal(addToBasketRes.json.items[0].quantity, 2);

    console.log("M29 smoke tests passed.");
  } finally {
    try {
      await cleanup(state);
    } catch (error) {
      console.error("[m29-smoke] cleanup error:", error);
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
