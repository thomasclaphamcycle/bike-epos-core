import { Prisma, WorkshopJobStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../utils/http";
import { getStoreLocaleSettings } from "../configurationService";
import {
  OPEN_WORKSHOP_STATUSES,
  addDaysUtc,
  getDateRangeOrThrow,
  listDateKeys,
  toCustomerDisplayName,
  toInteger,
  toPositiveIntWithinRangeOrThrow,
} from "./shared";

export const getWorkshopDailyReport = async (from?: string, to?: string, locationId?: string) => {
  const range = getDateRangeOrThrow(from, to);
  const { timeZone } = await getStoreLocaleSettings();
  const days = listDateKeys(range.from, range.to);
  const workshopLocationFilter = locationId
    ? Prisma.sql`AND w."locationId" = ${locationId}`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<Array<{ date: string; jobCount: number; revenuePence: number }>>`
    SELECT
      to_char((w."completedAt" AT TIME ZONE ${timeZone})::date, 'YYYY-MM-DD') AS "date",
      COUNT(*)::int AS "jobCount",
      COALESCE(SUM(s."totalPence"), 0)::bigint AS "revenuePence"
    FROM "WorkshopJob" w
    LEFT JOIN "Sale" s ON s."workshopJobId" = w.id
    WHERE
      w.status = 'COMPLETED'
      AND w."completedAt" IS NOT NULL
      AND (w."completedAt" AT TIME ZONE ${timeZone})::date BETWEEN ${range.from}::date AND ${range.to}::date
      ${workshopLocationFilter}
    GROUP BY "date"
    ORDER BY "date" ASC
  `;

  const byDate = new Map(
    rows.map((row) => [
      row.date,
      {
        jobCount: toInteger(row.jobCount),
        revenuePence: toInteger(row.revenuePence),
      },
    ]),
  );

  return days.map((date) => {
    const row = byDate.get(date);
    return {
      date,
      jobCount: row?.jobCount ?? 0,
      revenuePence: row?.revenuePence ?? 0,
    };
  });
};

const WORKSHOP_CAPACITY_LOOKBACK_DAYS = 30;
const WORKSHOP_CAPACITY_OPEN_STATUSES = OPEN_WORKSHOP_STATUSES;
const WORKSHOP_ANALYTICS_STALLED_JOB_LIMIT = 20;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

type WorkshopAnalyticsSeverity = "INFO" | "WARNING" | "CRITICAL";

type WorkshopAnalyticsDurationMetric = {
  count: number;
  averageDays: number | null;
  medianDays: number | null;
};

type WorkshopAnalyticsHoursMetric = {
  count: number;
  averageHours: number | null;
  medianHours: number | null;
};

type WorkshopAnalyticsJobRow = {
  id: string;
  status: WorkshopJobStatus;
  customerName: string | null;
  bikeDescription: string | null;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  scheduledDate: Date | null;
  scheduledStartAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  closedAt: Date | null;
  customer: {
    name: string | null;
    firstName: string;
    lastName: string;
  } | null;
};

type WorkshopAnalyticsEstimateRow = {
  id: string;
  workshopJobId: string;
  version: number;
  status: string;
  requestedAt: Date | null;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  supersededAt: Date | null;
};

const roundToOneDecimal = (value: number) => Number(value.toFixed(1));

const differenceInDays = (from: Date, to: Date) =>
  Math.max(0, (to.getTime() - from.getTime()) / DAY_MS);

const differenceInWholeDays = (from: Date, to: Date) =>
  Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));

const differenceInHours = (from: Date, to: Date) =>
  Math.max(0, (to.getTime() - from.getTime()) / HOUR_MS);

const median = (values: number[]) => {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return roundToOneDecimal(sorted[middle] ?? 0);
  }

  return roundToOneDecimal(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
};

const average = (values: number[]) => {
  if (values.length === 0) {
    return null;
  }

  return roundToOneDecimal(values.reduce((sum, value) => sum + value, 0) / values.length);
};

const getDurationMetric = (values: number[]): WorkshopAnalyticsDurationMetric => ({
  count: values.length,
  averageDays: average(values),
  medianDays: median(values),
});

const getHoursMetric = (values: number[]): WorkshopAnalyticsHoursMetric => ({
  count: values.length,
  averageHours: average(values),
  medianHours: median(values),
});

const dateKeyFormatterCache = new Map<string, Intl.DateTimeFormat>();

const getDateKeyFormatter = (timeZone: string) => {
  const cached = dateKeyFormatterCache.get(timeZone);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  dateKeyFormatterCache.set(timeZone, formatter);
  return formatter;
};

const getDateKeyInTimeZone = (timeZone: string, value: Date) =>
  getDateKeyFormatter(timeZone).format(value);

const isDateKeyInRange = (dateKey: string, from: string, to: string) =>
  dateKey >= from && dateKey <= to;

const getWorkshopCustomerName = (job: WorkshopAnalyticsJobRow) => {
  const explicit = job.customerName?.trim();
  if (explicit) {
    return explicit;
  }

  if (job.customer) {
    return toCustomerDisplayName(job.customer);
  }

  return "-";
};

const getWorkshopAssigneeKey = (job: {
  assignedStaffId: string | null;
  assignedStaffName: string | null;
}) => {
  if (job.assignedStaffId) {
    return job.assignedStaffId;
  }

  const name = job.assignedStaffName?.trim();
  if (name) {
    return `named:${name.toLowerCase()}`;
  }

  return "unassigned";
};

const incrementCount = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

const toDateKeyAge = (earlierDateKey: string, laterDateKey: string) => {
  const earlier = new Date(`${earlierDateKey}T00:00:00.000Z`);
  const later = new Date(`${laterDateKey}T00:00:00.000Z`);
  return differenceInWholeDays(earlier, later);
};

const getOpenJobAgeingBuckets = (jobs: WorkshopAnalyticsJobRow[], now: Date) => {
  const buckets = {
    zeroToTwoDays: 0,
    threeToSevenDays: 0,
    eightToFourteenDays: 0,
    fifteenToThirtyDays: 0,
    thirtyOnePlusDays: 0,
  };

  for (const job of jobs) {
    const ageDays = differenceInWholeDays(job.createdAt, now);
    if (ageDays <= 2) {
      buckets.zeroToTwoDays += 1;
    } else if (ageDays <= 7) {
      buckets.threeToSevenDays += 1;
    } else if (ageDays <= 14) {
      buckets.eightToFourteenDays += 1;
    } else if (ageDays <= 30) {
      buckets.fifteenToThirtyDays += 1;
    } else {
      buckets.thirtyOnePlusDays += 1;
    }
  }

  return buckets;
};

const getStalledJobSeverity = (reason: string, ageDays: number, stageAgeDays: number | null): WorkshopAnalyticsSeverity => {
  if (reason === "Waiting for customer approval") {
    if ((stageAgeDays ?? 0) >= 7) {
      return "CRITICAL";
    }
    if ((stageAgeDays ?? 0) >= 3) {
      return "WARNING";
    }
    return "INFO";
  }

  if (reason === "Waiting for parts" || reason === "Paused / on hold") {
    if ((stageAgeDays ?? 0) >= 7) {
      return "CRITICAL";
    }
    if ((stageAgeDays ?? 0) >= 3) {
      return "WARNING";
    }
    return "INFO";
  }

  if (reason === "Ready for collection") {
    if ((stageAgeDays ?? 0) >= 7) {
      return "CRITICAL";
    }
    if ((stageAgeDays ?? 0) >= 2) {
      return "WARNING";
    }
    return "INFO";
  }

  if (reason === "Past scheduled date") {
    if ((stageAgeDays ?? 0) >= 7) {
      return "CRITICAL";
    }
    return "WARNING";
  }

  if (ageDays >= 30) {
    return "CRITICAL";
  }

  return "WARNING";
};

export const getWorkshopCapacityReport = async () => {
  const now = new Date();
  const completedFrom = new Date(now);
  completedFrom.setUTCDate(completedFrom.getUTCDate() - (WORKSHOP_CAPACITY_LOOKBACK_DAYS - 1));
  completedFrom.setUTCHours(0, 0, 0, 0);
  const completedFrom7Days = new Date(now);
  completedFrom7Days.setUTCDate(completedFrom7Days.getUTCDate() - 6);
  completedFrom7Days.setUTCHours(0, 0, 0, 0);

  const jobs = await prisma.workshopJob.findMany({
    select: {
      status: true,
      createdAt: true,
      completedAt: true,
    },
  });

  const openJobs = jobs.filter((job) => WORKSHOP_CAPACITY_OPEN_STATUSES.has(job.status));
  const waitingForApprovalCount = openJobs.filter((job) => job.status === "WAITING_FOR_APPROVAL").length;
  const waitingForPartsCount = openJobs.filter((job) => job.status === "WAITING_FOR_PARTS").length;
  const readyForCollectionCount = openJobs.filter((job) => job.status === "READY_FOR_COLLECTION").length;
  const completedJobsInLookback = jobs.filter((job) => (
    job.completedAt !== null
    && job.completedAt >= completedFrom
    && job.completedAt <= now
  ));
  const completedJobsLast30Days = completedJobsInLookback.length;
  const completedJobsLast7Days = jobs.filter((job) => (
    job.completedAt !== null
    && job.completedAt >= completedFrom7Days
    && job.completedAt <= now
  )).length;
  const averageCompletedPerDay = Number((completedJobsLast30Days / WORKSHOP_CAPACITY_LOOKBACK_DAYS).toFixed(1));
  const estimatedBacklogDays = averageCompletedPerDay > 0
    ? Number((openJobs.length / averageCompletedPerDay).toFixed(1))
    : null;
  const averageCompletionDays = completedJobsInLookback.length > 0
    ? Number((
      completedJobsInLookback.reduce((sum, job) => (
        sum + Math.max(0, (job.completedAt!.getTime() - job.createdAt.getTime()) / 86_400_000)
      ), 0) / completedJobsInLookback.length
    ).toFixed(1))
    : null;

  const ageingBuckets = {
    zeroToTwoDays: 0,
    threeToSevenDays: 0,
    eightToFourteenDays: 0,
    fifteenPlusDays: 0,
  };
  let totalOpenJobAgeDays = 0;
  let longestOpenJobDays = 0;

  for (const job of openJobs) {
    const ageDays = Math.max(0, Math.floor((now.getTime() - job.createdAt.getTime()) / 86_400_000));
    totalOpenJobAgeDays += ageDays;
    longestOpenJobDays = Math.max(longestOpenJobDays, ageDays);
    if (ageDays <= 2) {
      ageingBuckets.zeroToTwoDays += 1;
    } else if (ageDays <= 7) {
      ageingBuckets.threeToSevenDays += 1;
    } else if (ageDays <= 14) {
      ageingBuckets.eightToFourteenDays += 1;
    } else {
      ageingBuckets.fifteenPlusDays += 1;
    }
  }

  const averageOpenJobAgeDays = openJobs.length > 0
    ? Number((totalOpenJobAgeDays / openJobs.length).toFixed(1))
    : null;

  return {
    generatedAt: now.toISOString(),
    lookbackDays: WORKSHOP_CAPACITY_LOOKBACK_DAYS,
    openJobCount: openJobs.length,
    waitingForApprovalCount,
    waitingForPartsCount,
    readyForCollectionCount,
    completedJobsLast7Days,
    completedJobsLast30Days,
    averageCompletedPerDay,
    estimatedBacklogDays,
    averageCompletionDays,
    averageOpenJobAgeDays,
    longestOpenJobDays: openJobs.length > 0 ? longestOpenJobDays : null,
    ageingBuckets,
  };
};

export const getWorkshopAnalyticsReport = async (from?: string, to?: string, locationId?: string) => {
  const range = getDateRangeOrThrow(from, to);
  const now = new Date();
  const { timeZone } = await getStoreLocaleSettings();
  const locationFilter = locationId ? { locationId } : undefined;

  const [jobs, estimates] = await Promise.all([
    prisma.workshopJob.findMany({
      where: locationFilter ?? {},
      select: {
        id: true,
        status: true,
        customerName: true,
        bikeDescription: true,
        assignedStaffId: true,
        assignedStaffName: true,
        scheduledDate: true,
        scheduledStartAt: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
        closedAt: true,
        customer: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    }) as Promise<WorkshopAnalyticsJobRow[]>,
    prisma.workshopEstimate.findMany({
      where: {
        requestedAt: { not: null },
        ...(locationId ? { workshopJob: { locationId } } : {}),
      },
      select: {
        id: true,
        workshopJobId: true,
        version: true,
        status: true,
        requestedAt: true,
        approvedAt: true,
        rejectedAt: true,
        supersededAt: true,
      },
    }) as Promise<WorkshopAnalyticsEstimateRow[]>,
  ]);

  const completedJobsInRange = jobs.filter((job) => (
    job.completedAt !== null
    && isDateKeyInRange(getDateKeyInTimeZone(timeZone, job.completedAt), range.from, range.to)
  ));
  const closedJobsInRange = jobs.filter((job) => (
    job.closedAt !== null
    && isDateKeyInRange(getDateKeyInTimeZone(timeZone, job.closedAt), range.from, range.to)
  ));

  const createdToCompletedDays = completedJobsInRange.map((job) =>
    differenceInDays(job.createdAt, job.completedAt!));
  const createdToClosedDays = closedJobsInRange.map((job) =>
    differenceInDays(job.createdAt, job.closedAt!));

  const requestedEstimatesInRange = estimates.filter((estimate) => (
    estimate.requestedAt !== null
    && isDateKeyInRange(getDateKeyInTimeZone(timeZone, estimate.requestedAt), range.from, range.to)
  ));
  const approvalDecisionHours = requestedEstimatesInRange
    .map((estimate) => {
      const decidedAt = estimate.approvedAt ?? estimate.rejectedAt;
      return estimate.requestedAt && decidedAt
        ? differenceInHours(estimate.requestedAt, decidedAt)
        : null;
    })
    .filter((value): value is number => value !== null);

  const approvedCount = requestedEstimatesInRange.filter((estimate) => estimate.status === "APPROVED").length;
  const rejectedCount = requestedEstimatesInRange.filter((estimate) => estimate.status === "REJECTED").length;
  const pendingEstimates = requestedEstimatesInRange.filter((estimate) => estimate.status === "PENDING_APPROVAL");
  const supersededCount = requestedEstimatesInRange.filter((estimate) => estimate.status === "SUPERSEDED").length;
  const pendingQuoteAgeDays = pendingEstimates
    .map((estimate) => estimate.requestedAt ? differenceInDays(estimate.requestedAt, now) : null)
    .filter((value): value is number => value !== null);

  const currentEstimateByJobId = new Map<string, WorkshopAnalyticsEstimateRow>();
  for (const estimate of estimates) {
    if (estimate.supersededAt !== null) {
      continue;
    }

    const existing = currentEstimateByJobId.get(estimate.workshopJobId);
    if (!existing || estimate.version > existing.version) {
      currentEstimateByJobId.set(estimate.workshopJobId, estimate);
    }
  }

  const openJobs = jobs.filter((job) => OPEN_WORKSHOP_STATUSES.has(job.status));
  const todayKey = getDateKeyInTimeZone(timeZone, now);
  const currentQueueByStatus: Record<string, number> = {};

  let dueTodayCount = 0;
  let overdueCount = 0;
  let unassignedCount = 0;
  let waitingForApprovalCount = 0;
  let waitingForPartsCount = 0;
  let pausedCount = 0;
  let readyForCollectionCount = 0;

  for (const job of openJobs) {
    incrementCount(currentQueueByStatus, job.status);

    if (!job.assignedStaffId && !job.assignedStaffName?.trim()) {
      unassignedCount += 1;
    }
    if (job.status === "WAITING_FOR_APPROVAL") {
      waitingForApprovalCount += 1;
    }
    if (job.status === "WAITING_FOR_PARTS") {
      waitingForPartsCount += 1;
    }
    if (job.status === "ON_HOLD") {
      pausedCount += 1;
    }
    if (job.status === "READY_FOR_COLLECTION") {
      readyForCollectionCount += 1;
    }

    const scheduledValue = job.scheduledStartAt ?? job.scheduledDate;
    if (!scheduledValue) {
      continue;
    }

    const scheduledDateKey = getDateKeyInTimeZone(timeZone, scheduledValue);
    if (scheduledDateKey === todayKey) {
      dueTodayCount += 1;
    } else if (scheduledDateKey < todayKey) {
      overdueCount += 1;
    }
  }

  const technicianRowsByKey = new Map<string, {
    technicianKey: string;
    staffId: string | null;
    staffName: string;
    completedJobs: number;
    activeJobs: number;
    waitingForApprovalJobs: number;
    waitingForPartsJobs: number;
    readyForCollectionJobs: number;
    completionDurations: number[];
  }>();

  const ensureTechnicianRow = (job: WorkshopAnalyticsJobRow) => {
    const technicianKey = getWorkshopAssigneeKey(job);
    const existing = technicianRowsByKey.get(technicianKey);
    if (existing) {
      return existing;
    }

    const row = {
      technicianKey,
      staffId: job.assignedStaffId,
      staffName: job.assignedStaffName?.trim() || "Unassigned",
      completedJobs: 0,
      activeJobs: 0,
      waitingForApprovalJobs: 0,
      waitingForPartsJobs: 0,
      readyForCollectionJobs: 0,
      completionDurations: [],
    };
    technicianRowsByKey.set(technicianKey, row);
    return row;
  };

  for (const job of completedJobsInRange) {
    const row = ensureTechnicianRow(job);
    row.completedJobs += 1;
    row.completionDurations.push(differenceInDays(job.createdAt, job.completedAt!));
  }

  for (const job of openJobs) {
    const row = ensureTechnicianRow(job);
    row.activeJobs += 1;
    if (job.status === "WAITING_FOR_APPROVAL") {
      row.waitingForApprovalJobs += 1;
    }
    if (job.status === "WAITING_FOR_PARTS") {
      row.waitingForPartsJobs += 1;
    }
    if (job.status === "READY_FOR_COLLECTION") {
      row.readyForCollectionJobs += 1;
    }
  }

  const technicianRows = Array.from(technicianRowsByKey.values())
    .map((row) => ({
      technicianKey: row.technicianKey,
      staffId: row.staffId,
      staffName: row.staffName,
      completedJobs: row.completedJobs,
      activeJobs: row.activeJobs,
      waitingForApprovalJobs: row.waitingForApprovalJobs,
      waitingForPartsJobs: row.waitingForPartsJobs,
      readyForCollectionJobs: row.readyForCollectionJobs,
      averageCompletionDays: average(row.completionDurations),
    }))
    .sort((left, right) => (
      right.completedJobs - left.completedJobs
      || right.activeJobs - left.activeJobs
      || left.staffName.localeCompare(right.staffName)
    ));

  const stalledRows = openJobs
    .map((job) => {
      const ageDays = differenceInWholeDays(job.createdAt, now);
      const scheduledValue = job.scheduledStartAt ?? job.scheduledDate;
      const scheduledDateKey = scheduledValue ? getDateKeyInTimeZone(timeZone, scheduledValue) : null;
      const overdueScheduledDays = scheduledDateKey && scheduledDateKey < todayKey
        ? toDateKeyAge(scheduledDateKey, todayKey)
        : 0;
      const currentEstimate = currentEstimateByJobId.get(job.id) ?? null;

      let stallReason: string | null = null;
      let stageAgeDays: number | null = null;
      let stageAgeBasis: "QUOTE_REQUESTED_AT" | "JOB_UPDATED_AT" | "JOB_CREATED_AT" | null = null;

      if (job.status === "WAITING_FOR_APPROVAL") {
        const stageStart = currentEstimate?.requestedAt ?? job.updatedAt;
        stallReason = "Waiting for customer approval";
        stageAgeDays = differenceInWholeDays(stageStart, now);
        stageAgeBasis = currentEstimate?.requestedAt ? "QUOTE_REQUESTED_AT" : "JOB_UPDATED_AT";
      } else if (job.status === "WAITING_FOR_PARTS") {
        stallReason = "Waiting for parts";
        stageAgeDays = differenceInWholeDays(job.updatedAt, now);
        stageAgeBasis = "JOB_UPDATED_AT";
      } else if (job.status === "ON_HOLD") {
        stallReason = "Paused / on hold";
        stageAgeDays = differenceInWholeDays(job.updatedAt, now);
        stageAgeBasis = "JOB_UPDATED_AT";
      } else if (job.status === "READY_FOR_COLLECTION") {
        stallReason = "Ready for collection";
        stageAgeDays = differenceInWholeDays(job.updatedAt, now);
        stageAgeBasis = "JOB_UPDATED_AT";
      } else if (overdueScheduledDays > 0) {
        stallReason = "Past scheduled date";
        stageAgeDays = overdueScheduledDays;
        stageAgeBasis = "JOB_CREATED_AT";
      } else if (ageDays >= 14) {
        stallReason = "Open longer than 14 days";
        stageAgeDays = ageDays;
        stageAgeBasis = "JOB_CREATED_AT";
      }

      if (!stallReason) {
        return null;
      }

      return {
        jobId: job.id,
        customerName: getWorkshopCustomerName(job),
        bikeDescription: job.bikeDescription,
        rawStatus: job.status,
        assignedStaffName: job.assignedStaffName?.trim() || null,
        scheduledDate: job.scheduledDate?.toISOString() ?? null,
        scheduledStartAt: job.scheduledStartAt?.toISOString() ?? null,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
        ageDays,
        stageAgeDays,
        stageAgeBasis,
        stallReason,
        severity: getStalledJobSeverity(stallReason, ageDays, stageAgeDays),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((left, right) => {
      const severityOrder: Record<WorkshopAnalyticsSeverity, number> = {
        CRITICAL: 0,
        WARNING: 1,
        INFO: 2,
      };

      return (
        severityOrder[left.severity] - severityOrder[right.severity]
        || (right.stageAgeDays ?? 0) - (left.stageAgeDays ?? 0)
        || right.ageDays - left.ageDays
        || left.customerName.localeCompare(right.customerName)
      );
    })
    .slice(0, WORKSHOP_ANALYTICS_STALLED_JOB_LIMIT);

  return {
    generatedAt: now.toISOString(),
    range: {
      from: range.from,
      to: range.to,
      dayCount: listDateKeys(range.from, range.to).length,
    },
    limitations: [
      "Technician throughput uses the current assigned technician on each job. CorePOS does not yet track labour attribution per technician line-by-line.",
      "Quote conversion is based on estimate versions requested in the selected range. Superseded quotes are tracked separately instead of being treated as approved or rejected.",
      "Blocked-stage age uses quote requested time for approval waits and last job update for waiting-for-parts, paused, and ready-for-collection states because exact stage-entry timestamps are not yet stored.",
    ],
    turnaround: {
      createdToCompleted: getDurationMetric(createdToCompletedDays),
      createdToClosed: getDurationMetric(createdToClosedDays),
      approvalDecision: getHoursMetric(approvalDecisionHours),
    },
    quoteConversion: {
      requestedCount: requestedEstimatesInRange.length,
      approvedCount,
      rejectedCount,
      pendingCount: pendingEstimates.length,
      supersededCount,
      conversionRate: requestedEstimatesInRange.length > 0
        ? roundToOneDecimal((approvedCount / requestedEstimatesInRange.length) * 100)
        : null,
      decisionRate: requestedEstimatesInRange.length > 0
        ? roundToOneDecimal(((approvedCount + rejectedCount) / requestedEstimatesInRange.length) * 100)
        : null,
      pendingAverageAgeDays: average(pendingQuoteAgeDays),
      oldestPendingAgeDays: pendingQuoteAgeDays.length > 0 ? Math.max(...pendingQuoteAgeDays) : null,
    },
    currentQueue: {
      openJobCount: openJobs.length,
      dueTodayCount,
      overdueCount,
      unassignedCount,
      waitingForApprovalCount,
      waitingForPartsCount,
      pausedCount,
      readyForCollectionCount,
      byStatus: currentQueueByStatus,
    },
    technicianThroughput: {
      completedJobCount: completedJobsInRange.length,
      activeAssignedJobCount: openJobs.filter((job) => Boolean(job.assignedStaffId || job.assignedStaffName?.trim())).length,
      unassignedOpenJobCount: unassignedCount,
      rows: technicianRows,
    },
    stalledJobs: {
      openJobCount: openJobs.length,
      stalledCount: stalledRows.length,
      olderThan14DaysCount: openJobs.filter((job) => differenceInWholeDays(job.createdAt, now) >= 14).length,
      ageingBuckets: getOpenJobAgeingBuckets(openJobs, now),
      rows: stalledRows,
    },
  };
};

type WarrantyTrackingStatus = "OPEN" | "FOLLOW_UP" | "RETURNED" | "RESOLVED";

const WARRANTY_STATUS_VALUES: WarrantyTrackingStatus[] = [
  "OPEN",
  "FOLLOW_UP",
  "RETURNED",
  "RESOLVED",
];

const parseWarrantyStatusFilterOrThrow = (status?: string) => {
  if (!status) {
    return undefined;
  }

  const normalized = status.trim().toUpperCase();
  if (!WARRANTY_STATUS_VALUES.includes(normalized as WarrantyTrackingStatus)) {
    throw new HttpError(400, "status must be OPEN, FOLLOW_UP, RETURNED, or RESOLVED", "INVALID_REPORT_FILTER");
  }

  return normalized as WarrantyTrackingStatus;
};

const parseWarrantyTaggedNote = (note: string) => {
  const match = note.match(/^\[WARRANTY:(OPEN|FOLLOW_UP|RETURNED|RESOLVED)\]\s*(.*)$/is);
  if (!match) {
    return null;
  }

  const [, rawStatus = "", rawDetail = ""] = match;
  return {
    status: rawStatus.toUpperCase() as WarrantyTrackingStatus,
    detail: rawDetail.trim(),
  };
};

export const getWorkshopWarrantyReport = async (
  status?: string,
  search?: string,
  take?: number,
) => {
  const resolvedStatus = parseWarrantyStatusFilterOrThrow(status);
  const resolvedTake = toPositiveIntWithinRangeOrThrow(take, "take", 1, 200, 100);
  const normalizedSearch = search?.trim().toLowerCase() || undefined;

  const taggedNotes = await prisma.workshopJobNote.findMany({
    where: {
      visibility: "INTERNAL",
      note: {
        contains: "[WARRANTY:",
        mode: "insensitive",
      },
    },
    orderBy: [{ createdAt: "desc" }],
    include: {
      workshopJob: {
        select: {
          id: true,
          status: true,
          customerId: true,
          customerName: true,
          bikeDescription: true,
          scheduledDate: true,
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
          sale: {
            select: {
              id: true,
              totalPence: true,
            },
          },
        },
      },
    },
  });

  const latestByJobId = new Map<string, {
    workshopJobId: string;
    status: WarrantyTrackingStatus;
    detail: string;
    noteId: string;
    noteCreatedAt: Date;
    noteCount: number;
    job: {
      id: string;
      status: WorkshopJobStatus;
      customerId: string | null;
      customerName: string | null;
      bikeDescription: string | null;
      scheduledDate: Date | null;
      customer: {
        id: string;
        firstName: string;
        lastName: string;
        email: string | null;
        phone: string | null;
      } | null;
      sale: {
        id: string;
        totalPence: number;
      } | null;
    };
  }>();

  for (const note of taggedNotes) {
    const parsed = parseWarrantyTaggedNote(note.note);
    if (!parsed) {
      continue;
    }

    const existing = latestByJobId.get(note.workshopJobId);
    if (!existing) {
      latestByJobId.set(note.workshopJobId, {
        workshopJobId: note.workshopJobId,
        status: parsed.status,
        detail: parsed.detail,
        noteId: note.id,
        noteCreatedAt: note.createdAt,
        noteCount: 1,
        job: note.workshopJob,
      });
      continue;
    }

    existing.noteCount += 1;
  }

  const filteredItems = Array.from(latestByJobId.values())
    .map((row) => {
      const customerName =
        row.job.customerName
        || (row.job.customer ? toCustomerDisplayName(row.job.customer) : null)
        || "-";

      return {
        workshopJobId: row.workshopJobId,
        rawStatus: row.job.status,
        customerId: row.job.customerId,
        customerName,
        customerEmail: row.job.customer?.email ?? null,
        customerPhone: row.job.customer?.phone ?? null,
        bikeDescription: row.job.bikeDescription,
        scheduledDate: row.job.scheduledDate,
        sale: row.job.sale,
        warrantyStatus: row.status,
        latestWarrantyNote: row.detail,
        latestWarrantyNoteId: row.noteId,
        latestWarrantyNoteAt: row.noteCreatedAt,
        noteCount: row.noteCount,
      };
    })
    .filter((row) => (resolvedStatus ? row.warrantyStatus === resolvedStatus : true))
    .filter((row) => {
      if (!normalizedSearch) {
        return true;
      }

      const haystack = [
        row.workshopJobId,
        row.customerName,
        row.customerEmail,
        row.customerPhone,
        row.bikeDescription,
        row.latestWarrantyNote,
        row.warrantyStatus,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    })
    .sort((left, right) => (
      new Date(right.latestWarrantyNoteAt).getTime() - new Date(left.latestWarrantyNoteAt).getTime()
      || left.customerName.localeCompare(right.customerName)
    ));

  const items = filteredItems.slice(0, resolvedTake);

  return {
    filters: {
      status: resolvedStatus ?? null,
      search: normalizedSearch ?? null,
      take: resolvedTake,
    },
    summary: {
      trackedJobCount: filteredItems.length,
      openCount: filteredItems.filter((row) => row.warrantyStatus === "OPEN").length,
      followUpCount: filteredItems.filter((row) => row.warrantyStatus === "FOLLOW_UP").length,
      returnedCount: filteredItems.filter((row) => row.warrantyStatus === "RETURNED").length,
      resolvedCount: filteredItems.filter((row) => row.warrantyStatus === "RESOLVED").length,
    },
    items,
  };
};
