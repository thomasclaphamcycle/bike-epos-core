import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { getPaymentsReportRows } from "../paymentIntentService";
import {
  buildDailyAmountMap,
  getDateRangeOrThrow,
  getDateRangeWithTakeOrThrow,
  listDateKeys,
  parseDateOnlyOrThrow,
  toInteger,
} from "./shared";

export const getSalesDailyReport = async (from?: string, to?: string, locationId?: string) => {
  const range = getDateRangeOrThrow(from, to);
  const days = listDateKeys(range.from, range.to);
  const salesLocationFilter = locationId
    ? Prisma.sql`AND s."locationId" = ${locationId}`
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
      netPence: grossPence - refundsPence,
    };
  });
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
              brand: true,
              category: true,
            },
          },
        },
      },
    },
  });

  const byProduct = new Map<string, {
    productId: string;
    productName: string;
    brandName: string | null;
    categoryName: string | null;
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
      brandName: item.variant.product.brand?.trim() || null,
      categoryName: item.variant.product.category?.trim() || null,
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
      brandName: row.brandName,
      categoryName: row.categoryName,
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

  const byCategory = new Map<string, {
    categoryName: string;
    quantitySold: number;
    grossRevenuePence: number;
    productIds: Set<string>;
  }>();

  for (const row of products) {
    const categoryName = row.categoryName || "Uncategorized";
    const existing = byCategory.get(categoryName) ?? {
      categoryName,
      quantitySold: 0,
      grossRevenuePence: 0,
      productIds: new Set<string>(),
    };

    existing.quantitySold += row.quantitySold;
    existing.grossRevenuePence += row.grossRevenuePence;
    existing.productIds.add(row.productId);
    byCategory.set(categoryName, existing);
  }

  const categoryBreakdown = Array.from(byCategory.values())
    .map((row) => ({
      categoryName: row.categoryName,
      quantitySold: row.quantitySold,
      grossRevenuePence: row.grossRevenuePence,
      productCount: row.productIds.size,
      averageUnitPricePence: row.quantitySold > 0 ? Math.round(row.grossRevenuePence / row.quantitySold) : 0,
    }))
    .sort((left, right) => (
      right.quantitySold - left.quantitySold
      || right.grossRevenuePence - left.grossRevenuePence
      || left.categoryName.localeCompare(right.categoryName)
    ));

  const topCategory = categoryBreakdown[0] ?? null;

  return {
    filters: range,
    summary: {
      productCount: products.length,
      categoryCount: categoryBreakdown.length,
      totalQuantitySold: products.reduce((sum, row) => sum + row.quantitySold, 0),
      totalRevenuePence: products.reduce((sum, row) => sum + row.grossRevenuePence, 0),
      topCategoryName: topCategory?.categoryName ?? null,
      topCategoryRevenuePence: topCategory?.grossRevenuePence ?? 0,
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
    categoryBreakdown,
    categoryBreakdownSupported: true,
  };
};
