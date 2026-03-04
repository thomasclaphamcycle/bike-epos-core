import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma";

type BookingSettingsClient = Prisma.TransactionClient | PrismaClient;

const DEFAULT_MAX_BOOKINGS_PER_DAY = 8;
const DEFAULT_DEPOSIT_PENCE = 1000;

const startOfUtcDay = (date: Date): Date => {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

export const getBookingSettings = async (
  db: BookingSettingsClient = prisma,
) => {
  return db.bookingSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      minBookableDate: startOfUtcDay(new Date()),
      maxBookingsPerDay: DEFAULT_MAX_BOOKINGS_PER_DAY,
      defaultDepositPence: DEFAULT_DEPOSIT_PENCE,
    },
  });
};
