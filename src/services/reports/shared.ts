import { WorkshopJobStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { HttpError, isUuid } from "../../utils/http";

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export type DateRange = {
  from: string;
  to: string;
};

export type TakeRange = DateRange & {
  take: number;
};

type DailyMoneyRow = {
  date: string;
  amountPence: number;
};

export const parseDateOnlyOrThrow = (value: string, field: "from" | "to") => {
  if (!DATE_ONLY_REGEX.test(value)) {
    throw new HttpError(400, `${field} must be YYYY-MM-DD`, "INVALID_DATE");
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${field} is invalid`, "INVALID_DATE");
  }

  return date;
};

export const getDateRangeOrThrow = (from?: string, to?: string): DateRange => {
  if (!from || !to) {
    throw new HttpError(400, "from and to are required", "INVALID_DATE_RANGE");
  }

  const fromDate = parseDateOnlyOrThrow(from, "from");
  const toDate = parseDateOnlyOrThrow(to, "to");

  if (fromDate > toDate) {
    throw new HttpError(400, "from must be before or equal to to", "INVALID_DATE_RANGE");
  }

  return { from, to };
};

export const getDateRangeWithTakeOrThrow = (from?: string, to?: string, take?: number): TakeRange => {
  const range = getDateRangeOrThrow(from, to);

  const normalizedTake = take ?? 20;
  if (!Number.isInteger(normalizedTake) || normalizedTake < 1 || normalizedTake > 100) {
    throw new HttpError(400, "take must be an integer between 1 and 100", "INVALID_TAKE");
  }

  return {
    ...range,
    take: normalizedTake,
  };
};

export const toNumber = (value: unknown): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (
    value !== null &&
    typeof value === "object" &&
    "toNumber" in value &&
    typeof (value as { toNumber: unknown }).toNumber === "function"
  ) {
    const parsed = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value === null || value === undefined) {
    return 0;
  }
  return 0;
};

export const toInteger = (value: unknown): number => Math.trunc(toNumber(value));

export const addDaysUtc = (date: Date, days: number) => {
  const out = new Date(date);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
};

export const listDateKeys = (from: string, to: string): string[] => {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);

  const keys: string[] = [];
  let current = start;
  while (current <= end) {
    keys.push(current.toISOString().slice(0, 10));
    current = addDaysUtc(current, 1);
  }

  return keys;
};

export const buildDailyAmountMap = (rows: DailyMoneyRow[]) => {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.date, row.amountPence);
  }
  return map;
};

export const assertLocationIdOrThrow = async (locationId?: string) => {
  if (!locationId || !isUuid(locationId)) {
    throw new HttpError(400, "locationId must be a valid UUID", "INVALID_LOCATION_ID");
  }

  const location = await prisma.stockLocation.findUnique({
    where: { id: locationId },
    select: { id: true },
  });

  if (!location) {
    throw new HttpError(404, "Stock location not found", "LOCATION_NOT_FOUND");
  }

  return locationId;
};

export const parseActiveFilterOrThrow = (value?: string) => {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") {
    return true;
  }
  if (normalized === "0" || normalized === "false") {
    return false;
  }

  throw new HttpError(400, "active must be 1, 0, true, or false", "INVALID_FILTER");
};

export const normalizeOptionalSearch = (value?: string) => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export { getCustomerDisplayName as toCustomerDisplayName } from "../../utils/customerName";

export const toPositiveIntWithinRangeOrThrow = (
  value: number | undefined,
  field: string,
  min: number,
  max: number,
  fallback: number,
) => {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new HttpError(400, `${field} must be an integer between ${min} and ${max}`, "INVALID_REPORT_FILTER");
  }
  return resolved;
};

export const OPEN_WORKSHOP_STATUSES = new Set<WorkshopJobStatus>([
  "BOOKED",
  "BIKE_ARRIVED",
  "IN_PROGRESS",
  "WAITING_FOR_APPROVAL",
  "WAITING_FOR_PARTS",
  "ON_HOLD",
  "READY_FOR_COLLECTION",
]);

export const REMINDER_OPEN_STATUSES: WorkshopJobStatus[] = [
  "BOOKED",
  "BIKE_ARRIVED",
  "IN_PROGRESS",
  "WAITING_FOR_APPROVAL",
  "WAITING_FOR_PARTS",
  "ON_HOLD",
  "READY_FOR_COLLECTION",
];
