#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const INITIAL_BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
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

const safeDbUrl = DATABASE_URL.replace(/(postgres(?:ql)?:\/\/[^:/@]+:)[^@]+@/i, "$1***@");
console.log(`[m84-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;
const RUN_REF = uniqueRef();
const MANAGER_USER_ID = `m84-manager-${RUN_REF}`;

const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": MANAGER_USER_ID,
};

let activeBaseUrl = INITIAL_BASE_URL;

const setActiveBaseUrl = (nextBaseUrl) => {
  activeBaseUrl = nextBaseUrl;
  console.log(`[m84-smoke] BASE_URL=${activeBaseUrl}`);
};

const currentHealthUrl = () => `${activeBaseUrl}/health`;

const portFromBaseUrl = () => {
  const url = new URL(activeBaseUrl);
  return url.port || (url.protocol === "https:" ? "443" : "80");
};

const buildAlternateBaseUrl = () => {
  const url = new URL(activeBaseUrl);
  const currentPort = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  url.port = String(currentPort === 3000 ? 3100 : currentPort + 1);
  return url.toString().replace(/\/$/, "");
};

const fetchJson = async (path, options = {}) => {
  const response = await fetch(`${activeBaseUrl}${path}`, {
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
    const response = await fetch(currentHealthUrl());
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
  const workshopJobIds = Array.from(state.workshopJobIds);
  const productIds = Array.from(state.productIds);
  const variantIds = Array.from(state.variantIds);
  const userIds = Array.from(state.userIds);

  await prisma.auditEvent.deleteMany({
    where: {
      OR: [
        { actorId: MANAGER_USER_ID },
        workshopJobIds.length > 0 ? { entityId: { in: workshopJobIds } } : undefined,
      ].filter(Boolean),
    },
  });

  if (workshopJobIds.length > 0) {
    await prisma.workshopJobPart.deleteMany({ where: { workshopJobId: { in: workshopJobIds } } });
    await prisma.workshopJobLine.deleteMany({ where: { jobId: { in: workshopJobIds } } });
    await prisma.workshopJobNote.deleteMany({ where: { workshopJobId: { in: workshopJobIds } } });
    await prisma.workshopJob.deleteMany({ where: { id: { in: workshopJobIds } } });
  }

  if (variantIds.length > 0) {
    await prisma.stockLedgerEntry.deleteMany({ where: { variantId: { in: variantIds } } });
    await prisma.inventoryMovement.deleteMany({ where: { variantId: { in: variantIds } } });
    await prisma.barcode.deleteMany({ where: { variantId: { in: variantIds } } });
    await prisma.variant.deleteMany({ where: { id: { in: variantIds } } });
  }

  if (productIds.length > 0) {
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  }

  if (userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
};

const run = async () => {
  const state = {
    workshopJobIds: new Set(),
    productIds: new Set(),
    variantIds: new Set(),
    userIds: new Set(),
  };

  let startedServer = false;
  let serverProcess = null;

  const runTest = async (name, fn, results) => {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log(`PASS ${name}`);
    } catch (error) {
      results.push({ name, ok: false, error });
      console.error(`FAIL ${name}`);
      console.error(error instanceof Error ? error.message : String(error));
    }
  };

  try {
    setActiveBaseUrl(INITIAL_BASE_URL);
    const existing = await serverIsHealthy();
    if (existing && process.env.ALLOW_EXISTING_SERVER !== "1") {
      throw new Error(
        "Refusing to run against an already-running server. Stop it first or set ALLOW_EXISTING_SERVER=1.",
      );
    }

    if (existing && process.env.ALLOW_EXISTING_SERVER === "1") {
      const authProbe = await fetchJson("/api/workshop/jobs?take=1", {
        headers: MANAGER_HEADERS,
      });

      if (authProbe.status === 401 || authProbe.status === 403) {
        const alternateBaseUrl = buildAlternateBaseUrl();
        console.log(
          `[m84-smoke] Existing server on ${INITIAL_BASE_URL} does not accept test header auth. Starting isolated test server on ${alternateBaseUrl}.`,
        );
        setActiveBaseUrl(alternateBaseUrl);
      }
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
      serverProcess.stdout.on("data", () => {});
      serverProcess.stderr.on("data", () => {});
      startedServer = true;
      await waitForServer();
    }

    if (existing && !(await serverIsHealthy())) {
      serverProcess = spawn("npm", ["run", "dev"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          NODE_ENV: "test",
          DATABASE_URL,
          PORT: portFromBaseUrl(),
        },
      });
      serverProcess.stdout.on("data", () => {});
      serverProcess.stderr.on("data", () => {});
      startedServer = true;
      await waitForServer();
    }

    const managerUser = await prisma.user.create({
      data: {
        id: MANAGER_USER_ID,
        username: `m84_manager_${RUN_REF}`,
        name: "M84 Manager",
        passwordHash: "test",
        role: "MANAGER",
      },
    });
    state.userIds.add(managerUser.id);

    const createProductResponse = await fetchJson("/api/products", {
      method: "POST",
      headers: MANAGER_HEADERS,
      body: JSON.stringify({
        name: `M84 Brake Pads ${uniqueRef()}`,
      }),
    });
    assert.equal(createProductResponse.status, 201, JSON.stringify(createProductResponse.json));
    const productId = createProductResponse.json.id;
    state.productIds.add(productId);

    const createVariantResponse = await fetchJson("/api/variants", {
      method: "POST",
      headers: MANAGER_HEADERS,
      body: JSON.stringify({
        productId,
        sku: `M84-SKU-${uniqueRef()}`,
        retailPricePence: 1499,
        costPricePence: 800,
      }),
    });
    assert.equal(createVariantResponse.status, 201, JSON.stringify(createVariantResponse.json));
    const variantId = createVariantResponse.json.id;
    state.variantIds.add(variantId);

    const createJobResponse = await fetchJson("/api/workshop/jobs", {
      method: "POST",
      headers: MANAGER_HEADERS,
      body: JSON.stringify({
        customerName: `M84 Customer ${uniqueRef()}`,
        bikeDescription: "Trail bike service",
        notes: `m84 allocation ${RUN_REF}`,
        status: "BOOKED",
      }),
    });
    assert.equal(createJobResponse.status, 201, JSON.stringify(createJobResponse.json));
    const workshopJobId = createJobResponse.json.id;
    state.workshopJobIds.add(workshopJobId);

    const addPartLineResponse = await fetchJson(`/api/workshop/jobs/${workshopJobId}/lines`, {
      method: "POST",
      headers: MANAGER_HEADERS,
      body: JSON.stringify({
        type: "PART",
        productId,
        variantId,
        description: "Brake pad set",
        qty: 3,
        unitPricePence: 1499,
      }),
    });
    assert.equal(addPartLineResponse.status, 201, JSON.stringify(addPartLineResponse.json));

    const openingStock = await fetchJson("/api/stock/adjustments", {
      method: "POST",
      headers: MANAGER_HEADERS,
      body: JSON.stringify({
        variantId,
        quantityDelta: 2,
        note: "m84 opening stock",
      }),
    });
    assert.equal(openingStock.status, 201, JSON.stringify(openingStock.json));
    const stockLocationId = openingStock.json.stock?.locationId ?? openingStock.json.entry?.locationId;
    assert.ok(stockLocationId);

    const results = [];

    await runTest(
      "job detail and dashboard expose shortage when required parts exceed stock",
      async () => {
        const jobDetail = await fetchJson(`/api/workshop/jobs/${workshopJobId}`, {
          headers: MANAGER_HEADERS,
        });
        assert.equal(jobDetail.status, 200, JSON.stringify(jobDetail.json));
        assert.equal(jobDetail.json.partsOverview.summary.partsStatus, "SHORT");
        assert.equal(jobDetail.json.partsOverview.summary.missingQty, 1);

        const dashboard = await fetchJson(`/api/workshop/dashboard?search=${encodeURIComponent(RUN_REF)}&limit=20`, {
          headers: MANAGER_HEADERS,
        });
        assert.equal(dashboard.status, 200, JSON.stringify(dashboard.json));
        const job = dashboard.json.jobs.find((entry) => entry.id === workshopJobId);
        assert.ok(job, "expected job in workshop dashboard response");
        assert.equal(job.partsStatus, "SHORT");
      },
      results,
    );

    let partId = null;

    await runTest(
      "reserving available stock creates PLANNED allocation and blocks over-reservation",
      async () => {
        const reservePart = await fetchJson(`/api/workshop-jobs/${workshopJobId}/parts`, {
          method: "POST",
          headers: MANAGER_HEADERS,
          body: JSON.stringify({
            variantId,
            quantity: 2,
            status: "PLANNED",
            locationId: stockLocationId,
            note: "Reserve available brake pads",
          }),
        });
        assert.equal(reservePart.status, 201, JSON.stringify(reservePart.json));
        partId = reservePart.json.part.id;
        assert.equal(reservePart.json.part.status, "PLANNED");
        assert.equal(reservePart.json.overview.summary.partsStatus, "SHORT");
        assert.equal(reservePart.json.overview.summary.allocatedQty, 2);

        const overReserve = await fetchJson(`/api/workshop-jobs/${workshopJobId}/parts`, {
          method: "POST",
          headers: MANAGER_HEADERS,
          body: JSON.stringify({
            variantId,
            quantity: 1,
            status: "PLANNED",
            locationId: stockLocationId,
            note: "Attempt to over-reserve",
          }),
        });
        assert.equal(overReserve.status, 409, JSON.stringify(overReserve.json));
      },
      results,
    );

    await runTest(
      "consuming reserved parts reduces stock and keeps job-level shortage visible",
      async () => {
        const consumePart = await fetchJson(`/api/workshop-jobs/${workshopJobId}/parts/${partId}`, {
          method: "PATCH",
          headers: MANAGER_HEADERS,
          body: JSON.stringify({
            status: "USED",
            locationId: stockLocationId,
            note: "Brake pads fitted",
          }),
        });
        assert.equal(consumePart.status, 200, JSON.stringify(consumePart.json));
        assert.equal(consumePart.json.part.status, "USED");
        assert.equal(consumePart.json.overview.summary.consumedQty, 2);
        assert.equal(consumePart.json.overview.summary.partsStatus, "SHORT");

        const stockAfterUse = await fetchJson(
          `/api/stock/variants/${variantId}?locationId=${encodeURIComponent(stockLocationId)}`,
          { headers: MANAGER_HEADERS },
        );
        assert.equal(stockAfterUse.status, 200, JSON.stringify(stockAfterUse.json));
        assert.equal(stockAfterUse.json.onHand, 0);
      },
      results,
    );

    await runTest(
      "adding more stock allows final reservation and clears shortage on the board",
      async () => {
        const replenish = await fetchJson("/api/stock/adjustments", {
          method: "POST",
          headers: MANAGER_HEADERS,
          body: JSON.stringify({
            variantId,
            locationId: stockLocationId,
            quantityDelta: 1,
            note: "m84 replenishment",
          }),
        });
        assert.equal(replenish.status, 201, JSON.stringify(replenish.json));

        const reserveLast = await fetchJson(`/api/workshop-jobs/${workshopJobId}/parts`, {
          method: "POST",
          headers: MANAGER_HEADERS,
          body: JSON.stringify({
            variantId,
            quantity: 1,
            status: "PLANNED",
            locationId: stockLocationId,
            note: "Reserve final part",
          }),
        });
        assert.equal(reserveLast.status, 201, JSON.stringify(reserveLast.json));
        assert.equal(reserveLast.json.overview.summary.partsStatus, "OK");
        assert.equal(reserveLast.json.overview.summary.missingQty, 0);

        const dashboard = await fetchJson(`/api/workshop/dashboard?search=${encodeURIComponent(RUN_REF)}&limit=20`, {
          headers: MANAGER_HEADERS,
        });
        assert.equal(dashboard.status, 200, JSON.stringify(dashboard.json));
        const job = dashboard.json.jobs.find((entry) => entry.id === workshopJobId);
        assert.ok(job, "expected job in workshop dashboard response");
        assert.equal(job.partsStatus, "OK");
      },
      results,
    );

    const failed = results.filter((result) => !result.ok);
    if (failed.length > 0) {
      process.exitCode = 1;
      return;
    }

    console.log("PASS m84 workshop parts allocation smoke tests");
  } finally {
    await cleanup(state).catch((cleanupError) => {
      console.error(
        "Cleanup failed:",
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      );
    });

    if (startedServer && serverProcess) {
      serverProcess.kill("SIGTERM");
      await sleep(500);
    }

    await prisma.$disconnect();
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
