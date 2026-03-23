import { BikeServiceScheduleType, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";

export const BIKE_SERVICE_SCHEDULE_DUE_WINDOW_DAYS = 30;

export const BIKE_SERVICE_SCHEDULE_TYPES = [
  "GENERAL_SERVICE",
  "SAFETY_CHECK",
  "BRAKES",
  "DRIVETRAIN",
  "SUSPENSION",
  "E_BIKE_SYSTEM",
  "TYRES",
  "OTHER",
] as const satisfies readonly BikeServiceScheduleType[];

export type BikeServiceScheduleDueStatus = "UPCOMING" | "DUE" | "OVERDUE" | "INACTIVE";

export type CreateBikeServiceScheduleInput = {
  type?: string | null;
  title?: string | null;
  description?: string | null;
  intervalMonths?: number | null;
  intervalMileage?: number | null;
  lastServiceAt?: string | Date | null;
  lastServiceMileage?: number | null;
  nextDueAt?: string | Date | null;
  nextDueMileage?: number | null;
  isActive?: boolean;
};

export type UpdateBikeServiceScheduleInput = {
  type?: string | null;
  title?: string | null;
  description?: string | null;
  intervalMonths?: number | null;
  intervalMileage?: number | null;
  lastServiceAt?: string | Date | null;
  lastServiceMileage?: number | null;
  nextDueAt?: string | Date | null;
  nextDueMileage?: number | null;
  isActive?: boolean;
};

export type MarkBikeServiceScheduleServicedInput = {
  servicedAt?: string | Date | null;
  servicedMileage?: number | null;
};

const BIKE_SERVICE_SCHEDULE_TYPE_LABELS: Record<BikeServiceScheduleType, string> = {
  GENERAL_SERVICE: "General service",
  SAFETY_CHECK: "Safety check",
  BRAKES: "Brakes",
  DRIVETRAIN: "Drivetrain",
  SUSPENSION: "Suspension",
  E_BIKE_SYSTEM: "E-bike system",
  TYRES: "Tyres",
  OTHER: "Other",
};

const bikeServiceScheduleTypeSet = new Set<string>(BIKE_SERVICE_SCHEDULE_TYPES);

const bikeServiceScheduleSelect = Prisma.validator<Prisma.BikeServiceScheduleSelect>()({
  id: true,
  bikeId: true,
  type: true,
  title: true,
  description: true,
  intervalMonths: true,
  intervalMileage: true,
  lastServiceAt: true,
  lastServiceMileage: true,
  nextDueAt: true,
  nextDueMileage: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
});

type BikeServiceScheduleRecord = Prisma.BikeServiceScheduleGetPayload<{
  select: typeof bikeServiceScheduleSelect;
}>;

const normalizeOptionalText = (value: string | null | undefined) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const defaultScheduleTitle = (type: BikeServiceScheduleType) =>
  BIKE_SERVICE_SCHEDULE_TYPE_LABELS[type];

const normalizeScheduleType = (
  value: string | null | undefined,
  code: string,
): BikeServiceScheduleType | undefined => {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return undefined;
  }

  const canonical = normalized.toUpperCase().replace(/[\s-]+/g, "_");
  if (!bikeServiceScheduleTypeSet.has(canonical)) {
    throw new HttpError(
      400,
      `type must be one of ${BIKE_SERVICE_SCHEDULE_TYPES.join(", ")}`,
      code,
    );
  }

  return canonical as BikeServiceScheduleType;
};

const normalizePositiveInteger = (
  value: number | null | undefined,
  field: string,
  code: string,
): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new HttpError(400, `${field} must be a positive integer`, code);
  }

  return value;
};

const normalizeMileageInteger = (
  value: number | null | undefined,
  field: string,
  code: string,
): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new HttpError(400, `${field} must be zero or a positive integer`, code);
  }

  return value;
};

const parseOptionalDateValue = (
  value: string | Date | null | undefined,
  field: string,
  code: string,
): Date | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const parsed = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : value instanceof Date
      ? new Date(value.getTime())
      : new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, `${field} must be a valid date`, code);
  }

  return parsed;
};

const startOfUtcDay = (value: Date) =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

const addDaysUtc = (value: Date, days: number) => {
  const next = new Date(value.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const addMonthsUtc = (value: Date, months: number) => {
  const year = value.getUTCFullYear();
  const monthIndex = value.getUTCMonth();
  const day = value.getUTCDate();
  const targetMonthIndex = monthIndex + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedTargetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetYear, normalizedTargetMonth + 1, 0),
  ).getUTCDate();

  return new Date(
    Date.UTC(
      targetYear,
      normalizedTargetMonth,
      Math.min(day, lastDayOfTargetMonth),
      value.getUTCHours(),
      value.getUTCMinutes(),
      value.getUTCSeconds(),
      value.getUTCMilliseconds(),
    ),
  );
};

const deriveNextDueAt = (lastServiceAt: Date | null, intervalMonths: number | null) => {
  if (!lastServiceAt || !intervalMonths) {
    return null;
  }

  return addMonthsUtc(lastServiceAt, intervalMonths);
};

const deriveNextDueMileage = (
  lastServiceMileage: number | null,
  intervalMileage: number | null,
) => {
  if (lastServiceMileage === null || intervalMileage === null) {
    return null;
  }

  return lastServiceMileage + intervalMileage;
};

const validateScheduleChronology = (input: {
  lastServiceAt: Date | null;
  nextDueAt: Date | null;
  lastServiceMileage: number | null;
  nextDueMileage: number | null;
}) => {
  if (input.lastServiceAt && input.nextDueAt && input.nextDueAt < input.lastServiceAt) {
    throw new HttpError(
      400,
      "nextDueAt cannot be earlier than lastServiceAt",
      "INVALID_BIKE_SERVICE_SCHEDULE_STATE",
    );
  }

  if (
    input.lastServiceMileage !== null
    && input.nextDueMileage !== null
    && input.nextDueMileage < input.lastServiceMileage
  ) {
    throw new HttpError(
      400,
      "nextDueMileage cannot be lower than lastServiceMileage",
      "INVALID_BIKE_SERVICE_SCHEDULE_STATE",
    );
  }
};

const validateScheduleActionability = (input: {
  isActive: boolean;
  nextDueAt: Date | null;
  nextDueMileage: number | null;
}) => {
  if (!input.isActive) {
    return;
  }

  if (!input.nextDueAt && input.nextDueMileage === null) {
    throw new HttpError(
      400,
      "Active schedules need a next due date, next due mileage, or enough interval data to derive one",
      "INVALID_BIKE_SERVICE_SCHEDULE_STATE",
    );
  }
};

const assertCustomerBikeExistsTx = async (
  tx: Prisma.TransactionClient | typeof prisma,
  bikeId: string,
) => {
  if (!isUuid(bikeId)) {
    throw new HttpError(400, "Invalid customer bike id", "INVALID_CUSTOMER_BIKE_ID");
  }

  const bike = await tx.customerBike.findUnique({
    where: { id: bikeId },
    select: { id: true },
  });

  if (!bike) {
    throw new HttpError(404, "Bike record not found", "CUSTOMER_BIKE_NOT_FOUND");
  }

  return bike;
};

const getBikeServiceScheduleByIdTx = async (
  tx: Prisma.TransactionClient | typeof prisma,
  bikeId: string,
  scheduleId: string,
) => {
  await assertCustomerBikeExistsTx(tx, bikeId);

  if (!isUuid(scheduleId)) {
    throw new HttpError(
      400,
      "Invalid bike service schedule id",
      "INVALID_BIKE_SERVICE_SCHEDULE_ID",
    );
  }

  const schedule = await tx.bikeServiceSchedule.findUnique({
    where: { id: scheduleId },
    select: bikeServiceScheduleSelect,
  });

  if (!schedule || schedule.bikeId !== bikeId) {
    throw new HttpError(404, "Bike service schedule not found", "BIKE_SERVICE_SCHEDULE_NOT_FOUND");
  }

  return schedule;
};

const toDueStatus = (
  schedule: Pick<BikeServiceScheduleRecord, "isActive" | "nextDueAt" | "nextDueMileage">,
  now = new Date(),
): BikeServiceScheduleDueStatus => {
  if (!schedule.isActive) {
    return "INACTIVE";
  }

  if (schedule.nextDueAt) {
    const today = startOfUtcDay(now);
    const dueWindowEnd = addDaysUtc(today, BIKE_SERVICE_SCHEDULE_DUE_WINDOW_DAYS);

    if (schedule.nextDueAt < today) {
      return "OVERDUE";
    }

    if (schedule.nextDueAt <= dueWindowEnd) {
      return "DUE";
    }

    return "UPCOMING";
  }

  if (schedule.nextDueMileage !== null) {
    return "UPCOMING";
  }

  return "UPCOMING";
};

const formatMileage = (value: number) => `${value.toLocaleString()} miles`;

const formatDate = (value: Date | null) =>
  value
    ? value.toLocaleDateString("en-GB", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

const buildCadenceSummaryText = (schedule: Pick<
  BikeServiceScheduleRecord,
  "intervalMonths" | "intervalMileage"
>) => {
  const parts: string[] = [];

  if (schedule.intervalMonths) {
    parts.push(
      `Every ${schedule.intervalMonths} month${schedule.intervalMonths === 1 ? "" : "s"}`,
    );
  }

  if (schedule.intervalMileage) {
    parts.push(`Every ${formatMileage(schedule.intervalMileage)}`);
  }

  return parts.length > 0 ? parts.join(" or ") : "Manual schedule";
};

const buildLastServiceSummaryText = (schedule: Pick<
  BikeServiceScheduleRecord,
  "lastServiceAt" | "lastServiceMileage"
>) => {
  const parts = [formatDate(schedule.lastServiceAt)];
  if (schedule.lastServiceMileage !== null) {
    parts.push(formatMileage(schedule.lastServiceMileage));
  }

  const filtered = parts.filter(Boolean);
  return filtered.length > 0 ? `Last serviced ${filtered.join(" · ")}` : "No last service logged yet";
};

const buildDueSummaryText = (
  schedule: Pick<BikeServiceScheduleRecord, "isActive" | "nextDueAt" | "nextDueMileage">,
  dueStatus: BikeServiceScheduleDueStatus,
) => {
  if (!schedule.isActive) {
    return "Inactive";
  }

  const dueDate = formatDate(schedule.nextDueAt);
  const dueMileage = schedule.nextDueMileage !== null ? formatMileage(schedule.nextDueMileage) : null;
  const joinedDueTarget = [dueDate, dueMileage].filter(Boolean).join(" · ");

  if (!joinedDueTarget) {
    return "Next due date not set";
  }

  switch (dueStatus) {
    case "OVERDUE":
      return `Overdue ${joinedDueTarget}`;
    case "DUE":
      return `Due ${joinedDueTarget}`;
    default:
      return `Next due ${joinedDueTarget}`;
  }
};

const scheduleSortRank: Record<BikeServiceScheduleDueStatus, number> = {
  OVERDUE: 0,
  DUE: 1,
  UPCOMING: 2,
  INACTIVE: 3,
};

export const serializeBikeServiceSchedule = (
  schedule: BikeServiceScheduleRecord,
  now = new Date(),
) => {
  const dueStatus = toDueStatus(schedule, now);

  return {
    id: schedule.id,
    bikeId: schedule.bikeId,
    type: schedule.type,
    typeLabel: BIKE_SERVICE_SCHEDULE_TYPE_LABELS[schedule.type],
    title: schedule.title,
    description: schedule.description,
    intervalMonths: schedule.intervalMonths,
    intervalMileage: schedule.intervalMileage,
    lastServiceAt: schedule.lastServiceAt,
    lastServiceMileage: schedule.lastServiceMileage,
    nextDueAt: schedule.nextDueAt,
    nextDueMileage: schedule.nextDueMileage,
    isActive: schedule.isActive,
    dueStatus,
    dueSummaryText: buildDueSummaryText(schedule, dueStatus),
    cadenceSummaryText: buildCadenceSummaryText(schedule),
    lastServiceSummaryText: buildLastServiceSummaryText(schedule),
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt,
  };
};

export const summarizeBikeServiceSchedules = (
  schedules: BikeServiceScheduleRecord[],
  now = new Date(),
) => {
  const serialized = schedules.map((schedule) => serializeBikeServiceSchedule(schedule, now));
  const activeSchedules = serialized.filter((schedule) => schedule.isActive);
  const dueSchedules = activeSchedules.filter((schedule) => schedule.dueStatus === "DUE");
  const overdueSchedules = activeSchedules.filter((schedule) => schedule.dueStatus === "OVERDUE");
  const upcomingSchedules = activeSchedules.filter((schedule) => schedule.dueStatus === "UPCOMING");
  const sortedSchedules = [...serialized].sort((left, right) => {
    const rankDelta = scheduleSortRank[left.dueStatus] - scheduleSortRank[right.dueStatus];
    if (rankDelta !== 0) {
      return rankDelta;
    }

    const leftDue = left.nextDueAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const rightDue = right.nextDueAt?.getTime() ?? Number.POSITIVE_INFINITY;
    if (leftDue !== rightDue) {
      return leftDue - rightDue;
    }

    return right.updatedAt.getTime() - left.updatedAt.getTime();
  });

  const primarySchedule = sortedSchedules[0] ?? null;

  return {
    activeCount: activeSchedules.length,
    inactiveCount: serialized.length - activeSchedules.length,
    dueCount: dueSchedules.length,
    overdueCount: overdueSchedules.length,
    upcomingCount: upcomingSchedules.length,
    primarySchedule,
  };
};

const normalizeCreateInput = (input: CreateBikeServiceScheduleInput) => {
  const type = normalizeScheduleType(
    input.type,
    "INVALID_BIKE_SERVICE_SCHEDULE_TYPE",
  );
  if (!type) {
    throw new HttpError(400, "type is required", "INVALID_BIKE_SERVICE_SCHEDULE");
  }

  const title = normalizeOptionalText(input.title) ?? defaultScheduleTitle(type);
  const description = normalizeOptionalText(input.description) ?? null;
  const intervalMonths = normalizePositiveInteger(
    input.intervalMonths,
    "intervalMonths",
    "INVALID_BIKE_SERVICE_SCHEDULE_INTERVAL",
  ) ?? null;
  const intervalMileage = normalizePositiveInteger(
    input.intervalMileage,
    "intervalMileage",
    "INVALID_BIKE_SERVICE_SCHEDULE_INTERVAL",
  ) ?? null;
  const lastServiceAt = parseOptionalDateValue(
    input.lastServiceAt,
    "lastServiceAt",
    "INVALID_BIKE_SERVICE_SCHEDULE_DATE",
  ) ?? null;
  const lastServiceMileage = normalizeMileageInteger(
    input.lastServiceMileage,
    "lastServiceMileage",
    "INVALID_BIKE_SERVICE_SCHEDULE_MILEAGE",
  ) ?? null;
  const nextDueAt = input.nextDueAt !== undefined
    ? parseOptionalDateValue(
        input.nextDueAt,
        "nextDueAt",
        "INVALID_BIKE_SERVICE_SCHEDULE_DATE",
      ) ?? null
    : deriveNextDueAt(lastServiceAt, intervalMonths);
  const nextDueMileage = input.nextDueMileage !== undefined
    ? normalizeMileageInteger(
        input.nextDueMileage,
        "nextDueMileage",
        "INVALID_BIKE_SERVICE_SCHEDULE_MILEAGE",
      ) ?? null
    : deriveNextDueMileage(lastServiceMileage, intervalMileage);
  const isActive = input.isActive ?? true;

  validateScheduleChronology({
    lastServiceAt,
    nextDueAt,
    lastServiceMileage,
    nextDueMileage,
  });
  validateScheduleActionability({
    isActive,
    nextDueAt,
    nextDueMileage,
  });

  return {
    type,
    title,
    description,
    intervalMonths,
    intervalMileage,
    lastServiceAt,
    lastServiceMileage,
    nextDueAt,
    nextDueMileage,
    isActive,
  };
};

export const listBikeServiceSchedules = async (
  bikeId: string,
  options: { includeInactive?: boolean } = {},
) => {
  await assertCustomerBikeExistsTx(prisma, bikeId);

  const schedules = await prisma.bikeServiceSchedule.findMany({
    where: {
      bikeId,
      ...(options.includeInactive ? {} : { isActive: true }),
    },
    orderBy: [{ isActive: "desc" }, { nextDueAt: "asc" }, { updatedAt: "desc" }],
    select: bikeServiceScheduleSelect,
  });

  const summary = summarizeBikeServiceSchedules(schedules);

  return {
    bikeId,
    schedules: schedules.map((schedule) => serializeBikeServiceSchedule(schedule)),
    summary,
  };
};

export const createBikeServiceSchedule = async (
  bikeId: string,
  input: CreateBikeServiceScheduleInput,
) => {
  const normalized = normalizeCreateInput(input);

  return prisma.$transaction(async (tx) => {
    await assertCustomerBikeExistsTx(tx, bikeId);

    const schedule = await tx.bikeServiceSchedule.create({
      data: {
        bikeId,
        ...normalized,
      },
      select: bikeServiceScheduleSelect,
    });

    return {
      schedule: serializeBikeServiceSchedule(schedule),
    };
  });
};

export const updateBikeServiceSchedule = async (
  bikeId: string,
  scheduleId: string,
  input: UpdateBikeServiceScheduleInput,
) => {
  return prisma.$transaction(async (tx) => {
    const existing = await getBikeServiceScheduleByIdTx(tx, bikeId, scheduleId);

    const type = input.type !== undefined
      ? normalizeScheduleType(input.type, "INVALID_BIKE_SERVICE_SCHEDULE_TYPE") ?? existing.type
      : existing.type;
    const title = input.title !== undefined
      ? normalizeOptionalText(input.title) ?? defaultScheduleTitle(type)
      : existing.title;
    const description = input.description !== undefined
      ? normalizeOptionalText(input.description) ?? null
      : existing.description;
    const intervalMonths = input.intervalMonths !== undefined
      ? normalizePositiveInteger(
          input.intervalMonths,
          "intervalMonths",
          "INVALID_BIKE_SERVICE_SCHEDULE_INTERVAL",
        ) ?? null
      : existing.intervalMonths;
    const intervalMileage = input.intervalMileage !== undefined
      ? normalizePositiveInteger(
          input.intervalMileage,
          "intervalMileage",
          "INVALID_BIKE_SERVICE_SCHEDULE_INTERVAL",
        ) ?? null
      : existing.intervalMileage;
    const lastServiceAt = input.lastServiceAt !== undefined
      ? parseOptionalDateValue(
          input.lastServiceAt,
          "lastServiceAt",
          "INVALID_BIKE_SERVICE_SCHEDULE_DATE",
        ) ?? null
      : existing.lastServiceAt;
    const lastServiceMileage = input.lastServiceMileage !== undefined
      ? normalizeMileageInteger(
          input.lastServiceMileage,
          "lastServiceMileage",
          "INVALID_BIKE_SERVICE_SCHEDULE_MILEAGE",
        ) ?? null
      : existing.lastServiceMileage;
    const nextDueAt = input.nextDueAt !== undefined
      ? parseOptionalDateValue(
          input.nextDueAt,
          "nextDueAt",
          "INVALID_BIKE_SERVICE_SCHEDULE_DATE",
        ) ?? null
      : (input.lastServiceAt !== undefined || input.intervalMonths !== undefined)
        ? deriveNextDueAt(lastServiceAt, intervalMonths)
        : existing.nextDueAt;
    const nextDueMileage = input.nextDueMileage !== undefined
      ? normalizeMileageInteger(
          input.nextDueMileage,
          "nextDueMileage",
          "INVALID_BIKE_SERVICE_SCHEDULE_MILEAGE",
        ) ?? null
      : (input.lastServiceMileage !== undefined || input.intervalMileage !== undefined)
        ? deriveNextDueMileage(lastServiceMileage, intervalMileage)
        : existing.nextDueMileage;
    const isActive = input.isActive !== undefined ? input.isActive : existing.isActive;

    validateScheduleChronology({
      lastServiceAt,
      nextDueAt,
      lastServiceMileage,
      nextDueMileage,
    });
    validateScheduleActionability({
      isActive,
      nextDueAt,
      nextDueMileage,
    });

    const updated = await tx.bikeServiceSchedule.update({
      where: { id: existing.id },
      data: {
        type,
        title,
        description,
        intervalMonths,
        intervalMileage,
        lastServiceAt,
        lastServiceMileage,
        nextDueAt,
        nextDueMileage,
        isActive,
      },
      select: bikeServiceScheduleSelect,
    });

    return {
      schedule: serializeBikeServiceSchedule(updated),
    };
  });
};

export const markBikeServiceScheduleServiced = async (
  bikeId: string,
  scheduleId: string,
  input: MarkBikeServiceScheduleServicedInput,
) => {
  return prisma.$transaction(async (tx) => {
    const existing = await getBikeServiceScheduleByIdTx(tx, bikeId, scheduleId);

    if (existing.intervalMonths === null && existing.intervalMileage === null) {
      throw new HttpError(
        400,
        "Add a service interval before using mark serviced on this schedule",
        "INVALID_BIKE_SERVICE_SCHEDULE_STATE",
      );
    }

    const servicedAt = parseOptionalDateValue(
      input.servicedAt === undefined ? new Date() : input.servicedAt,
      "servicedAt",
      "INVALID_BIKE_SERVICE_SCHEDULE_DATE",
    ) ?? new Date();
    const servicedMileage = normalizeMileageInteger(
      input.servicedMileage,
      "servicedMileage",
      "INVALID_BIKE_SERVICE_SCHEDULE_MILEAGE",
    ) ?? null;

    if (existing.intervalMileage !== null && servicedMileage === null) {
      throw new HttpError(
        400,
        "servicedMileage is required for mileage-based schedules",
        "INVALID_BIKE_SERVICE_SCHEDULE_MILEAGE",
      );
    }

    const nextDueAt = deriveNextDueAt(servicedAt, existing.intervalMonths);
    const nextDueMileage = deriveNextDueMileage(servicedMileage, existing.intervalMileage);

    validateScheduleChronology({
      lastServiceAt: servicedAt,
      nextDueAt,
      lastServiceMileage: servicedMileage,
      nextDueMileage,
    });
    validateScheduleActionability({
      isActive: existing.isActive,
      nextDueAt,
      nextDueMileage,
    });

    const updated = await tx.bikeServiceSchedule.update({
      where: { id: existing.id },
      data: {
        lastServiceAt: servicedAt,
        lastServiceMileage: servicedMileage,
        nextDueAt,
        nextDueMileage,
      },
      select: bikeServiceScheduleSelect,
    });

    return {
      schedule: serializeBikeServiceSchedule(updated),
    };
  });
};

export { bikeServiceScheduleSelect };
