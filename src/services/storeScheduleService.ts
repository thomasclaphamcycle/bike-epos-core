import { Prisma, RotaClosedDayType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { listShopSettings } from "./configurationService";
import {
  formatDateKeyInTimeZone,
  getStoreWeekdayKeyForDate,
  STORE_WEEKDAY_LABELS,
  type StoreDailyOpeningHours,
  type StoreOpeningHoursSettings,
  type StoreWeekdayKey,
} from "../utils/storeHours";

type StoreScheduleClient = Prisma.TransactionClient | typeof prisma;

export type StoreDaySchedule = {
  date: string;
  timeZone: string;
  weekday: StoreWeekdayKey;
  hours: StoreDailyOpeningHours;
  isClosed: boolean;
  closedReason: string | null;
};

const closedDayLabel = (type: RotaClosedDayType) => {
  switch (type) {
    case "BANK_HOLIDAY":
      return "Store closed for bank holiday.";
    case "CUSTOM":
      return "Store closed today.";
    case "SCHEDULED_CLOSED":
    default:
      return "Store closed today.";
  }
};

export const listStoreOpeningHours = async (
  db: StoreScheduleClient = prisma,
): Promise<StoreOpeningHoursSettings> => {
  const settings = await listShopSettings(db);
  return settings.store.openingHours;
};

export const resolveStoreDaySchedule = async (
  value: Date,
  db: StoreScheduleClient = prisma,
): Promise<StoreDaySchedule> => {
  const settings = await listShopSettings(db);
  const date = formatDateKeyInTimeZone(value, settings.store.timeZone);
  const weekday = getStoreWeekdayKeyForDate(value, settings.store.timeZone);
  const hours = settings.store.openingHours[weekday];

  const closedDay = await db.rotaClosedDay.findUnique({
    where: { date },
    select: {
      type: true,
      note: true,
    },
  });

  if (closedDay) {
    return {
      date,
      timeZone: settings.store.timeZone,
      weekday,
      hours,
      isClosed: true,
      closedReason: closedDay.note?.trim() || closedDayLabel(closedDay.type),
    };
  }

  if (hours.isClosed) {
    return {
      date,
      timeZone: settings.store.timeZone,
      weekday,
      hours,
      isClosed: true,
      closedReason: `${STORE_WEEKDAY_LABELS[weekday]} trading hours are closed in Store Info.`,
    };
  }

  return {
    date,
    timeZone: settings.store.timeZone,
    weekday,
    hours,
    isClosed: false,
    closedReason: null,
  };
};
