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
console.log(`[m83-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

let activeBaseUrl = INITIAL_BASE_URL;

const setActiveBaseUrl = (nextBaseUrl) => {
  activeBaseUrl = nextBaseUrl;
  console.log(`[m83-smoke] BASE_URL=${activeBaseUrl}`);
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

const createJob = async (state, overrides = {}) => {
  const ref = uniqueRef();
  const response = await fetchJson("/api/workshop/jobs", {
    method: "POST",
    headers: STAFF_HEADERS,
    body: JSON.stringify({
      customerName: `M83 Customer ${ref}`,
      bikeDescription: overrides.bikeDescription || "Road bike service",
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

const cleanup = async (state) => {
  const workshopJobIds = Array.from(state.workshopJobIds);
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

  if (userIds.length > 0) {
    await prisma.user.deleteMany({
      where: { id: { in: userIds } },
    });
  }
};

const run = async () => {
  const state = {
    workshopJobIds: new Set(),
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
        headers: STAFF_HEADERS,
      });

      if (authProbe.status === 401 || authProbe.status === 403) {
        const alternateBaseUrl = buildAlternateBaseUrl();
        console.log(
          `[m83-smoke] Existing server on ${INITIAL_BASE_URL} does not accept test header auth. Starting isolated test server on ${alternateBaseUrl}.`,
        );
        setActiveBaseUrl(alternateBaseUrl);
      }
    }

    if (!(await serverIsHealthy())) {
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

    await runTest("approval can move to APPROVED and blocks invalid later-state transitions", async () => {
      const { job } = await createJob(state);

      const approved = await fetchJson(`/api/workshop/jobs/${job.id}/approval`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "APPROVED" }),
      });
      assert.equal(approved.status, 201, JSON.stringify(approved.json));
      assert.equal(approved.json.job.status, "APPROVED");

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

    if (startedServer && serverProcess) {
      serverProcess.kill("SIGTERM");
    }
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
