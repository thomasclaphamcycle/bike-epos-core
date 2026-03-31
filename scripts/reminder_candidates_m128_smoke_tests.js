#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { createSmokeServerController } = require("./smoke_server_helper");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3100";
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
const serverController = createSmokeServerController({
  label: "m128-smoke",
  baseUrl: BASE_URL,
  databaseUrl: DATABASE_URL,
});

const RUN_REF = `m128_${Date.now()}`;
const STAFF_HEADERS = {
  "Content-Type": "application/json",
  "X-Staff-Role": "STAFF",
  "X-Staff-Id": `m128-staff-${RUN_REF}`,
};
const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": `m128-manager-${RUN_REF}`,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchJson = async (path, init = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, init);
  const json = await response.json();
  return { status: response.status, json };
};

const waitForReminderCandidate = async (workshopJobId) => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const candidate = await prisma.reminderCandidate.findUnique({
      where: { workshopJobId },
    });
    if (candidate) {
      return candidate;
    }
    await sleep(200);
  }
  throw new Error(`Reminder candidate not created for workshop job ${workshopJobId}`);
};

const cleanup = async (state) => {
  if (state.saleIds.length) {
    await prisma.sale.deleteMany({ where: { id: { in: state.saleIds } } });
  }
  if (state.workshopJobIds.length) {
    await prisma.workshopJob.deleteMany({ where: { id: { in: state.workshopJobIds } } });
  }
  if (state.customerIds.length) {
    await prisma.customer.deleteMany({ where: { id: { in: state.customerIds } } });
  }
};

const main = async () => {
  const state = { customerIds: [], workshopJobIds: [], saleIds: [] };
  try {
    await serverController.startIfNeeded();

    const customer = await prisma.customer.create({
      data: {
        firstName: "Reminder",
        lastName: RUN_REF,
        email: `m128-${RUN_REF}@local`,
      },
    });
    state.customerIds.push(customer.id);

    const createJob = await fetchJson("/api/workshop/jobs", {
      method: "POST",
      headers: STAFF_HEADERS,
      body: JSON.stringify({
        customerName: `${customer.firstName} ${customer.lastName}`.trim(),
        bikeDescription: "Reminder groundwork bike",
      }),
    });
    assert.equal(createJob.status, 201, JSON.stringify(createJob.json));
    const workshopJobId = createJob.json.id;
    state.workshopJobIds.push(workshopJobId);

    const attachCustomer = await fetchJson(`/api/workshop/jobs/${workshopJobId}/customer`, {
      method: "PATCH",
      headers: STAFF_HEADERS,
      body: JSON.stringify({
        customerId: customer.id,
      }),
    });
    assert.equal(attachCustomer.status, 200, JSON.stringify(attachCustomer.json));

    const inProgress = await fetchJson(`/api/workshop/jobs/${workshopJobId}/status`, {
      method: "POST",
      headers: STAFF_HEADERS,
      body: JSON.stringify({
        status: "IN_PROGRESS",
      }),
    });
    assert.equal(inProgress.status, 201, JSON.stringify(inProgress.json));

    const ready = await fetchJson(`/api/workshop/jobs/${workshopJobId}/status`, {
      method: "POST",
      headers: STAFF_HEADERS,
      body: JSON.stringify({
        status: "READY",
      }),
    });
    assert.equal(ready.status, 201, JSON.stringify(ready.json));

    await sleep(300);

    const candidateCountBeforeCompletion = await prisma.reminderCandidate.count({
      where: { workshopJobId },
    });
    assert.equal(candidateCountBeforeCompletion, 0);

    const complete = await fetchJson(`/api/workshop/jobs/${workshopJobId}/checkout`, {
      method: "POST",
      headers: STAFF_HEADERS,
      body: JSON.stringify({
        saleTotalPence: 0,
      }),
    });
    assert.equal(complete.status, 201, JSON.stringify(complete.json));
    state.saleIds.push(complete.json.sale.id);

    const candidate = await waitForReminderCandidate(workshopJobId);
    assert.equal(candidate.customerId, customer.id);
    assert.equal(candidate.workshopJobId, workshopJobId);
    assert.equal(candidate.sourceEvent, "workshop.job.completed");
    assert.equal(candidate.status, "PENDING");

    const completedJob = await prisma.workshopJob.findUnique({
      where: { id: workshopJobId },
      select: { status: true, completedAt: true },
    });
    assert.equal(completedJob?.status, "COMPLETED");
    assert.ok(completedJob?.completedAt);

    const completedAt = new Date(completedJob.completedAt);
    const dueAt = new Date(candidate.dueAt);
    const dueDays = Math.round((dueAt.getTime() - completedAt.getTime()) / 86_400_000);
    assert.equal(dueDays, 90);

    const replay = await fetchJson(`/api/workshop/jobs/${workshopJobId}/checkout`, {
      method: "POST",
      headers: STAFF_HEADERS,
      body: JSON.stringify({
        saleTotalPence: 0,
      }),
    });
    assert.equal(replay.status, 200, JSON.stringify(replay.json));
    assert.equal(replay.json.idempotent, true);
    assert.equal(replay.json.sale.id, complete.json.sale.id);

    await sleep(300);

    const candidates = await prisma.reminderCandidate.findMany({
      where: { workshopJobId },
    });
    assert.equal(candidates.length, 1);

    const report = await fetchJson("/api/reports/reminder-candidates?take=20", {
      headers: MANAGER_HEADERS,
    });
    assert.equal(report.status, 200, JSON.stringify(report.json));
    assert.ok(report.json.summary.candidateCount >= 1);
    const row = report.json.items.find((item) => item.workshopJobId === workshopJobId);
    assert.ok(row, JSON.stringify(report.json));
    assert.equal(row.reminderCandidateId, candidate.id);
    assert.equal(row.customerId, customer.id);
    assert.equal(row.customerName, `${customer.firstName} ${customer.lastName}`.trim());
    assert.equal(row.status, "PENDING");
    assert.equal(row.reviewState, "UNREVIEWED");
    assert.equal(row.reviewedAt, null);
    assert.equal(row.daysOverdue, 0);
    assert.equal(row.completedAt.slice(0, 10), completedJob.completedAt.toISOString().slice(0, 10));

    const review = await fetchJson(
      `/api/reports/reminder-candidates/${candidate.id}/review`,
      {
        method: "POST",
        headers: MANAGER_HEADERS,
      },
    );
    assert.equal(review.status, 201, JSON.stringify(review.json));
    assert.equal(review.json.idempotent, false);
    assert.equal(review.json.candidate.id, candidate.id);
    assert.equal(review.json.candidate.reviewedByStaffId, MANAGER_HEADERS["X-Staff-Id"]);
    assert.ok(review.json.candidate.reviewedAt);

    const reviewedCandidate = await prisma.reminderCandidate.findUnique({
      where: { id: candidate.id },
    });
    assert.ok(reviewedCandidate);
    assert.ok(reviewedCandidate.reviewedAt);
    assert.equal(reviewedCandidate.reviewedByStaffId, MANAGER_HEADERS["X-Staff-Id"]);

    const reviewReplay = await fetchJson(
      `/api/reports/reminder-candidates/${candidate.id}/review`,
      {
        method: "POST",
        headers: MANAGER_HEADERS,
      },
    );
    assert.equal(reviewReplay.status, 200, JSON.stringify(reviewReplay.json));
    assert.equal(reviewReplay.json.idempotent, true);

    const dismiss = await fetchJson(
      `/api/reports/reminder-candidates/${candidate.id}/dismiss`,
      {
        method: "POST",
        headers: MANAGER_HEADERS,
      },
    );
    assert.equal(dismiss.status, 201, JSON.stringify(dismiss.json));
    assert.equal(dismiss.json.idempotent, false);
    assert.equal(dismiss.json.candidate.id, candidate.id);
    assert.equal(dismiss.json.candidate.status, "DISMISSED");
    assert.ok(dismiss.json.candidate.reviewedAt);

    const dismissedReport = await fetchJson("/api/reports/reminder-candidates?take=20&includeDismissed=1", {
      headers: MANAGER_HEADERS,
    });
    assert.equal(dismissedReport.status, 200, JSON.stringify(dismissedReport.json));
    const dismissedRow = dismissedReport.json.items.find((item) => item.reminderCandidateId === candidate.id);
    assert.ok(dismissedRow, JSON.stringify(dismissedReport.json));
    assert.equal(dismissedRow.status, "DISMISSED");
    assert.equal(dismissedRow.reviewState, "REVIEWED");
    assert.ok(dismissedRow.reviewedAt);

    const dismissReplay = await fetchJson(
      `/api/reports/reminder-candidates/${candidate.id}/dismiss`,
      {
        method: "POST",
        headers: MANAGER_HEADERS,
      },
    );
    assert.equal(dismissReplay.status, 200, JSON.stringify(dismissReplay.json));
    assert.equal(dismissReplay.json.idempotent, true);

    console.log("[m128-smoke] reminder candidate controls passed");
  } finally {
    await cleanup(state);
    await prisma.$disconnect();
    await serverController.stop();
  }
};

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
