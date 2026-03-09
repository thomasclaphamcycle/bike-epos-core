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

export const getSupplierPerformanceReport = async (from?: string, to?: string, take?: number) => {
  const range = getDateRangeWithTakeOrThrow(from, to, take);
  const fromDate = parseDateOnlyOrThrow(range.from, "from");
  const toDate = new Date(`${range.to}T23:59:59.999Z`);

  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: {
      createdAt: {
        gte: fromDate,
        lte: toDate,
      },
    },
    include: {
      supplier: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
      items: {
        select: {
          quantityOrdered: true,
          quantityReceived: true,
          unitCostPence: true,
        },
      },
    },
    orderBy: [{ createdAt: "desc" }],
  });

  const bySupplier = new Map<string, {
    supplierId: string;
    supplierName: string;
    purchaseOrderCount: number;
    quantityOrdered: number;
    quantityReceived: number;
    quantityRemaining: number;
    orderedValuePence: number;
    receivedValuePence: number;
    draftCount: number;
    sentCount: number;
    partiallyReceivedCount: number;
    receivedCount: number;
    cancelledCount: number;
    overdueOpenCount: number;
    latestPurchaseOrderAt: Date | null;
  }>();

  for (const po of purchaseOrders) {
    const existing = bySupplier.get(po.supplierId) ?? {
      supplierId: po.supplierId,
      supplierName: po.supplier.name,
      purchaseOrderCount: 0,
      quantityOrdered: 0,
      quantityReceived: 0,
      quantityRemaining: 0,
      orderedValuePence: 0,
      receivedValuePence: 0,
      draftCount: 0,
      sentCount: 0,
      partiallyReceivedCount: 0,
      receivedCount: 0,
      cancelledCount: 0,
      overdueOpenCount: 0,
      latestPurchaseOrderAt: null,
    };

    existing.purchaseOrderCount += 1;
    if (!existing.latestPurchaseOrderAt || po.createdAt > existing.latestPurchaseOrderAt) {
      existing.latestPurchaseOrderAt = po.createdAt;
    }

    switch (po.status) {
      case "DRAFT":
        existing.draftCount += 1;
        break;
      case "SENT":
        existing.sentCount += 1;
        break;
      case "PARTIALLY_RECEIVED":
        existing.partiallyReceivedCount += 1;
        break;
      case "RECEIVED":
        existing.receivedCount += 1;
        break;
      case "CANCELLED":
        existing.cancelledCount += 1;
        break;
      default:
        break;
    }

    if (po.expectedAt && po.expectedAt < new Date() && po.status !== "RECEIVED" && po.status !== "CANCELLED") {
      existing.overdueOpenCount += 1;
    }

    for (const item of po.items) {
      existing.quantityOrdered += item.quantityOrdered;
      existing.quantityReceived += item.quantityReceived;
      existing.quantityRemaining += Math.max(0, item.quantityOrdered - item.quantityReceived);
      if (item.unitCostPence !== null) {
        existing.orderedValuePence += item.quantityOrdered * item.unitCostPence;
        existing.receivedValuePence += item.quantityReceived * item.unitCostPence;
      }
    }

    bySupplier.set(po.supplierId, existing);
  }

  const suppliers = Array.from(bySupplier.values())
    .map((row) => ({
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      purchaseOrderCount: row.purchaseOrderCount,
      quantityOrdered: row.quantityOrdered,
      quantityReceived: row.quantityReceived,
      quantityRemaining: row.quantityRemaining,
      orderedValuePence: row.orderedValuePence,
      receivedValuePence: row.receivedValuePence,
      fillRate: row.quantityOrdered > 0 ? Number((row.quantityReceived / row.quantityOrdered).toFixed(3)) : 0,
      draftCount: row.draftCount,
      sentCount: row.sentCount,
      partiallyReceivedCount: row.partiallyReceivedCount,
      receivedCount: row.receivedCount,
      cancelledCount: row.cancelledCount,
      overdueOpenCount: row.overdueOpenCount,
      latestPurchaseOrderAt: row.latestPurchaseOrderAt,
    }))
    .sort((left, right) => (
      right.orderedValuePence - left.orderedValuePence
      || right.purchaseOrderCount - left.purchaseOrderCount
      || left.supplierName.localeCompare(right.supplierName)
    ));

  return {
    filters: range,
    summary: {
      supplierCount: suppliers.length,
      purchaseOrderCount: suppliers.reduce((sum, row) => sum + row.purchaseOrderCount, 0),
      orderedValuePence: suppliers.reduce((sum, row) => sum + row.orderedValuePence, 0),
      receivedValuePence: suppliers.reduce((sum, row) => sum + row.receivedValuePence, 0),
      overdueOpenCount: suppliers.reduce((sum, row) => sum + row.overdueOpenCount, 0),
    },
    topSuppliers: suppliers.slice(0, range.take),
    suppliers,
    revenueContributionSupported: false,
    leadTimeSupported: false,
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
