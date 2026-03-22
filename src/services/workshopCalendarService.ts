import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";
import { listShopSettings } from "./configurationService";
import { resolveStoreDaySchedule } from "./storeScheduleService";
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
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  startMinutes: number;
  endMinutes: number;
  createdAt: Date;
  updatedAt: Date;
};

export type WorkshopCapacitySummary = {
  staffId: string;
  date: string;
  totalMinutes: number;
  bookedMinutes: number;
  timeOffMinutes: number;
  availableMinutes: number;
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

const hasOwn = <T extends object>(value: T, key: keyof T) =>
  Object.prototype.hasOwnProperty.call(value, key);

const toUtcDateKey = (value: string) => new Date(`${value}T00:00:00.000Z`);

const addMinutes = (value: Date, minutes: number) => new Date(value.getTime() + (minutes * 60_000));

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
  const hasScheduleChanges =
    hasOwn(input, "scheduledStartAt") ||
    hasOwn(input, "scheduledEndAt") ||
    hasOwn(input, "durationMinutes");

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

  const parsedStart = parseScheduledDateTime(input.scheduledStartAt, "scheduledStartAt");
  const parsedEnd = parseScheduledDateTime(input.scheduledEndAt, "scheduledEndAt");
  const parsedDuration = parseDurationMinutes(input.durationMinutes);

  const clearRequested =
    (parsedStart === null || parsedEnd === null || parsedDuration === null) &&
    !(parsedStart instanceof Date) &&
    !(parsedEnd instanceof Date) &&
    parsedDuration !== undefined;

  if (clearRequested) {
    return {
      hasScheduleChanges: true,
      schedule: {
        scheduledDate: current.scheduledDate,
        scheduledStartAt: null,
        scheduledEndAt: null,
        durationMinutes: null,
        localDateKey: null,
      },
    };
  }

  let scheduledStartAt =
    parsedStart !== undefined ? parsedStart : current.scheduledStartAt;
  let scheduledEndAt =
    parsedEnd !== undefined ? parsedEnd : current.scheduledEndAt;
  let durationMinutes =
    parsedDuration !== undefined ? parsedDuration : current.durationMinutes;

  if (scheduledStartAt && durationMinutes !== null && durationMinutes !== undefined && !scheduledEndAt) {
    scheduledEndAt = addMinutes(scheduledStartAt, durationMinutes);
  }

  if (scheduledStartAt === null && scheduledEndAt === null && durationMinutes === null) {
    return {
      hasScheduleChanges: true,
      schedule: {
        scheduledDate: current.scheduledDate,
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

export const resolveWorkshopWorkingHoursForDate = async (
  staffId: string,
  value: Date,
  db: WorkshopCalendarClient = prisma,
): Promise<ResolvedWorkshopWorkingHours | null> => {
  const settings = await listShopSettings(db);
  const weekdayKey = getStoreWeekdayKeyForDate(value, settings.store.timeZone);
  const dayOfWeek = WORKSHOP_DAY_OF_WEEK[weekdayKey] ?? 0;

  const workingHours = await db.workshopWorkingHours.findUnique({
    where: {
      staffId_dayOfWeek: {
        staffId,
        dayOfWeek,
      },
    },
  });

  if (!workingHours) {
    return null;
  }

  const startMinutes = clockTimeToMinutes(workingHours.startTime);
  const endMinutes = clockTimeToMinutes(workingHours.endTime);

  if (startMinutes === null || endMinutes === null || startMinutes >= endMinutes) {
    throw new HttpError(
      500,
      "Workshop working hours are misconfigured",
      "INVALID_WORKSHOP_WORKING_HOURS",
    );
  }

  return {
    ...workingHours,
    startMinutes,
    endMinutes,
  };
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
    scheduledStartAt: Date | null;
    scheduledEndAt: Date | null;
    durationMinutes: number | null;
  },
  db: WorkshopCalendarClient = prisma,
) => {
  if (!input.scheduledStartAt || !input.scheduledEndAt || !input.durationMinutes) {
    return null;
  }

  const storeDay = await resolveStoreDaySchedule(input.scheduledStartAt, db);
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

  const workingHours = await resolveWorkshopWorkingHoursForDate(
    input.staffId,
    input.scheduledStartAt,
    db,
  );

  if (!workingHours) {
    throw new HttpError(
      409,
      "Assigned staff member has no workshop working hours for the selected day",
      "WORKSHOP_SCHEDULE_NO_WORKING_HOURS",
    );
  }

  if (startMinutes < workingHours.startMinutes || endMinutes > workingHours.endMinutes) {
    throw new HttpError(
      409,
      "Workshop schedule falls outside assigned staff working hours",
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

const sumMergedMinutes = (ranges: Array<{ startAt: Date; endAt: Date }>) => {
  if (ranges.length === 0) {
    return 0;
  }

  const sorted = [...ranges].sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
  const merged: Array<{ startAt: Date; endAt: Date }> = [];

  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (!last || range.startAt > last.endAt) {
      merged.push({ startAt: range.startAt, endAt: range.endAt });
      continue;
    }

    if (range.endAt > last.endAt) {
      last.endAt = range.endAt;
    }
  }

  return merged.reduce(
    (sum, range) => sum + Math.max(0, Math.round((range.endAt.getTime() - range.startAt.getTime()) / 60_000)),
    0,
  );
};

export const getWorkshopStaffCapacityForDate = async (
  staffId: string,
  value: Date,
  db: WorkshopCalendarClient = prisma,
): Promise<WorkshopCapacitySummary> => {
  const settings = await listShopSettings(db);
  const workingHours = await resolveWorkshopWorkingHoursForDate(staffId, value, db);
  const dateKey = formatDateKeyInTimeZone(value, settings.store.timeZone);

  if (!workingHours) {
    return {
      staffId,
      date: dateKey,
      totalMinutes: 0,
      bookedMinutes: 0,
      timeOffMinutes: 0,
      availableMinutes: 0,
    };
  }

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

  const totalMinutes = workingHours.endMinutes - workingHours.startMinutes;
  const bookedMinutes = scheduledJobs.reduce((sum, job) => {
    if (job.durationMinutes && job.durationMinutes > 0) {
      return sum + job.durationMinutes;
    }
    if (job.scheduledStartAt && job.scheduledEndAt) {
      return sum + Math.round((job.scheduledEndAt.getTime() - job.scheduledStartAt.getTime()) / 60_000);
    }
    return sum;
  }, 0);

  const timeOffMinutes = sumMergedMinutes(
    timeOff.map((entry) => ({
      startAt: entry.startAt,
      endAt: entry.endAt,
    })),
  );

  return {
    staffId,
    date: dateKey,
    totalMinutes,
    bookedMinutes,
    timeOffMinutes,
    availableMinutes: Math.max(0, totalMinutes - bookedMinutes - timeOffMinutes),
  };
};
