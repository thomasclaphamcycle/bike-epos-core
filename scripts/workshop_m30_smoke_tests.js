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
console.log(`[m30-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m30-smoke] DATABASE_URL=${safeDbUrl}`);

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
  const workshopJobIds = Array.from(state.workshopJobIds);
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

  if (workshopJobIds.length > 0) {
    await prisma.workshopJobLine.deleteMany({
      where: {
        jobId: {
          in: workshopJobIds,
        },
      },
    });
    await prisma.workshopJob.deleteMany({
      where: {
        id: {
          in: workshopJobIds,
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
    workshopJobIds: new Set(),
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

    const staffUser = await prisma.user.create({
      data: {
        username: `m30-staff-${uniqueRef()}`,
        passwordHash: "m30-smoke",
        role: "STAFF",
      },
    });
    state.userIds.add(staffUser.id);

    const managerUser = await prisma.user.create({
      data: {
        username: `m30-manager-${uniqueRef()}`,
        passwordHash: "m30-smoke",
        role: "ADMIN",
      },
    });
    state.userIds.add(managerUser.id);

    const staffHeaders = {
      "X-Staff-Role": "STAFF",
      "X-Staff-Id": staffUser.id,
    };
    const managerHeaders = {
      "X-Staff-Role": "MANAGER",
      "X-Staff-Id": managerUser.id,
    };

    const productRes = await fetchJson("/api/products", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        name: `M30 Part Product ${uniqueRef()}`,
      }),
    });
    assert.equal(productRes.status, 201, JSON.stringify(productRes.json));
    state.productIds.add(productRes.json.id);

    const variantRes = await fetchJson("/api/variants", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        productId: productRes.json.id,
        sku: `M30-SKU-${uniqueRef()}`,
        retailPricePence: 2199,
      }),
    });
    assert.equal(variantRes.status, 201, JSON.stringify(variantRes.json));
    state.variantIds.add(variantRes.json.id);

    const seedRes = await fetchJson("/api/inventory/movements", {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        variantId: variantRes.json.id,
        type: "PURCHASE",
        quantity: 8,
        unitCost: 1200,
        referenceType: "M30_TEST",
        referenceId: `seed_${uniqueRef()}`,
      }),
    });
    assert.equal(seedRes.status, 201, JSON.stringify(seedRes.json));

    const createJobRes = await fetchJson("/api/workshop/jobs", {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        customerName: "M30 Customer",
        bikeDescription: "M30 Bike",
        notes: "Initial assessment",
      }),
    });
    assert.equal(createJobRes.status, 201, JSON.stringify(createJobRes.json));
    const workshopJobId = createJobRes.json.id;
    state.workshopJobIds.add(workshopJobId);

    const addPartLineRes = await fetchJson(`/api/workshop/jobs/${workshopJobId}/lines`, {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        type: "PART",
        productId: productRes.json.id,
        variantId: variantRes.json.id,
        qty: 2,
        unitPricePence: 2199,
      }),
    });
    assert.equal(addPartLineRes.status, 201, JSON.stringify(addPartLineRes.json));
    assert.equal(addPartLineRes.json.line.type, "PART");

    const addLabourLineRes = await fetchJson(`/api/workshop/jobs/${workshopJobId}/lines`, {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        type: "LABOUR",
        description: "Gear indexing",
        qty: 1,
        unitPricePence: 3000,
      }),
    });
    assert.equal(addLabourLineRes.status, 201, JSON.stringify(addLabourLineRes.json));
    assert.equal(addLabourLineRes.json.line.type, "LABOUR");

    const finalizeRes = await fetchJson(`/api/workshop/jobs/${workshopJobId}/finalize`, {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(finalizeRes.status, 201, JSON.stringify(finalizeRes.json));
    assert.ok(finalizeRes.json.basket?.id, "Expected basket id after finalize");
    state.basketIds.add(finalizeRes.json.basket.id);
    assert.ok(
      Array.isArray(finalizeRes.json.basket.items) && finalizeRes.json.basket.items.length >= 2,
      "Expected basket items from part and labour lines",
    );

    const movements = await prisma.inventoryMovement.findMany({
      where: {
        variantId: variantRes.json.id,
        referenceType: "WORKSHOP_JOB_LINE",
      },
      orderBy: { createdAt: "asc" },
    });
    assert.equal(movements.length, 1);
    assert.equal(movements[0].type, "WORKSHOP_USE");
    assert.equal(movements[0].quantity, -2);

    const getJobRes = await fetchJson(`/api/workshop/jobs/${workshopJobId}`, {
      headers: staffHeaders,
    });
    assert.equal(getJobRes.status, 200, JSON.stringify(getJobRes.json));
    assert.equal(getJobRes.json.job.finalizedBasketId, finalizeRes.json.basket.id);

    console.log("M30 smoke tests passed.");
  } finally {
    try {
      await cleanup(state);
    } catch (error) {
      console.error("[m30-smoke] cleanup error:", error);
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

