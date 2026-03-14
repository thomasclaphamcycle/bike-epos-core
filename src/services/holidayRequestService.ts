import { HolidayRequestStatus, Prisma, RotaAssignmentSource } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";
import { getOrCreateSixWeekRotaPeriod, normalizeDateKeyOrThrow } from "./rotaService";
import { resolveStoreDaySchedule } from "./storeScheduleService";

type HolidayRequestClient = Prisma.TransactionClient | typeof prisma;
type StaffRole = "STAFF" | "MANAGER" | "ADMIN";

type HolidayRequestActor = {
  actorId: string;
  role: StaffRole;
};

type HolidayRequestRecord = {
  id: string;
  staffId: string;
  startDate: string;
  endDate: string;
  status: HolidayRequestStatus;
  requestNotes: string | null;
  decisionNotes: string | null;
  submittedAt: Date;
  reviewedAt: Date | null;
  reviewedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  staff: {
    id: string;
    username: string;
    name: string | null;
    role: StaffRole;
  };
  reviewedByUser: {
    id: string;
    username: string;
    name: string | null;
  } | null;
};

export type HolidayRequestListItem = {
  id: string;
  staffId: string;
  staffName: string;
  staffRole: StaffRole;
  startDate: string;
  endDate: string;
  status: HolidayRequestStatus;
  requestNotes: string | null;
  decisionNotes: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  reviewedByName: string | null;
  requestedDayCount: number;
};

const HOLIDAY_REQUEST_SELECT = {
  id: true,
  staffId: true,
  startDate: true,
  endDate: true,
  status: true,
  requestNotes: true,
  decisionNotes: true,
  submittedAt: true,
  reviewedAt: true,
  reviewedByUserId: true,
  createdAt: true,
  updatedAt: true,
  staff: {
    select: {
      id: true,
      username: true,
      name: true,
      role: true,
    },
  },
  reviewedByUser: {
    select: {
      id: true,
      username: true,
      name: true,
    },
  },
} satisfies Prisma.HolidayRequestSelect;

const trimOptionalText = (value: string | undefined) => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || null;
};

const toDisplayName = (user: { name: string | null; username: string }) =>
  user.name?.trim() || user.username;

const addDaysToDateKey = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const listDateRange = (startDate: string, endDate: string) => {
  const dates: string[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    dates.push(cursor);
    cursor = addDaysToDateKey(cursor, 1);
  }
  return dates;
};

const toMondayDateKey = (date: string) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  const day = value.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  value.setUTCDate(value.getUTCDate() + diff);
  return value.toISOString().slice(0, 10);
};

const assertDateRange = (startDate: string, endDate: string) => {
  if (endDate < startDate) {
    throw new HttpError(400, "endDate must be on or after startDate", "INVALID_HOLIDAY_REQUEST");
  }
};

const listEligibleHolidayDates = async (
  startDate: string,
  endDate: string,
  db: HolidayRequestClient,
) => {
  const requestedDates = listDateRange(startDate, endDate);
  const eligibleDates: string[] = [];

  for (const date of requestedDates) {
    const schedule = await resolveStoreDaySchedule(new Date(`${date}T12:00:00.000Z`), db);
    if (!schedule.isClosed) {
      eligibleDates.push(date);
    }
  }

  return eligibleDates;
};

const assertNoOverlappingHolidayRequest = async (
  staffId: string,
  startDate: string,
  endDate: string,
  db: HolidayRequestClient,
  ignoreRequestId?: string,
) => {
  const overlapping = await db.holidayRequest.findFirst({
    where: {
      staffId,
      status: {
        in: ["PENDING", "APPROVED"],
      },
      startDate: {
        lte: endDate,
      },
      endDate: {
        gte: startDate,
      },
      ...(ignoreRequestId ? { id: { not: ignoreRequestId } } : {}),
    },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      status: true,
    },
  });

  if (overlapping) {
    throw new HttpError(
      409,
      `Holiday request overlaps an existing ${overlapping.status.toLowerCase()} request (${overlapping.startDate} to ${overlapping.endDate}).`,
      "OVERLAPPING_HOLIDAY_REQUEST",
    );
  }
};

const toHolidayRequestListItem = (record: HolidayRequestRecord): HolidayRequestListItem => ({
  id: record.id,
  staffId: record.staffId,
  staffName: toDisplayName(record.staff),
  staffRole: record.staff.role,
  startDate: record.startDate,
  endDate: record.endDate,
  status: record.status,
  requestNotes: record.requestNotes ?? null,
  decisionNotes: record.decisionNotes ?? null,
  submittedAt: record.submittedAt.toISOString(),
  reviewedAt: record.reviewedAt?.toISOString() ?? null,
  reviewedByUserId: record.reviewedByUserId ?? null,
  reviewedByName: record.reviewedByUser ? toDisplayName(record.reviewedByUser) : null,
  requestedDayCount: listDateRange(record.startDate, record.endDate).length,
});

const getHolidayRequestOrThrow = async (id: string, db: HolidayRequestClient) => {
  const request = await db.holidayRequest.findUnique({
    where: { id },
    select: HOLIDAY_REQUEST_SELECT,
  });

  if (!request) {
    throw new HttpError(404, "Holiday request not found", "HOLIDAY_REQUEST_NOT_FOUND");
  }

  return request as HolidayRequestRecord;
};

const resolveRotaPeriodForDate = async (date: string, db: Prisma.TransactionClient) => {
  const existing = await db.rotaPeriod.findFirst({
    where: {
      startsOn: {
        lte: date,
      },
      endsOn: {
        gte: date,
      },
    },
    orderBy: {
      startsOn: "desc",
    },
  });

  if (existing) {
    return existing;
  }

  return getOrCreateSixWeekRotaPeriod(toMondayDateKey(date), db);
};

const assertCanManageHolidayRequest = (actor: HolidayRequestActor) => {
  if (actor.role === "STAFF") {
    throw new HttpError(403, "Manager role required", "INSUFFICIENT_ROLE");
  }
};

export const submitHolidayRequest = async (
  input: {
    actor: HolidayRequestActor;
    startDate?: string;
    endDate?: string;
    requestNotes?: string;
  },
  db: HolidayRequestClient = prisma,
) => {
  const startDate = normalizeDateKeyOrThrow(input.startDate, "INVALID_HOLIDAY_REQUEST");
  const endDate = normalizeDateKeyOrThrow(input.endDate, "INVALID_HOLIDAY_REQUEST");
  assertDateRange(startDate, endDate);

  const requestNotes = trimOptionalText(input.requestNotes);
  const eligibleDates = await listEligibleHolidayDates(startDate, endDate, db);
  if (!eligibleDates.length) {
    throw new HttpError(
      400,
      "Holiday request range does not include any open trading days.",
      "INVALID_HOLIDAY_REQUEST",
    );
  }

  await assertNoOverlappingHolidayRequest(input.actor.actorId, startDate, endDate, db);

  const created = await db.holidayRequest.create({
    data: {
      staffId: input.actor.actorId,
      startDate,
      endDate,
      requestNotes,
      submittedAt: new Date(),
    },
    select: HOLIDAY_REQUEST_SELECT,
  });

  return toHolidayRequestListItem(created as HolidayRequestRecord);
};

export const listHolidayRequests = async (
  input: {
    actor: HolidayRequestActor;
    scope?: "mine" | "all";
  },
  db: HolidayRequestClient = prisma,
) => {
  const effectiveScope = input.actor.role === "STAFF" || input.scope === "mine" ? "mine" : "all";

  const requests = await db.holidayRequest.findMany({
    where: effectiveScope === "mine"
      ? {
          staffId: input.actor.actorId,
        }
      : undefined,
    orderBy: [
      { status: "asc" },
      { startDate: "asc" },
      { submittedAt: "desc" },
    ],
    select: HOLIDAY_REQUEST_SELECT,
  });

  return {
    scope: effectiveScope,
    requests: requests.map((request) => toHolidayRequestListItem(request as HolidayRequestRecord)),
  };
};

export const approveHolidayRequest = async (
  input: {
    actor: HolidayRequestActor;
    id: string;
    decisionNotes?: string;
  },
  db: typeof prisma = prisma,
) => {
  assertCanManageHolidayRequest(input.actor);
  const requestId = input.id.trim();
  if (!requestId) {
    throw new HttpError(400, "Holiday request id is required", "INVALID_HOLIDAY_REQUEST");
  }

  const decisionNotes = trimOptionalText(input.decisionNotes);

  return db.$transaction(async (tx) => {
    const request = await getHolidayRequestOrThrow(requestId, tx);
    if (request.status !== "PENDING") {
      throw new HttpError(409, "Only pending holiday requests can be approved.", "HOLIDAY_REQUEST_NOT_PENDING");
    }

    await assertNoOverlappingHolidayRequest(
      request.staffId,
      request.startDate,
      request.endDate,
      tx,
      request.id,
    );

    const eligibleDates = await listEligibleHolidayDates(request.startDate, request.endDate, tx);
    if (!eligibleDates.length) {
      throw new HttpError(
        400,
        "Holiday request does not cover any open trading days to assign.",
        "INVALID_HOLIDAY_REQUEST",
      );
    }

    const periodCache = new Map<string, string>();
    for (const date of eligibleDates) {
      let rotaPeriodId = periodCache.get(date);
      if (!rotaPeriodId) {
        const rotaPeriod = await resolveRotaPeriodForDate(date, tx);
        rotaPeriodId = rotaPeriod.id;
        periodCache.set(date, rotaPeriodId);
      }

      await tx.rotaAssignment.upsert({
        where: {
          staffId_date: {
            staffId: request.staffId,
            date,
          },
        },
        create: {
          rotaPeriodId,
          staffId: request.staffId,
          date,
          shiftType: "HOLIDAY",
          source: RotaAssignmentSource.HOLIDAY_APPROVED,
          note: request.requestNotes?.trim() || null,
          rawValue: null,
          importBatchKey: null,
        },
        update: {
          rotaPeriodId,
          shiftType: "HOLIDAY",
          source: RotaAssignmentSource.HOLIDAY_APPROVED,
          note: request.requestNotes?.trim() || null,
          rawValue: null,
          importBatchKey: null,
        },
      });
    }

    const updated = await tx.holidayRequest.update({
      where: {
        id: request.id,
      },
      data: {
        status: "APPROVED",
        decisionNotes,
        reviewedAt: new Date(),
        reviewedByUserId: input.actor.actorId,
      },
      select: HOLIDAY_REQUEST_SELECT,
    });

    return {
      request: toHolidayRequestListItem(updated as HolidayRequestRecord),
      appliedDates: eligibleDates,
    };
  });
};

export const rejectHolidayRequest = async (
  input: {
    actor: HolidayRequestActor;
    id: string;
    decisionNotes?: string;
  },
  db: HolidayRequestClient = prisma,
) => {
  assertCanManageHolidayRequest(input.actor);
  const requestId = input.id.trim();
  if (!requestId) {
    throw new HttpError(400, "Holiday request id is required", "INVALID_HOLIDAY_REQUEST");
  }

  const decisionNotes = trimOptionalText(input.decisionNotes);
  const request = await getHolidayRequestOrThrow(requestId, db);
  if (request.status !== "PENDING") {
    throw new HttpError(409, "Only pending holiday requests can be rejected.", "HOLIDAY_REQUEST_NOT_PENDING");
  }

  const updated = await db.holidayRequest.update({
    where: { id: request.id },
    data: {
      status: "REJECTED",
      decisionNotes,
      reviewedAt: new Date(),
      reviewedByUserId: input.actor.actorId,
    },
    select: HOLIDAY_REQUEST_SELECT,
  });

  return toHolidayRequestListItem(updated as HolidayRequestRecord);
};

export const cancelHolidayRequest = async (
  input: {
    actor: HolidayRequestActor;
    id: string;
  },
  db: HolidayRequestClient = prisma,
) => {
  const requestId = input.id.trim();
  if (!requestId) {
    throw new HttpError(400, "Holiday request id is required", "INVALID_HOLIDAY_REQUEST");
  }

  const request = await getHolidayRequestOrThrow(requestId, db);
  if (request.status !== "PENDING") {
    throw new HttpError(409, "Only pending holiday requests can be cancelled.", "HOLIDAY_REQUEST_NOT_PENDING");
  }

  const isOwner = request.staffId === input.actor.actorId;
  const canManage = input.actor.role === "MANAGER" || input.actor.role === "ADMIN";
  if (!isOwner && !canManage) {
    throw new HttpError(403, "You can only cancel your own holiday requests.", "INSUFFICIENT_ROLE");
  }

  const updated = await db.holidayRequest.update({
    where: { id: request.id },
    data: {
      status: "CANCELLED",
      reviewedAt: new Date(),
      reviewedByUserId: input.actor.actorId,
    },
    select: HOLIDAY_REQUEST_SELECT,
  });

  return toHolidayRequestListItem(updated as HolidayRequestRecord);
};
