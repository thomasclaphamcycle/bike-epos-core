#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

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
const MAX_STARTUP_LOG_CHARS = 4000;
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
let lastProbeDetail = "";
const serverStartedPattern = /Server running on http:\/\/localhost:\d+/i;
const trimStartupLog = (value) =>
  value.length > MAX_STARTUP_LOG_CHARS
    ? value.slice(value.length - MAX_STARTUP_LOG_CHARS)
    : value;

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
  let startedServer = false;
  let serverProcess = null;
  let startupLog = "";

  try {
    const existing = await probeHealthyBaseUrl();
    if (existing && process.env.ALLOW_EXISTING_SERVER !== "1") {
      throw new Error(
        "Refusing to run against an already-running server. Stop it first or set ALLOW_EXISTING_SERVER=1.",
      );
    }

    if (existing) {
      activeAppBaseUrl = existing;
    } else {
      serverProcess = spawn("npm", ["run", "dev"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          NODE_ENV: "test",
          DATABASE_URL,
          PORT: new URL(BASE_URL).port || "3100",
        },
      });
      startedServer = true;

      const appendStartupLog = (chunk) => {
        startupLog = trimStartupLog(`${startupLog}${chunk.toString()}`);
      };
      serverProcess.stdout?.on("data", appendStartupLog);
      serverProcess.stderr?.on("data", appendStartupLog);

      await waitForServer(serverProcess, () => startupLog);
    }

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

    console.log("[transfer-smoke] stock transfer workflow passed");
  } finally {
    try {
      await cleanup(state);
    } catch (error) {
      console.error("[transfer-smoke] cleanup error:", error);
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

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
