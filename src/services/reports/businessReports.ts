import { HireAssetStatus, HireBookingStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { getStoreLocaleSettings } from "../configurationService";
import { getCustomerInsightsReport } from "./customerReports";
import { getFinancialMonthlySalesSummaryReport, getFinancialSalesByCategoryReport } from "./financialReports";
import { getInventoryValueSnapshotReport, getInventoryVelocity, getInventoryVelocityReport } from "./inventoryReports";
import { addDaysUtc, getDateRangeWithTakeOrThrow, listDateKeys, toInteger } from "./shared";
import { getWorkshopAnalyticsReport, getWorkshopDailyReport } from "./workshopReports";

const DAY_MS = 86_400_000;

const roundToOneDecimal = (value: number) => Number(value.toFixed(1));

const toPercentOrNull = (numerator: number, denominator: number) =>
  denominator > 0 ? roundToOneDecimal((numerator / denominator) * 100) : null;

const formatRangeLabel = (from: string, to: string, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    dateStyle: "medium",
  });

  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);

  if (from === to) {
    return formatter.format(fromDate);
  }

  return `${formatter.format(fromDate)} - ${formatter.format(toDate)}`;
};

const dateKeyFormatterCache = new Map<string, Intl.DateTimeFormat>();

const getDateKeyFormatter = (timeZone: string) => {
  const cached = dateKeyFormatterCache.get(timeZone);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  dateKeyFormatterCache.set(timeZone, formatter);
  return formatter;
};

const getDateKeyInTimeZone = (timeZone: string, value: Date) =>
  getDateKeyFormatter(timeZone).format(value);

const shiftDateKeyByDays = (dateKey: string, days: number) =>
  addDaysUtc(new Date(`${dateKey}T00:00:00.000Z`), days).toISOString().slice(0, 10);

const isDateKeyWithinRange = (dateKey: string, from: string, to: string) =>
  dateKey >= from && dateKey <= to;

type SalesMixDailyRow = {
  date: string;
  retailGrossPence: number;
  retailRefundsPence: number;
  retailNetPence: number;
  workshopGrossPence: number;
  workshopRefundsPence: number;
  workshopNetPence: number;
  retailTransactions: number;
  workshopTransactions: number;
};

const getSalesMixByDate = async (from: string, to: string, timeZone: string) => {
  const days = listDateKeys(from, to);

  const [salesRows, refundRows] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        date: string;
        retailGrossPence: number;
        workshopGrossPence: number;
        retailTransactions: number;
        workshopTransactions: number;
      }>
    >`
      SELECT
        to_char((s."completedAt" AT TIME ZONE ${timeZone})::date, 'YYYY-MM-DD') AS "date",
        COALESCE(SUM(CASE WHEN s."workshopJobId" IS NULL THEN s."subtotalPence" ELSE 0 END), 0)::bigint AS "retailGrossPence",
        COALESCE(SUM(CASE WHEN s."workshopJobId" IS NOT NULL THEN s."subtotalPence" ELSE 0 END), 0)::bigint AS "workshopGrossPence",
        COUNT(*) FILTER (WHERE s."workshopJobId" IS NULL)::int AS "retailTransactions",
        COUNT(*) FILTER (WHERE s."workshopJobId" IS NOT NULL)::int AS "workshopTransactions"
      FROM "Sale" s
      WHERE
        s."completedAt" IS NOT NULL
        AND (s."completedAt" AT TIME ZONE ${timeZone})::date BETWEEN ${from}::date AND ${to}::date
      GROUP BY "date"
      ORDER BY "date" ASC
    `,
    prisma.$queryRaw<
      Array<{
        date: string;
        retailRefundsPence: number;
        workshopRefundsPence: number;
      }>
    >`
      SELECT
        to_char((r."completedAt" AT TIME ZONE ${timeZone})::date, 'YYYY-MM-DD') AS "date",
        COALESCE(SUM(CASE WHEN s."workshopJobId" IS NULL THEN r."subtotalPence" ELSE 0 END), 0)::bigint AS "retailRefundsPence",
        COALESCE(SUM(CASE WHEN s."workshopJobId" IS NOT NULL THEN r."subtotalPence" ELSE 0 END), 0)::bigint AS "workshopRefundsPence"
      FROM "Refund" r
      INNER JOIN "Sale" s ON s.id = r."saleId"
      WHERE
        r.status = 'COMPLETED'
        AND r."completedAt" IS NOT NULL
        AND (r."completedAt" AT TIME ZONE ${timeZone})::date BETWEEN ${from}::date AND ${to}::date
      GROUP BY "date"
      ORDER BY "date" ASC
    `,
  ]);

  const salesMap = new Map(
    salesRows.map((row) => [
      row.date,
      {
        retailGrossPence: toInteger(row.retailGrossPence),
        workshopGrossPence: toInteger(row.workshopGrossPence),
        retailTransactions: toInteger(row.retailTransactions),
        workshopTransactions: toInteger(row.workshopTransactions),
      },
    ]),
  );

  const refundMap = new Map(
    refundRows.map((row) => [
      row.date,
      {
        retailRefundsPence: toInteger(row.retailRefundsPence),
        workshopRefundsPence: toInteger(row.workshopRefundsPence),
      },
    ]),
  );

  const dailyRows: SalesMixDailyRow[] = days.map((date) => {
    const saleRow = salesMap.get(date);
    const refundRow = refundMap.get(date);
    const retailGrossPence = saleRow?.retailGrossPence ?? 0;
    const workshopGrossPence = saleRow?.workshopGrossPence ?? 0;
    const retailRefundsPence = refundRow?.retailRefundsPence ?? 0;
    const workshopRefundsPence = refundRow?.workshopRefundsPence ?? 0;

    return {
      date,
      retailGrossPence,
      retailRefundsPence,
      retailNetPence: retailGrossPence - retailRefundsPence,
      workshopGrossPence,
      workshopRefundsPence,
      workshopNetPence: workshopGrossPence - workshopRefundsPence,
      retailTransactions: saleRow?.retailTransactions ?? 0,
      workshopTransactions: saleRow?.workshopTransactions ?? 0,
    };
  });

  const summary = dailyRows.reduce(
    (accumulator, row) => {
      accumulator.retailGrossPence += row.retailGrossPence;
      accumulator.retailRefundsPence += row.retailRefundsPence;
      accumulator.retailNetPence += row.retailNetPence;
      accumulator.workshopGrossPence += row.workshopGrossPence;
      accumulator.workshopRefundsPence += row.workshopRefundsPence;
      accumulator.workshopNetPence += row.workshopNetPence;
      accumulator.retailTransactions += row.retailTransactions;
      accumulator.workshopTransactions += row.workshopTransactions;
      return accumulator;
    },
    {
      retailGrossPence: 0,
      retailRefundsPence: 0,
      retailNetPence: 0,
      workshopGrossPence: 0,
      workshopRefundsPence: 0,
      workshopNetPence: 0,
      retailTransactions: 0,
      workshopTransactions: 0,
    },
  );

  return {
    dailyRows,
    summary,
  };
};

const getHirePerformanceReport = async (input: {
  from: string;
  to: string;
  take: number;
  dayCount: number;
  timeZone: string;
}) => {
  const { from, to, take, dayCount, timeZone } = input;
  const now = new Date();
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDateInclusive = new Date(`${to}T23:59:59.999Z`);
  const expandedFrom = addDaysUtc(fromDate, -1);
  const expandedTo = addDaysUtc(toDateInclusive, 1);
  const days = listDateKeys(from, to);
  const hireDailyMap = new Map(
    days.map((dateKey) => [
      dateKey,
      {
        hireBookedValuePence: 0,
        hireBookingsStarted: 0,
      },
    ]),
  );

  const [assets, bookings, activeBookings] = await Promise.all([
    prisma.hireAsset.findMany({
      where: {
        status: {
          not: "RETIRED",
        },
      },
      select: {
        id: true,
        assetTag: true,
        displayName: true,
        isOnlineBookable: true,
        status: true,
        variant: {
          select: {
            product: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    }),
    prisma.hireBooking.findMany({
      where: {
        OR: [
          {
            startsAt: {
              gte: expandedFrom,
              lte: expandedTo,
            },
          },
          {
            dueBackAt: {
              gte: expandedFrom,
              lte: expandedTo,
            },
          },
          {
            cancelledAt: {
              gte: expandedFrom,
              lte: expandedTo,
            },
          },
          {
            returnedAt: {
              gte: expandedFrom,
              lte: expandedTo,
            },
          },
        ],
      },
      select: {
        id: true,
        hireAssetId: true,
        status: true,
        startsAt: true,
        dueBackAt: true,
        returnedAt: true,
        cancelledAt: true,
        hirePricePence: true,
        depositHeldPence: true,
        hireAsset: {
          select: {
            assetTag: true,
            displayName: true,
            variant: {
              select: {
                product: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.hireBooking.findMany({
      where: {
        status: "CHECKED_OUT",
      },
      select: {
        id: true,
        dueBackAt: true,
        depositHeldPence: true,
      },
    }),
  ]);

  const todayKey = getDateKeyInTimeZone(timeZone, now);
  const nextSevenDayKey = shiftDateKeyByDays(todayKey, 6);
  const assetPerformanceMap = new Map<string, {
    hireAssetId: string;
    assetTag: string;
    displayName: string | null;
    productName: string;
    bookingCount: number;
    bookedValuePence: number;
    bookedDays: number;
  }>();

  let bookingCount = 0;
  let bookedValuePence = 0;
  let bookedDurationDaysTotal = 0;
  let cancelledCount = 0;
  let returnedCount = 0;
  let pickupsNext7Days = 0;
  let returnsNext7Days = 0;
  let dueTodayCount = 0;

  for (const booking of bookings) {
    const startKey = getDateKeyInTimeZone(timeZone, booking.startsAt);
    const dueKey = getDateKeyInTimeZone(timeZone, booking.dueBackAt);
    const cancelledKey = booking.cancelledAt ? getDateKeyInTimeZone(timeZone, booking.cancelledAt) : null;
    const returnedKey = booking.returnedAt ? getDateKeyInTimeZone(timeZone, booking.returnedAt) : null;
    const startsInRange = isDateKeyWithinRange(startKey, from, to);
    const cancelledInRange = cancelledKey ? isDateKeyWithinRange(cancelledKey, from, to) : false;
    const returnedInRange = returnedKey ? isDateKeyWithinRange(returnedKey, from, to) : false;

    if (booking.status !== "CANCELLED" && startsInRange) {
      bookingCount += 1;
      bookedValuePence += booking.hirePricePence;
      bookedDurationDaysTotal += Math.max(0, (booking.dueBackAt.getTime() - booking.startsAt.getTime()) / DAY_MS);

      const dailyRow = hireDailyMap.get(startKey);
      if (dailyRow) {
        dailyRow.hireBookedValuePence += booking.hirePricePence;
        dailyRow.hireBookingsStarted += 1;
      }

      const assetPerformance = assetPerformanceMap.get(booking.hireAssetId) ?? {
        hireAssetId: booking.hireAssetId,
        assetTag: booking.hireAsset.assetTag,
        displayName: booking.hireAsset.displayName,
        productName: booking.hireAsset.variant.product.name,
        bookingCount: 0,
        bookedValuePence: 0,
        bookedDays: 0,
      };

      assetPerformance.bookingCount += 1;
      assetPerformance.bookedValuePence += booking.hirePricePence;
      assetPerformance.bookedDays += Math.max(0, (booking.dueBackAt.getTime() - booking.startsAt.getTime()) / DAY_MS);
      assetPerformanceMap.set(booking.hireAssetId, assetPerformance);
    }

    if (booking.status === "CANCELLED" && (cancelledInRange || startsInRange)) {
      cancelledCount += 1;
    }

    if (booking.status === "RETURNED" && returnedInRange) {
      returnedCount += 1;
    }

    if (booking.status === "RESERVED" && startKey >= todayKey && startKey <= nextSevenDayKey) {
      pickupsNext7Days += 1;
    }

    if (booking.status === "CHECKED_OUT" && dueKey >= todayKey && dueKey <= nextSevenDayKey) {
      returnsNext7Days += 1;
    }

    if (booking.status === "CHECKED_OUT" && dueKey === todayKey) {
      dueTodayCount += 1;
    }
  }

  const activeNowCount = activeBookings.length;
  const overdueNowCount = activeBookings.filter((booking) => booking.dueBackAt.getTime() < now.getTime()).length;
  const depositHeldPence = activeBookings.reduce((sum, booking) => sum + booking.depositHeldPence, 0);
  const activeFleetCount = assets.length;
  const maintenanceAssetCount = assets.filter((asset) => asset.status === HireAssetStatus.MAINTENANCE).length;
  const onlineBookableAssetCount = assets.filter((asset) => asset.isOnlineBookable).length;

  const overlappingBookings = bookings.filter((booking) =>
    booking.status !== "CANCELLED"
    && booking.startsAt.getTime() < toDateInclusive.getTime()
    && booking.dueBackAt.getTime() > fromDate.getTime());

  const bookedAssetDays = overlappingBookings.reduce((sum, booking) => {
    const clampedStart = Math.max(booking.startsAt.getTime(), fromDate.getTime());
    const clampedEnd = Math.min(booking.dueBackAt.getTime(), toDateInclusive.getTime());
    return sum + Math.max(0, (clampedEnd - clampedStart) / DAY_MS);
  }, 0);

  return {
    summary: {
      bookingCount,
      bookedValuePence,
      averageBookingValuePence: bookingCount > 0 ? Math.round(bookedValuePence / bookingCount) : 0,
      averageHireLengthDays: bookingCount > 0 ? roundToOneDecimal(bookedDurationDaysTotal / bookingCount) : null,
      activeNowCount,
      overdueNowCount,
      cancelledCount,
      returnedCount,
      activeFleetCount,
      maintenanceAssetCount,
      onlineBookableAssetCount,
      dueTodayCount,
      pickupsNext7Days,
      returnsNext7Days,
      depositHeldPence,
      utilisationPercent: activeFleetCount > 0 ? roundToOneDecimal((bookedAssetDays / (activeFleetCount * dayCount)) * 100) : null,
      cancellationRatePercent: toPercentOrNull(cancelledCount, bookingCount + cancelledCount),
    },
    daily: days.map((dateKey) => ({
      date: dateKey,
      hireBookedValuePence: hireDailyMap.get(dateKey)?.hireBookedValuePence ?? 0,
      hireBookingsStarted: hireDailyMap.get(dateKey)?.hireBookingsStarted ?? 0,
    })),
    topAssets: Array.from(assetPerformanceMap.values())
      .map((asset) => ({
        ...asset,
        bookedDays: roundToOneDecimal(asset.bookedDays),
        utilisationPercent: dayCount > 0 ? roundToOneDecimal((asset.bookedDays / dayCount) * 100) : null,
      }))
      .sort((left, right) => (
        right.bookedValuePence - left.bookedValuePence
        || right.bookingCount - left.bookingCount
        || left.productName.localeCompare(right.productName)
      ))
      .slice(0, take),
  };
};

export const getBusinessIntelligenceReport = async (from?: string, to?: string, take?: number) => {
  const range = getDateRangeWithTakeOrThrow(from, to, take);
  const days = listDateKeys(range.from, range.to);
  const { timeZone } = await getStoreLocaleSettings();

  const [
    salesSummary,
    salesByCategory,
    salesMix,
    workshopDaily,
    workshopAnalytics,
    hirePerformance,
    inventoryValue,
    inventoryVelocityWindow,
    inventoryVelocityCurrent,
    customerInsights,
  ] = await Promise.all([
    getFinancialMonthlySalesSummaryReport(range.from, range.to),
    getFinancialSalesByCategoryReport(range.from, range.to),
    getSalesMixByDate(range.from, range.to, timeZone),
    getWorkshopDailyReport(range.from, range.to),
    getWorkshopAnalyticsReport(range.from, range.to),
    getHirePerformanceReport({
      from: range.from,
      to: range.to,
      take: range.take,
      dayCount: days.length,
      timeZone,
    }),
    getInventoryValueSnapshotReport(),
    getInventoryVelocityReport(range.from, range.to, range.take),
    getInventoryVelocity(),
    getCustomerInsightsReport(range.from, range.to, range.take),
  ]);

  const workshopDailyMap = new Map(workshopDaily.map((row) => [row.date, row]));
  const hireDailyMap = new Map(hirePerformance.daily.map((row) => [row.date, row]));

  const dailyMix = days.map((dateKey) => {
    const salesRow = salesMix.dailyRows.find((row) => row.date === dateKey);
    const workshopRow = workshopDailyMap.get(dateKey);
    const hireRow = hireDailyMap.get(dateKey);

    return {
      date: dateKey,
      retailNetSalesPence: salesRow?.retailNetPence ?? 0,
      workshopNetSalesPence: salesRow?.workshopNetPence ?? 0,
      totalNetSalesPence: (salesRow?.retailNetPence ?? 0) + (salesRow?.workshopNetPence ?? 0),
      hireBookedValuePence: hireRow?.hireBookedValuePence ?? 0,
      hireBookingsStarted: hireRow?.hireBookingsStarted ?? 0,
      completedWorkshopJobs: workshopRow?.jobCount ?? 0,
    };
  });

  const bestTradingDay = [...dailyMix]
    .sort((left, right) => (
      right.totalNetSalesPence - left.totalNetSalesPence
      || right.workshopNetSalesPence - left.workshopNetSalesPence
      || left.date.localeCompare(right.date)
    ))[0] ?? null;

  const bestWorkshopDay = [...dailyMix]
    .sort((left, right) => (
      right.completedWorkshopJobs - left.completedWorkshopJobs
      || right.workshopNetSalesPence - left.workshopNetSalesPence
      || left.date.localeCompare(right.date)
    ))[0] ?? null;

  const currentVelocityCounts = inventoryVelocityCurrent.items.reduce(
    (accumulator, row) => {
      if (row.velocityClass === "FAST_MOVER") {
        accumulator.fastMoverCount += 1;
      } else if (row.velocityClass === "SLOW_MOVER") {
        accumulator.slowMoverCount += 1;
      } else if (row.velocityClass === "DEAD_STOCK") {
        accumulator.deadStockCount += 1;
      } else {
        accumulator.normalMoverCount += 1;
      }
      return accumulator;
    },
    {
      fastMoverCount: 0,
      normalMoverCount: 0,
      slowMoverCount: 0,
      deadStockCount: 0,
    },
  );

  const totalNetSalesPence = salesMix.summary.retailNetPence + salesMix.summary.workshopNetPence;
  const topCategoryRevenuePence = salesByCategory.summary.topCategoryRevenuePence ?? 0;

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      from: range.from,
      to: range.to,
      dayCount: days.length,
      take: range.take,
      label: formatRangeLabel(range.from, range.to, timeZone),
    },
    limitations: [
      "Retail and workshop figures use completed sales and completed refunds already recorded in CorePOS.",
      "Hire figures are reported as booking contract value from hire records. They are not yet reconciled against a dedicated sales-ledger payment flow.",
      "Inventory value uses the existing purchase-average stock valuation snapshot and current recorded stock movements.",
      "Customer metrics are grounded in recorded sales, workshop jobs, and customer credit only. No speculative scoring is applied.",
    ],
    headline: {
      actualNetSalesPence: totalNetSalesPence,
      retailNetSalesPence: salesMix.summary.retailNetPence,
      workshopNetSalesPence: salesMix.summary.workshopNetPence,
      hireBookedValuePence: hirePerformance.summary.bookedValuePence,
      completedWorkshopJobs: workshopDaily.reduce((sum, row) => sum + row.jobCount, 0),
      activeCustomers: customerInsights.summary.activeCustomerCount,
      inventoryValuePence: inventoryValue.summary.totalValuePence,
    },
    finance: {
      salesSummary: salesSummary.summary,
      tradingMix: {
        retailGrossSalesPence: salesMix.summary.retailGrossPence,
        retailRefundsPence: salesMix.summary.retailRefundsPence,
        retailNetSalesPence: salesMix.summary.retailNetPence,
        workshopGrossSalesPence: salesMix.summary.workshopGrossPence,
        workshopRefundsPence: salesMix.summary.workshopRefundsPence,
        workshopNetSalesPence: salesMix.summary.workshopNetPence,
        retailTransactions: salesMix.summary.retailTransactions,
        workshopTransactions: salesMix.summary.workshopTransactions,
        retailRevenueSharePercent: toPercentOrNull(salesMix.summary.retailNetPence, totalNetSalesPence),
        workshopRevenueSharePercent: toPercentOrNull(salesMix.summary.workshopNetPence, totalNetSalesPence),
      },
      topCategory: {
        categoryName: salesByCategory.summary.topCategoryName,
        revenuePence: topCategoryRevenuePence,
        revenueSharePercent: toPercentOrNull(topCategoryRevenuePence, salesByCategory.summary.revenuePence),
      },
      bestTradingDay: bestTradingDay
        ? {
            date: bestTradingDay.date,
            totalNetSalesPence: bestTradingDay.totalNetSalesPence,
            retailNetSalesPence: bestTradingDay.retailNetSalesPence,
            workshopNetSalesPence: bestTradingDay.workshopNetSalesPence,
          }
        : null,
      dailyMix,
    },
    workshop: {
      summary: {
        completedJobs: workshopDaily.reduce((sum, row) => sum + row.jobCount, 0),
        revenuePence: workshopDaily.reduce((sum, row) => sum + row.revenuePence, 0),
        averageTurnaroundDays: workshopAnalytics.turnaround.createdToCompleted.averageDays,
        medianTurnaroundDays: workshopAnalytics.turnaround.createdToCompleted.medianDays,
        averageApprovalHours: workshopAnalytics.turnaround.approvalDecision.averageHours,
        quoteApprovalRequestedCount: workshopAnalytics.quoteConversion.requestedCount,
        quoteApprovedCount: workshopAnalytics.quoteConversion.approvedCount,
        quoteRejectedCount: workshopAnalytics.quoteConversion.rejectedCount,
        quotePendingCount: workshopAnalytics.quoteConversion.pendingCount,
        quoteConversionRate: workshopAnalytics.quoteConversion.conversionRate,
        openJobs: workshopAnalytics.currentQueue.openJobCount,
        dueTodayCount: workshopAnalytics.currentQueue.dueTodayCount,
        overdueCount: workshopAnalytics.currentQueue.overdueCount,
        waitingForApprovalCount: workshopAnalytics.currentQueue.waitingForApprovalCount,
        waitingForPartsCount: workshopAnalytics.currentQueue.waitingForPartsCount,
        readyForCollectionCount: workshopAnalytics.currentQueue.readyForCollectionCount,
        stalledJobsCount: workshopAnalytics.stalledJobs.stalledCount,
      },
      bestWorkshopDay: bestWorkshopDay
        ? {
            date: bestWorkshopDay.date,
            completedWorkshopJobs: bestWorkshopDay.completedWorkshopJobs,
            workshopNetSalesPence: bestWorkshopDay.workshopNetSalesPence,
          }
        : null,
      technicianRows: workshopAnalytics.technicianThroughput.rows.slice(0, range.take),
      stalledRows: workshopAnalytics.stalledJobs.rows.slice(0, range.take),
    },
    hire: {
      summary: hirePerformance.summary,
      topAssets: hirePerformance.topAssets,
    },
    inventory: {
      summary: {
        stockValuePence: inventoryValue.summary.totalValuePence,
        stockUnitsOnHand: inventoryValue.summary.totalOnHand,
        missingCostVariantCount: inventoryValue.summary.countMissingCost,
        trackedProductCount: inventoryVelocityWindow.summary.trackedProductCount,
        productsWithSales: inventoryVelocityWindow.summary.productsWithSales,
        deadStockCandidatesInRangeCount: inventoryVelocityWindow.summary.deadStockCount,
        fastMoverCount: currentVelocityCounts.fastMoverCount,
        normalMoverCount: currentVelocityCounts.normalMoverCount,
        slowMoverCount: currentVelocityCounts.slowMoverCount,
        deadStockCount: currentVelocityCounts.deadStockCount,
        topValueProductName: inventoryValue.summary.topValueProductName,
        topValuePence: inventoryValue.summary.topValuePence,
      },
      fastMovingProducts: inventoryVelocityWindow.fastMovingProducts.slice(0, range.take),
      slowMovingProducts: inventoryVelocityWindow.slowMovingProducts.slice(0, range.take),
      deadStockCandidates: inventoryVelocityWindow.deadStockCandidates.slice(0, range.take),
    },
    customers: {
      summary: {
        customerCount: customerInsights.summary.customerCount,
        activeCustomerCount: customerInsights.summary.activeCustomerCount,
        repeatCustomerCount: customerInsights.summary.repeatCustomerCount,
        repeatRatePercent: toPercentOrNull(
          customerInsights.summary.repeatCustomerCount,
          customerInsights.summary.activeCustomerCount,
        ),
        highValueCustomerCount: customerInsights.summary.highValueCustomerCount,
        workshopActiveCustomerCount: customerInsights.summary.workshopActiveCustomerCount,
        customersWithCreditCount: customerInsights.summary.customersWithCreditCount,
        totalCreditBalancePence: customerInsights.summary.totalCreditBalancePence,
        averageSpendPence: customerInsights.summary.averageSpendPence,
      },
      topCustomers: customerInsights.topCustomers,
      workshopActiveCustomers: customerInsights.workshopActiveCustomers,
    },
  };
};
