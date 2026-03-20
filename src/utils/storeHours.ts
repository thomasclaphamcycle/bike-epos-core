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

export const getStoreWeekdayKeyForDate = (value: Date, timeZone: string): StoreWeekdayKey => {
  const weekday = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
  }).format(value).toLowerCase();

  return DAY_NAME_TO_KEY[weekday] ?? "MONDAY";
};
