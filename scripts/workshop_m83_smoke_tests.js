#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { createSmokeServerController } = require("./smoke_server_helper");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const MAX_STARTUP_LOG_CHARS = 4000;
const APP_REQUEST_RETRIES = 8;

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
console.log(`[m83-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m83-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const portFromBaseUrl = () => {
  const url = new URL(BASE_URL);
  return url.port || (url.protocol === "https:" ? "443" : "80");
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
const serverStartedPattern = /Server running on http:\/\/localhost:\d+/i;
const serverController = createSmokeServerController({
  label: "m83-smoke",
  baseUrls: appBaseUrlCandidates,
  databaseUrl: DATABASE_URL,
  captureStartupLog: true,
  startupLogCharLimit: MAX_STARTUP_LOG_CHARS,
  startupReadyPattern: serverStartedPattern,
  envOverrides: {
    PORT: portFromBaseUrl(),
  },
});

const fetchFromApp = async (path, options = {}) => {
  let lastError = null;

  for (let attempt = 0; attempt < APP_REQUEST_RETRIES; attempt += 1) {
    try {
      activeAppBaseUrl = serverController.getBaseUrl();
      return await fetch(`${activeAppBaseUrl}${path}`, options);
    } catch (error) {
      lastError = error;

      const healthyBaseUrl = await serverController.probeHealthyBaseUrl();
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

const todayUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

const addDays = (date, days) => {
  const out = new Date(date);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
};

let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;

const RUN_REF = uniqueRef();
const STAFF_USER_ID = `m83-staff-${RUN_REF}`;
const MANAGER_USER_ID = `m83-manager-${RUN_REF}`;

const STAFF_HEADERS = {
  "X-Staff-Role": "STAFF",
  "X-Staff-Id": STAFF_USER_ID,
};
const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": MANAGER_USER_ID,
};

const createJob = async (state, overrides = {}) => {
  const ref = uniqueRef();
  const response = await fetchJson("/api/workshop/jobs", {
    method: "POST",
    headers: STAFF_HEADERS,
    body: JSON.stringify({
      customerId: overrides.customerId,
      customerName:
        Object.prototype.hasOwnProperty.call(overrides, "customerName")
          ? overrides.customerName
          : `M83 Customer ${ref}`,
      bikeId: overrides.bikeId,
      bikeDescription:
        Object.prototype.hasOwnProperty.call(overrides, "bikeDescription")
          ? overrides.bikeDescription
          : "Road bike service",
      notes: overrides.notes || `m83 job ${ref}`,
      status: overrides.status || "BOOKED",
    }),
  });

  assert.equal(response.status, 201, JSON.stringify(response.json));
  state.workshopJobIds.add(response.json.id);

  await prisma.workshopJob.update({
    where: { id: response.json.id },
    data: {
      scheduledDate: addDays(todayUtc(), 14),
    },
  });

  return { job: { id: response.json.id } };
};

const createCustomer = async (state, overrides = {}) => {
  const ref = uniqueRef();
  const response = await fetchJson("/api/customers", {
    method: "POST",
    headers: STAFF_HEADERS,
    body: JSON.stringify({
      name: overrides.name || `M83 Customer ${ref}`,
      email: overrides.email || `m83-${ref}@example.com`,
      phone: overrides.phone || `07000${String(Math.floor(Math.random() * 90000) + 10000)}`,
      notes: overrides.notes || "M83 customer for workshop estimate coverage",
    }),
  });

  assert.equal(response.status, 201, JSON.stringify(response.json));
  state.customerIds.add(response.json.id);
  return response.json;
};

const createBike = async (state, customerId, overrides = {}) => {
  const ref = uniqueRef();
  const response = await fetchJson(`/api/customers/${customerId}/bikes`, {
    method: "POST",
    headers: STAFF_HEADERS,
    body: JSON.stringify({
      label: overrides.label || `M83 Bike ${ref}`,
      make: overrides.make || "Trek",
      model: overrides.model || "Domane",
      colour: overrides.colour || "Blue",
      frameNumber: overrides.frameNumber || `FRAME-${ref}`,
      notes: overrides.notes || "Workshop-linked bike record",
    }),
  });

  assert.equal(response.status, 201, JSON.stringify(response.json));
  return response.json.bike;
};

const cleanup = async (state) => {
  const workshopJobIds = Array.from(state.workshopJobIds);
  const customerIds = Array.from(state.customerIds);
  const userIds = Array.from(state.userIds);

  await prisma.auditEvent.deleteMany({
    where: {
      OR: [
        { actorId: { in: [STAFF_USER_ID, MANAGER_USER_ID] } },
        workshopJobIds.length > 0 ? { entityId: { in: workshopJobIds } } : undefined,
      ].filter(Boolean),
    },
  });

  if (workshopJobIds.length > 0) {
    await prisma.workshopEstimateLine.deleteMany({
      where: {
        estimate: {
          workshopJobId: {
            in: workshopJobIds,
          },
        },
      },
    });
    await prisma.workshopEstimate.deleteMany({
      where: { workshopJobId: { in: workshopJobIds } },
    });
    await prisma.workshopJobNote.deleteMany({
      where: { workshopJobId: { in: workshopJobIds } },
    });
    await prisma.workshopJobLine.deleteMany({
      where: { jobId: { in: workshopJobIds } },
    });
    await prisma.workshopJob.deleteMany({
      where: { id: { in: workshopJobIds } },
    });
  }

  if (customerIds.length > 0) {
    await prisma.customer.deleteMany({
      where: { id: { in: customerIds } },
    });
  }

  if (userIds.length > 0) {
    await prisma.user.deleteMany({
      where: { id: { in: userIds } },
    });
  }
};

const run = async () => {
  const state = {
    workshopJobIds: new Set(),
    customerIds: new Set(),
    userIds: new Set(),
  };

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
    await serverController.startIfNeeded();
    activeAppBaseUrl = serverController.getBaseUrl();

    const staffUser = await prisma.user.create({
      data: {
        id: STAFF_USER_ID,
        username: `staff_${RUN_REF}`,
        name: "M83 Staff",
        passwordHash: "test",
        role: "STAFF",
      },
    });
    state.userIds.add(staffUser.id);

    const managerUser = await prisma.user.create({
      data: {
        id: MANAGER_USER_ID,
        username: `manager_${RUN_REF}`,
        name: "M83 Manager",
        passwordHash: "test",
        role: "MANAGER",
      },
    });
    state.userIds.add(managerUser.id);

    const results = [];

    await runTest("approval status persists, is idempotent, and appears in dashboard filters", async () => {
      const { job } = await createJob(state);

      const addLine = await fetchJson(`/api/workshop/jobs/${job.id}/lines`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          type: "LABOUR",
          description: "Brake service estimate",
          qty: 1,
          unitPricePence: 4500,
        }),
      });
      assert.equal(addLine.status, 201, JSON.stringify(addLine.json));

      const waitingApproval = await fetchJson(`/api/workshop/jobs/${job.id}/approval`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "WAITING_FOR_APPROVAL" }),
      });
      assert.equal(waitingApproval.status, 201, JSON.stringify(waitingApproval.json));
      assert.equal(waitingApproval.json.job.status, "WAITING_FOR_APPROVAL");

      const replay = await fetchJson(`/api/workshop/jobs/${job.id}/approval`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "WAITING_FOR_APPROVAL" }),
      });
      assert.equal(replay.status, 200, JSON.stringify(replay.json));
      assert.equal(replay.json.idempotent, true);

      const detail = await fetchJson(`/api/workshop/jobs/${job.id}`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(detail.status, 200, JSON.stringify(detail.json));
      assert.equal(detail.json.job.rawStatus, "WAITING_FOR_APPROVAL");
      assert.equal(detail.json.lines.length, 1);
      assert.equal(detail.json.currentEstimate.status, "PENDING_APPROVAL");
      assert.equal(detail.json.currentEstimate.version, 1);
      assert.equal(detail.json.estimateHistory.length, 1);
      assert.equal(detail.json.currentEstimate.subtotalPence, 4500);

      const dashboard = await fetchJson(
        `/api/workshop/dashboard?status=WAITING_FOR_APPROVAL&limit=20`,
        { headers: STAFF_HEADERS },
      );
      assert.equal(dashboard.status, 200, JSON.stringify(dashboard.json));
      assert.ok(
        dashboard.json.jobs.some((dashboardJob) => dashboardJob.id === job.id),
        JSON.stringify(dashboard.json),
      );

      const audit = await fetchJson(
        `/api/audit?entityType=WORKSHOP_JOB&entityId=${job.id}&action=JOB_APPROVAL_STATUS_CHANGED&limit=20`,
        { headers: MANAGER_HEADERS },
      );
      assert.equal(audit.status, 200, JSON.stringify(audit.json));
      assert.ok(audit.json.events.length >= 1, JSON.stringify(audit.json));
    }, results);

    await runTest("approval can move to APPROVED, stale estimates are invalidated by line changes, and history is preserved", async () => {
      const { job } = await createJob(state);

      const addLine = await fetchJson(`/api/workshop/jobs/${job.id}/lines`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          type: "LABOUR",
          description: "Full service labour",
          qty: 1,
          unitPricePence: 6000,
        }),
      });
      assert.equal(addLine.status, 201, JSON.stringify(addLine.json));

      const approved = await fetchJson(`/api/workshop/jobs/${job.id}/approval`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "APPROVED" }),
      });
      assert.equal(approved.status, 201, JSON.stringify(approved.json));
      assert.equal(approved.json.job.status, "APPROVED");

      const updateLine = await fetchJson(
        `/api/workshop/jobs/${job.id}/lines/${addLine.json.line.id}`,
        {
          method: "PATCH",
          headers: STAFF_HEADERS,
          body: JSON.stringify({
            description: "Full service labour plus wheel true",
            qty: 1,
            unitPricePence: 7200,
          }),
        },
      );
      assert.equal(updateLine.status, 200, JSON.stringify(updateLine.json));

      const invalidatedDetail = await fetchJson(`/api/workshop/jobs/${job.id}`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(invalidatedDetail.status, 200, JSON.stringify(invalidatedDetail.json));
      assert.equal(invalidatedDetail.json.currentEstimate, null);
      assert.equal(invalidatedDetail.json.job.rawStatus, "BIKE_ARRIVED");
      assert.equal(invalidatedDetail.json.estimateHistory.length, 1);
      assert.ok(invalidatedDetail.json.estimateHistory[0].supersededAt, JSON.stringify(invalidatedDetail.json));

      const reRequest = await fetchJson(`/api/workshop/jobs/${job.id}/approval`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "WAITING_FOR_APPROVAL" }),
      });
      assert.equal(reRequest.status, 201, JSON.stringify(reRequest.json));

      const refreshedDetail = await fetchJson(`/api/workshop/jobs/${job.id}`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(refreshedDetail.status, 200, JSON.stringify(refreshedDetail.json));
      assert.equal(refreshedDetail.json.currentEstimate.status, "PENDING_APPROVAL");
      assert.equal(refreshedDetail.json.currentEstimate.version, 2);
      assert.equal(refreshedDetail.json.estimateHistory.length, 2);

      await prisma.workshopJob.update({
        where: { id: job.id },
        data: { status: "BIKE_READY" },
      });

      const invalid = await fetchJson(`/api/workshop/jobs/${job.id}/approval`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "WAITING_FOR_APPROVAL" }),
      });
      assert.equal(invalid.status, 409, JSON.stringify(invalid.json));
      assert.equal(invalid.json.error.code, "INVALID_APPROVAL_STATE_TRANSITION");
    }, results);

    await runTest("customer bike records can be linked directly to workshop jobs", async () => {
      const customer = await createCustomer(state, {
        name: `Bike Record Customer ${uniqueRef()}`,
      });
      const bike = await createBike(state, customer.id, {
        label: "Blue commuter",
        make: "Genesis",
        model: "Croix de Fer",
      });

      const { job } = await createJob(state, {
        customerId: customer.id,
        bikeId: bike.id,
        customerName: undefined,
        bikeDescription: undefined,
      });

      const detail = await fetchJson(`/api/workshop/jobs/${job.id}`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(detail.status, 200, JSON.stringify(detail.json));
      assert.equal(detail.json.job.customerId, customer.id);
      assert.equal(detail.json.job.bike.id, bike.id);
      assert.match(detail.json.job.bikeDescription, /Blue commuter/);
      assert.match(detail.json.job.bikeDescription, /Genesis Croix de Fer/);
    }, results);

    await runTest("manager can add and retrieve customer-visible quote notes", async () => {
      const { job } = await createJob(state);

      const addNote = await fetchJson(`/api/workshop/jobs/${job.id}/notes`, {
        method: "POST",
        headers: MANAGER_HEADERS,
        body: JSON.stringify({
          visibility: "CUSTOMER",
          note: "Estimate approved for new chain and labour.",
        }),
      });
      assert.equal(addNote.status, 201, JSON.stringify(addNote.json));
      assert.equal(addNote.json.note.visibility, "CUSTOMER");

      const listNotes = await fetchJson(`/api/workshop/jobs/${job.id}/notes`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(listNotes.status, 200, JSON.stringify(listNotes.json));
      assert.ok(
        listNotes.json.notes.some(
          (note) =>
            note.visibility === "CUSTOMER" &&
            note.note === "Estimate approved for new chain and labour.",
        ),
        JSON.stringify(listNotes.json),
      );
    }, results);

    const failed = results.filter((result) => !result.ok);
    if (failed.length > 0) {
      throw new Error(`${failed.length} m83 smoke test(s) failed.`);
    }

    console.log("M83 workshop estimates and approvals smoke tests passed.");
  } finally {
    await cleanup(state).catch((error) => {
      console.error("Cleanup failed:", error instanceof Error ? error.message : String(error));
    });
    await prisma.$disconnect();
    await serverController.stop();
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
