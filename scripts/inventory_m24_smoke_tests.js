#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const HEALTH_URL = `${BASE_URL}/health`;
const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

const portFromBaseUrl = () => {
  const url = new URL(BASE_URL);
  return url.port || (url.protocol === "https:" ? "443" : "80");
};

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
console.log(`[m24-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m24-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const uniqueRef = () => `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
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
      // Try the next candidate.
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

  return {
    status: response.status,
    json,
  };
};

const cleanup = async (state) => {
  const variantIds = Array.from(state.variantIds);
  const productIds = Array.from(state.productIds);
  const locationIds = Array.from(state.locationIds);

  if (variantIds.length > 0) {
    await prisma.inventoryMovement.deleteMany({
      where: {
        variantId: {
          in: variantIds,
        },
      },
    });
    await prisma.stockLedgerEntry.deleteMany({
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
    productIds: new Set(),
    variantIds: new Set(),
    locationIds: new Set(),
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

    const managerHeaders = {
      "X-Staff-Role": "MANAGER",
      "X-Staff-Id": "m24-smoke-manager",
    };
    const staffHeaders = {
      "X-Staff-Role": "STAFF",
      "X-Staff-Id": "m24-smoke-staff",
    };

    const productRes = await fetchJson("/api/products", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        name: `M24 Product ${uniqueRef()}`,
      }),
    });
    assert.equal(productRes.status, 201, JSON.stringify(productRes.json));
    state.productIds.add(productRes.json.id);

    const barcode = `24${Date.now().toString().slice(-11)}`;
    const variantRes = await fetchJson("/api/variants", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        productId: productRes.json.id,
        sku: `M24-SKU-${uniqueRef()}`,
        barcode,
        option: "M24 option",
        retailPricePence: 1299,
        costPricePence: 750,
      }),
    });
    assert.equal(variantRes.status, 201, JSON.stringify(variantRes.json));
    const variantId = variantRes.json.id;
    state.variantIds.add(variantId);

    const purchaseRes = await fetchJson("/api/inventory/movements", {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        variantId,
        type: "PURCHASE",
        quantity: 10,
        unitCost: 100,
        referenceType: "M24_TEST",
        referenceId: `purchase_${uniqueRef()}`,
      }),
    });
    assert.equal(purchaseRes.status, 201, JSON.stringify(purchaseRes.json));

    const locationsRes = await fetchJson("/api/locations", {
      headers: staffHeaders,
    });
    assert.equal(locationsRes.status, 200, JSON.stringify(locationsRes.json));
    const reportLocationId = locationsRes.json.locations?.[0]?.id;
    assert.ok(reportLocationId, "Expected at least one stock location after inventory seed");

    const saleRes = await fetchJson("/api/inventory/movements", {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        variantId,
        type: "SALE",
        quantity: -2,
        referenceType: "M24_TEST",
        referenceId: `sale_${uniqueRef()}`,
      }),
    });
    assert.equal(saleRes.status, 201, JSON.stringify(saleRes.json));

    const blockedAdjustmentRes = await fetchJson("/api/inventory/movements", {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        variantId,
        type: "ADJUSTMENT",
        quantity: 1,
        referenceType: "M24_TEST",
        referenceId: `adjustment_blocked_${uniqueRef()}`,
      }),
    });
    assert.equal(blockedAdjustmentRes.status, 403, JSON.stringify(blockedAdjustmentRes.json));

    const adjustmentRes = await fetchJson("/api/inventory/movements", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        variantId,
        type: "ADJUSTMENT",
        quantity: 1,
        referenceType: "M24_TEST",
        referenceId: `adjustment_${uniqueRef()}`,
      }),
    });
    assert.equal(adjustmentRes.status, 201, JSON.stringify(adjustmentRes.json));

    const onHandRes = await fetchJson(
      `/api/inventory/on-hand?variantId=${encodeURIComponent(variantId)}`,
      {
        headers: staffHeaders,
      },
    );
    assert.equal(onHandRes.status, 200, JSON.stringify(onHandRes.json));
    assert.equal(onHandRes.json.variantId, variantId);
    assert.equal(onHandRes.json.onHand, 9);

    const blockedMovementsRes = await fetchJson(
      `/api/inventory/movements?variantId=${encodeURIComponent(variantId)}`,
      {
        headers: staffHeaders,
      },
    );
    assert.equal(blockedMovementsRes.status, 403, JSON.stringify(blockedMovementsRes.json));

    const movementsRes = await fetchJson(
      `/api/inventory/movements?variantId=${encodeURIComponent(variantId)}`,
      {
        headers: managerHeaders,
      },
    );
    assert.equal(movementsRes.status, 200, JSON.stringify(movementsRes.json));
    assert.equal(Array.isArray(movementsRes.json.movements), true);
    assert.equal(movementsRes.json.movements.length, 3);
    const quantityByType = new Map(
      movementsRes.json.movements.map((entry) => [entry.type, entry.quantity]),
    );
    assert.equal(quantityByType.get("PURCHASE"), 10);
    assert.equal(quantityByType.get("SALE"), -2);
    assert.equal(quantityByType.get("ADJUSTMENT"), 1);

    const onHandReportRes = await fetchJson(
      `/api/reports/inventory/on-hand?locationId=${encodeURIComponent(reportLocationId)}`,
      {
        headers: managerHeaders,
      },
    );
    assert.equal(onHandReportRes.status, 200, JSON.stringify(onHandReportRes.json));
    const onHandRow = onHandReportRes.json.find((row) => row.variantId === variantId);
    assert.ok(onHandRow, "Expected inventory on-hand report row for test variant");
    assert.equal(onHandRow.onHand, 9);

    const valueReportRes = await fetchJson(
      `/api/reports/inventory/value?locationId=${encodeURIComponent(reportLocationId)}`,
      {
        headers: managerHeaders,
      },
    );
    assert.equal(valueReportRes.status, 200, JSON.stringify(valueReportRes.json));
    const valueRow = valueReportRes.json.breakdown.find((row) => row.variantId === variantId);
    assert.ok(valueRow, "Expected inventory value report row for test variant");
    assert.equal(valueRow.onHand, 9);
    assert.equal(valueRow.avgUnitCostPence, 100);
    assert.equal(valueRow.valuePence, 900);

    console.log("PASS m24 inventory movement ledger smoke tests");
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
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
