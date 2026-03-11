import { WorkshopJobStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { getPaymentsReportRows } from "./paymentIntentService";

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

type DateRange = {
  from: string;
  to: string;
};

type TakeRange = DateRange & {
  take: number;
};

type DailyMoneyRow = {
  date: string;
  amountPence: number;
};

const parseDateOnlyOrThrow = (value: string, field: "from" | "to") => {
  if (!DATE_ONLY_REGEX.test(value)) {
    throw new HttpError(400, `${field} must be YYYY-MM-DD`, "INVALID_DATE");
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${field} is invalid`, "INVALID_DATE");
  }

  return date;
};

const getDateRangeOrThrow = (from?: string, to?: string): DateRange => {
  if (!from || !to) {
    throw new HttpError(400, "from and to are required", "INVALID_DATE_RANGE");
  }

  const fromDate = parseDateOnlyOrThrow(from, "from");
  const toDate = parseDateOnlyOrThrow(to, "to");

  if (fromDate > toDate) {
    throw new HttpError(400, "from must be before or equal to to", "INVALID_DATE_RANGE");
  }

  return { from, to };
};

const getDateRangeWithTakeOrThrow = (from?: string, to?: string, take?: number): TakeRange => {
  const range = getDateRangeOrThrow(from, to);

  const normalizedTake = take ?? 20;
  if (!Number.isInteger(normalizedTake) || normalizedTake < 1 || normalizedTake > 100) {
    throw new HttpError(400, "take must be an integer between 1 and 100", "INVALID_TAKE");
  }

  return {
    ...range,
    take: normalizedTake,
  };
};

const toNumber = (value: unknown): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (
    value !== null &&
    typeof value === "object" &&
    "toNumber" in value &&
    typeof (value as { toNumber: unknown }).toNumber === "function"
  ) {
    const parsed = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value === null || value === undefined) {
    return 0;
  }
  return 0;
};

const toInteger = (value: unknown): number => Math.trunc(toNumber(value));

const addDaysUtc = (date: Date, days: number) => {
  const out = new Date(date);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
};

const listDateKeys = (from: string, to: string): string[] => {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);

  const keys: string[] = [];
  let current = start;
  while (current <= end) {
    keys.push(current.toISOString().slice(0, 10));
    current = addDaysUtc(current, 1);
  }

  return keys;
};

const buildDailyAmountMap = (rows: DailyMoneyRow[]) => {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.date, row.amountPence);
  }
  return map;
};

const assertLocationIdOrThrow = async (locationId?: string) => {
  if (!locationId || !isUuid(locationId)) {
    throw new HttpError(400, "locationId must be a valid UUID", "INVALID_LOCATION_ID");
  }

  const location = await prisma.stockLocation.findUnique({
    where: { id: locationId },
    select: { id: true },
  });

  if (!location) {
    throw new HttpError(404, "Stock location not found", "LOCATION_NOT_FOUND");
  }

  return locationId;
};

const parseActiveFilterOrThrow = (value?: string) => {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") {
    return true;
  }
  if (normalized === "0" || normalized === "false") {
    return false;
  }

  throw new HttpError(400, "active must be 1, 0, true, or false", "INVALID_FILTER");
};

const normalizeOptionalSearch = (value?: string) => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const getSalesDailyReport = async (from?: string, to?: string) => {
  const range = getDateRangeOrThrow(from, to);
  const days = listDateKeys(range.from, range.to);

  const salesRows = await prisma.$queryRaw<
    Array<{ date: string; saleCount: number; grossPence: number }>
  >`
    SELECT
      to_char((s."createdAt" AT TIME ZONE 'Europe/London')::date, 'YYYY-MM-DD') AS "date",
      COUNT(*)::int AS "saleCount",
      COALESCE(SUM(s."totalPence"), 0)::bigint AS "grossPence"
    FROM "Sale" s
    WHERE (s."createdAt" AT TIME ZONE 'Europe/London')::date BETWEEN ${range.from}::date AND ${range.to}::date
    GROUP BY "date"
    ORDER BY "date" ASC
  `;

  // Refunds rule for M19 v1:
  // refundsPence is "refunds posted that day", based on negative Payment rows by payment created-at day.
  const refundRows = await prisma.$queryRaw<Array<{ date: string; refundsPence: number }>>`
    SELECT
      to_char((p."createdAt" AT TIME ZONE 'Europe/London')::date, 'YYYY-MM-DD') AS "date",
      COALESCE(SUM(ABS(p."amountPence")), 0)::bigint AS "refundsPence"
    FROM "Payment" p
    WHERE
      p."amountPence" < 0
      AND (p."createdAt" AT TIME ZONE 'Europe/London')::date BETWEEN ${range.from}::date AND ${range.to}::date
    GROUP BY "date"
    ORDER BY "date" ASC
  `;

  const salesMap = new Map(
    salesRows.map((row) => [
      row.date,
      {
        saleCount: toInteger(row.saleCount),
        grossPence: toInteger(row.grossPence),
      },
    ]),
  );
  const refundMap = buildDailyAmountMap(
    refundRows.map((row) => ({
      date: row.date,
      amountPence: toInteger(row.refundsPence),
    })),
  );

  return days.map((date) => {
    const sales = salesMap.get(date);
    const saleCount = sales?.saleCount ?? 0;
    const grossPence = sales?.grossPence ?? 0;
    const refundsPence = refundMap.get(date) ?? 0;

    return {
      date,
      saleCount,
      grossPence,
      refundsPence,
      // Net can be negative on a day where posted refunds exceed gross sales.
      netPence: grossPence - refundsPence,
    };
  });
};

export const getWorkshopDailyReport = async (from?: string, to?: string) => {
  const range = getDateRangeOrThrow(from, to);
  const days = listDateKeys(range.from, range.to);

  const rows = await prisma.$queryRaw<Array<{ date: string; jobCount: number; revenuePence: number }>>`
    SELECT
      to_char((w."completedAt" AT TIME ZONE 'Europe/London')::date, 'YYYY-MM-DD') AS "date",
      COUNT(*)::int AS "jobCount",
      COALESCE(SUM(s."totalPence"), 0)::bigint AS "revenuePence"
    FROM "WorkshopJob" w
    LEFT JOIN "Sale" s ON s."workshopJobId" = w.id
    WHERE
      w.status = 'COMPLETED'
      AND w."completedAt" IS NOT NULL
      AND (w."completedAt" AT TIME ZONE 'Europe/London')::date BETWEEN ${range.from}::date AND ${range.to}::date
    GROUP BY "date"
    ORDER BY "date" ASC
  `;

  const byDate = new Map(
    rows.map((row) => [
      row.date,
      {
        jobCount: toInteger(row.jobCount),
        revenuePence: toInteger(row.revenuePence),
      },
    ]),
  );

  return days.map((date) => {
    const row = byDate.get(date);
    return {
      date,
      jobCount: row?.jobCount ?? 0,
      revenuePence: row?.revenuePence ?? 0,
    };
  });
};

const WORKSHOP_CAPACITY_LOOKBACK_DAYS = 30;
const WORKSHOP_CAPACITY_OPEN_STATUSES = new Set<WorkshopJobStatus>([
  "BOOKING_MADE",
  "BIKE_ARRIVED",
  "WAITING_FOR_APPROVAL",
  "APPROVED",
  "WAITING_FOR_PARTS",
  "ON_HOLD",
  "BIKE_READY",
]);

export const getWorkshopCapacityReport = async () => {
  const now = new Date();
  const completedFrom = new Date(now);
  completedFrom.setUTCDate(completedFrom.getUTCDate() - (WORKSHOP_CAPACITY_LOOKBACK_DAYS - 1));
  completedFrom.setUTCHours(0, 0, 0, 0);

  const jobs = await prisma.workshopJob.findMany({
    select: {
      status: true,
      createdAt: true,
      completedAt: true,
    },
  });

  const openJobs = jobs.filter((job) => WORKSHOP_CAPACITY_OPEN_STATUSES.has(job.status));
  const waitingForApprovalCount = openJobs.filter((job) => job.status === "WAITING_FOR_APPROVAL").length;
  const waitingForPartsCount = openJobs.filter((job) => job.status === "WAITING_FOR_PARTS").length;
  const completedJobsLast30Days = jobs.filter((job) => (
    job.completedAt !== null
    && job.completedAt >= completedFrom
    && job.completedAt <= now
  )).length;
  const averageCompletedPerDay = Number((completedJobsLast30Days / WORKSHOP_CAPACITY_LOOKBACK_DAYS).toFixed(1));
  const estimatedBacklogDays = averageCompletedPerDay > 0
    ? Number((openJobs.length / averageCompletedPerDay).toFixed(1))
    : null;

  const ageingBuckets = {
    zeroToTwoDays: 0,
    threeToSevenDays: 0,
    eightToFourteenDays: 0,
    fifteenPlusDays: 0,
  };

  for (const job of openJobs) {
    const ageDays = Math.max(0, Math.floor((now.getTime() - job.createdAt.getTime()) / 86_400_000));
    if (ageDays <= 2) {
      ageingBuckets.zeroToTwoDays += 1;
    } else if (ageDays <= 7) {
      ageingBuckets.threeToSevenDays += 1;
    } else if (ageDays <= 14) {
      ageingBuckets.eightToFourteenDays += 1;
    } else {
      ageingBuckets.fifteenPlusDays += 1;
    }
  }

  return {
    generatedAt: now.toISOString(),
    lookbackDays: WORKSHOP_CAPACITY_LOOKBACK_DAYS,
    openJobCount: openJobs.length,
    waitingForApprovalCount,
    waitingForPartsCount,
    completedJobsLast30Days,
    averageCompletedPerDay,
    estimatedBacklogDays,
    ageingBuckets,
  };
};

export const getInventoryOnHandReport = async (locationId?: string) => {
  // Keep locationId validation for API compatibility while using a single-location inventory ledger.
  await assertLocationIdOrThrow(locationId);

  const grouped = await prisma.inventoryMovement.groupBy({
    by: ["variantId"],
    _sum: {
      quantity: true,
    },
  });

  const variantIds = grouped.map((row) => row.variantId);
  const variants =
    variantIds.length > 0
      ? await prisma.variant.findMany({
          where: {
            id: {
              in: variantIds,
            },
          },
          select: {
            id: true,
            barcode: true,
            option: true,
            name: true,
            product: {
              select: {
                name: true,
              },
            },
          },
        })
      : [];

  const variantById = new Map(variants.map((variant) => [variant.id, variant]));

  return grouped
    .map((row) => {
      const variant = variantById.get(row.variantId);
      return {
        variantId: row.variantId,
        barcode: variant?.barcode ?? null,
        option: variant?.option ?? variant?.name ?? null,
        productName: variant?.product.name ?? "Unknown",
        onHand: toInteger(row._sum.quantity),
      };
    })
    .sort((a, b) => {
      const productCompare = a.productName.localeCompare(b.productName);
      if (productCompare !== 0) {
        return productCompare;
      }
      return a.variantId.localeCompare(b.variantId);
    });
};

export const getInventoryValueReport = async (locationId?: string) => {
  // Keep locationId validation for API compatibility while using a single-location inventory ledger.
  const resolvedLocationId = await assertLocationIdOrThrow(locationId);

  const onHandRows = await prisma.inventoryMovement.groupBy({
    by: ["variantId"],
    _sum: {
      quantity: true,
    },
  });

  const variantIds = onHandRows.map((row) => row.variantId);
  const purchaseCostRows =
    variantIds.length > 0
      ? await prisma.inventoryMovement.findMany({
          where: {
            variantId: {
              in: variantIds,
            },
            type: "PURCHASE",
            quantity: {
              gt: 0,
            },
            unitCost: {
              not: null,
            },
          },
          select: {
            variantId: true,
            quantity: true,
            unitCost: true,
          },
        })
      : [];

  const weightedCostByVariant = new Map<string, { totalQty: number; totalCost: number }>();
  for (const row of purchaseCostRows) {
    const current = weightedCostByVariant.get(row.variantId) ?? { totalQty: 0, totalCost: 0 };
    const quantity = toInteger(row.quantity);
    const unitCost = toNumber(row.unitCost);

    current.totalQty += quantity;
    current.totalCost += quantity * unitCost;
    weightedCostByVariant.set(row.variantId, current);
  }

  const breakdown = onHandRows
    .map((row) => {
      const onHand = toInteger(row._sum.quantity);
      const weighted = weightedCostByVariant.get(row.variantId);

      const avgUnitCostPence =
        weighted && weighted.totalQty > 0
          ? Math.round(weighted.totalCost / weighted.totalQty)
          : null;
      const valuePence = avgUnitCostPence === null ? 0 : onHand * avgUnitCostPence;

      return {
        variantId: row.variantId,
        onHand,
        avgUnitCostPence,
        valuePence,
      };
    })
    .sort((a, b) => a.variantId.localeCompare(b.variantId));

  const totalOnHand = breakdown.reduce((sum, row) => sum + row.onHand, 0);
  const totalValuePence = breakdown.reduce((sum, row) => sum + row.valuePence, 0);
  const countMissingCost = breakdown.filter((row) => row.avgUnitCostPence === null).length;

  return {
    locationId: resolvedLocationId,
    totalOnHand,
    totalValuePence,
    method: "PURCHASE_COST_AVG_V1",
    countMissingCost,
    breakdown,
  };
};

export const getPaymentsReport = async (filters: {
  status?: string;
  provider?: string;
  from?: string;
  to?: string;
} = {}) => {
  return getPaymentsReportRows(filters);
};

export const getProductSalesReport = async (from?: string, to?: string, take?: number) => {
  const range = getDateRangeWithTakeOrThrow(from, to, take);

  const saleItems = await prisma.saleItem.findMany({
    where: {
      sale: {
        completedAt: {
          gte: parseDateOnlyOrThrow(range.from, "from"),
          lte: new Date(`${range.to}T23:59:59.999Z`),
        },
      },
    },
    select: {
      quantity: true,
      lineTotalPence: true,
      saleId: true,
      sale: {
        select: {
          completedAt: true,
        },
      },
      variant: {
        select: {
          id: true,
          product: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });

  const byProduct = new Map<string, {
    productId: string;
    productName: string;
    quantitySold: number;
    grossRevenuePence: number;
    saleIds: Set<string>;
    variantIds: Set<string>;
    lastSoldAt: Date | null;
  }>();

  for (const item of saleItems) {
    const productId = item.variant.product.id;
    const existing = byProduct.get(productId) ?? {
      productId,
      productName: item.variant.product.name,
      quantitySold: 0,
      grossRevenuePence: 0,
      saleIds: new Set<string>(),
      variantIds: new Set<string>(),
      lastSoldAt: null,
    };

    existing.quantitySold += item.quantity;
    existing.grossRevenuePence += item.lineTotalPence;
    existing.saleIds.add(item.saleId);
    existing.variantIds.add(item.variant.id);
    if (item.sale.completedAt && (!existing.lastSoldAt || item.sale.completedAt > existing.lastSoldAt)) {
      existing.lastSoldAt = item.sale.completedAt;
    }

    byProduct.set(productId, existing);
  }

  const products = Array.from(byProduct.values())
    .map((row) => ({
      productId: row.productId,
      productName: row.productName,
      quantitySold: row.quantitySold,
      grossRevenuePence: row.grossRevenuePence,
      saleCount: row.saleIds.size,
      variantCountSold: row.variantIds.size,
      averageUnitPricePence: row.quantitySold > 0 ? Math.round(row.grossRevenuePence / row.quantitySold) : 0,
      lastSoldAt: row.lastSoldAt,
    }))
    .sort((left, right) => (
      right.quantitySold - left.quantitySold
      || right.grossRevenuePence - left.grossRevenuePence
      || left.productName.localeCompare(right.productName)
    ));

  return {
    filters: range,
    summary: {
      productCount: products.length,
      totalQuantitySold: products.reduce((sum, row) => sum + row.quantitySold, 0),
      totalRevenuePence: products.reduce((sum, row) => sum + row.grossRevenuePence, 0),
    },
    topSellingProducts: products.slice(0, range.take),
    lowestSellingProducts: [...products]
      .sort((left, right) => (
        left.quantitySold - right.quantitySold
        || left.grossRevenuePence - right.grossRevenuePence
        || left.productName.localeCompare(right.productName)
      ))
      .slice(0, range.take),
    products,
    categoryBreakdownSupported: false,
  };
};

export const getInventoryVelocityReport = async (from?: string, to?: string, take?: number) => {
  const range = getDateRangeWithTakeOrThrow(from, to, take);
  const fromDate = parseDateOnlyOrThrow(range.from, "from");
  const toDate = new Date(`${range.to}T23:59:59.999Z`);
  const rangeDays = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1);

  const saleItems = await prisma.saleItem.findMany({
    where: {
      sale: {
        completedAt: {
          gte: fromDate,
          lte: toDate,
        },
      },
    },
    select: {
      quantity: true,
      lineTotalPence: true,
      sale: {
        select: {
          completedAt: true,
        },
      },
      variant: {
        select: {
          id: true,
          product: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });

  const stockRows = await prisma.inventoryMovement.groupBy({
    by: ["variantId"],
    _sum: {
      quantity: true,
    },
  });

  const variantIds = stockRows.map((row) => row.variantId);
  const variants = variantIds.length > 0
    ? await prisma.variant.findMany({
        where: {
          id: {
            in: variantIds,
          },
        },
        select: {
          id: true,
          product: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      })
    : [];

  const byProduct = new Map<string, {
    productId: string;
    productName: string;
    currentOnHand: number;
    quantitySold: number;
    grossRevenuePence: number;
    lastSoldAt: Date | null;
  }>();

  for (const row of stockRows) {
    const variant = variants.find((entry) => entry.id === row.variantId);
    if (!variant) {
      continue;
    }

    const productId = variant.product.id;
    const existing = byProduct.get(productId) ?? {
      productId,
      productName: variant.product.name,
      currentOnHand: 0,
      quantitySold: 0,
      grossRevenuePence: 0,
      lastSoldAt: null,
    };

    existing.currentOnHand += toInteger(row._sum.quantity);
    byProduct.set(productId, existing);
  }

  for (const item of saleItems) {
    const productId = item.variant.product.id;
    const existing = byProduct.get(productId) ?? {
      productId,
      productName: item.variant.product.name,
      currentOnHand: 0,
      quantitySold: 0,
      grossRevenuePence: 0,
      lastSoldAt: null,
    };

    existing.quantitySold += item.quantity;
    existing.grossRevenuePence += item.lineTotalPence;
    if (item.sale.completedAt && (!existing.lastSoldAt || item.sale.completedAt > existing.lastSoldAt)) {
      existing.lastSoldAt = item.sale.completedAt;
    }
    byProduct.set(productId, existing);
  }

  const products = Array.from(byProduct.values())
    .map((row) => {
      const baseStock = Math.max(0, row.currentOnHand) + row.quantitySold;
      const sellThroughRate = baseStock > 0 ? Number((row.quantitySold / baseStock).toFixed(3)) : 0;
      const velocityPer30Days = Number(((row.quantitySold / rangeDays) * 30).toFixed(1));

      return {
        productId: row.productId,
        productName: row.productName,
        currentOnHand: row.currentOnHand,
        quantitySold: row.quantitySold,
        grossRevenuePence: row.grossRevenuePence,
        velocityPer30Days,
        sellThroughRate,
        lastSoldAt: row.lastSoldAt,
      };
    })
    .sort((left, right) => (
      right.quantitySold - left.quantitySold
      || right.grossRevenuePence - left.grossRevenuePence
      || left.productName.localeCompare(right.productName)
    ));

  const fastMovingProducts = products
    .filter((row) => row.quantitySold > 0)
    .slice(0, range.take);

  const slowMovingProducts = [...products]
    .filter((row) => row.quantitySold > 0 && row.currentOnHand > 0)
    .sort((left, right) => (
      left.quantitySold - right.quantitySold
      || right.currentOnHand - left.currentOnHand
      || left.productName.localeCompare(right.productName)
    ))
    .slice(0, range.take);

  const deadStockCandidates = [...products]
    .filter((row) => row.currentOnHand > 0 && row.quantitySold === 0)
    .sort((left, right) => (
      right.currentOnHand - left.currentOnHand
      || left.productName.localeCompare(right.productName)
    ))
    .slice(0, range.take);

  return {
    filters: {
      ...range,
      rangeDays,
    },
    summary: {
      trackedProductCount: products.length,
      productsWithSales: products.filter((row) => row.quantitySold > 0).length,
      deadStockCount: products.filter((row) => row.currentOnHand > 0 && row.quantitySold === 0).length,
      totalOnHand: products.reduce((sum, row) => sum + row.currentOnHand, 0),
    },
    fastMovingProducts,
    slowMovingProducts,
    deadStockCandidates,
    products,
  };
};

type InventoryVelocityClass = "FAST_MOVER" | "NORMAL" | "SLOW_MOVER" | "DEAD_STOCK";
type PricingExceptionType = "MISSING_RETAIL_PRICE" | "RETAIL_AT_OR_BELOW_COST" | "LOW_MARGIN";

const getInventoryVelocityClass = (sales30Days: number, sales90Days: number, onHand: number): InventoryVelocityClass => {
  if (sales90Days === 0 && onHand > 0) {
    return "DEAD_STOCK";
  }
  if (sales30Days >= 10) {
    return "FAST_MOVER";
  }
  if (sales30Days >= 3) {
    return "NORMAL";
  }
  if (sales30Days >= 1) {
    return "SLOW_MOVER";
  }
  return "NORMAL";
};

const getPricingExceptionType = (retailPrice: number, cost: number | null): PricingExceptionType | null => {
  if (retailPrice <= 0) {
    return "MISSING_RETAIL_PRICE";
  }
  if (cost === null) {
    return null;
  }

  if (retailPrice <= cost) {
    return "RETAIL_AT_OR_BELOW_COST";
  }

  const marginPercent = ((retailPrice - cost) / retailPrice) * 100;
  if (marginPercent < 20) {
    return "LOW_MARGIN";
  }

  return null;
};

export const getPricingExceptionsReport = async () => {
  const variants = await prisma.variant.findMany({
    select: {
      id: true,
      sku: true,
      retailPricePence: true,
      costPricePence: true,
      product: {
        select: {
          name: true,
        },
      },
    },
  });

  const latestPurchaseCosts = await prisma.purchaseOrderItem.findMany({
    where: {
      unitCostPence: {
        not: null,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      variantId: true,
      unitCostPence: true,
    },
  });

  const purchaseCostByVariant = new Map<string, number>();
  for (const row of latestPurchaseCosts) {
    if (row.unitCostPence === null || purchaseCostByVariant.has(row.variantId)) {
      continue;
    }
    purchaseCostByVariant.set(row.variantId, row.unitCostPence);
  }

  const items = variants
    .map((variant) => {
      const retailPrice = variant.retailPricePence;
      const cost = variant.costPricePence ?? purchaseCostByVariant.get(variant.id) ?? null;
      const exceptionType = getPricingExceptionType(retailPrice, cost);

      if (!exceptionType) {
        return null;
      }

      const apparentMarginPence =
        cost !== null && retailPrice > 0
          ? retailPrice - cost
          : null;
      const apparentMarginPercent =
        cost !== null && retailPrice > 0
          ? Number((((retailPrice - cost) / retailPrice) * 100).toFixed(1))
          : null;

      return {
        variantId: variant.id,
        productName: variant.product.name,
        sku: variant.sku,
        cost,
        retailPrice,
        apparentMarginPence,
        apparentMarginPercent,
        exceptionType,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((left, right) => (
      (left.exceptionType === "MISSING_RETAIL_PRICE" ? 0 : left.exceptionType === "RETAIL_AT_OR_BELOW_COST" ? 1 : 2)
      - (right.exceptionType === "MISSING_RETAIL_PRICE" ? 0 : right.exceptionType === "RETAIL_AT_OR_BELOW_COST" ? 1 : 2)
      || left.productName.localeCompare(right.productName)
      || left.sku.localeCompare(right.sku)
    ));

  return {
    generatedAt: new Date().toISOString(),
    thresholds: {
      lowMarginPercent: 20,
    },
    summary: {
      missingRetailPriceCount: items.filter((row) => row.exceptionType === "MISSING_RETAIL_PRICE").length,
      retailAtOrBelowCostCount: items.filter((row) => row.exceptionType === "RETAIL_AT_OR_BELOW_COST").length,
      lowMarginCount: items.filter((row) => row.exceptionType === "LOW_MARGIN").length,
    },
    items,
  };
};

export const getInventoryVelocity = async () => {
  const now = new Date();
  const from30Days = new Date(now);
  from30Days.setUTCDate(from30Days.getUTCDate() - 29);
  from30Days.setUTCHours(0, 0, 0, 0);

  const from90Days = new Date(now);
  from90Days.setUTCDate(from90Days.getUTCDate() - 89);
  from90Days.setUTCHours(0, 0, 0, 0);

  const saleItems = await prisma.saleItem.findMany({
    where: {
      sale: {
        completedAt: {
          gte: from90Days,
          lte: now,
        },
      },
    },
    select: {
      quantity: true,
      sale: {
        select: {
          completedAt: true,
        },
      },
      variant: {
        select: {
          id: true,
          sku: true,
          product: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  });

  const stockRows = await prisma.inventoryMovement.groupBy({
    by: ["variantId"],
    _sum: {
      quantity: true,
    },
  });

  const variantIds = Array.from(new Set([
    ...saleItems.map((item) => item.variant.id),
    ...stockRows.map((row) => row.variantId),
  ]));

  const variants = variantIds.length > 0
    ? await prisma.variant.findMany({
        where: {
          id: {
            in: variantIds,
          },
        },
        select: {
          id: true,
          sku: true,
          product: {
            select: {
              name: true,
            },
          },
        },
      })
    : [];

  const variantMap = new Map(variants.map((variant) => [variant.id, variant]));
  const onHandMap = new Map(stockRows.map((row) => [row.variantId, toInteger(row._sum.quantity)]));
  const salesMap = new Map<string, { sales30Days: number; sales90Days: number }>();

  for (const item of saleItems) {
    const existing = salesMap.get(item.variant.id) ?? { sales30Days: 0, sales90Days: 0 };
    existing.sales90Days += item.quantity;
    if (item.sale.completedAt && item.sale.completedAt >= from30Days) {
      existing.sales30Days += item.quantity;
    }
    salesMap.set(item.variant.id, existing);
  }

  const items = variantIds
    .map((variantId) => {
      const variant = variantMap.get(variantId);
      if (!variant) {
        return null;
      }

      const sales = salesMap.get(variantId) ?? { sales30Days: 0, sales90Days: 0 };
      const onHand = onHandMap.get(variantId) ?? 0;

      return {
        variantId,
        productName: variant.product.name,
        sku: variant.sku,
        onHand,
        sales30Days: sales.sales30Days,
        sales90Days: sales.sales90Days,
        velocityClass: getInventoryVelocityClass(sales.sales30Days, sales.sales90Days, onHand),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((left, right) => (
      (right.velocityClass === "FAST_MOVER" ? 4 : right.velocityClass === "NORMAL" ? 3 : right.velocityClass === "SLOW_MOVER" ? 2 : 1)
      - (left.velocityClass === "FAST_MOVER" ? 4 : left.velocityClass === "NORMAL" ? 3 : left.velocityClass === "SLOW_MOVER" ? 2 : 1)
      || right.sales30Days - left.sales30Days
      || right.sales90Days - left.sales90Days
      || left.productName.localeCompare(right.productName)
      || left.sku.localeCompare(right.sku)
    ));

  return {
    generatedAt: new Date().toISOString(),
    items,
  };
};

type ReorderSuggestionUrgency = "Reorder Now" | "Reorder Soon" | "On Order";

const REORDER_LOOKBACK_DAYS = 30;
const REORDER_TARGET_COVERAGE_DAYS = 30;
const reorderUrgencyRank: Record<ReorderSuggestionUrgency, number> = {
  "Reorder Now": 3,
  "Reorder Soon": 2,
  "On Order": 1,
};

export const getInventoryReorderSuggestionsReport = async (take?: number) => {
  const normalizedTake = take ?? 100;
  if (!Number.isInteger(normalizedTake) || normalizedTake < 1 || normalizedTake > 200) {
    throw new HttpError(400, "take must be an integer between 1 and 200", "INVALID_TAKE");
  }

  const toDate = new Date();
  const fromDate = new Date(toDate);
  fromDate.setUTCDate(fromDate.getUTCDate() - (REORDER_LOOKBACK_DAYS - 1));
  fromDate.setUTCHours(0, 0, 0, 0);

  const saleItems = await prisma.saleItem.findMany({
    where: {
      sale: {
        completedAt: {
          gte: fromDate,
          lte: toDate,
        },
      },
    },
    select: {
      quantity: true,
      sale: {
        select: {
          completedAt: true,
        },
      },
      variant: {
        select: {
          id: true,
          sku: true,
          name: true,
          option: true,
          product: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });

  const stockRows = await prisma.inventoryMovement.groupBy({
    by: ["variantId"],
    _sum: {
      quantity: true,
    },
  });

  const openPurchaseOrderItems = await prisma.purchaseOrderItem.findMany({
    where: {
      purchaseOrder: {
        status: {
          in: ["SENT", "PARTIALLY_RECEIVED"],
        },
      },
    },
    select: {
      id: true,
      variantId: true,
      quantityOrdered: true,
      quantityReceived: true,
      purchaseOrder: {
        select: {
          id: true,
          poNumber: true,
          status: true,
          expectedAt: true,
          supplier: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  });

  const variantIds = Array.from(new Set([
    ...saleItems.map((item) => item.variant.id),
    ...stockRows.map((row) => row.variantId),
    ...openPurchaseOrderItems.map((item) => item.variantId),
  ]));

  const variants = variantIds.length > 0
    ? await prisma.variant.findMany({
        where: {
          id: {
            in: variantIds,
          },
        },
        select: {
          id: true,
          sku: true,
          name: true,
          option: true,
          product: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      })
    : [];

  const variantMap = new Map(variants.map((variant) => [variant.id, variant]));
  const onHandMap = new Map(stockRows.map((row) => [row.variantId, toInteger(row._sum.quantity)]));
  const salesMap = new Map<string, { quantitySold: number; lastSoldAt: Date | null }>();
  const incomingMap = new Map<string, {
    onOpenPurchaseOrders: number;
    openPurchaseOrders: Array<{
      id: string;
      poNumber: string;
      status: string;
      expectedAt: Date | null;
      supplierName: string;
      quantityRemaining: number;
    }>;
  }>();

  for (const item of saleItems) {
    const existing = salesMap.get(item.variant.id) ?? { quantitySold: 0, lastSoldAt: null };
    existing.quantitySold += item.quantity;
    if (item.sale.completedAt && (!existing.lastSoldAt || item.sale.completedAt > existing.lastSoldAt)) {
      existing.lastSoldAt = item.sale.completedAt;
    }
    salesMap.set(item.variant.id, existing);
  }

  for (const item of openPurchaseOrderItems) {
    const quantityRemaining = Math.max(0, item.quantityOrdered - item.quantityReceived);
    if (quantityRemaining <= 0) {
      continue;
    }

    const existing = incomingMap.get(item.variantId) ?? {
      onOpenPurchaseOrders: 0,
      openPurchaseOrders: [],
    };
    existing.onOpenPurchaseOrders += quantityRemaining;
    existing.openPurchaseOrders.push({
      id: item.purchaseOrder.id,
      poNumber: item.purchaseOrder.poNumber,
      status: item.purchaseOrder.status,
      expectedAt: item.purchaseOrder.expectedAt,
      supplierName: item.purchaseOrder.supplier.name,
      quantityRemaining,
    });
    incomingMap.set(item.variantId, existing);
  }

  const allSuggestions = variantIds
    .map((variantId) => {
      const variant = variantMap.get(variantId);
      if (!variant) {
        return null;
      }

      const sales = salesMap.get(variantId) ?? { quantitySold: 0, lastSoldAt: null };
      const purchasing = incomingMap.get(variantId) ?? {
        onOpenPurchaseOrders: 0,
        openPurchaseOrders: [],
      };
      const currentOnHand = onHandMap.get(variantId) ?? 0;
      const dailyDemand = sales.quantitySold > 0 ? sales.quantitySold / REORDER_LOOKBACK_DAYS : 0;
      const targetStockQty = Math.max(0, Math.ceil(dailyDemand * REORDER_TARGET_COVERAGE_DAYS));
      const suggestedReorderQty = Math.max(
        0,
        targetStockQty - Math.max(0, currentOnHand) - purchasing.onOpenPurchaseOrders,
      );
      const daysOfCover = dailyDemand > 0 ? Number((Math.max(0, currentOnHand) / dailyDemand).toFixed(1)) : null;

      let urgency: ReorderSuggestionUrgency | null = null;
      if (suggestedReorderQty > 0 && (currentOnHand <= 0 || (daysOfCover !== null && daysOfCover <= 7))) {
        urgency = "Reorder Now";
      } else if (suggestedReorderQty > 0) {
        urgency = "Reorder Soon";
      } else if (sales.quantitySold > 0 && purchasing.onOpenPurchaseOrders > 0 && currentOnHand < targetStockQty) {
        urgency = "On Order";
      }

      if (!urgency) {
        return null;
      }

      const displayName = variant.name?.trim() || variant.option?.trim() || variant.product.name;
      const openPurchaseOrders = [...purchasing.openPurchaseOrders].sort((left, right) => {
        const leftTime = left.expectedAt ? new Date(left.expectedAt).getTime() : Number.MAX_SAFE_INTEGER;
        const rightTime = right.expectedAt ? new Date(right.expectedAt).getTime() : Number.MAX_SAFE_INTEGER;
        return leftTime - rightTime || left.poNumber.localeCompare(right.poNumber);
      });

      return {
        variantId,
        productId: variant.product.id,
        productName: variant.product.name,
        variantName: variant.name,
        displayName,
        sku: variant.sku,
        currentOnHand,
        recentSalesQty: sales.quantitySold,
        daysOfCover,
        targetStockQty,
        suggestedReorderQty,
        urgency,
        onOpenPurchaseOrders: purchasing.onOpenPurchaseOrders,
        openPurchaseOrders,
        lastSoldAt: sales.lastSoldAt,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((left, right) => (
      reorderUrgencyRank[right.urgency] - reorderUrgencyRank[left.urgency]
      || right.suggestedReorderQty - left.suggestedReorderQty
      || right.recentSalesQty - left.recentSalesQty
      || left.productName.localeCompare(right.productName)
      || left.displayName.localeCompare(right.displayName)
    ));

  const items = allSuggestions.slice(0, normalizedTake);

  return {
    generatedAt: new Date().toISOString(),
    heuristic: {
      lookbackDays: REORDER_LOOKBACK_DAYS,
      targetCoverageDays: REORDER_TARGET_COVERAGE_DAYS,
      description: "Suggested reorder = 30-day sales demand minus current on-hand and open incoming PO quantity.",
    },
    summary: {
      candidateCount: allSuggestions.length,
      reorderNowCount: allSuggestions.filter((row) => row.urgency === "Reorder Now").length,
      reorderSoonCount: allSuggestions.filter((row) => row.urgency === "Reorder Soon").length,
      onOrderCount: allSuggestions.filter((row) => row.urgency === "On Order").length,
      totalSuggestedQty: allSuggestions.reduce((sum, row) => sum + row.suggestedReorderQty, 0),
    },
    items,
  };
};

export const getInventoryLocationSummaryReport = async (filters: {
  q?: string;
  active?: string;
  locationId?: string;
  take?: number;
} = {}) => {
  const take = filters.take ?? 100;
  if (!Number.isInteger(take) || take < 1 || take > 200) {
    throw new HttpError(400, "take must be an integer between 1 and 200", "INVALID_TAKE");
  }

  const q = normalizeOptionalSearch(filters.q);
  const active = parseActiveFilterOrThrow(filters.active);
  const selectedLocationId = filters.locationId ? await assertLocationIdOrThrow(filters.locationId) : undefined;

  const locations = await prisma.stockLocation.findMany({
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      isDefault: true,
    },
  });

  const visibleLocations = selectedLocationId
    ? locations.filter((location) => location.id === selectedLocationId)
    : locations;

  const variants = await prisma.variant.findMany({
    where: {
      stockLedgerEntries: { some: {} },
      ...(active === undefined ? {} : { isActive: active }),
      ...(q
        ? {
            OR: [
              { sku: { contains: q, mode: "insensitive" } },
              { barcode: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
              { option: { contains: q, mode: "insensitive" } },
              { product: { name: { contains: q, mode: "insensitive" } } },
              { product: { brand: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    take,
    select: {
      id: true,
      sku: true,
      barcode: true,
      name: true,
      option: true,
      isActive: true,
      product: {
        select: {
          id: true,
          name: true,
          brand: true,
        },
      },
    },
    orderBy: [{ sku: "asc" }],
  });

  const variantIds = variants.map((variant) => variant.id);

  const grouped = variantIds.length > 0
    ? await prisma.stockLedgerEntry.groupBy({
        by: ["variantId", "locationId"],
        where: {
          variantId: { in: variantIds },
          ...(selectedLocationId ? { locationId: selectedLocationId } : {}),
        },
        _sum: {
          quantityDelta: true,
        },
      })
    : [];

  const byVariant = new Map<string, Map<string, number>>();
  for (const row of grouped) {
    const current = byVariant.get(row.variantId) ?? new Map<string, number>();
    current.set(row.locationId, toInteger(row._sum.quantityDelta));
    byVariant.set(row.variantId, current);
  }

  const rows = variants.map((variant) => {
    const locationMap = byVariant.get(variant.id) ?? new Map<string, number>();
    const locationRows = visibleLocations.map((location) => ({
      id: location.id,
      name: location.name,
      isDefault: location.isDefault,
      onHand: locationMap.get(location.id) ?? 0,
    }));
    const totalOnHand = locationRows.reduce((sum, row) => sum + row.onHand, 0);

    return {
      variantId: variant.id,
      productId: variant.product.id,
      productName: variant.product.name,
      brand: variant.product.brand,
      sku: variant.sku,
      barcode: variant.barcode,
      variantName: variant.name ?? variant.option ?? null,
      isActive: variant.isActive,
      totalOnHand,
      locations: locationRows,
    };
  }).sort((left, right) => (
    left.productName.localeCompare(right.productName)
    || (left.variantName ?? "").localeCompare(right.variantName ?? "")
    || left.sku.localeCompare(right.sku)
  ));

  return {
    filters: {
      q: q ?? null,
      active: active === undefined ? null : active,
      locationId: selectedLocationId ?? null,
      take,
    },
    summary: {
      variantCount: rows.length,
      locationCount: visibleLocations.length,
      totalOnHand: rows.reduce((sum, row) => sum + row.totalOnHand, 0),
      zeroStockVariants: rows.filter((row) => row.totalOnHand === 0).length,
      negativeStockVariants: rows.filter((row) => row.totalOnHand < 0).length,
    },
    locations: visibleLocations,
    rows,
  };
};

export const getSupplierPerformanceReport = async () => {
  const now = new Date();
  const purchaseOrders = await prisma.purchaseOrder.findMany({
    include: {
      supplier: {
        select: {
          id: true,
          name: true,
        },
      },
      items: {
        select: {
          quantityOrdered: true,
          quantityReceived: true,
        },
      },
    },
    orderBy: [{ createdAt: "desc" }],
  });

  const bySupplier = new Map<string, {
    supplierId: string;
    supplierName: string;
    purchaseOrderCount: number;
    openPurchaseOrderCount: number;
    partiallyReceivedCount: number;
    receivedPurchaseOrderCount: number;
    overdueOpenPurchaseOrderCount: number;
    totalOrderedQuantity: number;
    totalReceivedQuantity: number;
  }>();

  for (const po of purchaseOrders) {
    const existing = bySupplier.get(po.supplierId) ?? {
      supplierId: po.supplierId,
      supplierName: po.supplier.name,
      purchaseOrderCount: 0,
      openPurchaseOrderCount: 0,
      partiallyReceivedCount: 0,
      receivedPurchaseOrderCount: 0,
      overdueOpenPurchaseOrderCount: 0,
      totalOrderedQuantity: 0,
      totalReceivedQuantity: 0,
    };

    existing.purchaseOrderCount += 1;
    if (po.status === "SENT" || po.status === "PARTIALLY_RECEIVED") {
      existing.openPurchaseOrderCount += 1;
    }
    if (po.status === "PARTIALLY_RECEIVED") {
      existing.partiallyReceivedCount += 1;
    }
    if (po.status === "RECEIVED") {
      existing.receivedPurchaseOrderCount += 1;
    }
    if (
      (po.status === "SENT" || po.status === "PARTIALLY_RECEIVED")
      && po.expectedAt
      && po.expectedAt < now
    ) {
      existing.overdueOpenPurchaseOrderCount += 1;
    }

    for (const item of po.items) {
      existing.totalOrderedQuantity += item.quantityOrdered;
      existing.totalReceivedQuantity += item.quantityReceived;
    }

    bySupplier.set(po.supplierId, existing);
  }

  const suppliers = Array.from(bySupplier.values())
    .sort((left, right) => (
      right.overdueOpenPurchaseOrderCount - left.overdueOpenPurchaseOrderCount
      || right.openPurchaseOrderCount - left.openPurchaseOrderCount
      || right.purchaseOrderCount - left.purchaseOrderCount
      || left.supplierName.localeCompare(right.supplierName)
    ));

  return {
    generatedAt: now.toISOString(),
    summary: {
      supplierCount: suppliers.length,
      purchaseOrderCount: suppliers.reduce((sum, row) => sum + row.purchaseOrderCount, 0),
      openPurchaseOrderCount: suppliers.reduce((sum, row) => sum + row.openPurchaseOrderCount, 0),
      overdueOpenPurchaseOrderCount: suppliers.reduce((sum, row) => sum + row.overdueOpenPurchaseOrderCount, 0),
      totalOrderedQuantity: suppliers.reduce((sum, row) => sum + row.totalOrderedQuantity, 0),
      totalReceivedQuantity: suppliers.reduce((sum, row) => sum + row.totalReceivedQuantity, 0),
    },
    suppliers,
  };
};

const toCustomerDisplayName = (customer: {
  name: string;
  firstName: string;
  lastName: string;
}) => {
  const explicitName = customer.name.trim();
  if (explicitName.length > 0) {
    return explicitName;
  }

  return [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim() || "Unknown customer";
};

const OPEN_WORKSHOP_STATUSES = new Set([
  "BOOKING_MADE",
  "BIKE_ARRIVED",
  "WAITING_FOR_APPROVAL",
  "APPROVED",
  "WAITING_FOR_PARTS",
  "ON_HOLD",
  "BIKE_READY",
]);

export const getCustomerInsightsReport = async (from?: string, to?: string, take?: number) => {
  const range = getDateRangeWithTakeOrThrow(from, to, take);
  const fromDate = parseDateOnlyOrThrow(range.from, "from");
  const toDate = new Date(`${range.to}T23:59:59.999Z`);

  const [customers, sales, workshopJobs, creditAccounts] = await Promise.all([
    prisma.customer.findMany({
      select: {
        id: true,
        name: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        createdAt: true,
      },
    }),
    prisma.sale.findMany({
      where: {
        customerId: { not: null },
        completedAt: {
          gte: fromDate,
          lte: toDate,
        },
      },
      select: {
        id: true,
        customerId: true,
        totalPence: true,
        completedAt: true,
      },
    }),
    prisma.workshopJob.findMany({
      where: {
        customerId: { not: null },
      },
      select: {
        id: true,
        customerId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
      },
    }),
    prisma.creditAccount.findMany({
      where: {
        customerId: { not: null },
      },
      select: {
        customerId: true,
        entries: {
          select: {
            amountPence: true,
          },
        },
      },
    }),
  ]);

  const salesByCustomer = new Map<string, {
    saleCount: number;
    totalSpendPence: number;
    lastSaleAt: Date | null;
  }>();
  for (const sale of sales) {
    if (!sale.customerId) {
      continue;
    }
    const current = salesByCustomer.get(sale.customerId) ?? {
      saleCount: 0,
      totalSpendPence: 0,
      lastSaleAt: null,
    };
    current.saleCount += 1;
    current.totalSpendPence += sale.totalPence;
    if (sale.completedAt && (!current.lastSaleAt || sale.completedAt > current.lastSaleAt)) {
      current.lastSaleAt = sale.completedAt;
    }
    salesByCustomer.set(sale.customerId, current);
  }

  const workshopByCustomer = new Map<string, {
    totalWorkshopJobs: number;
    activeWorkshopJobs: number;
    recentWorkshopJobs: number;
    lastWorkshopAt: Date | null;
  }>();
  for (const job of workshopJobs) {
    if (!job.customerId) {
      continue;
    }
    const current = workshopByCustomer.get(job.customerId) ?? {
      totalWorkshopJobs: 0,
      activeWorkshopJobs: 0,
      recentWorkshopJobs: 0,
      lastWorkshopAt: null,
    };
    current.totalWorkshopJobs += 1;
    if (OPEN_WORKSHOP_STATUSES.has(job.status)) {
      current.activeWorkshopJobs += 1;
    }
    if (job.updatedAt >= fromDate && job.updatedAt <= toDate) {
      current.recentWorkshopJobs += 1;
    }
    if (!current.lastWorkshopAt || job.updatedAt > current.lastWorkshopAt) {
      current.lastWorkshopAt = job.updatedAt;
    }
    workshopByCustomer.set(job.customerId, current);
  }

  const creditByCustomer = new Map<string, number>();
  for (const account of creditAccounts) {
    if (!account.customerId) {
      continue;
    }
    const balance = account.entries.reduce((sum, entry) => sum + entry.amountPence, 0);
    creditByCustomer.set(account.customerId, balance);
  }

  const baseRows = customers.map((customer) => {
    const salesRow = salesByCustomer.get(customer.id);
    const workshopRow = workshopByCustomer.get(customer.id);
    const creditBalancePence = creditByCustomer.get(customer.id) ?? 0;
    const lastActivityAtCandidates = [salesRow?.lastSaleAt, workshopRow?.lastWorkshopAt].filter(
      (value): value is Date => Boolean(value),
    );
    const lastActivityAt = lastActivityAtCandidates.length > 0
      ? [...lastActivityAtCandidates].sort((left, right) => right.getTime() - left.getTime())[0]
      : null;

    return {
      customerId: customer.id,
      customerName: toCustomerDisplayName(customer),
      email: customer.email,
      phone: customer.phone,
      saleCount: salesRow?.saleCount ?? 0,
      totalSpendPence: salesRow?.totalSpendPence ?? 0,
      averageOrderValuePence:
        salesRow && salesRow.saleCount > 0 ? Math.round(salesRow.totalSpendPence / salesRow.saleCount) : 0,
      totalWorkshopJobs: workshopRow?.totalWorkshopJobs ?? 0,
      activeWorkshopJobs: workshopRow?.activeWorkshopJobs ?? 0,
      recentWorkshopJobs: workshopRow?.recentWorkshopJobs ?? 0,
      creditBalancePence,
      lastSaleAt: salesRow?.lastSaleAt ?? null,
      lastWorkshopAt: workshopRow?.lastWorkshopAt ?? null,
      lastActivityAt,
      createdAt: customer.createdAt,
    };
  });

  const customersWithSales = baseRows.filter((row) => row.saleCount > 0);
  const averageSpendPence = customersWithSales.length > 0
    ? Math.round(customersWithSales.reduce((sum, row) => sum + row.totalSpendPence, 0) / customersWithSales.length)
    : 0;

  const customersWithFlags = baseRows.map((row) => ({
    ...row,
    isRepeatCustomer: row.saleCount >= 2,
    isHighValueCustomer: row.totalSpendPence > 0 && row.totalSpendPence >= averageSpendPence,
  }));

  const topCustomers = [...customersWithFlags]
    .filter((row) => row.totalSpendPence > 0)
    .sort((left, right) => (
      right.totalSpendPence - left.totalSpendPence
      || right.saleCount - left.saleCount
      || left.customerName.localeCompare(right.customerName)
    ))
    .slice(0, range.take);

  const repeatCustomers = [...customersWithFlags]
    .filter((row) => row.isRepeatCustomer)
    .sort((left, right) => (
      right.saleCount - left.saleCount
      || right.totalSpendPence - left.totalSpendPence
      || left.customerName.localeCompare(right.customerName)
    ))
    .slice(0, range.take);

  const recentActivityCustomers = [...customersWithFlags]
    .filter((row) => row.lastActivityAt)
    .sort((left, right) => (
      (right.lastActivityAt?.getTime() ?? 0) - (left.lastActivityAt?.getTime() ?? 0)
      || left.customerName.localeCompare(right.customerName)
    ))
    .slice(0, range.take);

  const workshopActiveCustomers = [...customersWithFlags]
    .filter((row) => row.activeWorkshopJobs > 0)
    .sort((left, right) => (
      right.activeWorkshopJobs - left.activeWorkshopJobs
      || (right.lastWorkshopAt?.getTime() ?? 0) - (left.lastWorkshopAt?.getTime() ?? 0)
      || left.customerName.localeCompare(right.customerName)
    ))
    .slice(0, range.take);

  return {
    filters: range,
    summary: {
      customerCount: baseRows.length,
      activeCustomerCount: customersWithFlags.filter((row) => row.saleCount > 0 || row.activeWorkshopJobs > 0).length,
      repeatCustomerCount: customersWithFlags.filter((row) => row.isRepeatCustomer).length,
      highValueCustomerCount: customersWithFlags.filter((row) => row.isHighValueCustomer).length,
      workshopActiveCustomerCount: customersWithFlags.filter((row) => row.activeWorkshopJobs > 0).length,
      customersWithCreditCount: customersWithFlags.filter((row) => row.creditBalancePence !== 0).length,
      totalCreditBalancePence: customersWithFlags.reduce((sum, row) => sum + row.creditBalancePence, 0),
      averageSpendPence,
    },
    topCustomers,
    repeatCustomers,
    recentActivityCustomers,
    workshopActiveCustomers,
    customers: customersWithFlags,
    creditSupported: true,
  };
};

const toPositiveIntWithinRangeOrThrow = (
  value: number | undefined,
  field: string,
  min: number,
  max: number,
  fallback: number,
) => {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new HttpError(400, `${field} must be an integer between ${min} and ${max}`, "INVALID_REPORT_FILTER");
  }
  return resolved;
};

const REMINDER_OPEN_STATUSES: WorkshopJobStatus[] = [
  "BOOKING_MADE",
  "BIKE_ARRIVED",
  "WAITING_FOR_APPROVAL",
  "APPROVED",
  "WAITING_FOR_PARTS",
  "ON_HOLD",
  "BIKE_READY",
];

type CustomerReminderQueueStatus = "DUE_SOON" | "OVERDUE" | "RECENT_ACTIVITY";

export const getCustomerServiceRemindersReport = async (
  dueSoonDays?: number,
  overdueDays?: number,
  lookbackDays?: number,
  take?: number,
) => {
  const resolvedDueSoonDays = toPositiveIntWithinRangeOrThrow(dueSoonDays, "dueSoonDays", 1, 3650, 90);
  const resolvedOverdueDays = toPositiveIntWithinRangeOrThrow(overdueDays, "overdueDays", 1, 3650, 180);
  const resolvedLookbackDays = toPositiveIntWithinRangeOrThrow(lookbackDays, "lookbackDays", 30, 3650, 365);
  const resolvedTake = toPositiveIntWithinRangeOrThrow(take, "take", 1, 200, 100);

  if (resolvedOverdueDays < resolvedDueSoonDays) {
    throw new HttpError(400, "overdueDays must be greater than or equal to dueSoonDays", "INVALID_REPORT_FILTER");
  }
  if (resolvedLookbackDays < resolvedOverdueDays) {
    throw new HttpError(400, "lookbackDays must be greater than or equal to overdueDays", "INVALID_REPORT_FILTER");
  }

  const now = new Date();
  const lookbackStart = addDaysUtc(now, -resolvedLookbackDays);

  const [completedWorkshopJobs, recentSales, openWorkshopJobs] = await Promise.all([
    prisma.workshopJob.findMany({
      where: {
        customerId: { not: null },
        completedAt: { not: null, gte: lookbackStart },
      },
      select: {
        id: true,
        customerId: true,
        customer: {
          select: {
            id: true,
            name: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        bikeDescription: true,
        completedAt: true,
      },
      orderBy: [{ completedAt: "desc" }],
    }),
    prisma.sale.findMany({
      where: {
        customerId: { not: null },
        completedAt: { not: null, gte: lookbackStart },
      },
      select: {
        customerId: true,
        completedAt: true,
      },
      orderBy: [{ completedAt: "desc" }],
    }),
    prisma.workshopJob.findMany({
      where: {
        customerId: { not: null },
        status: {
          in: REMINDER_OPEN_STATUSES,
        },
      },
      select: {
        customerId: true,
      },
    }),
  ]);

  const latestSaleByCustomer = new Map<string, Date>();
  for (const sale of recentSales) {
    if (!sale.customerId || !sale.completedAt || latestSaleByCustomer.has(sale.customerId)) {
      continue;
    }
    latestSaleByCustomer.set(sale.customerId, sale.completedAt);
  }

  const openJobsByCustomer = new Map<string, number>();
  for (const job of openWorkshopJobs) {
    if (!job.customerId) {
      continue;
    }
    openJobsByCustomer.set(job.customerId, (openJobsByCustomer.get(job.customerId) ?? 0) + 1);
  }

  const remindersByCustomer = new Map<string, {
    customerId: string;
    customerName: string;
    email: string | null;
    phone: string | null;
    lastCompletedWorkshopAt: Date;
    latestWorkshopJobId: string;
    latestBikeDescription: string | null;
    completedWorkshopJobsInWindow: number;
    activeWorkshopJobs: number;
    lastSaleAt: Date | null;
  }>();

  for (const job of completedWorkshopJobs) {
    if (!job.customerId || !job.customer || !job.completedAt) {
      continue;
    }

    const existing = remindersByCustomer.get(job.customerId);
    if (!existing) {
      remindersByCustomer.set(job.customerId, {
        customerId: job.customerId,
        customerName: toCustomerDisplayName(job.customer),
        email: job.customer.email,
        phone: job.customer.phone,
        lastCompletedWorkshopAt: job.completedAt,
        latestWorkshopJobId: job.id,
        latestBikeDescription: job.bikeDescription,
        completedWorkshopJobsInWindow: 1,
        activeWorkshopJobs: openJobsByCustomer.get(job.customerId) ?? 0,
        lastSaleAt: latestSaleByCustomer.get(job.customerId) ?? null,
      });
      continue;
    }

    existing.completedWorkshopJobsInWindow += 1;
  }

  const customers = Array.from(remindersByCustomer.values())
    .map((row) => {
      const daysSinceLastCompletedWorkshop = Math.max(
        0,
        Math.floor((now.getTime() - row.lastCompletedWorkshopAt.getTime()) / 86_400_000),
      );

      let reminderStatus: "RECENT_COMPLETION" | "DUE_SOON" | "OVERDUE" = "RECENT_COMPLETION";
      if (daysSinceLastCompletedWorkshop >= resolvedOverdueDays) {
        reminderStatus = "OVERDUE";
      } else if (daysSinceLastCompletedWorkshop >= resolvedDueSoonDays) {
        reminderStatus = "DUE_SOON";
      }

      return {
        ...row,
        daysSinceLastCompletedWorkshop,
        reminderStatus,
      };
    })
    .sort((left, right) => {
      const statusRank = { OVERDUE: 3, DUE_SOON: 2, RECENT_COMPLETION: 1 } as const;
      return (
        statusRank[right.reminderStatus] - statusRank[left.reminderStatus]
        || right.daysSinceLastCompletedWorkshop - left.daysSinceLastCompletedWorkshop
        || left.customerName.localeCompare(right.customerName)
      );
    });

  const items = customers
    .map((row) => ({
      customerId: row.customerId,
      customerName: row.customerName,
      email: row.email,
      phone: row.phone,
      contact: row.phone?.trim() || row.email?.trim() || null,
      lastWorkshopJobDate: row.lastCompletedWorkshopAt,
      daysSinceLastWorkshopJob: row.daysSinceLastCompletedWorkshop,
      reminderStatus: (row.reminderStatus === "RECENT_COMPLETION"
        ? "RECENT_ACTIVITY"
        : row.reminderStatus) as CustomerReminderQueueStatus,
      latestWorkshopJobId: row.latestWorkshopJobId,
    }))
    .slice(0, resolvedTake);

  return {
    filters: {
      dueSoonDays: resolvedDueSoonDays,
      overdueDays: resolvedOverdueDays,
      lookbackDays: resolvedLookbackDays,
      take: resolvedTake,
    },
    summary: {
      customerCount: customers.length,
      overdueCount: customers.filter((row) => row.reminderStatus === "OVERDUE").length,
      dueSoonCount: customers.filter((row) => row.reminderStatus === "DUE_SOON").length,
      recentCompletionCount: customers.filter((row) => row.reminderStatus === "RECENT_COMPLETION").length,
      recentActivityCount: items.filter((row) => row.reminderStatus === "RECENT_ACTIVITY").length,
    },
    overdueCustomers: customers.filter((row) => row.reminderStatus === "OVERDUE").slice(0, resolvedTake),
    dueSoonCustomers: customers.filter((row) => row.reminderStatus === "DUE_SOON").slice(0, resolvedTake),
    recentCompletedCustomers: customers.filter((row) => row.reminderStatus === "RECENT_COMPLETION").slice(0, resolvedTake),
    recentActivityCustomers: items.filter((row) => row.reminderStatus === "RECENT_ACTIVITY"),
    customers: customers.slice(0, resolvedTake),
    items,
  };
};

type WarrantyTrackingStatus = "OPEN" | "FOLLOW_UP" | "RETURNED" | "RESOLVED";

const WARRANTY_STATUS_VALUES: WarrantyTrackingStatus[] = [
  "OPEN",
  "FOLLOW_UP",
  "RETURNED",
  "RESOLVED",
];

const parseWarrantyStatusFilterOrThrow = (status?: string) => {
  if (!status) {
    return undefined;
  }

  const normalized = status.trim().toUpperCase();
  if (!WARRANTY_STATUS_VALUES.includes(normalized as WarrantyTrackingStatus)) {
    throw new HttpError(400, "status must be OPEN, FOLLOW_UP, RETURNED, or RESOLVED", "INVALID_REPORT_FILTER");
  }

  return normalized as WarrantyTrackingStatus;
};

const parseWarrantyTaggedNote = (note: string) => {
  const match = note.match(/^\[WARRANTY:(OPEN|FOLLOW_UP|RETURNED|RESOLVED)\]\s*(.*)$/is);
  if (!match) {
    return null;
  }

  const [, rawStatus = "", rawDetail = ""] = match;
  return {
    status: rawStatus.toUpperCase() as WarrantyTrackingStatus,
    detail: rawDetail.trim(),
  };
};

export const getWorkshopWarrantyReport = async (
  status?: string,
  search?: string,
  take?: number,
) => {
  const resolvedStatus = parseWarrantyStatusFilterOrThrow(status);
  const resolvedTake = toPositiveIntWithinRangeOrThrow(take, "take", 1, 200, 100);
  const normalizedSearch = search?.trim().toLowerCase() || undefined;

  const taggedNotes = await prisma.workshopJobNote.findMany({
    where: {
      visibility: "INTERNAL",
      note: {
        contains: "[WARRANTY:",
        mode: "insensitive",
      },
    },
    orderBy: [{ createdAt: "desc" }],
    include: {
      workshopJob: {
        select: {
          id: true,
          status: true,
          customerId: true,
          customerName: true,
          bikeDescription: true,
          scheduledDate: true,
          customer: {
            select: {
              id: true,
              name: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
          sale: {
            select: {
              id: true,
              totalPence: true,
            },
          },
        },
      },
    },
  });

  const latestByJobId = new Map<string, {
    workshopJobId: string;
    status: WarrantyTrackingStatus;
    detail: string;
    noteId: string;
    noteCreatedAt: Date;
    noteCount: number;
    job: {
      id: string;
      status: WorkshopJobStatus;
      customerId: string | null;
      customerName: string | null;
      bikeDescription: string | null;
      scheduledDate: Date | null;
      customer: {
        id: string;
        name: string | null;
        firstName: string;
        lastName: string;
        email: string | null;
        phone: string | null;
      } | null;
      sale: {
        id: string;
        totalPence: number;
      } | null;
    };
  }>();

  for (const note of taggedNotes) {
    const parsed = parseWarrantyTaggedNote(note.note);
    if (!parsed) {
      continue;
    }

    const existing = latestByJobId.get(note.workshopJobId);
    if (!existing) {
      latestByJobId.set(note.workshopJobId, {
        workshopJobId: note.workshopJobId,
        status: parsed.status,
        detail: parsed.detail,
        noteId: note.id,
        noteCreatedAt: note.createdAt,
        noteCount: 1,
        job: note.workshopJob,
      });
      continue;
    }

    existing.noteCount += 1;
  }

  const filteredItems = Array.from(latestByJobId.values())
    .map((row) => {
      const customerName =
        row.job.customerName
        || (row.job.customer
          ? [row.job.customer.name, row.job.customer.firstName, row.job.customer.lastName]
            .filter(Boolean)
            .join(" ")
            .trim()
          : null)
        || "-";

      return {
        workshopJobId: row.workshopJobId,
        rawStatus: row.job.status,
        customerId: row.job.customerId,
        customerName,
        customerEmail: row.job.customer?.email ?? null,
        customerPhone: row.job.customer?.phone ?? null,
        bikeDescription: row.job.bikeDescription,
        scheduledDate: row.job.scheduledDate,
        sale: row.job.sale,
        warrantyStatus: row.status,
        latestWarrantyNote: row.detail,
        latestWarrantyNoteId: row.noteId,
        latestWarrantyNoteAt: row.noteCreatedAt,
        noteCount: row.noteCount,
      };
    })
    .filter((row) => (resolvedStatus ? row.warrantyStatus === resolvedStatus : true))
    .filter((row) => {
      if (!normalizedSearch) {
        return true;
      }

      const haystack = [
        row.workshopJobId,
        row.customerName,
        row.customerEmail,
        row.customerPhone,
        row.bikeDescription,
        row.latestWarrantyNote,
        row.warrantyStatus,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    })
    .sort((left, right) => (
      new Date(right.latestWarrantyNoteAt).getTime() - new Date(left.latestWarrantyNoteAt).getTime()
      || left.customerName.localeCompare(right.customerName)
    ));

  const items = filteredItems.slice(0, resolvedTake);

  return {
    filters: {
      status: resolvedStatus ?? null,
      search: normalizedSearch ?? null,
      take: resolvedTake,
    },
    summary: {
      trackedJobCount: filteredItems.length,
      openCount: filteredItems.filter((row) => row.warrantyStatus === "OPEN").length,
      followUpCount: filteredItems.filter((row) => row.warrantyStatus === "FOLLOW_UP").length,
      returnedCount: filteredItems.filter((row) => row.warrantyStatus === "RETURNED").length,
      resolvedCount: filteredItems.filter((row) => row.warrantyStatus === "RESOLVED").length,
    },
    items,
  };
};
