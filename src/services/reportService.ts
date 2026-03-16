import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";
import { createAuditEventTx, type AuditActor } from "./auditService";
import { ensureDefaultLocationTx, resolveLocationByCodeOrThrowTx } from "./locationService";
import { DEFAULT_CASH_LOCATION_ID } from "./tillService";

export * from "./reports";

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

type DailyCloseInput = {
  date?: string;
  locationCode?: string;
  auditActor?: AuditActor;
};

const toDateKeyInServerTimezone = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const resolveDailyCloseDateOrThrow = (value?: string) => {
  if (value === undefined) {
    return toDateKeyInServerTimezone(new Date());
  }

  const trimmed = value.trim();
  if (!DATE_ONLY_REGEX.test(trimmed)) {
    throw new HttpError(400, "date must be YYYY-MM-DD", "INVALID_DATE");
  }

  const parsed = new Date(`${trimmed}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, "date is invalid", "INVALID_DATE");
  }

  return trimmed;
};

const getDailyCloseBounds = (date: string) => {
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(`${date}T00:00:00`);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

const resolveDailyCloseLocationCode = (value?: string) => {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new HttpError(400, "locationCode must be non-empty", "INVALID_LOCATION_CODE");
  }

  return trimmed.toUpperCase();
};

const buildDailyCloseReportTx = async (
  tx: Prisma.TransactionClient,
  input: DailyCloseInput,
) => {
  const date = resolveDailyCloseDateOrThrow(input.date);
  const { start, end } = getDailyCloseBounds(date);
  const requestedLocationCode = resolveDailyCloseLocationCode(input.locationCode);

  const location = requestedLocationCode
    ? await resolveLocationByCodeOrThrowTx(tx, requestedLocationCode)
    : await ensureDefaultLocationTx(tx);

  const sales = await tx.sale.findMany({
    where: {
      locationId: location.id,
      completedAt: {
        gte: start,
        lt: end,
      },
    },
    select: {
      id: true,
      totalPence: true,
    },
  });

  const salesTenderRows = await tx.saleTender.groupBy({
    by: ["method"],
    where: {
      sale: {
        locationId: location.id,
        completedAt: {
          gte: start,
          lt: end,
        },
      },
    },
    _sum: {
      amountPence: true,
    },
  });

  const refunds = await tx.refund.findMany({
    where: {
      status: "COMPLETED",
      completedAt: {
        gte: start,
        lt: end,
      },
      sale: {
        locationId: location.id,
      },
    },
    select: {
      id: true,
      totalPence: true,
    },
  });

  const refundTenderRows = await tx.refundTender.groupBy({
    by: ["tenderType"],
    where: {
      refund: {
        status: "COMPLETED",
        completedAt: {
          gte: start,
          lt: end,
        },
        sale: {
          locationId: location.id,
        },
      },
    },
    _sum: {
      amountPence: true,
    },
  });

  const receiptCount = await tx.receipt.count({
    where: {
      issuedAt: {
        gte: start,
        lt: end,
      },
      OR: [
        {
          sale: {
            locationId: location.id,
          },
        },
        {
          saleRefund: {
            sale: {
              locationId: location.id,
            },
          },
        },
      ],
    },
  });

  const cashRows = await tx.cashMovement.groupBy({
    by: ["type"],
    where: {
      createdAt: {
        gte: start,
        lt: end,
      },
      locationId: {
        in: [location.id, DEFAULT_CASH_LOCATION_ID],
      },
    },
    _sum: {
      amountPence: true,
    },
  });

  const tenderTotals = {
    CASH: 0,
    CARD: 0,
    BANK_TRANSFER: 0,
    VOUCHER: 0,
  };
  for (const row of salesTenderRows) {
    tenderTotals[row.method] = row._sum.amountPence ?? 0;
  }

  const refundTenderTotals = {
    CASH: 0,
    CARD: 0,
    VOUCHER: 0,
    OTHER: 0,
  };
  for (const row of refundTenderRows) {
    refundTenderTotals[row.tenderType] = row._sum.amountPence ?? 0;
  }

  const cashTotals = {
    floatPence: 0,
    paidInPence: 0,
    paidOutPence: 0,
    cashSalesPence: 0,
    cashRefundsPence: 0,
  };
  for (const row of cashRows) {
    const amount = row._sum.amountPence ?? 0;
    switch (row.type) {
      case "FLOAT_IN":
        cashTotals.floatPence += amount;
        break;
      case "PAID_IN":
        cashTotals.paidInPence += amount;
        break;
      case "PAID_OUT":
        cashTotals.paidOutPence += amount;
        break;
      case "CASH_SALE":
        cashTotals.cashSalesPence += amount;
        break;
      case "CASH_REFUND":
        cashTotals.cashRefundsPence += amount;
        break;
    }
  }

  const grossSalesPence = sales.reduce((sum, sale) => sum + sale.totalPence, 0);
  const refundsTotalPence = refunds.reduce((sum, refund) => sum + refund.totalPence, 0);
  const expectedCashInDrawerPence =
    cashTotals.floatPence +
    cashTotals.paidInPence -
    cashTotals.paidOutPence +
    cashTotals.cashSalesPence -
    cashTotals.cashRefundsPence;

  return {
    date,
    location: {
      id: location.id,
      code: location.code,
      name: location.name,
    },
    sales: {
      count: sales.length,
      grossPence: grossSalesPence,
      tenderTotalsPence: tenderTotals,
    },
    refunds: {
      count: refunds.length,
      totalPence: refundsTotalPence,
      tenderTotalsPence: refundTenderTotals,
    },
    netSalesPence: grossSalesPence - refundsTotalPence,
    cashMovements: {
      ...cashTotals,
      expectedCashInDrawerPence,
    },
    receipts: {
      count: receiptCount,
    },
  };
};

export const getDailyCloseReport = async (input: DailyCloseInput = {}) =>
  prisma.$transaction((tx) => buildDailyCloseReportTx(tx, input));

export const runDailyCloseReport = async (input: DailyCloseInput = {}) =>
  prisma.$transaction(async (tx) => {
    const summary = await buildDailyCloseReportTx(tx, input);

    await createAuditEventTx(
      tx,
      {
        action: "DAILY_CLOSE_RUN",
        entityType: "LOCATION",
        entityId: summary.location.id,
        metadata: {
          date: summary.date,
          locationCode: summary.location.code,
          salesCount: summary.sales.count,
          refundsCount: summary.refunds.count,
          netSalesPence: summary.netSalesPence,
        },
      },
      input.auditActor,
    );

    return summary;
  });
