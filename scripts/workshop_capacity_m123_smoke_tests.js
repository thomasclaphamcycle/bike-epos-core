#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { ensureMainLocationId } = require("./default_location_helper");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const HEALTH_URL = `${BASE_URL}/health`;
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

const RUN_REF = `m123_${Date.now()}`;
const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": `m123-manager-${RUN_REF}`,
  "Content-Type": "application/json",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchJson = async (path) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: MANAGER_HEADERS,
  });
  const json = await response.json();
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
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await serverIsHealthy()) {
      return;
    }
    await sleep(500);
  }
  throw new Error("Server did not become healthy on /health");
};

const daysAgo = (days) => {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() - days);
  return value;
};

const cleanup = async (state) => {
  if (state.workshopJobIds.length) {
    await prisma.workshopJob.deleteMany({
      where: { id: { in: state.workshopJobIds } },
    });
  }
};

const main = async () => {
  const state = { workshopJobIds: [] };
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
      startedServer = true;
      await waitForServer();
    }

    const locationId = await ensureMainLocationId(prisma);
    const before = await fetchJson("/api/reports/workshop/capacity");
    assert.equal(before.status, 200);

    const jobs = await Promise.all([
      prisma.workshopJob.create({
        data: {
          locationId,
          customerName: `M123 Fresh ${RUN_REF}`,
          bikeDescription: "Fresh queue job",
          status: "BOOKING_MADE",
          createdAt: daysAgo(1),
        },
      }),
      prisma.workshopJob.create({
        data: {
          locationId,
          customerName: `M123 Approval ${RUN_REF}`,
          bikeDescription: "Approval queue job",
          status: "WAITING_FOR_APPROVAL",
          createdAt: daysAgo(5),
        },
      }),
      prisma.workshopJob.create({
        data: {
          locationId,
          customerName: `M123 Parts ${RUN_REF}`,
          bikeDescription: "Parts queue job",
          status: "WAITING_FOR_PARTS",
          createdAt: daysAgo(10),
        },
      }),
      prisma.workshopJob.create({
        data: {
          locationId,
          customerName: `M123 Old ${RUN_REF}`,
          bikeDescription: "Old open job",
          status: "APPROVED",
          createdAt: daysAgo(20),
        },
      }),
      prisma.workshopJob.create({
        data: {
          locationId,
          customerName: `M123 Completed A ${RUN_REF}`,
          bikeDescription: "Completed recently",
          status: "COMPLETED",
          createdAt: daysAgo(3),
          completedAt: daysAgo(1),
        },
      }),
      prisma.workshopJob.create({
        data: {
          locationId,
          customerName: `M123 Completed B ${RUN_REF}`,
          bikeDescription: "Completed recently",
          status: "COMPLETED",
          createdAt: daysAgo(8),
          completedAt: daysAgo(5),
        },
      }),
      prisma.workshopJob.create({
        data: {
          locationId,
          customerName: `M123 Completed C ${RUN_REF}`,
          bikeDescription: "Completed recently",
          status: "COMPLETED",
          createdAt: daysAgo(23),
          completedAt: daysAgo(20),
        },
      }),
      prisma.workshopJob.create({
        data: {
          locationId,
          customerName: `M123 Completed Old ${RUN_REF}`,
          bikeDescription: "Completed outside lookback",
          status: "COMPLETED",
          createdAt: daysAgo(45),
          completedAt: daysAgo(40),
        },
      }),
    ]);

    state.workshopJobIds.push(...jobs.map((job) => job.id));

    const after = await fetchJson("/api/reports/workshop/capacity");
    assert.equal(after.status, 200);

    assert.equal(after.json.openJobCount, before.json.openJobCount + 4);
    assert.equal(after.json.waitingForApprovalCount, before.json.waitingForApprovalCount + 1);
    assert.equal(after.json.waitingForPartsCount, before.json.waitingForPartsCount + 1);
    assert.equal(after.json.completedJobsLast30Days, before.json.completedJobsLast30Days + 3);

    assert.equal(after.json.ageingBuckets.zeroToTwoDays, before.json.ageingBuckets.zeroToTwoDays + 1);
    assert.equal(after.json.ageingBuckets.threeToSevenDays, before.json.ageingBuckets.threeToSevenDays + 1);
    assert.equal(after.json.ageingBuckets.eightToFourteenDays, before.json.ageingBuckets.eightToFourteenDays + 1);
    assert.equal(after.json.ageingBuckets.fifteenPlusDays, before.json.ageingBuckets.fifteenPlusDays + 1);

    assert.equal(
      after.json.averageCompletedPerDay,
      Number((after.json.completedJobsLast30Days / after.json.lookbackDays).toFixed(1)),
    );
    assert.equal(
      after.json.estimatedBacklogDays,
      after.json.averageCompletedPerDay > 0
        ? Number((after.json.openJobCount / after.json.averageCompletedPerDay).toFixed(1))
        : null,
    );

    console.log("[m123-smoke] workshop capacity report passed");
  } finally {
    await cleanup(state);
    await prisma.$disconnect();
    if (startedServer && serverProcess) {
      serverProcess.kill("SIGTERM");
    }
  }
};

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
