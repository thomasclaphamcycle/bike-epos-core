import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { getPaymentsReportRows } from "./paymentIntentService";

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

type DateRange = {
  from: string;
  to: string;
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

const assertBusinessLocationIdOrThrow = async (locationId?: string) => {
  if (!locationId) {
    return undefined;
  }

  const normalized = locationId.trim();
  if (!normalized) {
    throw new HttpError(400, "locationId must be provided", "INVALID_LOCATION_ID");
  }

  const location = await prisma.location.findUnique({
    where: { id: normalized },
    select: { id: true },
  });
  if (!location) {
    throw new HttpError(404, "Location not found", "LOCATION_NOT_FOUND");
  }
  return normalized;
};

export const getSalesDailyReport = async (from?: string, to?: string, locationId?: string) => {
  const range = getDateRangeOrThrow(from, to);
  const resolvedLocationId = await assertBusinessLocationIdOrThrow(locationId);
  const days = listDateKeys(range.from, range.to);
  const salesLocationFilter = resolvedLocationId
    ? Prisma.sql`AND s."locationId" = ${resolvedLocationId}`
    : Prisma.empty;

  const salesRows = await prisma.$queryRaw<
    Array<{ date: string; saleCount: number; grossPence: number }>
  >`
    SELECT
      to_char((s."createdAt" AT TIME ZONE 'Europe/London')::date, 'YYYY-MM-DD') AS "date",
      COUNT(*)::int AS "saleCount",
      COALESCE(SUM(s."totalPence"), 0)::bigint AS "grossPence"
    FROM "Sale" s
    WHERE (s."createdAt" AT TIME ZONE 'Europe/London')::date BETWEEN ${range.from}::date AND ${range.to}::date
      ${salesLocationFilter}
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

export const getWorkshopDailyReport = async (from?: string, to?: string, locationId?: string) => {
  const range = getDateRangeOrThrow(from, to);
  const resolvedLocationId = await assertBusinessLocationIdOrThrow(locationId);
  const days = listDateKeys(range.from, range.to);
  const workshopLocationFilter = resolvedLocationId
    ? Prisma.sql`AND w."locationId" = ${resolvedLocationId}`
    : Prisma.empty;

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
      ${workshopLocationFilter}
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
