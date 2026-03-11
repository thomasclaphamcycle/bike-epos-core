import { WorkshopJobStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../utils/http";
import {
  OPEN_WORKSHOP_STATUSES,
  addDaysUtc,
  getDateRangeOrThrow,
  listDateKeys,
  toInteger,
  toPositiveIntWithinRangeOrThrow,
} from "./shared";

export const getWorkshopDailyReport = async (from?: string, to?: string) => {
  const range = getDateRangeOrThrow(from, to);
  const days = listDateKeys(range.from, range.to);

  const rows = await prisma.$queryRaw<Array<{ date: string; jobCount: number; revenuePence: number }>>`
    SELECT
      to_char((w."completedAt" AT TIME ZONE 'Europe/London')::date, 'YYYY-MM-DD') AS "date",
      COUNT(*)::int AS "jobCount",
      COALESCE(SUM(s."totalPence"), 0)::bigint AS "revenuePence"
    FROM "WorkshopJob" w
    LEFT JOIN "Sale" s ON s."workshopJobId" = w.id
    WHERE
      w.status = 'COMPLETED'
      AND w."completedAt" IS NOT NULL
      AND (w."completedAt" AT TIME ZONE 'Europe/London')::date BETWEEN ${range.from}::date AND ${range.to}::date
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

export const getWorkshopCapacityReport = async () => {
  const now = new Date();
  const completedFrom = new Date(now);
  completedFrom.setUTCDate(completedFrom.getUTCDate() - (WORKSHOP_CAPACITY_LOOKBACK_DAYS - 1));
  completedFrom.setUTCHours(0, 0, 0, 0);

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
  const completedJobsLast30Days = jobs.filter((job) => (
    job.completedAt !== null
    && job.completedAt >= completedFrom
    && job.completedAt <= now
  )).length;
  const averageCompletedPerDay = Number((completedJobsLast30Days / WORKSHOP_CAPACITY_LOOKBACK_DAYS).toFixed(1));
  const estimatedBacklogDays = averageCompletedPerDay > 0
    ? Number((openJobs.length / averageCompletedPerDay).toFixed(1))
    : null;

  const ageingBuckets = {
    zeroToTwoDays: 0,
    threeToSevenDays: 0,
    eightToFourteenDays: 0,
    fifteenPlusDays: 0,
  };

  for (const job of openJobs) {
    const ageDays = Math.max(0, Math.floor((now.getTime() - job.createdAt.getTime()) / 86_400_000));
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

  return {
    generatedAt: now.toISOString(),
    lookbackDays: WORKSHOP_CAPACITY_LOOKBACK_DAYS,
    openJobCount: openJobs.length,
    waitingForApprovalCount,
    waitingForPartsCount,
    completedJobsLast30Days,
    averageCompletedPerDay,
    estimatedBacklogDays,
    ageingBuckets,
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
              name: true,
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
        name: string | null;
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
        || (row.job.customer
          ? [row.job.customer.name, row.job.customer.firstName, row.job.customer.lastName]
            .filter(Boolean)
            .join(" ")
            .trim()
          : null)
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
