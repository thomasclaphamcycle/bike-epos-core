import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";
import { createAuditEventTx, type AuditActor } from "./auditService";
import { getStoreLocaleSettings } from "./configurationService";
import { ensureDefaultLocationTx, resolveLocationByCodeOrThrowTx } from "./locationService";
import { listDateKeys, parseDateOnlyOrThrow, toInteger } from "./reports/shared";
import { DEFAULT_CASH_LOCATION_ID } from "./tillService";

export * from "./reports";

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

type HistoricalFinancialSummaryImportRow = {
  date: string;
  grossRevenuePence: number;
  netRevenuePence: number;
  costOfGoodsPence: number;
  transactionCount: number;
};

const getDateKeyInTimeZone = (timeZone: string, value = new Date()) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(value);
};

const getMonthStartKey = (dateKey: string) => `${dateKey.slice(0, 8)}01`;

const shiftDateKeyByYears = (dateKey: string, yearDelta: number) => {
  const [yearText, monthText, dayText] = dateKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  const shifted = new Date(Date.UTC(year + yearDelta, month - 1, 1));
  shifted.setUTCMonth(month - 1, day);
  return shifted.toISOString().slice(0, 10);
};

const sumPenceFromDecimalInput = (raw: string, field: string, lineNumber: number) => {
  const normalized = raw.trim();
  if (!normalized) {
    throw new HttpError(400, `Line ${lineNumber}: ${field} is required`, "INVALID_HISTORICAL_SUMMARY_CSV");
  }

  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new HttpError(
      400,
      `Line ${lineNumber}: ${field} must be a number with up to 2 decimal places`,
      "INVALID_HISTORICAL_SUMMARY_CSV",
    );
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new HttpError(400, `Line ${lineNumber}: ${field} must be zero or greater`, "INVALID_HISTORICAL_SUMMARY_CSV");
  }

  return Math.round(parsed * 100);
};

const parseNonNegativeInteger = (raw: string, field: string, lineNumber: number) => {
  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new HttpError(400, `Line ${lineNumber}: ${field} must be a whole number`, "INVALID_HISTORICAL_SUMMARY_CSV");
  }

  return Number(normalized);
};

const parseHistoricalFinancialSummaryCsv = (csv: string) => {
  const normalized = csv.replace(/^\uFEFF/, "").trim();
  if (!normalized) {
    throw new HttpError(400, "CSV body is required", "INVALID_HISTORICAL_SUMMARY_CSV");
  }

  const lines = normalized.split(/\r?\n/);
  if (lines.length < 2) {
    throw new HttpError(400, "CSV must include a header row and at least one data row", "INVALID_HISTORICAL_SUMMARY_CSV");
  }

  const headerLine = lines[0] ?? "";
  const headers = headerLine.split(",").map((value) => value.trim().toLowerCase());
  const expectedHeaders = [
    "date",
    "gross_revenue",
    "net_revenue",
    "cost_of_goods",
    "transaction_count",
  ];

  if (headers.length !== expectedHeaders.length || headers.some((value, index) => value !== expectedHeaders[index])) {
    throw new HttpError(
      400,
      `CSV header must be exactly: ${expectedHeaders.join(",")}`,
      "INVALID_HISTORICAL_SUMMARY_CSV",
    );
  }

  const parsedRows: Array<HistoricalFinancialSummaryImportRow & { lineNumber: number }> = [];
  const skipped: Array<{ lineNumber: number; message: string }> = [];
  const seenDates = new Set<string>();

  for (let index = 1; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const rawLine = lines[index];
    if (!rawLine || !rawLine.trim()) {
      continue;
    }
    const cells = rawLine.split(",").map((value) => value.trim());
    if (cells.length !== expectedHeaders.length) {
      skipped.push({
        lineNumber,
        message: "Expected 5 columns matching the CSV header",
      });
      continue;
    }

    try {
      const [date = "", grossRevenue = "", netRevenue = "", costOfGoods = "", transactionCount = ""] = cells;
      parseDateOnlyOrThrow(date, "from");
      if (seenDates.has(date)) {
        skipped.push({
          lineNumber,
          message: `Duplicate date ${date} in CSV import`,
        });
        continue;
      }
      seenDates.add(date);

      parsedRows.push({
        lineNumber,
        date,
        grossRevenuePence: sumPenceFromDecimalInput(grossRevenue, "gross_revenue", lineNumber),
        netRevenuePence: sumPenceFromDecimalInput(netRevenue, "net_revenue", lineNumber),
        costOfGoodsPence: sumPenceFromDecimalInput(costOfGoods, "cost_of_goods", lineNumber),
        transactionCount: parseNonNegativeInteger(transactionCount, "transaction_count", lineNumber),
      });
    } catch (error) {
      skipped.push({
        lineNumber,
        message: error instanceof Error ? error.message : "Invalid CSV row",
      });
    }
  }

  return {
    parsedRows,
    skipped,
  };
};

export const importHistoricalFinancialSummaries = async (csv: string) => {
  const { parsedRows, skipped } = parseHistoricalFinancialSummaryCsv(csv);

  if (parsedRows.length === 0) {
    return {
      importedCount: 0,
      skippedCount: skipped.length,
      skipped,
    };
  }

  const existing = await prisma.historicalFinancialSummary.findMany({
    where: {
      date: {
        in: parsedRows.map((row) => new Date(`${row.date}T00:00:00.000Z`)),
      },
    },
    select: {
      date: true,
    },
  });
  const existingKeys = new Set(existing.map((row) => row.date.toISOString().slice(0, 10)));

  const rowsToCreate = parsedRows.filter((row) => {
    if (existingKeys.has(row.date)) {
      skipped.push({
        lineNumber: row.lineNumber,
        message: `Summary for ${row.date} already exists`,
      });
      return false;
    }
    return true;
  });

  if (rowsToCreate.length > 0) {
    const importedAt = new Date();
    await prisma.historicalFinancialSummary.createMany({
      data: rowsToCreate.map((row) => ({
        date: new Date(`${row.date}T00:00:00.000Z`),
        grossRevenuePence: row.grossRevenuePence,
        netRevenuePence: row.netRevenuePence,
        costOfGoodsPence: row.costOfGoodsPence,
        transactionCount: row.transactionCount,
        createdAt: importedAt,
        updatedAt: importedAt,
      })),
    });
  }

  return {
    importedCount: rowsToCreate.length,
    skippedCount: skipped.length,
    skipped,
  };
};

const getLiveFinancialMonthToDate = async (from: string, to: string, timeZone: string) => {
  const [grossRows, refundRows, salesCostRows] = await Promise.all([
    prisma.$queryRaw<Array<{ grossPence: number; saleCount: number }>>`
      SELECT
        COALESCE(SUM(s."totalPence"), 0)::bigint AS "grossPence",
        COUNT(*)::int AS "saleCount"
      FROM "Sale" s
      WHERE s."completedAt" IS NOT NULL
        AND (s."completedAt" AT TIME ZONE ${timeZone})::date BETWEEN ${from}::date AND ${to}::date
    `,
    prisma.$queryRaw<Array<{ refundsPence: number }>>`
      SELECT
        COALESCE(SUM(r."totalPence"), 0)::bigint AS "refundsPence"
      FROM "Refund" r
      WHERE r.status = 'COMPLETED'
        AND r."completedAt" IS NOT NULL
        AND (r."completedAt" AT TIME ZONE ${timeZone})::date BETWEEN ${from}::date AND ${to}::date
    `,
    prisma.$queryRaw<Array<{ costOfGoodsPence: number }>>`
      SELECT
        COALESCE(SUM(si.quantity * COALESCE(v."costPricePence", 0)), 0)::bigint AS "costOfGoodsPence"
      FROM "SaleItem" si
      INNER JOIN "Sale" s ON s.id = si."saleId"
      INNER JOIN "Variant" v ON v.id = si."variantId"
      WHERE s."completedAt" IS NOT NULL
        AND (s."completedAt" AT TIME ZONE ${timeZone})::date BETWEEN ${from}::date AND ${to}::date
    `,
  ]);

  const grossRevenuePence = toInteger(grossRows[0]?.grossPence);
  const refundsPence = toInteger(refundRows[0]?.refundsPence);
  const costOfGoodsPence = toInteger(salesCostRows[0]?.costOfGoodsPence);
  const revenuePence = grossRevenuePence - refundsPence;
  const grossMarginPence = revenuePence - costOfGoodsPence;
  const transactionCount = toInteger(grossRows[0]?.saleCount);

  return {
    grossRevenuePence,
    refundsPence,
    revenuePence,
    costOfGoodsPence,
    grossMarginPence,
    transactionCount,
  };
};

const getHistoricalSummaryAggregate = async (from: string, to: string) => {
  const requiredDateKeys = listDateKeys(from, to);
  const rows = await prisma.historicalFinancialSummary.findMany({
    where: {
      date: {
        gte: new Date(`${from}T00:00:00.000Z`),
        lte: new Date(`${to}T00:00:00.000Z`),
      },
    },
    orderBy: {
      date: "asc",
    },
  });

  const rowsByDate = new Map(rows.map((row) => [row.date.toISOString().slice(0, 10), row]));
  const missingDates = requiredDateKeys.filter((dateKey) => !rowsByDate.has(dateKey));

  return {
    from,
    to,
    requiredDayCount: requiredDateKeys.length,
    availableDayCount: rows.length,
    missingDates,
    totals: rows.reduce(
      (accumulator, row) => {
        accumulator.grossRevenuePence += row.grossRevenuePence;
        accumulator.revenuePence += row.netRevenuePence;
        accumulator.costOfGoodsPence += row.costOfGoodsPence;
        accumulator.transactionCount += row.transactionCount;
        return accumulator;
      },
      {
        grossRevenuePence: 0,
        revenuePence: 0,
        costOfGoodsPence: 0,
        transactionCount: 0,
      },
    ),
  };
};

const buildComparisonMetric = (
  currentPence: number,
  historicalPence: number,
  coverage: { availableDayCount: number; requiredDayCount: number; missingDates: string[] },
) => {
  if (coverage.availableDayCount === 0) {
    return {
      status: "no_data" as const,
      currentPence,
      historicalPence: null,
      deltaPence: null,
      percentageChange: null,
      label: "No comparison data in CorePOS yet",
    };
  }

  if (coverage.availableDayCount < coverage.requiredDayCount) {
    return {
      status: "partial_data" as const,
      currentPence,
      historicalPence,
      deltaPence: currentPence - historicalPence,
      percentageChange: null,
      label: "Historical comparison data is incomplete in CorePOS",
    };
  }

  if (historicalPence === 0) {
    return {
      status: "zero_baseline" as const,
      currentPence,
      historicalPence,
      deltaPence: currentPence,
      percentageChange: null,
      label: "No valid last-year baseline in CorePOS",
    };
  }

  const percentageChange = ((currentPence - historicalPence) / historicalPence) * 100;
  return {
    status: "available" as const,
    currentPence,
    historicalPence,
    deltaPence: currentPence - historicalPence,
    percentageChange,
    label:
      Math.abs(percentageChange) < 0.05
        ? "No change vs same time last year"
        : `${percentageChange > 0 ? "Up" : "Down"} ${Math.abs(percentageChange).toFixed(1)}% vs same time last year`,
  };
};

const resolveFinancialAsOfDateOrThrow = async (value?: string) => {
  if (value === undefined) {
    const { timeZone } = await getStoreLocaleSettings();
    return getDateKeyInTimeZone(timeZone);
  }

  const trimmed = value.trim();
  parseDateOnlyOrThrow(trimmed, "to");
  return trimmed;
};

export const getFinancialMonthlySalesSummary = async (asOf?: string) => {
  const asOfDate = await resolveFinancialAsOfDateOrThrow(asOf);
  const from = getMonthStartKey(asOfDate);
  const lastYearFrom = shiftDateKeyByYears(from, -1);
  const lastYearTo = shiftDateKeyByYears(asOfDate, -1);
  const { timeZone } = await getStoreLocaleSettings();

  const [liveTotals, historical] = await Promise.all([
    getLiveFinancialMonthToDate(from, asOfDate, timeZone),
    getHistoricalSummaryAggregate(lastYearFrom, lastYearTo),
  ]);

  return {
    period: {
      from,
      to: asOfDate,
      lastYearFrom,
      lastYearTo,
    },
    summary: {
      grossRevenuePence: liveTotals.grossRevenuePence,
      refundsPence: liveTotals.refundsPence,
      revenuePence: liveTotals.revenuePence,
      transactionCount: liveTotals.transactionCount,
    },
    comparison: {
      coverage: {
        requiredDayCount: historical.requiredDayCount,
        availableDayCount: historical.availableDayCount,
        missingDates: historical.missingDates,
      },
      revenue: buildComparisonMetric(liveTotals.revenuePence, historical.totals.revenuePence, historical),
    },
  };
};

export const getFinancialMonthlyMarginSummary = async (asOf?: string) => {
  const asOfDate = await resolveFinancialAsOfDateOrThrow(asOf);
  const from = getMonthStartKey(asOfDate);
  const lastYearFrom = shiftDateKeyByYears(from, -1);
  const lastYearTo = shiftDateKeyByYears(asOfDate, -1);
  const { timeZone } = await getStoreLocaleSettings();

  const [liveTotals, historical] = await Promise.all([
    getLiveFinancialMonthToDate(from, asOfDate, timeZone),
    getHistoricalSummaryAggregate(lastYearFrom, lastYearTo),
  ]);

  const historicalGrossMarginPence = historical.totals.revenuePence - historical.totals.costOfGoodsPence;
  const marginPercent =
    liveTotals.revenuePence === 0
      ? null
      : Number(((liveTotals.grossMarginPence / liveTotals.revenuePence) * 100).toFixed(1));

  return {
    period: {
      from,
      to: asOfDate,
      lastYearFrom,
      lastYearTo,
    },
    summary: {
      revenuePence: liveTotals.revenuePence,
      costOfGoodsPence: liveTotals.costOfGoodsPence,
      grossMarginPence: liveTotals.grossMarginPence,
      marginPercent,
    },
    comparison: {
      coverage: {
        requiredDayCount: historical.requiredDayCount,
        availableDayCount: historical.availableDayCount,
        missingDates: historical.missingDates,
      },
      grossMargin: buildComparisonMetric(liveTotals.grossMarginPence, historicalGrossMarginPence, historical),
    },
  };
};
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
