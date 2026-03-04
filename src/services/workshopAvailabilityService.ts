import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";
import { getBookingSettings } from "./workshopSettingsService";

type WorkshopClient = Prisma.TransactionClient | PrismaClient;

const dateOnlyRegex = /^\d{4}-\d{2}-\d{2}$/;

export const parseDateOnlyOrThrow = (value: string, label: "from" | "to" | "scheduledDate") => {
  if (!dateOnlyRegex.test(value)) {
    throw new HttpError(400, `${label} must be YYYY-MM-DD`, "INVALID_DATE");
  }

  const asDate = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(asDate.getTime())) {
    throw new HttpError(400, `${label} is invalid`, "INVALID_DATE");
  }

  return asDate;
};

const addDays = (date: Date, days: number): Date => {
  const out = new Date(date);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
};

export const toDateKey = (date: Date): string => date.toISOString().slice(0, 10);

const listDateKeys = (from: Date, to: Date): string[] => {
  const keys: string[] = [];
  let current = new Date(from);
  while (current <= to) {
    keys.push(toDateKey(current));
    current = addDays(current, 1);
  }
  return keys;
};

const getBookedCountMap = async (db: WorkshopClient, from: Date, to: Date) => {
  const jobs = await db.workshopJob.findMany({
    where: {
      scheduledDate: {
        gte: from,
        lt: addDays(to, 1),
      },
      status: {
        not: "CANCELLED",
      },
    },
    select: {
      scheduledDate: true,
    },
  });

  const map = new Map<string, number>();
  for (const row of jobs) {
    if (row.scheduledDate) {
      const key = toDateKey(row.scheduledDate);
      const current = map.get(key) ?? 0;
      map.set(key, current + 1);
    }
  }
  return map;
};

const getBookedCountForDate = async (
  db: WorkshopClient,
  date: Date,
  excludeWorkshopJobId?: string,
) => {
  return db.workshopJob.count({
    where: {
      scheduledDate: {
        gte: date,
        lt: addDays(date, 1),
      },
      status: {
        not: "CANCELLED",
      },
      ...(excludeWorkshopJobId
        ? {
            id: {
              not: excludeWorkshopJobId,
            },
          }
        : {}),
    },
  });
};

export const getWorkshopAvailability = async (from: string, to: string) => {
  const fromDate = parseDateOnlyOrThrow(from, "from");
  const toDate = parseDateOnlyOrThrow(to, "to");

  if (fromDate > toDate) {
    throw new HttpError(400, "from must be before or equal to to", "INVALID_DATE_RANGE");
  }

  const settings = await getBookingSettings();
  const minBookableKey = toDateKey(settings.minBookableDate);
  const bookedMap = await getBookedCountMap(prisma, fromDate, toDate);

  return listDateKeys(fromDate, toDate).map((dateKey) => {
    const bookedCount = bookedMap.get(dateKey) ?? 0;
    return {
      date: dateKey,
      bookedCount,
      maxBookings: settings.maxBookingsPerDay,
      isBookable:
        dateKey >= minBookableKey && bookedCount < settings.maxBookingsPerDay,
    };
  });
};

export const assertDateIsBookable = async (
  db: WorkshopClient,
  scheduledDate: string,
  excludeWorkshopJobId?: string,
) => {
  const date = parseDateOnlyOrThrow(scheduledDate, "scheduledDate");
  const dateKey = toDateKey(date);

  const settings = await getBookingSettings(db);
  const minBookableKey = toDateKey(settings.minBookableDate);

  if (dateKey < minBookableKey) {
    throw new HttpError(409, "Date is not bookable", "DATE_NOT_BOOKABLE");
  }

  const bookedCount = await getBookedCountForDate(db, date, excludeWorkshopJobId);

  if (bookedCount >= settings.maxBookingsPerDay) {
    throw new HttpError(409, "Workshop is full for this date", "WORKSHOP_FULL");
  }

  return {
    date,
    bookedCount,
    maxBookings: settings.maxBookingsPerDay,
  };
};
