#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { ensureMainLocationId } = require("./default_location_helper");
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

const toIsoDate = (value) => value.toISOString().slice(0, 10);

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
    const analyticsFrom = toIsoDate(daysAgo(29));
    const analyticsTo = toIsoDate(new Date());
    const before = await fetchJson("/api/reports/workshop/capacity");
    const beforeAnalytics = await fetchJson(`/api/reports/workshop/analytics?from=${analyticsFrom}&to=${analyticsTo}`);
    assert.equal(before.status, 200);
    assert.equal(beforeAnalytics.status, 200);

    const techAName = `M123 Tech A ${RUN_REF}`;
    const techBName = `M123 Tech B ${RUN_REF}`;

    const jobs = await Promise.all([
      prisma.workshopJob.create({
        data: {
          locationId,
          customerName: `M123 Approval ${RUN_REF}`,
          bikeDescription: "Approval queue job",
          status: "WAITING_FOR_APPROVAL",
          createdAt: daysAgo(5),
          assignedStaffName: techAName,
        },
      }),
      prisma.workshopJob.create({
        data: {
          locationId,
          customerName: `M123 Parts ${RUN_REF}`,
          bikeDescription: "Parts queue job",
          status: "WAITING_FOR_PARTS",
          createdAt: daysAgo(10),
          assignedStaffName: techAName,
        },
      }),
      prisma.workshopJob.create({
        data: {
          locationId,
          customerName: `M123 Ready ${RUN_REF}`,
          bikeDescription: "Ready for collection job",
          status: "READY_FOR_COLLECTION",
          createdAt: daysAgo(4),
          assignedStaffName: techBName,
        },
      }),
      prisma.workshopJob.create({
        data: {
          locationId,
          customerName: `M123 Overdue ${RUN_REF}`,
          bikeDescription: "Old open job",
          status: "IN_PROGRESS",
          createdAt: daysAgo(20),
          scheduledDate: daysAgo(1),
          assignedStaffName: techBName,
        },
      }),
      prisma.workshopJob.create({
        data: {
          locationId,
          customerName: `M123 Completed Closed ${RUN_REF}`,
          bikeDescription: "Completed and collected",
          status: "COMPLETED",
          createdAt: daysAgo(6),
          completedAt: daysAgo(2),
          closedAt: daysAgo(1),
          assignedStaffName: techAName,
        },
      }),
      prisma.workshopJob.create({
        data: {
          locationId,
          customerName: `M123 Completed Open ${RUN_REF}`,
          bikeDescription: "Completed not closed",
          status: "COMPLETED",
          createdAt: daysAgo(8),
          completedAt: daysAgo(5),
          assignedStaffName: techBName,
        },
      }),
      prisma.workshopJob.create({
        data: {
          locationId,
          customerName: `M123 Completed Historical ${RUN_REF}`,
          bikeDescription: "Completed recently",
          status: "COMPLETED",
          createdAt: daysAgo(23),
          completedAt: daysAgo(20),
          assignedStaffName: techAName,
        },
      }),
      prisma.workshopJob.create({
        data: {
          locationId,
          customerName: `M123 Rejected ${RUN_REF}`,
          bikeDescription: "Quote rejected",
          status: "CANCELLED",
          createdAt: daysAgo(7),
        },
      }),
      prisma.workshopJob.create({
        data: {
          locationId,
          customerName: `M123 Superseded ${RUN_REF}`,
          bikeDescription: "Superseded quote history",
          status: "COMPLETED",
          createdAt: daysAgo(15),
          completedAt: daysAgo(12),
          assignedStaffName: techAName,
        },
      }),
    ]);

    state.workshopJobIds.push(...jobs.map((job) => job.id));

    const [
      approvalJob,
      partsJob,
      readyJob,
      overdueJob,
      completedClosedJob,
      completedOpenJob,
      completedHistoricalJob,
      rejectedJob,
      supersededJob,
    ] = jobs;

    await prisma.workshopEstimate.createMany({
      data: [
        {
          workshopJobId: approvalJob.id,
          version: 1,
          status: "PENDING_APPROVAL",
          requestedAt: daysAgo(4),
        },
        {
          workshopJobId: completedClosedJob.id,
          version: 1,
          status: "APPROVED",
          requestedAt: daysAgo(5),
          approvedAt: daysAgo(4),
        },
        {
          workshopJobId: rejectedJob.id,
          version: 1,
          status: "REJECTED",
          requestedAt: daysAgo(6),
          rejectedAt: daysAgo(5),
        },
        {
          workshopJobId: supersededJob.id,
          version: 1,
          status: "SUPERSEDED",
          requestedAt: daysAgo(9),
          supersededAt: daysAgo(8),
        },
      ],
    });

    const after = await fetchJson("/api/reports/workshop/capacity");
    const afterAnalytics = await fetchJson(`/api/reports/workshop/analytics?from=${analyticsFrom}&to=${analyticsTo}`);
    assert.equal(after.status, 200);
    assert.equal(afterAnalytics.status, 200);

    assert.equal(after.json.openJobCount, before.json.openJobCount + 4);
    assert.equal(after.json.waitingForApprovalCount, before.json.waitingForApprovalCount + 1);
    assert.equal(after.json.waitingForPartsCount, before.json.waitingForPartsCount + 1);
    assert.equal(after.json.readyForCollectionCount, before.json.readyForCollectionCount + 1);
    assert.equal(after.json.completedJobsLast7Days, before.json.completedJobsLast7Days + 2);
    assert.equal(after.json.completedJobsLast30Days, before.json.completedJobsLast30Days + 4);

    assert.equal(after.json.ageingBuckets.zeroToTwoDays, before.json.ageingBuckets.zeroToTwoDays);
    assert.equal(after.json.ageingBuckets.threeToSevenDays, before.json.ageingBuckets.threeToSevenDays + 2);
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

    assert.equal(
      afterAnalytics.json.turnaround.createdToCompleted.count,
      beforeAnalytics.json.turnaround.createdToCompleted.count + 4,
    );
    assert.equal(
      afterAnalytics.json.turnaround.createdToClosed.count,
      beforeAnalytics.json.turnaround.createdToClosed.count + 1,
    );
    assert.equal(
      afterAnalytics.json.turnaround.approvalDecision.count,
      beforeAnalytics.json.turnaround.approvalDecision.count + 2,
    );

    assert.equal(
      afterAnalytics.json.quoteConversion.requestedCount,
      beforeAnalytics.json.quoteConversion.requestedCount + 4,
    );
    assert.equal(
      afterAnalytics.json.quoteConversion.approvedCount,
      beforeAnalytics.json.quoteConversion.approvedCount + 1,
    );
    assert.equal(
      afterAnalytics.json.quoteConversion.rejectedCount,
      beforeAnalytics.json.quoteConversion.rejectedCount + 1,
    );
    assert.equal(
      afterAnalytics.json.quoteConversion.pendingCount,
      beforeAnalytics.json.quoteConversion.pendingCount + 1,
    );
    assert.equal(
      afterAnalytics.json.quoteConversion.supersededCount,
      beforeAnalytics.json.quoteConversion.supersededCount + 1,
    );

    assert.equal(
      afterAnalytics.json.currentQueue.openJobCount,
      beforeAnalytics.json.currentQueue.openJobCount + 4,
    );
    assert.equal(
      afterAnalytics.json.currentQueue.waitingForApprovalCount,
      beforeAnalytics.json.currentQueue.waitingForApprovalCount + 1,
    );
    assert.equal(
      afterAnalytics.json.currentQueue.waitingForPartsCount,
      beforeAnalytics.json.currentQueue.waitingForPartsCount + 1,
    );
    assert.equal(
      afterAnalytics.json.currentQueue.readyForCollectionCount,
      beforeAnalytics.json.currentQueue.readyForCollectionCount + 1,
    );
    assert.equal(
      afterAnalytics.json.currentQueue.overdueCount,
      beforeAnalytics.json.currentQueue.overdueCount + 1,
    );

    const techARow = afterAnalytics.json.technicianThroughput.rows.find((row) => row.staffName === techAName);
    assert.ok(techARow, JSON.stringify(afterAnalytics.json.technicianThroughput.rows));
    assert.equal(techARow.completedJobs, 3);
    assert.equal(techARow.activeJobs, 2);
    assert.equal(techARow.waitingForApprovalJobs, 1);
    assert.equal(techARow.waitingForPartsJobs, 1);

    const techBRow = afterAnalytics.json.technicianThroughput.rows.find((row) => row.staffName === techBName);
    assert.ok(techBRow, JSON.stringify(afterAnalytics.json.technicianThroughput.rows));
    assert.equal(techBRow.completedJobs, 1);
    assert.equal(techBRow.activeJobs, 2);
    assert.equal(techBRow.readyForCollectionJobs, 1);

    const approvalStalled = afterAnalytics.json.stalledJobs.rows.find((row) => row.jobId === approvalJob.id);
    assert.ok(approvalStalled, JSON.stringify(afterAnalytics.json.stalledJobs.rows));
    assert.equal(approvalStalled.stallReason, "Waiting for customer approval");

    const overdueStalled = afterAnalytics.json.stalledJobs.rows.find((row) => row.jobId === overdueJob.id);
    assert.ok(
      overdueStalled || afterAnalytics.json.stalledJobs.rows.some((row) => row.stallReason === "Past scheduled date"),
      JSON.stringify(afterAnalytics.json.stalledJobs.rows),
    );
    if (overdueStalled) {
      assert.equal(overdueStalled.stallReason, "Past scheduled date");
    }

    console.log("[m123-smoke] workshop capacity and analytics reports passed");
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
