#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
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

const RUN_REF = `hire_${Date.now()}`;
const MANAGER_ID = `hire-manager-${RUN_REF}`;
const STAFF_ID = `hire-staff-${RUN_REF}`;
const safeDbUrl = DATABASE_URL.replace(/(postgres(?:ql)?:\/\/[^:/@]+:)[^@]+@/i, "$1***@");
console.log(`[hire-smoke] BASE_URL=${BASE_URL}`);
console.log(`[hire-smoke] DATABASE_URL=${safeDbUrl}`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_STARTUP_LOG_CHARS = 4000;
const APP_REQUEST_RETRIES = 8;

const managerHeaders = {
  "Content-Type": "application/json",
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": MANAGER_ID,
};

const staffHeaders = {
  "Content-Type": "application/json",
  "X-Staff-Role": "STAFF",
  "X-Staff-Id": STAFF_ID,
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
    // Keep primary only if URL parsing fails.
  }

  return urls;
})();

let activeAppBaseUrl = appBaseUrlCandidates[0];
let lastProbeDetail = "";

const trimStartupLog = (value) =>
  value.length > MAX_STARTUP_LOG_CHARS ? value.slice(value.length - MAX_STARTUP_LOG_CHARS) : value;

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
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (serverProcess && serverProcess.exitCode !== null) {
      const startupLog = getStartupLog().trim();
      throw new Error(
        startupLog ? `Server exited before becoming healthy:\n${startupLog}` : "Server exited before becoming healthy.",
      );
    }

    const healthyBaseUrl = await probeHealthyBaseUrl();
    if (healthyBaseUrl) {
      activeAppBaseUrl = healthyBaseUrl;
      return;
    }

    await sleep(500);
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

const fetchJson = async (path, options = {}, headers = managerHeaders) => {
  const response = await fetchFromApp(path, {
    ...options,
    headers: {
      ...headers,
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

const stopServer = async (serverProcess) => {
  if (!serverProcess || serverProcess.exitCode !== null) {
    return;
  }

  const exitPromise = once(serverProcess, "exit").catch(() => []);
  serverProcess.kill("SIGTERM");

  const exited = await Promise.race([
    exitPromise.then(() => true),
    sleep(3000).then(() => false),
  ]);

  if (exited) {
    return;
  }

  serverProcess.kill("SIGKILL");
  await exitPromise;
};

const cleanup = async (state) => {
  if (state.bookingIds.length > 0) {
    await prisma.hireBooking.deleteMany({
      where: {
        id: {
          in: state.bookingIds,
        },
      },
    });
  }

  if (state.assetIds.length > 0) {
    await prisma.hireAsset.deleteMany({
      where: {
        id: {
          in: state.assetIds,
        },
      },
    });
  }

  if (state.variantIds.length > 0) {
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

  if (state.customerIds.length > 0) {
    await prisma.customer.deleteMany({
      where: {
        id: {
          in: state.customerIds,
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
    bookingIds: [],
    assetIds: [],
    variantIds: [],
    productIds: [],
    customerIds: [],
    userIds: [MANAGER_ID, STAFF_ID],
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
      const port = new URL(BASE_URL).port || "3100";
      serverProcess = spawn("npx", ["ts-node", "--transpile-only", "src/server.ts"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          NODE_ENV: "test",
          DATABASE_URL,
          PORT: port,
        },
        shell: process.platform === "win32",
      });
      startedServer = true;

      const appendStartupLog = (chunk) => {
        startupLog = trimStartupLog(`${startupLog}${chunk.toString()}`);
      };
      serverProcess.stdout?.on("data", appendStartupLog);
      serverProcess.stderr?.on("data", appendStartupLog);

      await waitForServer(serverProcess, () => startupLog);
    }

    const product = await prisma.product.create({
      data: {
        name: `Hire Hardtail ${RUN_REF}`,
        brand: "CorePOS",
        variants: {
          create: {
            sku: `HIRE-${RUN_REF}`,
            barcode: `HIRE-${RUN_REF}`,
            retailPricePence: 4500,
          },
        },
      },
      include: {
        variants: true,
      },
    });
    state.productIds.push(product.id);
    state.variantIds.push(product.variants[0].id);

    const customer = await prisma.customer.create({
      data: {
        name: `Hire Customer ${RUN_REF}`,
        firstName: "Hire",
        lastName: `Customer ${RUN_REF}`,
        email: `hire-${RUN_REF}@corepos.test`,
        phone: "07700900900",
      },
    });
    state.customerIds.push(customer.id);

    const createAssetRes = await fetchJson(
      "/api/hire/assets",
      {
        method: "POST",
        body: JSON.stringify({
          variantId: product.variants[0].id,
          assetTag: `HIRE-ASSET-${RUN_REF}`,
          displayName: "Demo hire bike",
          notes: "Front suspension checked",
        }),
      },
      managerHeaders,
    );
    assert.equal(createAssetRes.status, 201);
    assert.equal(createAssetRes.json.status, "AVAILABLE");
    state.assetIds.push(createAssetRes.json.id);

    const listAssetsRes = await fetchJson("/api/hire/assets?take=20", { method: "GET" }, staffHeaders);
    assert.equal(listAssetsRes.status, 200);
    assert.ok(
      listAssetsRes.json.assets.some((asset) => asset.id === createAssetRes.json.id && asset.status === "AVAILABLE"),
      "expected created hire asset in fleet list",
    );

    const startsAt = new Date(Date.now() + 3_600_000).toISOString();
    const dueBackAt = new Date(Date.now() + 86_400_000).toISOString();
    const createBookingRes = await fetchJson(
      "/api/hire/bookings",
      {
        method: "POST",
        body: JSON.stringify({
          hireAssetId: createAssetRes.json.id,
          customerId: customer.id,
          startsAt,
          dueBackAt,
          hirePricePence: 4500,
          depositPence: 15000,
          notes: "Passport checked",
        }),
      },
      staffHeaders,
    );
    assert.equal(createBookingRes.status, 201);
    assert.equal(createBookingRes.json.status, "RESERVED");
    assert.equal(createBookingRes.json.customer.id, customer.id);
    state.bookingIds.push(createBookingRes.json.id);

    const insufficientCheckoutRes = await fetchJson(
      `/api/hire/bookings/${encodeURIComponent(createBookingRes.json.id)}/checkout`,
      {
        method: "POST",
        body: JSON.stringify({
          depositHeldPence: 5000,
        }),
      },
      staffHeaders,
    );
    assert.equal(insufficientCheckoutRes.status, 409);
    assert.equal(insufficientCheckoutRes.json.error.code, "HIRE_DEPOSIT_REQUIRED");

    const checkoutRes = await fetchJson(
      `/api/hire/bookings/${encodeURIComponent(createBookingRes.json.id)}/checkout`,
      {
        method: "POST",
        body: JSON.stringify({
          depositHeldPence: 15000,
        }),
      },
      staffHeaders,
    );
    assert.equal(checkoutRes.status, 200);
    assert.equal(checkoutRes.json.status, "CHECKED_OUT");
    assert.equal(checkoutRes.json.depositStatus, "HELD");

    const onHireAssetsRes = await fetchJson("/api/hire/assets?status=ON_HIRE&take=20", { method: "GET" }, staffHeaders);
    assert.equal(onHireAssetsRes.status, 200);
    assert.ok(
      onHireAssetsRes.json.assets.some((asset) => asset.id === createAssetRes.json.id),
      "expected checked-out asset in ON_HIRE fleet list",
    );

    const returnRes = await fetchJson(
      `/api/hire/bookings/${encodeURIComponent(createBookingRes.json.id)}/return`,
      {
        method: "POST",
        body: JSON.stringify({
          depositOutcome: "RETURNED",
        }),
      },
      staffHeaders,
    );
    assert.equal(returnRes.status, 200);
    assert.equal(returnRes.json.status, "RETURNED");
    assert.equal(returnRes.json.depositStatus, "RETURNED");

    const secondAssetRes = await fetchJson(
      "/api/hire/assets",
      {
        method: "POST",
        body: JSON.stringify({
          variantId: product.variants[0].id,
          assetTag: `HIRE-ASSET-${RUN_REF}-2`,
          displayName: "Second demo bike",
        }),
      },
      managerHeaders,
    );
    assert.equal(secondAssetRes.status, 201);
    state.assetIds.push(secondAssetRes.json.id);

    const secondBookingRes = await fetchJson(
      "/api/hire/bookings",
      {
        method: "POST",
        body: JSON.stringify({
          hireAssetId: secondAssetRes.json.id,
          customerId: customer.id,
          startsAt,
          dueBackAt,
          hirePricePence: 3000,
          depositPence: 5000,
        }),
      },
      staffHeaders,
    );
    assert.equal(secondBookingRes.status, 201);
    state.bookingIds.push(secondBookingRes.json.id);

    const cancelRes = await fetchJson(
      `/api/hire/bookings/${encodeURIComponent(secondBookingRes.json.id)}/cancel`,
      {
        method: "POST",
      },
      staffHeaders,
    );
    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.json.status, "CANCELLED");

    const bookingListRes = await fetchJson("/api/hire/bookings?take=20", { method: "GET" }, staffHeaders);
    assert.equal(bookingListRes.status, 200);
    assert.ok(
      bookingListRes.json.bookings.some((booking) => booking.id === createBookingRes.json.id && booking.status === "RETURNED"),
      "expected returned hire booking in booking list",
    );
    assert.ok(
      bookingListRes.json.bookings.some((booking) => booking.id === secondBookingRes.json.id && booking.status === "CANCELLED"),
      "expected cancelled hire booking in booking list",
    );

    const availableAssetsRes = await fetchJson("/api/hire/assets?status=AVAILABLE&take=20", { method: "GET" }, staffHeaders);
    assert.equal(availableAssetsRes.status, 200);
    assert.ok(
      availableAssetsRes.json.assets.some((asset) => asset.id === createAssetRes.json.id),
      "expected returned asset back in AVAILABLE list",
    );
    assert.ok(
      availableAssetsRes.json.assets.some((asset) => asset.id === secondAssetRes.json.id),
      "expected cancelled asset back in AVAILABLE list",
    );

    console.log("PASS bike hire assets can be created and listed");
    console.log("PASS hire bookings reserve assets and enforce deposit checkout rules");
    console.log("PASS hire returns and cancellations restore asset availability");
  } finally {
    try {
      await cleanup(state);
    } finally {
      if (startedServer) {
        await stopServer(serverProcess);
      }
      await prisma.$disconnect();
    }
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
