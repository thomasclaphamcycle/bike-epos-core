#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { ensureMainLocationId } = require("./default_location_helper");
const { createSmokeServerController } = require("./smoke_server_helper");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const MAX_STARTUP_LOG_CHARS = 4000;

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
console.log(`[m14-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m14-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

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
  label: "m14-smoke",
  baseUrls: appBaseUrlCandidates,
  databaseUrl: DATABASE_URL,
  captureStartupLog: true,
  startupLogCharLimit: MAX_STARTUP_LOG_CHARS,
  startupReadyPattern: serverStartedPattern,
  envOverrides: {
    PORT: portFromBaseUrl(),
  },
});

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
const STAFF_USER_ID = `m14-staff-${RUN_REF}`;
const MANAGER_USER_ID = `m14-manager-${RUN_REF}`;

const STAFF_HEADERS = {
  "X-Staff-Role": "STAFF",
  "X-Staff-Id": STAFF_USER_ID,
};
const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": MANAGER_USER_ID,
};

const fetchFromApp = async (path, options = {}) => {
  activeAppBaseUrl = serverController.getBaseUrl();
  return fetch(`${activeAppBaseUrl}${path}`, options);
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

const createCustomerAndJob = async (state, overrides = {}) => {
  const ref = uniqueRef();
  const locationId = await ensureMainLocationId(prisma);
  const customer = await prisma.customer.create({
    data: {
      firstName: "M14",
      lastName: "Customer",
      email: `m14.${ref}@example.com`,
      phone: `0722${String(ref).replace(/\D/g, "").slice(-7).padStart(7, "0")}`,
    },
  });
  state.customerIds.add(customer.id);

  const job = await prisma.workshopJob.create({
    data: {
      customerId: customer.id,
      status: "BOOKING_MADE",
      source: "IN_STORE",
      locationId,
      scheduledDate: addDays(todayUtc(), 20),
      depositStatus: "NOT_REQUIRED",
      depositRequiredPence: 0,
      notes: `m14 job ${ref}`,
      ...overrides,
    },
  });
  state.workshopJobIds.add(job.id);
  return { customer, job };
};

const cleanup = async (state) => {
  const workshopJobIds = Array.from(state.workshopJobIds);
  const customerIds = Array.from(state.customerIds);
  const userIds = Array.from(state.userIds);

  await prisma.auditEvent.deleteMany({
    where: {
      actorId: {
        in: [STAFF_USER_ID, MANAGER_USER_ID],
      },
    },
  });

  if (workshopJobIds.length > 0) {
    await prisma.workshopJobNote.deleteMany({
      where: { workshopJobId: { in: workshopJobIds } },
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

    const staffUser = await prisma.user.create({
      data: {
        id: STAFF_USER_ID,
        username: `staff_${RUN_REF}`,
        name: "M14 Staff",
        passwordHash: "test",
        role: "STAFF",
      },
    });
    state.userIds.add(staffUser.id);

    const managerUser = await prisma.user.create({
      data: {
        id: MANAGER_USER_ID,
        username: `manager_${RUN_REF}`,
        name: "M14 Manager",
        passwordHash: "test",
        role: "ADMIN",
      },
    });
    state.userIds.add(managerUser.id);

    const results = [];

    await runTest("job assignment permissions, idempotency, and audit", async () => {
      const { job } = await createCustomerAndJob(state);

      const assignSelf = await fetchJson(`/api/workshop/jobs/${job.id}/assign`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ staffId: STAFF_USER_ID }),
      });
      assert.equal(assignSelf.status, 201, JSON.stringify(assignSelf.json));
      assert.equal(assignSelf.json.job.assignedStaffId, STAFF_USER_ID);

      const assignSelfReplay = await fetchJson(`/api/workshop/jobs/${job.id}/assign`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ staffId: STAFF_USER_ID }),
      });
      assert.equal(assignSelfReplay.status, 200, JSON.stringify(assignSelfReplay.json));
      assert.equal(assignSelfReplay.json.idempotent, true);

      const assignOtherAsStaff = await fetchJson(`/api/workshop/jobs/${job.id}/assign`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ staffId: MANAGER_USER_ID }),
      });
      assert.equal(assignOtherAsStaff.status, 403, JSON.stringify(assignOtherAsStaff.json));
      assert.equal(assignOtherAsStaff.json.error.code, "INSUFFICIENT_ROLE");

      const assignOtherAsManager = await fetchJson(`/api/workshop/jobs/${job.id}/assign`, {
        method: "POST",
        headers: MANAGER_HEADERS,
        body: JSON.stringify({ staffId: MANAGER_USER_ID }),
      });
      assert.equal(assignOtherAsManager.status, 201, JSON.stringify(assignOtherAsManager.json));
      assert.equal(assignOtherAsManager.json.job.assignedStaffId, MANAGER_USER_ID);

      const audit = await fetchJson(
        `/api/audit?entityType=WORKSHOP_JOB&entityId=${job.id}&action=JOB_ASSIGNED&limit=20`,
        { headers: MANAGER_HEADERS },
      );
      assert.equal(audit.status, 200, JSON.stringify(audit.json));
      assert.ok(audit.json.events.length >= 2, JSON.stringify(audit.json));
    }, results);

    await runTest("job notes permissions, retrieval, and audit", async () => {
      const { job } = await createCustomerAndJob(state);

      const addInternal = await fetchJson(`/api/workshop/jobs/${job.id}/notes`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          visibility: "INTERNAL",
          note: "Internal diagnostic note",
        }),
      });
      assert.equal(addInternal.status, 201, JSON.stringify(addInternal.json));
      assert.equal(addInternal.json.note.visibility, "INTERNAL");

      const addCustomerAsStaff = await fetchJson(`/api/workshop/jobs/${job.id}/notes`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          visibility: "CUSTOMER",
          note: "Customer-safe update",
        }),
      });
      assert.equal(addCustomerAsStaff.status, 403, JSON.stringify(addCustomerAsStaff.json));
      assert.equal(addCustomerAsStaff.json.error.code, "INSUFFICIENT_ROLE");

      const addCustomerAsManager = await fetchJson(`/api/workshop/jobs/${job.id}/notes`, {
        method: "POST",
        headers: MANAGER_HEADERS,
        body: JSON.stringify({
          visibility: "CUSTOMER",
          note: "Bike ready this afternoon",
        }),
      });
      assert.equal(addCustomerAsManager.status, 201, JSON.stringify(addCustomerAsManager.json));
      assert.equal(addCustomerAsManager.json.note.visibility, "CUSTOMER");

      const list = await fetchJson(`/api/workshop/jobs/${job.id}/notes`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(list.status, 200, JSON.stringify(list.json));
      assert.ok(Array.isArray(list.json.notes), JSON.stringify(list.json));
      assert.ok(list.json.notes.length >= 2, JSON.stringify(list.json));

      const audit = await fetchJson(
        `/api/audit?entityType=WORKSHOP_JOB&entityId=${job.id}&action=JOB_NOTE_ADDED&limit=20`,
        { headers: MANAGER_HEADERS },
      );
      assert.equal(audit.status, 200, JSON.stringify(audit.json));
      assert.ok(audit.json.events.length >= 2, JSON.stringify(audit.json));
    }, results);

    await runTest("status transition rules and audit", async () => {
      const { job } = await createCustomerAndJob(state);

      const invalid = await fetchJson(`/api/workshop/jobs/${job.id}/status`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "READY_FOR_COLLECTION" }),
      });
      assert.equal(invalid.status, 409, JSON.stringify(invalid.json));
      assert.equal(invalid.json.error.code, "INVALID_STATUS_TRANSITION");

      const toReadyForWork = await fetchJson(`/api/workshop/jobs/${job.id}/status`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "READY_FOR_WORK" }),
      });
      assert.equal(toReadyForWork.status, 201, JSON.stringify(toReadyForWork.json));
      assert.equal(toReadyForWork.json.job.status, "READY_FOR_WORK");

      const toReadyForWorkReplay = await fetchJson(`/api/workshop/jobs/${job.id}/status`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "READY_FOR_WORK" }),
      });
      assert.equal(toReadyForWorkReplay.status, 200, JSON.stringify(toReadyForWorkReplay.json));
      assert.equal(toReadyForWorkReplay.json.idempotent, true);

      const toInProgress = await fetchJson(`/api/workshop/jobs/${job.id}/status`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      });
      assert.equal(toInProgress.status, 201, JSON.stringify(toInProgress.json));
      assert.equal(toInProgress.json.job.status, "IN_PROGRESS");

      const toWaitingParts = await fetchJson(`/api/workshop/jobs/${job.id}/status`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "WAITING_FOR_PARTS" }),
      });
      assert.equal(toWaitingParts.status, 201, JSON.stringify(toWaitingParts.json));
      assert.equal(toWaitingParts.json.job.status, "WAITING_FOR_PARTS");

      const resumeWork = await fetchJson(`/api/workshop/jobs/${job.id}/status`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      });
      assert.equal(resumeWork.status, 201, JSON.stringify(resumeWork.json));
      assert.equal(resumeWork.json.job.status, "IN_PROGRESS");

      const toReady = await fetchJson(`/api/workshop/jobs/${job.id}/status`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "READY_FOR_COLLECTION" }),
      });
      assert.equal(toReady.status, 201, JSON.stringify(toReady.json));
      assert.equal(toReady.json.job.status, "READY_FOR_COLLECTION");

      const toCompleted = await fetchJson(`/api/workshop/jobs/${job.id}/status`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "COMPLETED" }),
      });
      assert.equal(toCompleted.status, 409, JSON.stringify(toCompleted.json));
      assert.equal(toCompleted.json.error.code, "WORKSHOP_COLLECTION_REQUIRES_SALE");

      const { job: cancelJob } = await createCustomerAndJob(state);
      const toCancelled = await fetchJson(`/api/workshop/jobs/${cancelJob.id}/status`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "CANCELLED" }),
      });
      assert.equal(toCancelled.status, 201, JSON.stringify(toCancelled.json));
      assert.equal(toCancelled.json.job.status, "CANCELLED");

      const audit = await fetchJson(
        `/api/audit?entityType=WORKSHOP_JOB&entityId=${job.id}&action=JOB_STATUS_CHANGED&limit=20`,
        { headers: MANAGER_HEADERS },
      );
      assert.equal(audit.status, 200, JSON.stringify(audit.json));
      assert.ok(audit.json.events.length >= 4, JSON.stringify(audit.json));
    }, results);

    await runTest("dashboard includes assignment + note stats and new filters", async () => {
      const { job: assignedJob } = await createCustomerAndJob(state, {
        scheduledDate: addDays(todayUtc(), 25),
      });
      const { job: unassignedJob } = await createCustomerAndJob(state, {
        scheduledDate: addDays(todayUtc(), 26),
      });

      const assign = await fetchJson(`/api/workshop/jobs/${assignedJob.id}/assign`, {
        method: "POST",
        headers: MANAGER_HEADERS,
        body: JSON.stringify({ staffId: STAFF_USER_ID }),
      });
      assert.equal(assign.status, 201, JSON.stringify(assign.json));

      const addNote = await fetchJson(`/api/workshop/jobs/${assignedJob.id}/notes`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          visibility: "INTERNAL",
          note: "dashboard note",
        }),
      });
      assert.equal(addNote.status, 201, JSON.stringify(addNote.json));

      const assignedFilter = await fetchJson(
        `/api/workshop/dashboard?assignedTo=${STAFF_USER_ID}&limit=100`,
        { headers: STAFF_HEADERS },
      );
      assert.equal(assignedFilter.status, 200, JSON.stringify(assignedFilter.json));
      assert.ok(
        assignedFilter.json.jobs.every((job) => job.assignedStaffId === STAFF_USER_ID),
        JSON.stringify(assignedFilter.json),
      );

      const unassignedFilter = await fetchJson("/api/workshop/dashboard?unassigned=true&limit=100", {
        headers: STAFF_HEADERS,
      });
      assert.equal(unassignedFilter.status, 200, JSON.stringify(unassignedFilter.json));
      assert.ok(
        unassignedFilter.json.jobs.some((job) => job.id === unassignedJob.id),
        JSON.stringify(unassignedFilter.json),
      );

      const hasNotesFilter = await fetchJson("/api/workshop/dashboard?hasNotes=true&limit=100", {
        headers: STAFF_HEADERS,
      });
      assert.equal(hasNotesFilter.status, 200, JSON.stringify(hasNotesFilter.json));
      assert.ok(
        hasNotesFilter.json.jobs.some((job) => job.id === assignedJob.id && job.noteCount > 0),
        JSON.stringify(hasNotesFilter.json),
      );
      assert.ok(
        hasNotesFilter.json.jobs.every((job) => typeof job.noteCount === "number"),
        JSON.stringify(hasNotesFilter.json),
      );
      assert.ok(
        hasNotesFilter.json.jobs.some((job) => Object.prototype.hasOwnProperty.call(job, "lastNoteAt")),
        JSON.stringify(hasNotesFilter.json),
      );
    }, results);

    const failed = results.filter((result) => !result.ok);
    if (failed.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await cleanup(state);
    await prisma.$disconnect();
    await serverController.stop();
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
