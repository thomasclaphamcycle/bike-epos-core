import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";

const dateOnlyRegex = /^\d{4}-\d{2}-\d{2}$/;

const parseDateOnlyOrThrow = (value: string, label: "from" | "to") => {
  if (!dateOnlyRegex.test(value)) {
    throw new HttpError(400, `${label} must be YYYY-MM-DD`, "INVALID_DATE");
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${label} is invalid`, "INVALID_DATE");
  }

  return date;
};

const addDays = (date: Date, days: number) => {
  const out = new Date(date);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
};

const getDateRangeOrThrow = (from?: string, to?: string) => {
  if (!from || !to) {
    throw new HttpError(400, "from and to are required", "INVALID_DATE_RANGE");
  }

  const fromDate = parseDateOnlyOrThrow(from, "from");
  const toDate = parseDateOnlyOrThrow(to, "to");

  if (fromDate > toDate) {
    throw new HttpError(400, "from must be before or equal to to", "INVALID_DATE_RANGE");
  }

  return {
    fromDate,
    toDateInclusive: toDate,
    toDateExclusive: addDays(toDate, 1),
  };
};

export const getWorkshopPaymentsReport = async (from?: string, to?: string) => {
  const range = getDateRangeOrThrow(from, to);

  const grouped = await prisma.payment.groupBy({
    by: ["purpose", "method"],
    where: {
      createdAt: {
        gte: range.fromDate,
        lt: range.toDateExclusive,
      },
    },
    _sum: { amountPence: true, refundedTotalPence: true },
    _count: { _all: true },
  });

  const refunds = await prisma.paymentRefund.aggregate({
    where: {
      createdAt: {
        gte: range.fromDate,
        lt: range.toDateExclusive,
      },
      status: {
        not: "PROCESSOR_FAILED",
      },
    },
    _sum: { amountPence: true },
    _count: { _all: true },
  });

  return {
    from: from!,
    to: to!,
    totals: grouped.map((row) => ({
      purpose: row.purpose,
      method: row.method,
      count: row._count._all,
      amountPence: row._sum.amountPence ?? 0,
      refundedTotalPence: row._sum.refundedTotalPence ?? 0,
    })),
    refunds: {
      count: refunds._count._all,
      amountPence: refunds._sum.amountPence ?? 0,
    },
  };
};

export const getWorkshopDepositsReport = async (from?: string, to?: string) => {
  const range = getDateRangeOrThrow(from, to);

  const jobs = await prisma.workshopJob.findMany({
    where: {
      createdAt: {
        gte: range.fromDate,
        lt: range.toDateExclusive,
      },
    },
    select: {
      id: true,
      depositRequiredPence: true,
      depositStatus: true,
    },
  });

  const requiredJobs = jobs.filter((job) => job.depositRequiredPence > 0);
  const paidJobs = requiredJobs.filter((job) => job.depositStatus === "PAID");
  const unpaidJobs = requiredJobs.filter((job) => job.depositStatus !== "PAID");

  const refunds = await prisma.paymentRefund.aggregate({
    where: {
      createdAt: {
        gte: range.fromDate,
        lt: range.toDateExclusive,
      },
      status: {
        not: "PROCESSOR_FAILED",
      },
      payment: {
        purpose: "DEPOSIT",
      },
    },
    _sum: { amountPence: true },
    _count: { _all: true },
  });

  const forfeited = await prisma.workshopCancellation.count({
    where: {
      cancelledAt: {
        gte: range.fromDate,
        lt: range.toDateExclusive,
      },
      outcome: "FORFEIT_DEPOSIT",
    },
  });

  const convertedCredits = await prisma.creditLedgerEntry.aggregate({
    where: {
      createdAt: {
        gte: range.fromDate,
        lt: range.toDateExclusive,
      },
      sourceType: "WORKSHOP_CANCELLATION",
      amountPence: {
        gt: 0,
      },
    },
    _sum: { amountPence: true },
    _count: { _all: true },
  });

  return {
    from: from!,
    to: to!,
    required: {
      count: requiredJobs.length,
      amountPence: requiredJobs.reduce((sum, job) => sum + job.depositRequiredPence, 0),
    },
    paid: {
      count: paidJobs.length,
      amountPence: paidJobs.reduce((sum, job) => sum + job.depositRequiredPence, 0),
    },
    unpaid: {
      count: unpaidJobs.length,
      amountPence: unpaidJobs.reduce((sum, job) => sum + job.depositRequiredPence, 0),
    },
    refunded: {
      count: refunds._count._all,
      amountPence: refunds._sum.amountPence ?? 0,
    },
    forfeited: {
      count: forfeited,
    },
    credited: {
      count: convertedCredits._count._all,
      amountPence: convertedCredits._sum.amountPence ?? 0,
    },
  };
};

export const getWorkshopCreditsReport = async (from?: string, to?: string) => {
  const range = getDateRangeOrThrow(from, to);

  const entries = await prisma.creditLedgerEntry.findMany({
    where: {
      createdAt: {
        gte: range.fromDate,
        lt: range.toDateExclusive,
      },
    },
    select: {
      amountPence: true,
      sourceType: true,
    },
  });

  const issuedPence = entries
    .filter((entry) => entry.amountPence > 0)
    .reduce((sum, entry) => sum + entry.amountPence, 0);
  const usedPence = entries
    .filter((entry) => entry.amountPence < 0)
    .reduce((sum, entry) => sum + Math.abs(entry.amountPence), 0);

  const bySource = entries.reduce<Record<string, { issuedPence: number; usedPence: number }>>(
    (acc, entry) => {
      if (!acc[entry.sourceType]) {
        acc[entry.sourceType] = {
          issuedPence: 0,
          usedPence: 0,
        };
      }

      if (entry.amountPence > 0) {
        acc[entry.sourceType].issuedPence += entry.amountPence;
      } else if (entry.amountPence < 0) {
        acc[entry.sourceType].usedPence += Math.abs(entry.amountPence);
      }

      return acc;
    },
    {},
  );

  return {
    from: from!,
    to: to!,
    issuedPence,
    usedPence,
    netPence: issuedPence - usedPence,
    bySource,
  };
};
