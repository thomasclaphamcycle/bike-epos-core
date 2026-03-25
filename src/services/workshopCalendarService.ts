import { Prisma, RotaShiftType, type UserOperationalRole, type UserRole, type WorkshopJobStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";
import { listShopSettings } from "./configurationService";
import { resolveStoreDaySchedule } from "./storeScheduleService";
import { parseDateOnlyOrThrow, toDateKey } from "./workshopAvailabilityService";
import { toWorkshopExecutionStatus } from "./workshopStatusService";
import {
  clockTimeToMinutes,
  formatDateKeyInTimeZone,
  getStoreWeekdayKeyForDate,
} from "../utils/storeHours";

type WorkshopCalendarClient = Prisma.TransactionClient | typeof prisma;

type ScheduleInputValue = string | Date | null | undefined;

type WorkshopSchedulePatchInput = {
  scheduledStartAt?: ScheduleInputValue;
  scheduledEndAt?: ScheduleInputValue;
  durationMinutes?: number | null;
  clearSchedule?: boolean;
};

export type WorkshopScheduleSnapshot = {
  scheduledDate: Date | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  durationMinutes: number | null;
  localDateKey: string | null;
};

export type ResolvedWorkshopWorkingHours = {
  id: string;
  staffId: string;
  date: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  startMinutes: number;
  endMinutes: number;
  source: "ROTA" | "WORKSHOP_FALLBACK";
  shiftType: RotaShiftType | null;
  label: string;
  createdAt: Date;
  updatedAt: Date;
};

export type WorkshopCalendarAvailability = {
  date: string;
  dayOfWeek: number;
  source: "ROTA" | "WORKSHOP_FALLBACK" | "UNAVAILABLE";
  shiftType: RotaShiftType | null;
  startTime: string | null;
  endTime: string | null;
  totalMinutes: number;
  label: string;
};

export type WorkshopCapacitySummary = {
  staffId: string;
  date: string;
  totalMinutes: number;
  bookedMinutes: number;
  timeOffMinutes: number;
  availableMinutes: number;
};

type CalendarScheduledJobRecord = {
  id: string;
  locationId: string;
  customerId: string | null;
  bikeId: string | null;
  customerName: string | null;
  bikeDescription: string | null;
  status: WorkshopJobStatus;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  scheduledDate: Date | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  durationMinutes: number | null;
  notes: string | null;
  completedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type CalendarCapacityContext = {
  dateKey: string;
  timeZone: string;
  workingHours: ResolvedWorkshopWorkingHours | null;
  timeOff: Array<{ startAt: Date; endAt: Date }>;
  bookedJobs: Array<{
    scheduledStartAt: Date | null;
    scheduledEndAt: Date | null;
    durationMinutes: number | null;
  }>;
};

type LegacyWorkshopWorkingHoursRecord = {
  id: string;
  staffId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  createdAt: Date;
  updatedAt: Date;
};

type WorkshopRotaAssignmentRecord = {
  id: string;
  staffId: string;
  date: string;
  shiftType: RotaShiftType;
  createdAt: Date;
  updatedAt: Date;
};

type WorkshopAvailabilityResolution = {
  workingHours: ResolvedWorkshopWorkingHours | null;
  availability: WorkshopCalendarAvailability;
};

const WORKSHOP_DAY_OF_WEEK: Record<string, number> = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};

const WORKSHOP_MAX_CALENDAR_RANGE_DAYS = 62;

const toUtcDateKey = (value: string) => new Date(`${value}T00:00:00.000Z`);

const addMinutes = (value: Date, minutes: number) => new Date(value.getTime() + (minutes * 60_000));

const addDays = (value: Date, days: number) => {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const toDateFromDateKey = (value: string) => new Date(`${value}T12:00:00.000Z`);

const isWorkshopOperationalRole = (value: UserOperationalRole | null) =>
  value === "WORKSHOP" || value === "MIXED";

const toStaffDisplayName = (staff: { name: string | null; username: string }) =>
  staff.name?.trim() || staff.username;

const getTimeZoneParts = (value: Date, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(value);
  const lookup = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    year: lookup("year"),
    month: lookup("month"),
    day: lookup("day"),
    hour: Number(lookup("hour") || "0"),
    minute: Number(lookup("minute") || "0"),
  };
};

const getMinutesInTimeZone = (value: Date, timeZone: string) => {
  const parts = getTimeZoneParts(value, timeZone);
  return (parts.hour * 60) + parts.minute;
};

const getDayOfWeekForDateKey = (value: string, timeZone: string) =>
  WORKSHOP_DAY_OF_WEEK[getStoreWeekdayKeyForDate(toDateFromDateKey(value), timeZone)] ?? 0;

const minutesToClockTime = (value: number) =>
  `${`${Math.floor(value / 60)}`.padStart(2, "0")}:${`${value % 60}`.padStart(2, "0")}`;

const listDateKeysInclusive = (from: Date, to: Date) => {
  const keys: string[] = [];
  let current = new Date(from);
  while (current <= to) {
    keys.push(toDateKey(current));
    current = addDays(current, 1);
  }
  return keys;
};

const getLegacyWorkshopWorkingHoursForDate = async (
  staffId: string,
  dayOfWeek: number,
  db: WorkshopCalendarClient = prisma,
): Promise<LegacyWorkshopWorkingHoursRecord | null> =>
  db.workshopWorkingHours.findUnique({
    where: {
      staffId_dayOfWeek: {
        staffId,
        dayOfWeek,
      },
    },
  });

const buildUnavailableAvailability = (
  dateKey: string,
  dayOfWeek: number,
  label: string,
  shiftType: RotaShiftType | null = null,
): WorkshopAvailabilityResolution => ({
  workingHours: null,
  availability: {
    date: dateKey,
    dayOfWeek,
    source: "UNAVAILABLE",
    shiftType,
    startTime: null,
    endTime: null,
    totalMinutes: 0,
    label,
  },
});

const buildFallbackWorkshopAvailability = (
  dateKey: string,
  fallbackWorkingHours: LegacyWorkshopWorkingHoursRecord,
): WorkshopAvailabilityResolution => {
  const startMinutes = clockTimeToMinutes(fallbackWorkingHours.startTime);
  const endMinutes = clockTimeToMinutes(fallbackWorkingHours.endTime);

  if (startMinutes === null || endMinutes === null || startMinutes >= endMinutes) {
    throw new HttpError(
      500,
      "Workshop fallback working hours are misconfigured",
      "INVALID_WORKSHOP_WORKING_HOURS",
    );
  }

  const workingHours: ResolvedWorkshopWorkingHours = {
    ...fallbackWorkingHours,
    date: dateKey,
    startMinutes,
    endMinutes,
    source: "WORKSHOP_FALLBACK",
    shiftType: null,
    label: "Legacy workshop hours fallback",
  };

  return {
    workingHours,
    availability: {
      date: dateKey,
      dayOfWeek: fallbackWorkingHours.dayOfWeek,
      source: "WORKSHOP_FALLBACK",
      shiftType: null,
      startTime: workingHours.startTime,
      endTime: workingHours.endTime,
      totalMinutes: Math.max(0, workingHours.endMinutes - workingHours.startMinutes),
      label: workingHours.label,
    },
  };
};

const buildRotaWorkshopAvailability = (
  input: {
    dateKey: string;
    dayOfWeek: number;
    staffId: string;
    storeDay: Awaited<ReturnType<typeof resolveStoreDaySchedule>>;
    rotaAssignment: WorkshopRotaAssignmentRecord;
  },
): WorkshopAvailabilityResolution => {
  if (input.storeDay.isClosed) {
    return buildUnavailableAvailability(
      input.dateKey,
      input.dayOfWeek,
      input.storeDay.closedReason ?? "Store closed today",
      input.rotaAssignment.shiftType,
    );
  }

  if (input.rotaAssignment.shiftType === "HOLIDAY") {
    return buildUnavailableAvailability(input.dateKey, input.dayOfWeek, "Holiday", "HOLIDAY");
  }

  const storeStartMinutes = clockTimeToMinutes(input.storeDay.hours.opensAt);
  const storeEndMinutes = clockTimeToMinutes(input.storeDay.hours.closesAt);

  if (
    storeStartMinutes === null
    || storeEndMinutes === null
    || storeStartMinutes >= storeEndMinutes
  ) {
    throw new HttpError(
      500,
      "Store opening hours are misconfigured",
      "INVALID_WORKSHOP_WORKING_HOURS",
    );
  }

  const midpointMinutes =
    storeStartMinutes + Math.floor((storeEndMinutes - storeStartMinutes) / 2);
  let startMinutes = storeStartMinutes;
  let endMinutes = storeEndMinutes;
  let label = "Rota full-day shift";

  if (input.rotaAssignment.shiftType === "HALF_DAY_AM") {
    endMinutes = midpointMinutes;
    label = "Rota AM shift";
  } else if (input.rotaAssignment.shiftType === "HALF_DAY_PM") {
    startMinutes = midpointMinutes;
    label = "Rota PM shift";
  }

  if (startMinutes >= endMinutes) {
    return buildUnavailableAvailability(
      input.dateKey,
      input.dayOfWeek,
      "No schedulable rota availability for this shift",
      input.rotaAssignment.shiftType,
    );
  }

  const workingHours: ResolvedWorkshopWorkingHours = {
    id: `rota:${input.rotaAssignment.id}`,
    staffId: input.staffId,
    date: input.dateKey,
    dayOfWeek: input.dayOfWeek,
    startTime: minutesToClockTime(startMinutes),
    endTime: minutesToClockTime(endMinutes),
    startMinutes,
    endMinutes,
    source: "ROTA",
    shiftType: input.rotaAssignment.shiftType,
    label,
    createdAt: input.rotaAssignment.createdAt,
    updatedAt: input.rotaAssignment.updatedAt,
  };

  return {
    workingHours,
    availability: {
      date: input.dateKey,
      dayOfWeek: input.dayOfWeek,
      source: "ROTA",
      shiftType: input.rotaAssignment.shiftType,
      startTime: workingHours.startTime,
      endTime: workingHours.endTime,
      totalMinutes: Math.max(0, workingHours.endMinutes - workingHours.startMinutes),
      label,
    },
  };
};

const buildWorkshopAvailabilityForDate = (input: {
  staffId: string;
  dateKey: string;
  dayOfWeek: number;
  storeDay: Awaited<ReturnType<typeof resolveStoreDaySchedule>>;
  rotaAssignment: WorkshopRotaAssignmentRecord | null;
  fallbackWorkingHours: LegacyWorkshopWorkingHoursRecord | null;
}): WorkshopAvailabilityResolution => {
  if (input.rotaAssignment) {
    return buildRotaWorkshopAvailability({
      dateKey: input.dateKey,
      dayOfWeek: input.dayOfWeek,
      staffId: input.staffId,
      storeDay: input.storeDay,
      rotaAssignment: input.rotaAssignment,
    });
  }

  if (input.fallbackWorkingHours) {
    return buildFallbackWorkshopAvailability(input.dateKey, input.fallbackWorkingHours);
  }

  return buildUnavailableAvailability(input.dateKey, input.dayOfWeek, "No rota shift");
};

const parseCalendarDateRange = (input: { from: string; to: string }) => {
  const fromDate = parseDateOnlyOrThrow(input.from, "from");
  const toDate = parseDateOnlyOrThrow(input.to, "to");

  if (fromDate > toDate) {
    throw new HttpError(400, "from must be before or equal to to", "INVALID_DATE_RANGE");
  }

  const totalDays = Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
  if (totalDays > WORKSHOP_MAX_CALENDAR_RANGE_DAYS) {
    throw new HttpError(
      400,
      `Calendar range must be ${WORKSHOP_MAX_CALENDAR_RANGE_DAYS} days or fewer`,
      "INVALID_DATE_RANGE",
    );
  }

  return {
    fromDate,
    toDate,
    totalDays,
  };
};

const parseScheduledDateTime = (
  value: ScheduleInputValue,
  field: "scheduledStartAt" | "scheduledEndAt",
) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(
      400,
      `${field} must be a valid ISO date-time`,
      "INVALID_WORKSHOP_SCHEDULE",
    );
  }

  return date;
};

const parseDurationMinutes = (value: number | null | undefined) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new HttpError(
      400,
      "durationMinutes must be a positive integer",
      "INVALID_WORKSHOP_SCHEDULE",
    );
  }

  return value;
};

export const resolveWorkshopSchedulePatch = async (
  input: WorkshopSchedulePatchInput,
  current: {
    scheduledDate: Date | null;
    scheduledStartAt: Date | null;
    scheduledEndAt: Date | null;
    durationMinutes: number | null;
  },
  db: WorkshopCalendarClient = prisma,
): Promise<{ hasScheduleChanges: boolean; schedule: WorkshopScheduleSnapshot }> => {
  const parsedStart = parseScheduledDateTime(input.scheduledStartAt, "scheduledStartAt");
  const parsedEnd = parseScheduledDateTime(input.scheduledEndAt, "scheduledEndAt");
  const parsedDuration = parseDurationMinutes(input.durationMinutes);
  const clearSchedule = input.clearSchedule === true;
  const hasScheduleChanges =
    clearSchedule
    || parsedStart !== undefined
    || parsedEnd !== undefined
    || parsedDuration !== undefined;

  if (!hasScheduleChanges) {
    return {
      hasScheduleChanges: false,
      schedule: {
        scheduledDate: current.scheduledDate,
        scheduledStartAt: current.scheduledStartAt,
        scheduledEndAt: current.scheduledEndAt,
        durationMinutes: current.durationMinutes,
        localDateKey: null,
      },
    };
  }

  if (
    clearSchedule &&
    (
      parsedStart !== undefined ||
      parsedEnd !== undefined ||
      parsedDuration !== undefined
    )
  ) {
    throw new HttpError(
      400,
      "clearSchedule cannot be combined with scheduledStartAt, scheduledEndAt, or durationMinutes",
      "INVALID_WORKSHOP_SCHEDULE",
    );
  }

  const hasExplicitNullField =
    parsedStart === null || parsedEnd === null || parsedDuration === null;
  const hasExplicitValueField =
    parsedStart instanceof Date
    || parsedEnd instanceof Date
    || (parsedDuration !== undefined && parsedDuration !== null);
  const clearRequested = clearSchedule || (hasExplicitNullField && !hasExplicitValueField);

  if (clearRequested) {
    return {
      hasScheduleChanges: true,
      schedule: {
        scheduledDate: null,
        scheduledStartAt: null,
        scheduledEndAt: null,
        durationMinutes: null,
        localDateKey: null,
      },
    };
  }

  let scheduledStartAt =
    parsedStart !== undefined ? parsedStart : current.scheduledStartAt;
  let durationMinutes =
    parsedDuration !== undefined ? parsedDuration : current.durationMinutes;
  const scheduledEndProvided = parsedEnd !== undefined;
  const startOrDurationChanged =
    parsedStart !== undefined || parsedDuration !== undefined;
  let scheduledEndAt =
    scheduledEndProvided
      ? parsedEnd
      : startOrDurationChanged && scheduledStartAt && durationMinutes !== null && durationMinutes !== undefined
        ? addMinutes(scheduledStartAt, durationMinutes)
        : current.scheduledEndAt;

  if (scheduledStartAt && durationMinutes !== null && durationMinutes !== undefined && !scheduledEndAt) {
    scheduledEndAt = addMinutes(scheduledStartAt, durationMinutes);
  }

  if (scheduledStartAt === null && scheduledEndAt === null && durationMinutes === null) {
    return {
      hasScheduleChanges: true,
      schedule: {
        scheduledDate: null,
        scheduledStartAt: null,
        scheduledEndAt: null,
        durationMinutes: null,
        localDateKey: null,
      },
    };
  }

  if (!scheduledStartAt) {
    throw new HttpError(
      400,
      "scheduledStartAt is required when providing workshop schedule fields",
      "INVALID_WORKSHOP_SCHEDULE",
    );
  }

  if (!durationMinutes) {
    throw new HttpError(
      400,
      "durationMinutes is required when scheduledStartAt is set",
      "INVALID_WORKSHOP_SCHEDULE",
    );
  }

  const expectedScheduledEndAt = addMinutes(scheduledStartAt, durationMinutes);
  if (!scheduledEndAt) {
    scheduledEndAt = expectedScheduledEndAt;
  }

  if (scheduledEndAt.getTime() !== expectedScheduledEndAt.getTime()) {
    throw new HttpError(
      400,
      "scheduledEndAt must equal scheduledStartAt plus durationMinutes",
      "INVALID_WORKSHOP_SCHEDULE",
    );
  }

  if (scheduledEndAt <= scheduledStartAt) {
    throw new HttpError(
      400,
      "scheduledEndAt must be after scheduledStartAt",
      "INVALID_WORKSHOP_SCHEDULE",
    );
  }

  const settings = await listShopSettings(db);
  const startDateKey = formatDateKeyInTimeZone(scheduledStartAt, settings.store.timeZone);
  const endDateKey = formatDateKeyInTimeZone(scheduledEndAt, settings.store.timeZone);

  if (startDateKey !== endDateKey) {
    throw new HttpError(
      400,
      "Workshop schedules must start and finish on the same operational day",
      "INVALID_WORKSHOP_SCHEDULE",
    );
  }

  return {
    hasScheduleChanges: true,
    schedule: {
      scheduledDate: toUtcDateKey(startDateKey),
      scheduledStartAt,
      scheduledEndAt,
      durationMinutes,
      localDateKey: startDateKey,
    },
  };
};

export const resolveWorkshopAvailabilityForDate = async (
  staffId: string,
  value: Date,
  db: WorkshopCalendarClient = prisma,
): Promise<WorkshopAvailabilityResolution> => {
  const storeDay = await resolveStoreDaySchedule(value, db);
  const dateKey = storeDay.date;
  const dayOfWeek = WORKSHOP_DAY_OF_WEEK[storeDay.weekday] ?? 0;

  const [rotaAssignment, fallbackWorkingHours] = await Promise.all([
    db.rotaAssignment.findUnique({
      where: {
        staffId_date: {
          staffId,
          date: dateKey,
        },
      },
      select: {
        id: true,
        staffId: true,
        date: true,
        shiftType: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    getLegacyWorkshopWorkingHoursForDate(staffId, dayOfWeek, db),
  ]);

  return buildWorkshopAvailabilityForDate({
    staffId,
    dateKey,
    dayOfWeek,
    storeDay,
    rotaAssignment,
    fallbackWorkingHours,
  });
};

export const resolveWorkshopWorkingHoursForDate = async (
  staffId: string,
  value: Date,
  db: WorkshopCalendarClient = prisma,
): Promise<ResolvedWorkshopWorkingHours | null> => {
  const resolution = await resolveWorkshopAvailabilityForDate(staffId, value, db);
  return resolution.workingHours;
};

export const listWorkshopTimeOffForWindow = async (
  input: {
    staffId?: string | null;
    startAt: Date;
    endAt: Date;
  },
  db: WorkshopCalendarClient = prisma,
) => db.workshopTimeOff.findMany({
  where: {
    startAt: { lt: input.endAt },
    endAt: { gt: input.startAt },
    ...(input.staffId
      ? {
          OR: [
            { staffId: null },
            { staffId: input.staffId },
          ],
        }
      : {
          staffId: null,
        }),
  },
  orderBy: [{ startAt: "asc" }],
});

export const findOverlappingWorkshopJobs = async (
  input: {
    workshopJobId?: string;
    staffId: string;
    scheduledStartAt: Date;
    scheduledEndAt: Date;
  },
  db: WorkshopCalendarClient = prisma,
) => db.workshopJob.findMany({
  where: {
    assignedStaffId: input.staffId,
    cancelledAt: null,
    scheduledStartAt: { lt: input.scheduledEndAt },
    scheduledEndAt: { gt: input.scheduledStartAt },
    ...(input.workshopJobId
      ? {
          NOT: {
            id: input.workshopJobId,
          },
        }
      : {}),
  },
  select: {
    id: true,
    bikeDescription: true,
    customerName: true,
    scheduledStartAt: true,
    scheduledEndAt: true,
  },
  orderBy: [{ scheduledStartAt: "asc" }],
});

export const assertWorkshopScheduleAllowed = async (
  input: {
    workshopJobId?: string;
    staffId?: string | null;
    scheduledDate?: Date | null;
    scheduledStartAt: Date | null;
    scheduledEndAt: Date | null;
    durationMinutes: number | null;
  },
  db: WorkshopCalendarClient = prisma,
) => {
  if (!input.scheduledStartAt || !input.scheduledEndAt || !input.durationMinutes) {
    return null;
  }

  const operationalDate = input.scheduledDate ?? input.scheduledStartAt;
  const storeDay = await resolveStoreDaySchedule(operationalDate, db);
  if (storeDay.isClosed) {
    throw new HttpError(
      409,
      storeDay.closedReason ?? "Workshop schedule falls on a closed day",
      "WORKSHOP_SCHEDULE_STORE_CLOSED",
    );
  }

  const storeStartMinutes = clockTimeToMinutes(storeDay.hours.opensAt);
  const storeEndMinutes = clockTimeToMinutes(storeDay.hours.closesAt);
  const startMinutes = getMinutesInTimeZone(input.scheduledStartAt, storeDay.timeZone);
  const endMinutes = getMinutesInTimeZone(input.scheduledEndAt, storeDay.timeZone);

  if (
    storeStartMinutes === null ||
    storeEndMinutes === null ||
    startMinutes < storeStartMinutes ||
    endMinutes > storeEndMinutes
  ) {
    throw new HttpError(
      409,
      "Workshop schedule falls outside store opening hours",
      "WORKSHOP_SCHEDULE_OUTSIDE_STORE_HOURS",
    );
  }

  const workshopWideTimeOff = await listWorkshopTimeOffForWindow(
    {
      startAt: input.scheduledStartAt,
      endAt: input.scheduledEndAt,
    },
    db,
  );

  if (workshopWideTimeOff.length > 0) {
    throw new HttpError(
      409,
      workshopWideTimeOff[0]?.reason?.trim() || "Workshop time off blocks the selected schedule",
      "WORKSHOP_SCHEDULE_TIME_OFF",
    );
  }

  if (!input.staffId) {
    return {
      storeDay,
      workingHours: null,
      timeOff: workshopWideTimeOff,
      overlaps: [],
    };
  }

  const availabilityResolution = await resolveWorkshopAvailabilityForDate(
    input.staffId,
    operationalDate,
    db,
  );
  const workingHours = availabilityResolution.workingHours;

  if (!workingHours) {
    throw new HttpError(
      409,
      availabilityResolution.availability.shiftType === "HOLIDAY"
        ? "Assigned staff member is on holiday for the selected day"
        : availabilityResolution.availability.label === "No rota shift"
          ? "Assigned staff member is not scheduled to work that day"
          : "Assigned staff member has no workshop availability for the selected day",
      "WORKSHOP_SCHEDULE_NO_WORKING_HOURS",
    );
  }

  if (startMinutes < workingHours.startMinutes || endMinutes > workingHours.endMinutes) {
    throw new HttpError(
      409,
      workingHours.source === "ROTA"
        ? "Workshop schedule falls outside the assigned staff rota shift"
        : "Workshop schedule falls outside assigned staff working hours",
      "WORKSHOP_SCHEDULE_OUTSIDE_STAFF_HOURS",
    );
  }

  const staffTimeOff = await listWorkshopTimeOffForWindow(
    {
      staffId: input.staffId,
      startAt: input.scheduledStartAt,
      endAt: input.scheduledEndAt,
    },
    db,
  );

  if (staffTimeOff.length > 0) {
    throw new HttpError(
      409,
      staffTimeOff[0]?.reason?.trim() || "Assigned staff member is unavailable during that time",
      "WORKSHOP_SCHEDULE_TIME_OFF",
    );
  }

  const overlaps = await findOverlappingWorkshopJobs(
    {
      workshopJobId: input.workshopJobId,
      staffId: input.staffId,
      scheduledStartAt: input.scheduledStartAt,
      scheduledEndAt: input.scheduledEndAt,
    },
    db,
  );

  if (overlaps.length > 0) {
    throw new HttpError(
      409,
      "Assigned staff member already has another workshop job in that time slot",
      "WORKSHOP_SCHEDULE_OVERLAP",
    );
  }

  return {
    storeDay,
    workingHours,
    timeOff: staffTimeOff,
    overlaps,
  };
};

const sumMergedMinuteRanges = (ranges: Array<{ startMinutes: number; endMinutes: number }>) => {
  if (ranges.length === 0) {
    return 0;
  }

  const sorted = [...ranges].sort((left, right) => left.startMinutes - right.startMinutes);
  const merged: Array<{ startMinutes: number; endMinutes: number }> = [];

  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (!last || range.startMinutes > last.endMinutes) {
      merged.push({ ...range });
      continue;
    }

    if (range.endMinutes > last.endMinutes) {
      last.endMinutes = range.endMinutes;
    }
  }

  return merged.reduce((sum, range) => sum + Math.max(0, range.endMinutes - range.startMinutes), 0);
};

const clipTimeOffMinutesForDate = (
  dateKey: string,
  timeZone: string,
  workingHours: ResolvedWorkshopWorkingHours | null,
  entries: Array<{ startAt: Date; endAt: Date }>,
) => {
  if (!workingHours || entries.length === 0) {
    return 0;
  }

  const clippedRanges: Array<{ startMinutes: number; endMinutes: number }> = [];
  for (const entry of entries) {
    const startDateKey = formatDateKeyInTimeZone(entry.startAt, timeZone);
    const endDateKey = formatDateKeyInTimeZone(entry.endAt, timeZone);
    const startMinutes = startDateKey < dateKey ? 0 : getMinutesInTimeZone(entry.startAt, timeZone);
    const endMinutes = endDateKey > dateKey ? 24 * 60 : getMinutesInTimeZone(entry.endAt, timeZone);
    const clippedStart = Math.max(workingHours.startMinutes, startMinutes);
    const clippedEnd = Math.min(workingHours.endMinutes, endMinutes);

    if (clippedEnd > clippedStart) {
      clippedRanges.push({
        startMinutes: clippedStart,
        endMinutes: clippedEnd,
      });
    }
  }

  return sumMergedMinuteRanges(clippedRanges);
};

const buildWorkshopCapacitySummary = (
  input: CalendarCapacityContext,
): WorkshopCapacitySummary => {
  const bookedMinutes = input.bookedJobs.reduce((sum, job) => {
    if (job.durationMinutes && job.durationMinutes > 0) {
      return sum + job.durationMinutes;
    }
    if (job.scheduledStartAt && job.scheduledEndAt) {
      return sum + Math.round((job.scheduledEndAt.getTime() - job.scheduledStartAt.getTime()) / 60_000);
    }
    return sum;
  }, 0);

  const totalMinutes = input.workingHours
    ? input.workingHours.endMinutes - input.workingHours.startMinutes
    : 0;
  const timeOffMinutes = clipTimeOffMinutesForDate(
    input.dateKey,
    input.timeZone,
    input.workingHours,
    input.timeOff,
  );

  return {
    staffId: input.workingHours?.staffId ?? "",
    date: input.dateKey,
    totalMinutes,
    bookedMinutes,
    timeOffMinutes,
    availableMinutes: Math.max(0, totalMinutes - bookedMinutes - timeOffMinutes),
  };
};

const toCalendarJobSummary = (job: CalendarScheduledJobRecord) => ({
  id: job.id,
  jobPath: `/workshop/${job.id}`,
  locationId: job.locationId,
  customerId: job.customerId,
  bikeId: job.bikeId,
  customerName: job.customerName,
  bikeDescription: job.bikeDescription,
  summaryText: [job.customerName, job.bikeDescription].filter(Boolean).join(" · "),
  status: toWorkshopExecutionStatus(job),
  rawStatus: job.status,
  assignedStaffId: job.assignedStaffId,
  assignedStaffName: job.assignedStaffName,
  scheduledDate: job.scheduledDate,
  scheduledStartAt: job.scheduledStartAt,
  scheduledEndAt: job.scheduledEndAt,
  durationMinutes: job.durationMinutes,
  notes: job.notes,
  completedAt: job.completedAt,
  closedAt: job.closedAt,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
});

const buildCalendarScheduledJobWhere = (
  input: {
    fromDate: Date;
    toDate: Date;
    locationId?: string | null;
    assignedOnly?: boolean;
  },
): Prisma.WorkshopJobWhereInput => ({
  scheduledDate: {
    gte: input.fromDate,
    lt: addDays(input.toDate, 1),
  },
  scheduledStartAt: {
    not: null,
  },
  scheduledEndAt: {
    not: null,
  },
  status: {
    not: "CANCELLED",
  },
  ...(input.locationId ? { locationId: input.locationId } : {}),
  ...(input.assignedOnly ? { assignedStaffId: { not: null } } : {}),
});

const CALENDAR_JOB_SELECT = {
  id: true,
  locationId: true,
  customerId: true,
  bikeId: true,
  customerName: true,
  bikeDescription: true,
  status: true,
  assignedStaffId: true,
  assignedStaffName: true,
  scheduledDate: true,
  scheduledStartAt: true,
  scheduledEndAt: true,
  durationMinutes: true,
  notes: true,
  completedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WorkshopJobSelect;

export const getWorkshopStaffCapacityForDate = async (
  staffId: string,
  value: Date,
  db: WorkshopCalendarClient = prisma,
): Promise<WorkshopCapacitySummary> => {
  const settings = await listShopSettings(db);
  const availabilityResolution = await resolveWorkshopAvailabilityForDate(staffId, value, db);
  const workingHours = availabilityResolution.workingHours;
  const dateKey = formatDateKeyInTimeZone(value, settings.store.timeZone);

  const scheduledDate = toUtcDateKey(dateKey);
  const [timeOff, scheduledJobs] = await Promise.all([
    listWorkshopTimeOffForWindow(
      {
        staffId,
        startAt: scheduledDate,
        endAt: addMinutes(scheduledDate, 24 * 60),
      },
      db,
    ),
    db.workshopJob.findMany({
      where: {
        assignedStaffId: staffId,
        cancelledAt: null,
        scheduledDate,
        scheduledStartAt: { not: null },
        scheduledEndAt: { not: null },
      },
      select: {
        scheduledStartAt: true,
        scheduledEndAt: true,
        durationMinutes: true,
      },
    }),
  ]);

  const summary = buildWorkshopCapacitySummary({
    dateKey,
    timeZone: settings.store.timeZone,
    workingHours,
    timeOff: timeOff.map((entry) => ({
      startAt: entry.startAt,
      endAt: entry.endAt,
    })),
    bookedJobs: scheduledJobs,
  });

  return {
    ...summary,
    staffId,
  };
};

export const getWorkshopCalendar = async (
  input: {
    from: string;
    to: string;
    locationId?: string | null;
  },
  db: WorkshopCalendarClient = prisma,
) => {
  const locationId = input.locationId?.trim() || null;
  const settings = await listShopSettings(db);
  const { fromDate, toDate } = parseCalendarDateRange({
    from: input.from,
    to: input.to,
  });
  const dateKeys = listDateKeysInclusive(fromDate, toDate);

  const allStaff = await db.user.findMany({
    where: {
      isActive: true,
    },
    select: {
      id: true,
      username: true,
      name: true,
      role: true,
      operationalRole: true,
    },
    orderBy: [
      { name: "asc" },
      { username: "asc" },
    ],
  });

  const usesOperationalRoleTags = allStaff.some((staff) => isWorkshopOperationalRole(staff.operationalRole));
  const calendarStaff = usesOperationalRoleTags
    ? allStaff.filter((staff) => isWorkshopOperationalRole(staff.operationalRole))
    : allStaff;
  const staffIds = calendarStaff.map((staff) => staff.id);

  const [legacyWorkingHours, rotaAssignments, timeOff, visibleScheduledJobs, capacityScheduledJobs, unscheduledJobs, days] = await Promise.all([
    staffIds.length > 0
      ? db.workshopWorkingHours.findMany({
          where: {
            staffId: {
              in: staffIds,
            },
          },
          orderBy: [
            { staffId: "asc" },
            { dayOfWeek: "asc" },
          ],
        })
      : [],
    staffIds.length > 0
      ? db.rotaAssignment.findMany({
          where: {
            staffId: {
              in: staffIds,
            },
            date: {
              in: dateKeys,
            },
          },
          select: {
            id: true,
            staffId: true,
            date: true,
            shiftType: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: [
            { staffId: "asc" },
            { date: "asc" },
          ],
        })
      : [],
    db.workshopTimeOff.findMany({
      where: {
        startAt: {
          lt: addDays(toDate, 1),
        },
        endAt: {
          gt: fromDate,
        },
        ...(staffIds.length > 0
          ? {
              OR: [
                { staffId: null },
                {
                  staffId: {
                    in: staffIds,
                  },
                },
              ],
            }
          : {
              staffId: null,
            }),
      },
      orderBy: [
        { startAt: "asc" },
        { createdAt: "asc" },
      ],
    }),
    db.workshopJob.findMany({
      where: buildCalendarScheduledJobWhere({
        fromDate,
        toDate,
        locationId,
      }),
      select: CALENDAR_JOB_SELECT,
      orderBy: [
        { scheduledStartAt: "asc" },
        { createdAt: "asc" },
      ],
    }) as Promise<CalendarScheduledJobRecord[]>,
    staffIds.length > 0
      ? db.workshopJob.findMany({
          where: {
            ...buildCalendarScheduledJobWhere({
              fromDate,
              toDate,
              locationId,
              assignedOnly: true,
            }),
            assignedStaffId: {
              in: staffIds,
            },
          },
          select: {
            assignedStaffId: true,
            scheduledDate: true,
            scheduledStartAt: true,
            scheduledEndAt: true,
            durationMinutes: true,
          },
        })
      : [],
    db.workshopJob.findMany({
      where: {
        scheduledStartAt: null,
        scheduledEndAt: null,
        closedAt: null,
        status: {
          notIn: ["CANCELLED", "COMPLETED"],
        },
        OR: [
          { scheduledDate: null },
          {
            scheduledDate: {
              gte: fromDate,
              lt: addDays(toDate, 1),
            },
          },
        ],
        ...(locationId ? { locationId } : {}),
      },
      select: CALENDAR_JOB_SELECT,
      orderBy: [
        { scheduledDate: "asc" },
        { createdAt: "asc" },
      ],
    }) as Promise<CalendarScheduledJobRecord[]>,
    Promise.all(
      dateKeys.map((dateKey) => resolveStoreDaySchedule(toDateFromDateKey(dateKey), db)),
    ),
  ]);

  const legacyWorkingHoursByStaffDay = new Map(
    legacyWorkingHours.map((entry) => [`${entry.staffId}:${entry.dayOfWeek}`, entry] as const),
  );
  const rotaAssignmentsByStaffDate = new Map(
    rotaAssignments.map((entry) => [`${entry.staffId}:${entry.date}`, entry] as const),
  );
  const storeDayByDateKey = new Map(days.map((day) => [day.date, day] as const));

  const timeOffByStaff = new Map<string, typeof timeOff>();
  for (const staff of calendarStaff) {
    timeOffByStaff.set(
      staff.id,
      timeOff.filter((entry) => entry.staffId === null || entry.staffId === staff.id),
    );
  }

  const visibleScheduledJobsByStaff = new Map<string, CalendarScheduledJobRecord[]>();
  for (const job of visibleScheduledJobs) {
    if (!job.assignedStaffId) {
      continue;
    }
    const bucket = visibleScheduledJobsByStaff.get(job.assignedStaffId) ?? [];
    bucket.push(job);
    visibleScheduledJobsByStaff.set(job.assignedStaffId, bucket);
  }

  const capacityJobsByStaffDate = new Map<
    string,
    Array<{ scheduledStartAt: Date | null; scheduledEndAt: Date | null; durationMinutes: number | null }>
  >();
  for (const job of capacityScheduledJobs) {
    if (!job.assignedStaffId || !job.scheduledDate) {
      continue;
    }

    const key = `${job.assignedStaffId}:${toDateKey(job.scheduledDate)}`;
    const bucket = capacityJobsByStaffDate.get(key) ?? [];
    bucket.push({
      scheduledStartAt: job.scheduledStartAt,
      scheduledEndAt: job.scheduledEndAt,
      durationMinutes: job.durationMinutes,
    });
    capacityJobsByStaffDate.set(key, bucket);
  }

  return {
    range: {
      from: input.from,
      to: input.to,
      timeZone: settings.store.timeZone,
    },
    locationId,
    usesOperationalRoleTags,
    days: days.map((day) => ({
      date: day.date,
      weekday: day.weekday,
      opensAt: day.isClosed ? null : day.hours.opensAt,
      closesAt: day.isClosed ? null : day.hours.closesAt,
      isClosed: day.isClosed,
      closedReason: day.closedReason,
    })),
    scheduledJobs: visibleScheduledJobs.map(toCalendarJobSummary),
    unassignedJobs: visibleScheduledJobs
      .filter((job) => !job.assignedStaffId)
      .map(toCalendarJobSummary),
    unscheduledJobs: unscheduledJobs.map(toCalendarJobSummary),
    workshopTimeOff: timeOff
      .filter((entry) => entry.staffId === null)
      .map((entry) => ({
        id: entry.id,
        scope: "WORKSHOP" as const,
        staffId: null,
        startAt: entry.startAt,
        endAt: entry.endAt,
        reason: entry.reason,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      })),
    staff: calendarStaff.map((staff) => {
      const relevantTimeOff = timeOffByStaff.get(staff.id) ?? [];
      const availabilityByDate = dateKeys.map((dateKey) => {
        const dayOfWeek = getDayOfWeekForDateKey(dateKey, settings.store.timeZone);
        const storeDay = storeDayByDateKey.get(dateKey);
        if (!storeDay) {
          return buildUnavailableAvailability(dateKey, dayOfWeek, "Store day not available");
        }

        return buildWorkshopAvailabilityForDate({
          staffId: staff.id,
          dateKey,
          dayOfWeek,
          storeDay,
          rotaAssignment: rotaAssignmentsByStaffDate.get(`${staff.id}:${dateKey}`) ?? null,
          fallbackWorkingHours: legacyWorkingHoursByStaffDay.get(`${staff.id}:${dayOfWeek}`) ?? null,
        });
      });

      return {
        id: staff.id,
        name: toStaffDisplayName(staff),
        username: staff.username,
        role: staff.role as UserRole,
        operationalRole: staff.operationalRole,
        workingHours: availabilityByDate.flatMap(({ workingHours }) =>
          workingHours
            ? [
                {
                  id: workingHours.id,
                  date: workingHours.date,
                  dayOfWeek: workingHours.dayOfWeek,
                  startTime: workingHours.startTime,
                  endTime: workingHours.endTime,
                  totalMinutes: Math.max(0, workingHours.endMinutes - workingHours.startMinutes),
                  source: workingHours.source,
                  shiftType: workingHours.shiftType,
                  label: workingHours.label,
                },
              ]
            : [],
        ),
        availability: availabilityByDate.map(({ availability }) => availability),
        timeOff: relevantTimeOff.map((entry) => ({
          id: entry.id,
          scope: entry.staffId ? ("STAFF" as const) : ("WORKSHOP" as const),
          staffId: entry.staffId,
          startAt: entry.startAt,
          endAt: entry.endAt,
          reason: entry.reason,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        })),
        dailyCapacity: availabilityByDate.map(({ availability, workingHours }) => ({
            ...buildWorkshopCapacitySummary({
              dateKey: availability.date,
              timeZone: settings.store.timeZone,
              workingHours,
              timeOff: relevantTimeOff.map((entry) => ({
                startAt: entry.startAt,
                endAt: entry.endAt,
              })),
              bookedJobs: capacityJobsByStaffDate.get(`${staff.id}:${availability.date}`) ?? [],
            }),
            staffId: staff.id,
          })),
        scheduledJobs: (visibleScheduledJobsByStaff.get(staff.id) ?? []).map(toCalendarJobSummary),
      };
    }),
  };
};
