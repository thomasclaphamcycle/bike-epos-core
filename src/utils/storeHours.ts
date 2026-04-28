export const STORE_WEEKDAY_KEYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const;

export type StoreWeekdayKey = typeof STORE_WEEKDAY_KEYS[number];

export type StoreDailyOpeningHours = {
  isClosed: boolean;
  opensAt: string;
  closesAt: string;
};

export type StoreOpeningHoursSettings = Record<StoreWeekdayKey, StoreDailyOpeningHours>;

export const STORE_WEEKDAY_LABELS: Record<StoreWeekdayKey, string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
  SATURDAY: "Saturday",
  SUNDAY: "Sunday",
};

export const DEFAULT_STORE_OPENING_HOURS: StoreOpeningHoursSettings = {
  MONDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
  TUESDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
  WEDNESDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
  THURSDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
  FRIDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
  SATURDAY: { isClosed: false, opensAt: "09:00", closesAt: "16:30" },
  SUNDAY: { isClosed: true, opensAt: "", closesAt: "" },
};

const DAY_NAME_TO_KEY: Record<string, StoreWeekdayKey> = {
  monday: "MONDAY",
  tuesday: "TUESDAY",
  wednesday: "WEDNESDAY",
  thursday: "THURSDAY",
  friday: "FRIDAY",
  saturday: "SATURDAY",
  sunday: "SUNDAY",
};

export const normalizeStoreClockTime = (value: string) => {
  const trimmed = value.trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return `${`${hours}`.padStart(2, "0")}:${`${minutes}`.padStart(2, "0")}`;
};

export const clockTimeToMinutes = (value: string) => {
  const normalized = normalizeStoreClockTime(value);
  if (!normalized) {
    return null;
  }

  const [hoursText = "0", minutesText = "0"] = normalized.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  return (hours * 60) + minutes;
};

export const formatDateKeyInTimeZone = (value: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);

  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";

  return `${year}-${month}-${day}`;
};

const getDateTimePartsInTimeZone = (value: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);

  const lookup = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    year: Number(lookup("year") || "0"),
    month: Number(lookup("month") || "0"),
    day: Number(lookup("day") || "0"),
    hour: Number(lookup("hour") || "0"),
    minute: Number(lookup("minute") || "0"),
    second: Number(lookup("second") || "0"),
  };
};

const ISO_LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const ISO_TIME_ZONE_SUFFIX_PATTERN = /(Z|[+\-]\d{2}(?::?\d{2})?)$/i;

export const parseDateTimeInTimeZone = (value: string, timeZone: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (ISO_TIME_ZONE_SUFFIX_PATTERN.test(trimmed)) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const match = ISO_LOCAL_DATE_TIME_PATTERN.exec(trimmed);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? "0");
  const targetUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  let candidate = new Date(targetUtcMs);

  // Align a store-local wall-clock input to a stable UTC instant.
  for (let index = 0; index < 4; index += 1) {
    const parts = getDateTimePartsInTimeZone(candidate, timeZone);
    const renderedUtcMs = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const diffMs = targetUtcMs - renderedUtcMs;

    if (diffMs === 0) {
      break;
    }

    candidate = new Date(candidate.getTime() + diffMs);
  }

  const resolved = getDateTimePartsInTimeZone(candidate, timeZone);
  if (
    resolved.year !== year ||
    resolved.month !== month ||
    resolved.day !== day ||
    resolved.hour !== hour ||
    resolved.minute !== minute ||
    resolved.second !== second
  ) {
    return null;
  }

  return candidate;
};

export const getStoreWeekdayKeyForDate = (value: Date, timeZone: string): StoreWeekdayKey => {
  const weekday = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
  }).format(value).toLowerCase();

  return DAY_NAME_TO_KEY[weekday] ?? "MONDAY";
};
