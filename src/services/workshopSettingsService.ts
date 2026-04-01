import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getWorkshopSettings } from "./configurationService";

type BookingSettingsClient = Prisma.TransactionClient | PrismaClient;

const startOfUtcDay = (date: Date): Date => {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

export const getBookingSettings = async (
  db: BookingSettingsClient = prisma,
) => {
  const workshopSettings = await getWorkshopSettings(db);
  const existing = await db.bookingSettings.findUnique({
    where: { id: 1 },
  });

  if (!existing) {
    return db.bookingSettings.create({
      data: {
        id: 1,
        minBookableDate: startOfUtcDay(new Date()),
        maxBookingsPerDay: workshopSettings.maxBookingsPerDay,
        defaultDepositPence: workshopSettings.defaultDepositPence,
      },
    });
  }

  if (
    existing.defaultDepositPence === workshopSettings.defaultDepositPence
    && existing.maxBookingsPerDay === workshopSettings.maxBookingsPerDay
  ) {
    return existing;
  }

  return db.bookingSettings.update({
    where: { id: 1 },
    data: {
      defaultDepositPence: workshopSettings.defaultDepositPence,
      maxBookingsPerDay: workshopSettings.maxBookingsPerDay,
    },
  });
};
