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
console.log(`[m33-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m33-smoke] DATABASE_URL=${safeDbUrl}`);

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
  const variantIds = Array.from(state.variantIds);
  const productIds = Array.from(state.productIds);
  const userIds = Array.from(state.userIds);

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
        username: `m33-manager-${uniqueRef()}`,
        passwordHash: "m33-smoke",
        role: "ADMIN",
      },
    });
    state.userIds.add(managerUser.id);

    const staffUser = await prisma.user.create({
      data: {
        username: `m33-staff-${uniqueRef()}`,
        passwordHash: "m33-smoke",
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
        name: `M33 Product ${uniqueRef()}`,
      }),
    });
    assert.equal(productRes.status, 201, JSON.stringify(productRes.json));
    state.productIds.add(productRes.json.id);

    const variantRes = await fetchJson("/api/variants", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        productId: productRes.json.id,
        sku: `M33-SKU-${uniqueRef()}`,
        retailPricePence: 1899,
      }),
    });
    assert.equal(variantRes.status, 201, JSON.stringify(variantRes.json));
    const variantId = variantRes.json.id;
    state.variantIds.add(variantId);

    const blockedAdjustRes = await fetchJson("/api/inventory/adjustments", {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        variantId,
        quantityDelta: 1,
        reason: "COUNT_CORRECTION",
        note: "Staff should not adjust stock",
      }),
    });
    assert.equal(blockedAdjustRes.status, 403, JSON.stringify(blockedAdjustRes.json));

    const plusFiveRes = await fetchJson("/api/inventory/adjustments", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        variantId,
        quantityDelta: 5,
        reason: "COUNT_CORRECTION",
        note: "Opening adjustment",
      }),
    });
    assert.equal(plusFiveRes.status, 201, JSON.stringify(plusFiveRes.json));
    assert.equal(plusFiveRes.json.movement.type, "ADJUSTMENT");
    assert.equal(plusFiveRes.json.movement.quantity, 5);
    assert.equal(plusFiveRes.json.movement.reason, "COUNT_CORRECTION");
    assert.equal(plusFiveRes.json.onHand, 5);

    const minusTwoRes = await fetchJson("/api/inventory/adjustments", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        variantId,
        quantityDelta: -2,
        reason: "DAMAGED",
        note: "Damaged item",
      }),
    });
    assert.equal(minusTwoRes.status, 201, JSON.stringify(minusTwoRes.json));
    assert.equal(minusTwoRes.json.movement.type, "ADJUSTMENT");
    assert.equal(minusTwoRes.json.movement.quantity, -2);
    assert.equal(minusTwoRes.json.movement.reason, "DAMAGED");
    assert.equal(minusTwoRes.json.onHand, 3);

    const onHandRes = await fetchJson(`/api/inventory/on-hand?variantId=${encodeURIComponent(variantId)}`, {
      headers: staffHeaders,
    });
    assert.equal(onHandRes.status, 200, JSON.stringify(onHandRes.json));
    assert.equal(onHandRes.json.onHand, 3);

    const movementRows = await prisma.inventoryMovement.findMany({
      where: {
        variantId,
        type: "ADJUSTMENT",
      },
      orderBy: { createdAt: "asc" },
    });
    assert.equal(movementRows.length, 2);
    assert.equal(movementRows[0].quantity, 5);
    assert.equal(movementRows[1].quantity, -2);

    console.log("M33 smoke tests passed.");
  } finally {
    try {
      await cleanup(state);
    } catch (error) {
      console.error("[m33-smoke] cleanup error:", error);
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
