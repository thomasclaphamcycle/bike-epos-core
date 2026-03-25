import { Prisma, WorkshopJobSource, WorkshopJobStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { getWorkshopJobPartsOverview } from "./workshopPartService";
import { getWorkshopStaffingToday } from "./rotaService";
import { parseWorkshopRawStatusAlias } from "./workshopStatusService";

type WorkshopDashboardInput = {
  staffDate?: string;
  status?: string;
  source?: string;
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
  includeCancelled?: string;
  assignedTo?: string;
  unassigned?: string;
  hasNotes?: string;
};

type WorkshopCapacityStatus =
  | "CLOSED"
  | "NO_COVER"
  | "LIGHT"
  | "NORMAL"
  | "BUSY"
  | "OVERLOADED";

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

const VALID_STATUSES: WorkshopJobStatus[] = [
  "BOOKED",
  "BIKE_ARRIVED",
  "IN_PROGRESS",
  "WAITING_FOR_APPROVAL",
  "WAITING_FOR_PARTS",
  "ON_HOLD",
  "READY_FOR_COLLECTION",
  "COMPLETED",
  "CANCELLED",
];

const VALID_SOURCES: WorkshopJobSource[] = ["ONLINE", "IN_STORE"];
const CAPACITY_OPEN_JOB_STATUSES: WorkshopJobStatus[] = [
  "BOOKED",
  "BIKE_ARRIVED",
  "IN_PROGRESS",
  "WAITING_FOR_APPROVAL",
  "WAITING_FOR_PARTS",
  "ON_HOLD",
  "READY_FOR_COLLECTION",
];
const CAPACITY_ACTIVE_WORKLOAD_STATUSES: WorkshopJobStatus[] = [
  "IN_PROGRESS",
  "WAITING_FOR_PARTS",
  "ON_HOLD",
  "READY_FOR_COLLECTION",
];
const WORKSHOP_STAFFING_FOUNDATION_TABLES = [
  "public.appconfig",
  "public.rotaassignment",
  "public.rotaclosedday",
  "public.rotaperiod",
  "public.rotatemplate",
  "public.rotatemplateassignment",
];

const normalizeText = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseCsvParam = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
};

const parseDateOnlyStartOrThrow = (value: string, field: "from" | "to") => {
  if (!DATE_ONLY_REGEX.test(value)) {
    throw new HttpError(400, `${field} must be YYYY-MM-DD`, "INVALID_DATE");
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${field} is invalid`, "INVALID_DATE");
  }
  return date;
};

const getUtcDayBounds = (targetDateValue?: string) => {
  if (targetDateValue) {
    const dayStart = parseDateOnlyStartOrThrow(targetDateValue, "from");
    const nextDayStart = new Date(dayStart);
    nextDayStart.setUTCDate(nextDayStart.getUTCDate() + 1);
    return { dayStart, nextDayStart };
  }

  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const nextDayStart = new Date(dayStart);
  nextDayStart.setUTCDate(nextDayStart.getUTCDate() + 1);
  return { dayStart, nextDayStart };
};

const endOfDateUtc = (dayStart: Date) => {
  const end = new Date(dayStart);
  end.setUTCHours(23, 59, 59, 999);
  return end;
};

const parseStatusFilterOrThrow = (value: string | undefined): WorkshopJobStatus[] => {
  const statuses = parseCsvParam(value);
  if (statuses.length === 0) {
    return [];
  }

  const normalized = new Set<WorkshopJobStatus>();
  for (const status of statuses) {
    const resolved = parseWorkshopRawStatusAlias(status);
    if (!resolved || !VALID_STATUSES.includes(resolved)) {
      throw new HttpError(400, `Invalid status filter: ${status}`, "INVALID_FILTER");
    }
    normalized.add(resolved);
  }

  return Array.from(normalized);
};

const parseSourceFilterOrThrow = (value: string | undefined): WorkshopJobSource[] => {
  const sources = parseCsvParam(value);
  if (sources.length === 0) {
    return [];
  }

  for (const source of sources) {
    if (!VALID_SOURCES.includes(source as WorkshopJobSource)) {
      throw new HttpError(400, `Invalid source filter: ${source}`, "INVALID_FILTER");
    }
  }

  return sources as WorkshopJobSource[];
};

const parseLimitOrThrow = (value: number | undefined) => {
  if (value === undefined) {
    return DEFAULT_LIMIT;
  }

  if (!Number.isInteger(value) || value <= 0 || value > MAX_LIMIT) {
    throw new HttpError(400, `limit must be an integer between 1 and ${MAX_LIMIT}`, "INVALID_FILTER");
  }

  return value;
};

const parseIncludeCancelled = (value: string | undefined): boolean => {
  if (value === undefined) {
    return false;
  }

  return value.toLowerCase() === "true";
};

const parseOptionalBooleanOrThrow = (
  value: string | undefined,
  field: string,
): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  throw new HttpError(400, `${field} must be true or false`, "INVALID_FILTER");
};

const buildCapacityBaseMetricsText = (metrics: {
  scheduledStaffCount: number;
  dueTodayJobs: number;
  overdueJobs: number;
  activeWorkloadJobs: number;
}) =>
  `${metrics.scheduledStaffCount} workshop staff scheduled, ${metrics.dueTodayJobs} job${metrics.dueTodayJobs === 1 ? "" : "s"} due today, ${metrics.overdueJobs} overdue, ${metrics.activeWorkloadJobs} active open job${metrics.activeWorkloadJobs === 1 ? "" : "s"}.`;

const isMissingWorkshopStaffingFoundationError = (error: unknown) => {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2021"
  ) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  if (!message.includes("does not exist")) {
    return false;
  }

  return WORKSHOP_STAFFING_FOUNDATION_TABLES.some((tableName) =>
    message.includes(tableName),
  );
};

const buildFallbackWorkshopStaffingToday = (
  staffDate?: string,
): Awaited<ReturnType<typeof getWorkshopStaffingToday>> => {
  const { dayStart } = getUtcDayBounds(staffDate);
  const date = staffDate ?? dayStart.toISOString().slice(0, 10);

  return {
    summary: {
      date,
      isClosed: false,
      closedReason: null,
      opensAt: null,
      closesAt: null,
      scheduledStaffCount: 0,
      holidayStaffCount: 0,
      totalScheduledStaffCount: 0,
      totalHolidayStaffCount: 0,
      coverageStatus: "none",
    },
    context: {
      usesOperationalRoleTags: false,
      fallbackToBroadStaffing: true,
    },
    scheduledStaff: [],
    holidayStaff: [],
  };
};

const getWorkshopStaffingTodaySafely = async (
  staffDate?: string,
): Promise<Awaited<ReturnType<typeof getWorkshopStaffingToday>>> => {
  try {
    return await getWorkshopStaffingToday({ date: staffDate }, prisma);
  } catch (error) {
    if (!isMissingWorkshopStaffingFoundationError(error)) {
      throw error;
    }

    return buildFallbackWorkshopStaffingToday(staffDate);
  }
};

const isMissingWorkshopPartsFoundationError = (error: unknown) => {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2021" || error.code === "P2022")
  ) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.toLowerCase().includes("does not exist");
};

const getWorkshopJobPartsOverviewSafely = async (workshopJobId: string) => {
  if (!isUuid(workshopJobId)) {
    return null;
  }

  try {
    return await getWorkshopJobPartsOverview(workshopJobId);
  } catch (error) {
    if (
      (error instanceof HttpError && error.code === "INVALID_WORKSHOP_JOB_ID") ||
      isMissingWorkshopPartsFoundationError(error)
    ) {
      return null;
    }

    throw error;
  }
};

const deriveWorkshopCapacityToday = (input: {
  staffingToday: Awaited<ReturnType<typeof getWorkshopStaffingToday>>;
  dueTodayJobs: number;
  overdueJobs: number;
  openJobs: number;
  activeWorkloadJobs: number;
}) => {
  const { staffingToday, dueTodayJobs, overdueJobs, openJobs, activeWorkloadJobs } = input;
  const scheduledStaffCount = staffingToday.summary.scheduledStaffCount;
  const totalScheduledStaffCount = staffingToday.summary.totalScheduledStaffCount;
  const baseMetricsText = buildCapacityBaseMetricsText({
    scheduledStaffCount,
    dueTodayJobs,
    overdueJobs,
    activeWorkloadJobs,
  });

  if (staffingToday.summary.isClosed) {
    const closedReason = staffingToday.summary.closedReason ?? "Store closed today";
    return {
      status: "CLOSED" as WorkshopCapacityStatus,
      label: "Closed",
      explanation: `Store closed today: ${closedReason}.`,
      metrics: {
        scheduledStaffCount,
        totalScheduledStaffCount,
        dueTodayJobs,
        overdueJobs,
        openJobs,
        activeWorkloadJobs,
      },
    };
  }

  if (scheduledStaffCount === 0) {
    return {
      status: "NO_COVER" as WorkshopCapacityStatus,
      label: "No cover",
      explanation:
        dueTodayJobs > 0 || overdueJobs > 0 || activeWorkloadJobs > 0
          ? `No workshop cover is scheduled for today's queue. ${baseMetricsText}`
          : "No workshop cover is scheduled today.",
      metrics: {
        scheduledStaffCount,
        totalScheduledStaffCount,
        dueTodayJobs,
        overdueJobs,
        openJobs,
        activeWorkloadJobs,
      },
    };
  }

  const loadPressureScore =
    dueTodayJobs
    + overdueJobs * 2
    + Math.max(0, activeWorkloadJobs - scheduledStaffCount);

  if (
    overdueJobs >= Math.max(1, scheduledStaffCount * 2)
    || loadPressureScore >= scheduledStaffCount * 5
    || activeWorkloadJobs >= scheduledStaffCount * 6
  ) {
    return {
      status: "OVERLOADED" as WorkshopCapacityStatus,
      label: "Overloaded",
      explanation: `Due and overdue workshop work materially exceeds today's available cover. ${baseMetricsText}`,
      metrics: {
        scheduledStaffCount,
        totalScheduledStaffCount,
        dueTodayJobs,
        overdueJobs,
        openJobs,
        activeWorkloadJobs,
      },
    };
  }

  if (
    overdueJobs > 0
    || loadPressureScore >= scheduledStaffCount * 3
    || activeWorkloadJobs >= scheduledStaffCount * 4
  ) {
    return {
      status: "BUSY" as WorkshopCapacityStatus,
      label: "Busy",
      explanation: `Today's due and overdue queue is starting to outpace available cover. ${baseMetricsText}`,
      metrics: {
        scheduledStaffCount,
        totalScheduledStaffCount,
        dueTodayJobs,
        overdueJobs,
        openJobs,
        activeWorkloadJobs,
      },
    };
  }

  if (dueTodayJobs === 0 && overdueJobs === 0 && activeWorkloadJobs <= scheduledStaffCount) {
    return {
      status: "LIGHT" as WorkshopCapacityStatus,
      label: "Light",
      explanation: `Workshop cover is ahead of the current queue. ${baseMetricsText}`,
      metrics: {
        scheduledStaffCount,
        totalScheduledStaffCount,
        dueTodayJobs,
        overdueJobs,
        openJobs,
        activeWorkloadJobs,
      },
    };
  }

  return {
    status: "NORMAL" as WorkshopCapacityStatus,
    label: "Normal",
    explanation: `Workshop cover looks in step with today's queue. ${baseMetricsText}`,
    metrics: {
      scheduledStaffCount,
      totalScheduledStaffCount,
      dueTodayJobs,
      overdueJobs,
      openJobs,
      activeWorkloadJobs,
    },
  };
};

const buildDashboardWhere = (input: {
  statuses: WorkshopJobStatus[];
  sources: WorkshopJobSource[];
  fromDate?: Date;
  toDate?: Date;
  search?: string;
  includeCancelled: boolean;
  assignedTo?: string;
  unassigned?: boolean;
  hasNotes?: boolean;
}): Prisma.WorkshopJobWhereInput => {
  const where: Prisma.WorkshopJobWhereInput = {};

  if (input.statuses.length > 0) {
    where.status = { in: input.statuses };
  } else if (!input.includeCancelled) {
    where.status = { not: "CANCELLED" };
  }

  if (input.sources.length > 0) {
    where.source = { in: input.sources };
  }

  if (input.fromDate || input.toDate) {
    where.scheduledDate = {};
    if (input.fromDate) {
      where.scheduledDate.gte = input.fromDate;
    }
    if (input.toDate) {
      where.scheduledDate.lte = endOfDateUtc(input.toDate);
    }
  }

  if (input.search) {
    where.OR = [
      { notes: { contains: input.search, mode: "insensitive" } },
      { customer: { firstName: { contains: input.search, mode: "insensitive" } } },
      { customer: { lastName: { contains: input.search, mode: "insensitive" } } },
      { customer: { email: { contains: input.search, mode: "insensitive" } } },
      { customer: { phone: { contains: input.search, mode: "insensitive" } } },
    ];
  }

  if (input.assignedTo) {
    where.assignedStaffId = input.assignedTo;
  } else if (input.unassigned === true) {
    where.assignedStaffId = null;
  } else if (input.unassigned === false) {
    where.assignedStaffId = { not: null };
  }

  if (input.hasNotes === true) {
    where.jobNotes = { some: {} };
  } else if (input.hasNotes === false) {
    where.jobNotes = { none: {} };
  }

  return where;
};

export const getWorkshopDashboard = async (input: WorkshopDashboardInput) => {
  const statuses = parseStatusFilterOrThrow(input.status);
  const sources = parseSourceFilterOrThrow(input.source);
  const search = normalizeText(input.search);
  const limit = parseLimitOrThrow(input.limit);
  const includeCancelled = parseIncludeCancelled(input.includeCancelled);
  const assignedTo = normalizeText(input.assignedTo);
  const unassigned = parseOptionalBooleanOrThrow(input.unassigned, "unassigned");
  const hasNotes = parseOptionalBooleanOrThrow(input.hasNotes, "hasNotes");

  if (assignedTo && unassigned === true) {
    throw new HttpError(400, "assignedTo cannot be combined with unassigned=true", "INVALID_FILTER");
  }

  const from = normalizeText(input.from);
  const to = normalizeText(input.to);
  const fromDate = from ? parseDateOnlyStartOrThrow(from, "from") : undefined;
  const toDate = to ? parseDateOnlyStartOrThrow(to, "to") : undefined;

  if (fromDate && toDate && fromDate > toDate) {
    throw new HttpError(400, "from must be before or equal to to", "INVALID_DATE_RANGE");
  }

  const where = buildDashboardWhere({
    statuses,
    sources,
    fromDate,
    toDate,
    search,
    includeCancelled,
    assignedTo,
    unassigned,
    hasNotes,
  });

  const { dayStart, nextDayStart } = getUtcDayBounds(input.staffDate);
  const capacityWhere: Prisma.WorkshopJobWhereInput = {
    status: {
      in: CAPACITY_OPEN_JOB_STATUSES,
    },
  };

  const [
    jobs,
    totalJobs,
    statusCounts,
    sourceCounts,
    depositRequired,
    depositPaidCount,
    dueToday,
    overdue,
    staffingToday,
    openJobs,
    activeWorkloadJobs,
  ] =
    await Promise.all([
      prisma.workshopJob.findMany({
        where,
        orderBy: [{ scheduledDate: "asc" }, { createdAt: "desc" }],
        take: limit,
        include: {
          customer: true,
          sale: {
            select: {
              id: true,
              totalPence: true,
              createdAt: true,
            },
          },
        },
      }),
      prisma.workshopJob.count({ where }),
      prisma.workshopJob.groupBy({
        by: ["status"],
        where,
        _count: { _all: true },
      }),
      prisma.workshopJob.groupBy({
        by: ["source"],
        where,
        _count: { _all: true },
      }),
      prisma.workshopJob.aggregate({
        where: {
          ...where,
          depositRequiredPence: { gt: 0 },
        },
        _count: { _all: true },
        _sum: { depositRequiredPence: true },
      }),
      prisma.workshopJob.count({
        where: {
          ...where,
          depositRequiredPence: { gt: 0 },
          depositStatus: "PAID",
        },
      }),
      prisma.workshopJob.count({
        where: {
          ...capacityWhere,
          scheduledDate: {
            gte: dayStart,
            lt: nextDayStart,
          },
        },
      }),
      prisma.workshopJob.count({
        where: {
          ...capacityWhere,
          scheduledDate: {
            lt: dayStart,
          },
        },
      }),
      getWorkshopStaffingTodaySafely(input.staffDate),
      prisma.workshopJob.count({
        where: capacityWhere,
      }),
      prisma.workshopJob.count({
        where: {
          status: {
            in: CAPACITY_ACTIVE_WORKLOAD_STATUSES,
          },
        },
      }),
    ]);

  const noteAggregates =
    jobs.length > 0
      ? await prisma.workshopJobNote.groupBy({
          by: ["workshopJobId"],
          where: {
            workshopJobId: {
              in: jobs.map((job) => job.id),
            },
          },
          _count: { _all: true },
          _max: { createdAt: true },
        })
      : [];

  const noteSummaryByJobId = noteAggregates.reduce<
    Record<string, { count: number; lastNoteAt: Date | null }>
  >((acc, row) => {
    acc[row.workshopJobId] = {
      count: row._count._all,
      lastNoteAt: row._max.createdAt,
    };
    return acc;
  }, {});

  const statusSummary = VALID_STATUSES.reduce<Record<string, number>>((acc, status) => {
    acc[status] = 0;
    return acc;
  }, {});
  statusCounts.forEach((row) => {
    statusSummary[row.status] = row._count._all;
  });

  const sourceSummary = {
    ONLINE: 0,
    IN_STORE: 0,
  };
  sourceCounts.forEach((row) => {
    sourceSummary[row.source] = row._count._all;
  });

  const partsOverviewEntries = await Promise.all(
    jobs.map(async (job) => [job.id, await getWorkshopJobPartsOverviewSafely(job.id)] as const),
  );

  const partsOverviewByJobId = new Map(partsOverviewEntries);

  const capacityToday = deriveWorkshopCapacityToday({
    staffingToday,
    dueTodayJobs: dueToday,
    overdueJobs: overdue,
    openJobs,
    activeWorkloadJobs,
  });

  return {
    filters: {
      status: statuses,
      source: sources,
      from: from ?? null,
      to: to ?? null,
      search: search ?? null,
      includeCancelled,
      assignedTo: assignedTo ?? null,
      unassigned: unassigned ?? null,
      hasNotes: hasNotes ?? null,
      limit,
    },
    summary: {
      totalJobs,
      dueToday,
      overdue,
      byStatus: statusSummary,
      bySource: sourceSummary,
      deposits: {
        requiredCount: depositRequired._count._all,
        requiredAmountPence: depositRequired._sum.depositRequiredPence ?? 0,
        paidCount: depositPaidCount,
        unpaidCount: Math.max(0, depositRequired._count._all - depositPaidCount),
      },
    },
    staffingToday,
    capacityToday,
    jobs: jobs.map((job) => {
      const partsOverview = partsOverviewByJobId.get(job.id);
      return {
      id: job.id,
      status: job.status,
      source: job.source,
      finalizedBasketId: job.finalizedBasketId,
      scheduledDate: job.scheduledDate,
      notes: job.notes,
      depositRequiredPence: job.depositRequiredPence,
      depositStatus: job.depositStatus,
      assignedStaffId: job.assignedStaffId,
      assignedStaffName: job.assignedStaffName,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      cancelledAt: job.cancelledAt,
      noteCount: noteSummaryByJobId[job.id]?.count ?? 0,
      lastNoteAt: noteSummaryByJobId[job.id]?.lastNoteAt ?? null,
      customer: job.customer
        ? {
            id: job.customer.id,
            firstName: job.customer.firstName,
            lastName: job.customer.lastName,
            email: job.customer.email,
            phone: job.customer.phone,
          }
        : null,
      sale: job.sale,
      partsStatus: partsOverview?.summary.partsStatus ?? "OK",
      partsSummary: partsOverview?.summary ?? null,
      };
    }),
  };
};
