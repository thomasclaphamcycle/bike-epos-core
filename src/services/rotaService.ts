import { Prisma, RotaAssignmentSource, RotaPeriodStatus, RotaShiftType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";
import { resolveStoreDaySchedule } from "./storeScheduleService";

type RotaClient = Prisma.TransactionClient | typeof prisma;

export type DashboardStaffTodayResponse = {
  summary: {
    date: string;
    isClosed: boolean;
    closedReason: string | null;
    opensAt: string | null;
    closesAt: string | null;
    scheduledStaffCount: number;
    holidayStaffCount: number;
  };
  staff: Array<{
    staffId: string;
    name: string;
    role: "STAFF" | "MANAGER" | "ADMIN";
    shiftType: RotaShiftType;
    note: string | null;
    source: RotaAssignmentSource;
  }>;
};

const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const isValidDateKey = (value: string) => {
  if (!DATE_KEY_REGEX.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export const normalizeDateKeyOrThrow = (value: string | undefined, code = "INVALID_ROTA_DATE") => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || !isValidDateKey(normalized)) {
    throw new HttpError(400, "date must be a valid YYYY-MM-DD string", code);
  }
  return normalized;
};

const toDateFromDateKey = (date: string) => new Date(`${date}T12:00:00.000Z`);

const toStaffDisplayName = (staff: { name: string | null; username: string }) =>
  staff.name?.trim() || staff.username;

export const buildSixWeekRotaWindow = (startsOn: string) => {
  const normalizedStartsOn = normalizeDateKeyOrThrow(startsOn);
  const start = new Date(`${normalizedStartsOn}T00:00:00.000Z`);
  if (start.getUTCDay() !== 1) {
    throw new HttpError(400, "Rota period start must be a Monday", "INVALID_ROTA_PERIOD");
  }

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 41);

  return {
    startsOn: normalizedStartsOn,
    endsOn: end.toISOString().slice(0, 10),
  };
};

export const getOrCreateSixWeekRotaPeriod = async (
  startsOn: string,
  db: RotaClient = prisma,
) => {
  const window = buildSixWeekRotaWindow(startsOn);
  const existing = await db.rotaPeriod.findUnique({
    where: {
      startsOn_endsOn: {
        startsOn: window.startsOn,
        endsOn: window.endsOn,
      },
    },
  });

  if (existing) {
    return existing;
  }

  return db.rotaPeriod.create({
    data: {
      startsOn: window.startsOn,
      endsOn: window.endsOn,
      label: `${window.startsOn} to ${window.endsOn}`,
      status: RotaPeriodStatus.ACTIVE,
    },
  });
};

export const getDashboardStaffToday = async (
  input: { date?: string } = {},
  db: RotaClient = prisma,
): Promise<DashboardStaffTodayResponse> => {
  const date = input.date ? normalizeDateKeyOrThrow(input.date) : undefined;
  const targetDate = date ? toDateFromDateKey(date) : new Date();
  const schedule = await resolveStoreDaySchedule(targetDate, db);

  const assignments = await db.rotaAssignment.findMany({
    where: {
      date: schedule.date,
    },
    orderBy: [
      { shiftType: "asc" },
      { staff: { name: "asc" } },
      { staff: { username: "asc" } },
    ],
    select: {
      shiftType: true,
      note: true,
      source: true,
      staff: {
        select: {
          id: true,
          username: true,
          name: true,
          role: true,
        },
      },
    },
  });

  const holidayStaffCount = assignments.filter((assignment) => assignment.shiftType === "HOLIDAY").length;
  const scheduledStaff = schedule.isClosed
    ? []
    : assignments
      .filter((assignment) => assignment.shiftType !== "HOLIDAY")
      .map((assignment) => ({
        staffId: assignment.staff.id,
        name: toStaffDisplayName(assignment.staff),
        role: assignment.staff.role,
        shiftType: assignment.shiftType,
        note: assignment.note ?? null,
        source: assignment.source,
      }));

  return {
    summary: {
      date: schedule.date,
      isClosed: schedule.isClosed,
      closedReason: schedule.closedReason,
      opensAt: schedule.isClosed ? null : schedule.hours.opensAt,
      closesAt: schedule.isClosed ? null : schedule.hours.closesAt,
      scheduledStaffCount: scheduledStaff.length,
      holidayStaffCount,
    },
    staff: scheduledStaff,
  };
};
