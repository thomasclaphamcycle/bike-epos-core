import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { listShopSettings } from "./configurationService";

type BookingSettingsClient = Prisma.TransactionClient | PrismaClient;

const DEFAULT_MAX_BOOKINGS_PER_DAY = 8;
const DEFAULT_DEPOSIT_PENCE = 1000;

const startOfUtcDay = (date: Date): Date => {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

export const getBookingSettings = async (
  db: BookingSettingsClient = prisma,
) => {
  const appSettings = await listShopSettings(db);
  const configuredDefaultDepositPence = appSettings.workshop.defaultDepositPence || DEFAULT_DEPOSIT_PENCE;
  const existing = await db.bookingSettings.findUnique({
    where: { id: 1 },
  });

  if (!existing) {
    return db.bookingSettings.create({
      data: {
        id: 1,
        minBookableDate: startOfUtcDay(new Date()),
        maxBookingsPerDay: DEFAULT_MAX_BOOKINGS_PER_DAY,
        defaultDepositPence: configuredDefaultDepositPence,
      },
    });
  }

  if (existing.defaultDepositPence === configuredDefaultDepositPence) {
    return existing;
  }

  return db.bookingSettings.update({
    where: { id: 1 },
    data: {
      defaultDepositPence: configuredDefaultDepositPence,
    },
  });
};
