import {
  Prisma,
  RotaAssignmentSource,
  RotaClosedDayType,
  RotaPeriodStatus,
  RotaShiftType,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";
import { listShopSettings } from "./configurationService";
import { resolveStoreDaySchedule } from "./storeScheduleService";
import { formatDateKeyInTimeZone, getStoreWeekdayKeyForDate, STORE_WEEKDAY_LABELS } from "../utils/storeHours";
import { filterWorkshopTechnicians } from "./workshopStaffingService";

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
  staff: DashboardStaffEntry[];
  holidayStaff: DashboardStaffEntry[];
};

export type DashboardStaffEntry = {
  staffId: string;
  name: string;
  role: "STAFF" | "MANAGER" | "ADMIN";
  isTechnician: boolean;
  shiftType: RotaShiftType;
  note: string | null;
  source: RotaAssignmentSource;
};

export type WorkshopStaffingTodayResponse = {
  summary: {
    date: string;
    isClosed: boolean;
    closedReason: string | null;
    opensAt: string | null;
    closesAt: string | null;
    scheduledStaffCount: number;
    holidayStaffCount: number;
    totalScheduledStaffCount: number;
    totalHolidayStaffCount: number;
    coverageStatus: "closed" | "none" | "thin" | "covered";
  };
  scheduledStaff: DashboardStaffEntry[];
  holidayStaff: DashboardStaffEntry[];
};

export type RotaPeriodListItem = {
  id: string;
  label: string;
  startsOn: string;
  endsOn: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  isCurrent: boolean;
  summary: {
    assignedStaffCount: number;
    assignedDays: number;
    holidayDays: number;
    importedAssignments: number;
    latestImportAt: string | null;
    latestImportBatchKey: string | null;
    latestImportFileName: string | null;
  };
};

export type RotaPeriodDayColumn = {
  date: string;
  weekIndex: number;
  weekLabel: string;
  weekday: "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY";
  weekdayLabel: string;
  shortDateLabel: string;
  isClosed: boolean;
  closedReason: string | null;
  opensAt: string | null;
  closesAt: string | null;
};

export type RotaPeriodStaffCell = {
  assignmentId: string | null;
  date: string;
  shiftType: RotaShiftType | null;
  note: string | null;
  source: RotaAssignmentSource | null;
  rawValue: string | null;
  isClosed: boolean;
  closedReason: string | null;
};

export type RotaPeriodDetail = {
  id: string;
  label: string;
  startsOn: string;
  endsOn: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  days: RotaPeriodDayColumn[];
  weeks: Array<{
    weekIndex: number;
    label: string;
    startsOn: string;
    endsOn: string;
  }>;
  summary: {
    assignedStaffCount: number;
    assignedDays: number;
    holidayDays: number;
    importedAssignments: number;
    closedDays: number;
    latestImportAt: string | null;
    latestImportBatchKey: string | null;
    latestImportFileName: string | null;
  };
  staffRows: Array<{
    staffId: string;
    name: string;
    role: "STAFF" | "MANAGER" | "ADMIN";
    cells: RotaPeriodStaffCell[];
  }>;
};

export type RotaOverviewResponse = {
  selectedPeriodId: string | null;
  periods: RotaPeriodListItem[];
  period: RotaPeriodDetail | null;
};

export type RotaStaffScope = "assigned" | "all";

export type SaveRotaAssignmentResult = {
  assignment: {
    id: string;
    rotaPeriodId: string;
    staffId: string;
    date: string;
    shiftType: RotaShiftType;
    source: RotaAssignmentSource;
  };
  previousSource: RotaAssignmentSource | null;
  replacedHolidayApproved: boolean;
};

export type ClearRotaAssignmentResult = {
  clearedAssignmentId: string;
  staffId: string;
  date: string;
  previousSource: RotaAssignmentSource;
};

export type BulkRotaAssignmentResult = {
  changes: Array<{
    date: string;
    action: "saved" | "cleared" | "unchanged";
    shiftType: RotaShiftType | null;
    previousSource: RotaAssignmentSource | null;
    replacedHolidayApproved: boolean;
  }>;
  summary: {
    savedCount: number;
    clearedCount: number;
    unchangedCount: number;
  };
};

export type CreateRotaPeriodResult = {
  created: boolean;
  rotaPeriod: {
    id: string;
    label: string;
    startsOn: string;
    endsOn: string;
    status: "DRAFT" | "ACTIVE" | "ARCHIVED";
    notes: string | null;
  };
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

const addDaysToDateKey = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const HEADER_ACTOR_PASSWORD_HASH = "__header_actor__";

const toClosedReasonLabel = (type: RotaClosedDayType, note: string | null) => {
  if (note?.trim()) {
    return note.trim();
  }
  if (type === "BANK_HOLIDAY") {
    return "Store closed for bank holiday.";
  }
  return "Store closed today.";
};

const toPeriodWeekLabel = (startsOn: string, endsOn: string, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
  });
  const start = formatter.format(toDateFromDateKey(startsOn));
  const end = formatter.format(toDateFromDateKey(endsOn));
  return `${start} - ${end}`;
};

const toShortDateLabel = (date: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "short",
  }).format(toDateFromDateKey(date));

const getRelevantRotaPeriodId = (periods: Array<{ id: string; startsOn: string; endsOn: string; status: "DRAFT" | "ACTIVE" | "ARCHIVED" }>, today: string) => {
  const current = periods.find((period) => period.startsOn <= today && period.endsOn >= today);
  if (current) {
    return current.id;
  }

  const upcomingActive = periods
    .filter((period) => period.status === "ACTIVE" && period.startsOn > today)
    .sort((left, right) => left.startsOn.localeCompare(right.startsOn))[0];
  if (upcomingActive) {
    return upcomingActive.id;
  }

  return periods[0]?.id ?? null;
};

const normalizeRotaStaffScope = (value: string | undefined): RotaStaffScope => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "assigned") {
    return "assigned";
  }
  if (normalized === "all") {
    return "all";
  }
  throw new HttpError(400, "staffScope must be 'assigned' or 'all'", "INVALID_ROTA_FILTER");
};

const normalizeOptionalUserRoleFilter = (value: string | undefined) => {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "STAFF" || normalized === "MANAGER" || normalized === "ADMIN") {
    return normalized;
  }
  throw new HttpError(400, "role must be STAFF, MANAGER, or ADMIN", "INVALID_ROTA_FILTER");
};

const normalizeOptionalSearch = (value: string | undefined) => {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 80) : undefined;
};

const matchesRotaSearch = (value: string, search: string | undefined) => {
  if (!search) {
    return true;
  }
  return value.toLocaleLowerCase("en-GB").includes(search.toLocaleLowerCase("en-GB"));
};

const getLatestImportSummary = (
  assignments: Array<{
    source: RotaAssignmentSource;
    importBatchKey: string | null;
    updatedAt: Date;
  }>,
) => {
  const importedAssignments = assignments.filter((assignment) => assignment.source === "IMPORT");
  const latestImport = importedAssignments
    .filter((assignment) => assignment.importBatchKey)
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0];

  return {
    importedAssignments: importedAssignments.length,
    latestImportAt: latestImport?.updatedAt.toISOString() ?? null,
    latestImportBatchKey: latestImport?.importBatchKey ?? null,
    latestImportFileName: latestImport?.importBatchKey?.split(":")[0] ?? null,
  };
};

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

export const createRotaPeriod = async (
  input: {
    startsOn?: string;
    label?: string;
    notes?: string | null;
  },
  db: RotaClient = prisma,
): Promise<CreateRotaPeriodResult> => {
  const startsOn = normalizeDateKeyOrThrow(input.startsOn, "INVALID_ROTA_PERIOD");
  const window = buildSixWeekRotaWindow(startsOn);
  const label = typeof input.label === "string" && input.label.trim()
    ? input.label.trim()
    : `${window.startsOn} to ${window.endsOn}`;
  const notes = typeof input.notes === "string" && input.notes.trim()
    ? input.notes.trim()
    : null;

  const exactMatch = await db.rotaPeriod.findUnique({
    where: {
      startsOn_endsOn: {
        startsOn: window.startsOn,
        endsOn: window.endsOn,
      },
    },
    select: {
      id: true,
      label: true,
      startsOn: true,
      endsOn: true,
      status: true,
      notes: true,
    },
  });

  if (exactMatch) {
    return {
      created: false,
      rotaPeriod: {
        id: exactMatch.id,
        label: exactMatch.label,
        startsOn: exactMatch.startsOn,
        endsOn: exactMatch.endsOn,
        status: exactMatch.status,
        notes: exactMatch.notes ?? null,
      },
    };
  }

  const overlappingPeriod = await db.rotaPeriod.findFirst({
    where: {
      startsOn: {
        lte: window.endsOn,
      },
      endsOn: {
        gte: window.startsOn,
      },
    },
    select: {
      id: true,
      label: true,
      startsOn: true,
      endsOn: true,
    },
  });

  if (overlappingPeriod) {
    throw new HttpError(
      409,
      `This six-week block overlaps the existing rota period ${overlappingPeriod.label}.`,
      "ROTA_PERIOD_OVERLAP",
    );
  }

  const rotaPeriod = await db.rotaPeriod.create({
    data: {
      startsOn: window.startsOn,
      endsOn: window.endsOn,
      label,
      notes,
      status: RotaPeriodStatus.ACTIVE,
    },
    select: {
      id: true,
      label: true,
      startsOn: true,
      endsOn: true,
      status: true,
      notes: true,
    },
  });

  return {
    created: true,
    rotaPeriod: {
      id: rotaPeriod.id,
      label: rotaPeriod.label,
      startsOn: rotaPeriod.startsOn,
      endsOn: rotaPeriod.endsOn,
      status: rotaPeriod.status,
      notes: rotaPeriod.notes ?? null,
    },
  };
};

const getEditableRotaPeriodOrThrow = async (
  rotaPeriodId: string,
  date: string,
  db: RotaClient,
) => {
  const period = await db.rotaPeriod.findUnique({
    where: { id: rotaPeriodId },
    select: {
      id: true,
      startsOn: true,
      endsOn: true,
    },
  });

  if (!period) {
    throw new HttpError(404, "Rota period not found", "ROTA_PERIOD_NOT_FOUND");
  }

  if (date < period.startsOn || date > period.endsOn) {
    throw new HttpError(
      400,
      "Assignment date must fall within the selected rota period",
      "INVALID_ROTA_ASSIGNMENT",
    );
  }

  return period;
};

const assertEditableRotaDate = async (date: string, db: RotaClient) => {
  const schedule = await resolveStoreDaySchedule(toDateFromDateKey(date), db);
  if (schedule.isClosed) {
    throw new HttpError(
      409,
      schedule.closedReason ?? "Assignments cannot be edited on closed days.",
      "ROTA_DAY_CLOSED",
    );
  }
};

const getSchedulableStaffOrThrow = async (staffId: string, db: RotaClient) => {
  const staff = await db.user.findUnique({
    where: { id: staffId },
    select: {
      id: true,
      isActive: true,
      passwordHash: true,
    },
  });

  if (!staff || !staff.isActive || staff.passwordHash === HEADER_ACTOR_PASSWORD_HASH) {
    throw new HttpError(404, "Staff member not found", "ROTA_STAFF_NOT_FOUND");
  }
};

export const saveManualRotaAssignment = async (
  input: {
    rotaPeriodId?: string;
    staffId?: string;
    date?: string;
    shiftType: RotaShiftType;
  },
  db: RotaClient = prisma,
): Promise<SaveRotaAssignmentResult> => {
  const rotaPeriodId = typeof input.rotaPeriodId === "string" ? input.rotaPeriodId.trim() : "";
  if (!rotaPeriodId) {
    throw new HttpError(400, "rotaPeriodId is required", "INVALID_ROTA_ASSIGNMENT");
  }

  const staffId = typeof input.staffId === "string" ? input.staffId.trim() : "";
  if (!staffId) {
    throw new HttpError(400, "staffId is required", "INVALID_ROTA_ASSIGNMENT");
  }

  const date = normalizeDateKeyOrThrow(input.date, "INVALID_ROTA_ASSIGNMENT");

  await Promise.all([
    getEditableRotaPeriodOrThrow(rotaPeriodId, date, db),
    getSchedulableStaffOrThrow(staffId, db),
    assertEditableRotaDate(date, db),
  ]);

  const existing = await db.rotaAssignment.findUnique({
    where: {
      staffId_date: {
        staffId,
        date,
      },
    },
    select: {
      source: true,
    },
  });

  const assignment = await db.rotaAssignment.upsert({
    where: {
      staffId_date: {
        staffId,
        date,
      },
    },
    create: {
      rotaPeriodId,
      staffId,
      date,
      shiftType: input.shiftType,
      source: RotaAssignmentSource.MANUAL,
      note: null,
      rawValue: null,
      importBatchKey: null,
    },
    update: {
      rotaPeriodId,
      shiftType: input.shiftType,
      source: RotaAssignmentSource.MANUAL,
      note: null,
      rawValue: null,
      importBatchKey: null,
    },
    select: {
      id: true,
      rotaPeriodId: true,
      staffId: true,
      date: true,
      shiftType: true,
      source: true,
    },
  });

  return {
    assignment,
    previousSource: existing?.source ?? null,
    replacedHolidayApproved: existing?.source === RotaAssignmentSource.HOLIDAY_APPROVED,
  };
};

export const clearRotaAssignment = async (
  input: { assignmentId?: string },
  db: RotaClient = prisma,
): Promise<ClearRotaAssignmentResult> => {
  const assignmentId = typeof input.assignmentId === "string" ? input.assignmentId.trim() : "";
  if (!assignmentId) {
    throw new HttpError(400, "assignmentId is required", "INVALID_ROTA_ASSIGNMENT");
  }

  const assignment = await db.rotaAssignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      staffId: true,
      date: true,
      source: true,
    },
  });

  if (!assignment) {
    throw new HttpError(404, "Rota assignment not found", "ROTA_ASSIGNMENT_NOT_FOUND");
  }

  await assertEditableRotaDate(assignment.date, db);
  await db.rotaAssignment.delete({
    where: { id: assignment.id },
  });

  return {
    clearedAssignmentId: assignment.id,
    staffId: assignment.staffId,
    date: assignment.date,
    previousSource: assignment.source,
  };
};

export const saveBulkRotaAssignments = async (
  input: {
    rotaPeriodId?: string;
    staffId?: string;
    changes?: Array<{
      date?: string;
      shiftType?: RotaShiftType | "OFF";
    }>;
  },
  db: RotaClient = prisma,
): Promise<BulkRotaAssignmentResult> => {
  const rotaPeriodId = typeof input.rotaPeriodId === "string" ? input.rotaPeriodId.trim() : "";
  if (!rotaPeriodId) {
    throw new HttpError(400, "rotaPeriodId is required", "INVALID_ROTA_ASSIGNMENT");
  }

  const staffId = typeof input.staffId === "string" ? input.staffId.trim() : "";
  if (!staffId) {
    throw new HttpError(400, "staffId is required", "INVALID_ROTA_ASSIGNMENT");
  }

  const rawChanges = Array.isArray(input.changes) ? input.changes : [];
  if (rawChanges.length === 0) {
    throw new HttpError(400, "changes must include at least one date", "INVALID_ROTA_ASSIGNMENT");
  }

  const dedupedChanges = new Map<string, RotaShiftType | "OFF">();
  for (const change of rawChanges) {
    const date = normalizeDateKeyOrThrow(change?.date, "INVALID_ROTA_ASSIGNMENT");
    const shiftType = change?.shiftType;
    if (
      shiftType !== "FULL_DAY"
      && shiftType !== "HALF_DAY_AM"
      && shiftType !== "HALF_DAY_PM"
      && shiftType !== "HOLIDAY"
      && shiftType !== "OFF"
    ) {
      throw new HttpError(
        400,
        "shiftType must be FULL_DAY, HALF_DAY_AM, HALF_DAY_PM, HOLIDAY, or OFF",
        "INVALID_ROTA_ASSIGNMENT",
      );
    }
    dedupedChanges.set(date, shiftType);
  }

  const run = async (tx: RotaClient): Promise<BulkRotaAssignmentResult> => {
    await getSchedulableStaffOrThrow(staffId, tx);

    const changes: BulkRotaAssignmentResult["changes"] = [];

    for (const [date, shiftType] of dedupedChanges.entries()) {
      await Promise.all([
        getEditableRotaPeriodOrThrow(rotaPeriodId, date, tx),
        assertEditableRotaDate(date, tx),
      ]);

      if (shiftType === "OFF") {
        const existing = await tx.rotaAssignment.findUnique({
          where: {
            staffId_date: {
              staffId,
              date,
            },
          },
          select: {
            id: true,
            source: true,
          },
        });

        if (!existing) {
          changes.push({
            date,
            action: "unchanged",
            shiftType: null,
            previousSource: null,
            replacedHolidayApproved: false,
          });
          continue;
        }

        const cleared = await clearRotaAssignment({ assignmentId: existing.id }, tx);
        changes.push({
          date,
          action: "cleared",
          shiftType: null,
          previousSource: cleared.previousSource,
          replacedHolidayApproved: cleared.previousSource === RotaAssignmentSource.HOLIDAY_APPROVED,
        });
        continue;
      }

      const saved = await saveManualRotaAssignment(
        {
          rotaPeriodId,
          staffId,
          date,
          shiftType,
        },
        tx,
      );

      changes.push({
        date,
        action: "saved",
        shiftType: saved.assignment.shiftType,
        previousSource: saved.previousSource,
        replacedHolidayApproved: saved.replacedHolidayApproved,
      });
    }

    return {
      changes,
      summary: {
        savedCount: changes.filter((change) => change.action === "saved").length,
        clearedCount: changes.filter((change) => change.action === "cleared").length,
        unchangedCount: changes.filter((change) => change.action === "unchanged").length,
      },
    };
  };

  if ("$transaction" in db) {
    return db.$transaction((tx) => run(tx));
  }

  return run(db);
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
          operationalRole: true,
          isTechnician: true,
        },
      },
    },
  });

  const holidayStaff = assignments
    .filter((assignment) => assignment.shiftType === "HOLIDAY")
    .map((assignment) => ({
      staffId: assignment.staff.id,
      name: toStaffDisplayName(assignment.staff),
      role: assignment.staff.role,
      isTechnician: assignment.staff.isTechnician,
      shiftType: assignment.shiftType,
      note: assignment.note ?? null,
      source: assignment.source,
    }));
  const scheduledStaff = schedule.isClosed
    ? []
    : assignments
      .filter((assignment) => assignment.shiftType !== "HOLIDAY")
      .map((assignment) => ({
        staffId: assignment.staff.id,
        name: toStaffDisplayName(assignment.staff),
        role: assignment.staff.role,
        isTechnician: assignment.staff.isTechnician,
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
      holidayStaffCount: holidayStaff.length,
    },
    staff: scheduledStaff,
    holidayStaff,
  };
};

export const getWorkshopStaffingToday = async (
  input: { date?: string } = {},
  db: RotaClient = prisma,
): Promise<WorkshopStaffingTodayResponse> => {
  const staffToday = await getDashboardStaffToday(input, db);
  const staffingSelection = filterWorkshopTechnicians([
    ...staffToday.staff,
    ...staffToday.holidayStaff,
  ]);
  const selectedStaffIds = new Set(staffingSelection.staff.map((entry) => entry.staffId));
  const scheduledStaff = staffToday.staff.filter((entry) => selectedStaffIds.has(entry.staffId));
  const holidayStaff = staffToday.holidayStaff.filter((entry) => selectedStaffIds.has(entry.staffId));
  const coverageStatus = staffToday.summary.isClosed
    ? "closed"
    : scheduledStaff.length === 0
      ? "none"
      : scheduledStaff.length === 1
        ? "thin"
        : "covered";

  return {
    summary: {
      ...staffToday.summary,
      scheduledStaffCount: scheduledStaff.length,
      holidayStaffCount: holidayStaff.length,
      totalScheduledStaffCount: staffToday.summary.scheduledStaffCount,
      totalHolidayStaffCount: staffToday.summary.holidayStaffCount,
      coverageStatus,
    },
    scheduledStaff,
    holidayStaff,
  };
};

export const getRotaOverview = async (
  input: {
    periodId?: string;
    staffScope?: string;
    role?: string;
    search?: string;
  } = {},
  db: RotaClient = prisma,
): Promise<RotaOverviewResponse> => {
  const staffScope = normalizeRotaStaffScope(input.staffScope);
  const roleFilter = normalizeOptionalUserRoleFilter(input.role);
  const searchFilter = normalizeOptionalSearch(input.search);
  const [settings, periods] = await Promise.all([
    listShopSettings(db),
    db.rotaPeriod.findMany({
      orderBy: [
        { startsOn: "desc" },
        { createdAt: "desc" },
      ],
      select: {
        id: true,
        label: true,
        startsOn: true,
        endsOn: true,
        status: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  if (!periods.length) {
    return {
      selectedPeriodId: null,
      periods: [],
      period: null,
    };
  }

  const today = formatDateKeyInTimeZone(new Date(), settings.store.timeZone);
  const selectedPeriodId = input.periodId?.trim()
    ? periods.find((period) => period.id === input.periodId.trim())?.id ?? null
    : getRelevantRotaPeriodId(periods, today);

  if (!selectedPeriodId) {
    return {
      selectedPeriodId: null,
      periods: [],
      period: null,
    };
  }

  const periodIds = periods.map((period) => period.id);
  const assignmentSummaries = await db.rotaAssignment.findMany({
    where: {
      rotaPeriodId: {
        in: periodIds,
      },
    },
    select: {
      rotaPeriodId: true,
      staffId: true,
      shiftType: true,
      source: true,
      importBatchKey: true,
      updatedAt: true,
    },
  });

  const assignmentsByPeriod = new Map<string, typeof assignmentSummaries>();
  for (const assignment of assignmentSummaries) {
    const bucket = assignmentsByPeriod.get(assignment.rotaPeriodId) ?? [];
    bucket.push(assignment);
    assignmentsByPeriod.set(assignment.rotaPeriodId, bucket);
  }

  const periodList: RotaPeriodListItem[] = periods.map((period) => {
    const periodAssignments = assignmentsByPeriod.get(period.id) ?? [];
    const latestImport = getLatestImportSummary(periodAssignments);

    return {
      id: period.id,
      label: period.label,
      startsOn: period.startsOn,
      endsOn: period.endsOn,
      status: period.status,
      isCurrent: period.startsOn <= today && period.endsOn >= today,
      summary: {
        assignedStaffCount: new Set(periodAssignments.map((assignment) => assignment.staffId)).size,
        assignedDays: periodAssignments.filter((assignment) => assignment.shiftType !== "HOLIDAY").length,
        holidayDays: periodAssignments.filter((assignment) => assignment.shiftType === "HOLIDAY").length,
        importedAssignments: latestImport.importedAssignments,
        latestImportAt: latestImport.latestImportAt,
        latestImportBatchKey: latestImport.latestImportBatchKey,
        latestImportFileName: latestImport.latestImportFileName,
      },
    };
  });

  const selectedPeriod = periods.find((period) => period.id === selectedPeriodId);
  if (!selectedPeriod) {
    throw new HttpError(404, "Rota period not found", "ROTA_PERIOD_NOT_FOUND");
  }

  const [periodAssignments, closedDays, activeStaff] = await Promise.all([
    db.rotaAssignment.findMany({
      where: {
        rotaPeriodId: selectedPeriod.id,
      },
      orderBy: [
        { staff: { name: "asc" } },
        { staff: { username: "asc" } },
        { date: "asc" },
      ],
      select: {
        id: true,
        date: true,
        shiftType: true,
        note: true,
        source: true,
        rawValue: true,
        importBatchKey: true,
        updatedAt: true,
        staff: {
          select: {
            id: true,
            username: true,
            name: true,
            role: true,
          },
        },
      },
    }),
    db.rotaClosedDay.findMany({
      where: {
        date: {
          gte: selectedPeriod.startsOn,
          lte: selectedPeriod.endsOn,
        },
      },
      select: {
        date: true,
        type: true,
        note: true,
      },
    }),
    staffScope === "all"
      ? db.user.findMany({
        where: {
          isActive: true,
          passwordHash: {
            not: HEADER_ACTOR_PASSWORD_HASH,
          },
          ...(roleFilter ? { role: roleFilter } : {}),
          ...(searchFilter
            ? {
              OR: [
                {
                  name: {
                    contains: searchFilter,
                    mode: "insensitive",
                  },
                },
                {
                  username: {
                    contains: searchFilter,
                    mode: "insensitive",
                  },
                },
              ],
            }
            : {}),
        },
        orderBy: [
          { role: "asc" },
          { name: "asc" },
          { username: "asc" },
        ],
        select: {
          id: true,
          username: true,
          name: true,
          role: true,
        },
      })
      : Promise.resolve([]),
  ]);

  const closedDayMap = new Map(
    closedDays.map((closedDay) => [closedDay.date, closedDay]),
  );

  const dayColumns: RotaPeriodDayColumn[] = [];
  const weeks: RotaPeriodDetail["weeks"] = [];
  for (let weekIndex = 0; weekIndex < 6; weekIndex += 1) {
    const weekStart = addDaysToDateKey(selectedPeriod.startsOn, weekIndex * 7);
    const weekEnd = addDaysToDateKey(weekStart, 5);
    weeks.push({
      weekIndex,
      label: toPeriodWeekLabel(weekStart, weekEnd, settings.store.timeZone),
      startsOn: weekStart,
      endsOn: weekEnd,
    });

    for (let dayOffset = 0; dayOffset < 6; dayOffset += 1) {
      const date = addDaysToDateKey(weekStart, dayOffset);
      const weekday = getStoreWeekdayKeyForDate(toDateFromDateKey(date), settings.store.timeZone);
      const dayHours = settings.store.openingHours[weekday];
      const closedDay = closedDayMap.get(date);
      const isClosed = Boolean(closedDay) || dayHours.isClosed;

      dayColumns.push({
        date,
        weekIndex,
        weekLabel: weeks[weekIndex].label,
        weekday: weekday as RotaPeriodDayColumn["weekday"],
        weekdayLabel: STORE_WEEKDAY_LABELS[weekday],
        shortDateLabel: toShortDateLabel(date, settings.store.timeZone),
        isClosed,
        closedReason: closedDay ? toClosedReasonLabel(closedDay.type, closedDay.note ?? null) : null,
        opensAt: isClosed ? null : dayHours.opensAt,
        closesAt: isClosed ? null : dayHours.closesAt,
      });
    }
  }

  const assignmentsByStaff = new Map<string, {
    staffId: string;
    name: string;
    role: "STAFF" | "MANAGER" | "ADMIN";
    byDate: Map<string, Omit<RotaPeriodStaffCell, "isClosed" | "closedReason">>;
  }>();

  for (const assignment of periodAssignments) {
    const key = assignment.staff.id;
    const existing = assignmentsByStaff.get(key) ?? {
      staffId: assignment.staff.id,
      name: toStaffDisplayName(assignment.staff),
      role: assignment.staff.role,
      byDate: new Map(),
    };

    existing.byDate.set(assignment.date, {
      assignmentId: assignment.id,
      date: assignment.date,
      shiftType: assignment.shiftType,
      note: assignment.note ?? null,
      source: assignment.source,
      rawValue: assignment.rawValue ?? null,
    });
    assignmentsByStaff.set(key, existing);
  }

  for (const staff of activeStaff) {
    if (assignmentsByStaff.has(staff.id)) {
      continue;
    }

    assignmentsByStaff.set(staff.id, {
      staffId: staff.id,
      name: toStaffDisplayName(staff),
      role: staff.role,
      byDate: new Map(),
    });
  }

  const latestImport = getLatestImportSummary(periodAssignments);
  const roleRank = {
    STAFF: 1,
    MANAGER: 2,
    ADMIN: 3,
  } satisfies Record<"STAFF" | "MANAGER" | "ADMIN", number>;
  const staffRows = [...assignmentsByStaff.values()]
    .filter((staffRow) => {
      if (roleFilter && staffRow.role !== roleFilter) {
        return false;
      }
      if (!matchesRotaSearch(staffRow.name, searchFilter)) {
        return false;
      }
      return true;
    })
    .sort((left, right) => {
      const roleDifference = roleRank[left.role] - roleRank[right.role];
      if (roleDifference !== 0) {
        return roleDifference;
      }
      return left.name.localeCompare(right.name, "en-GB");
    })
    .map((staffRow) => ({
      staffId: staffRow.staffId,
      name: staffRow.name,
      role: staffRow.role,
      cells: dayColumns.map((day) => {
        const assignment = staffRow.byDate.get(day.date);
        return {
          assignmentId: assignment?.assignmentId ?? null,
          date: day.date,
          shiftType: assignment?.shiftType ?? null,
          note: assignment?.note ?? null,
          source: assignment?.source ?? null,
          rawValue: assignment?.rawValue ?? null,
          isClosed: day.isClosed,
          closedReason: day.closedReason,
        };
      }),
    }));

  return {
    selectedPeriodId,
    periods: periodList,
    period: {
      id: selectedPeriod.id,
      label: selectedPeriod.label,
      startsOn: selectedPeriod.startsOn,
      endsOn: selectedPeriod.endsOn,
      status: selectedPeriod.status,
      notes: selectedPeriod.notes ?? null,
      createdAt: selectedPeriod.createdAt.toISOString(),
      updatedAt: selectedPeriod.updatedAt.toISOString(),
      days: dayColumns,
      weeks,
      summary: {
        assignedStaffCount: new Set(periodAssignments.map((assignment) => assignment.staff.id)).size,
        assignedDays: periodAssignments.filter((assignment) => assignment.shiftType !== "HOLIDAY").length,
        holidayDays: periodAssignments.filter((assignment) => assignment.shiftType === "HOLIDAY").length,
        importedAssignments: latestImport.importedAssignments,
        closedDays: dayColumns.filter((day) => day.isClosed).length,
        latestImportAt: latestImport.latestImportAt,
        latestImportBatchKey: latestImport.latestImportBatchKey,
        latestImportFileName: latestImport.latestImportFileName,
      },
      staffRows,
    },
  };
};
