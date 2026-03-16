#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { ensureMainLocationId } = require("./default_location_helper");
const { createSmokeServerController } = require("./smoke_server_helper");

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
const serverController = createSmokeServerController({
  label: "m123-smoke",
  baseUrl: BASE_URL,
  databaseUrl: DATABASE_URL,
});

const RUN_REF = `m123_${Date.now()}`;
const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": `m123-manager-${RUN_REF}`,
  "Content-Type": "application/json",
};

const fetchJson = async (path) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: MANAGER_HEADERS,
  });
  const json = await response.json();
  return { status: response.status, json };
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
  try {
    await serverController.startIfNeeded();

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
    assert.equal(after.json.readyForCollectionCount, before.json.readyForCollectionCount);
    assert.equal(after.json.completedJobsLast7Days, before.json.completedJobsLast7Days + 2);
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
    assert.ok(after.json.averageOpenJobAgeDays === null || after.json.averageOpenJobAgeDays >= 0);
    assert.ok(after.json.averageCompletionDays === null || after.json.averageCompletionDays >= 0);
    assert.ok(after.json.longestOpenJobDays === null || after.json.longestOpenJobDays >= 0);
    if (after.json.averageOpenJobAgeDays !== null && after.json.longestOpenJobDays !== null) {
      assert.ok(after.json.longestOpenJobDays >= after.json.averageOpenJobAgeDays);
    }

    console.log("[m123-smoke] workshop capacity report passed");
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
