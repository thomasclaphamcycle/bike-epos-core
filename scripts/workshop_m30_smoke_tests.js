#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

const portFromBaseUrl = () => {
  const url = new URL(BASE_URL);
  return url.port || (url.protocol === "https:" ? "443" : "80");
};

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
let lastProbeDetail = "";
const serverStartedPattern = /Server running on http:\/\/localhost:\d+/i;
const trimStartupLog = (value) =>
  value.length > MAX_STARTUP_LOG_CHARS
    ? value.slice(value.length - MAX_STARTUP_LOG_CHARS)
    : value;
let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;

const probeHealthyBaseUrl = async () => {
  for (const baseUrl of appBaseUrlCandidates) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        lastProbeDetail = `${baseUrl}/health -> ${response.status}`;
        return baseUrl;
      }
      lastProbeDetail = `${baseUrl}/health -> ${response.status}`;
    } catch (error) {
      lastProbeDetail = `${baseUrl}/health -> ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  return null;
};

const waitForServer = async (serverProcess, getStartupLog) => {
  for (let i = 0; i < 60; i += 1) {
    const startupLog = getStartupLog();
    if (serverProcess && serverProcess.exitCode !== null) {
      throw new Error(
        startupLog.trim()
          ? `Server exited before becoming healthy:\n${startupLog.trim()}`
          : "Server exited before becoming healthy.",
      );
    }

    const healthyBaseUrl = await probeHealthyBaseUrl();
    if (healthyBaseUrl) {
      activeAppBaseUrl = healthyBaseUrl;
      return;
    }

    await sleep(serverStartedPattern.test(startupLog) ? 250 : 500);
  }

  const startupLog = getStartupLog().trim();
  throw new Error(
    startupLog
      ? `Server did not become healthy on /health.\n${startupLog}\nlast probe: ${lastProbeDetail}`
      : `Server did not become healthy on /health${lastProbeDetail ? `\nlast probe: ${lastProbeDetail}` : ""}`,
  );
};

const fetchFromApp = async (path, options = {}) => {
  let lastError = null;

  for (let attempt = 0; attempt < APP_REQUEST_RETRIES; attempt += 1) {
    try {
      return await fetch(`${activeAppBaseUrl}${path}`, options);
    } catch (error) {
      lastError = error;

      const healthyBaseUrl = await probeHealthyBaseUrl();
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

  return { status: response.status, json };
};

const cleanup = async (state) => {
  const basketIds = Array.from(state.basketIds);
  const saleIds = Array.from(state.saleIds);
  const workshopJobIds = Array.from(state.workshopJobIds);
  const variantIds = Array.from(state.variantIds);
  const productIds = Array.from(state.productIds);
  const userIds = Array.from(state.userIds);

  if (saleIds.length > 0) {
    await prisma.payment.deleteMany({
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
    saleIds: new Set(),
    workshopJobIds: new Set(),
    variantIds: new Set(),
    productIds: new Set(),
    userIds: new Set(),
  };

  let startedServer = false;
  let serverProcess = null;
  let serverStartupLog = "";

  try {
    const existing = await probeHealthyBaseUrl();
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
          PORT: portFromBaseUrl(),
        },
      });
      serverProcess.stdout.on("data", (chunk) => {
        serverStartupLog = trimStartupLog(`${serverStartupLog}${String(chunk)}`);
      });
      serverProcess.stderr.on("data", (chunk) => {
        serverStartupLog = trimStartupLog(`${serverStartupLog}${String(chunk)}`);
      });
      startedServer = true;
      await waitForServer(serverProcess, () => serverStartupLog);
    } else {
      activeAppBaseUrl = existing;
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
      headers: managerHeaders,
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

    const stockAfterFinalizeRes = await fetchJson(
      `/api/stock/variants/${encodeURIComponent(variantRes.json.id)}`,
      {
        headers: staffHeaders,
      },
    );
    assert.equal(stockAfterFinalizeRes.status, 200, JSON.stringify(stockAfterFinalizeRes.json));
    assert.equal(stockAfterFinalizeRes.json.onHand, 6);
    assert.equal(stockAfterFinalizeRes.json.locations.length, 1);
    assert.equal(stockAfterFinalizeRes.json.locations[0].onHand, 6);

    const getJobRes = await fetchJson(`/api/workshop/jobs/${workshopJobId}`, {
      headers: staffHeaders,
    });
    assert.equal(getJobRes.status, 200, JSON.stringify(getJobRes.json));
    assert.equal(getJobRes.json.job.finalizedBasketId, finalizeRes.json.basket.id);

    const checkoutRes = await fetchJson(`/api/baskets/${finalizeRes.json.basket.id}/checkout`, {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        paymentMethod: "CARD",
        amountPence: finalizeRes.json.basket.totals.totalPence,
        providerRef: `m30-checkout-${uniqueRef()}`,
      }),
    });
    assert.equal(checkoutRes.status, 201, JSON.stringify(checkoutRes.json));
    state.saleIds.add(checkoutRes.json.sale.id);

    const linkedSale = await prisma.sale.findUnique({
      where: { id: checkoutRes.json.sale.id },
      select: {
        id: true,
        basketId: true,
        workshopJobId: true,
      },
    });
    assert.equal(linkedSale?.basketId, finalizeRes.json.basket.id);
    assert.equal(linkedSale?.workshopJobId, workshopJobId);

    const jobAfterCheckout = await prisma.workshopJob.findUnique({
      where: { id: workshopJobId },
      select: {
        status: true,
        completedAt: true,
      },
    });
    assert.equal(jobAfterCheckout?.status, "COMPLETED");
    assert.ok(jobAfterCheckout?.completedAt, "Expected workshop completedAt after POS checkout");

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
