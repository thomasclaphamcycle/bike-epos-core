import { prisma } from "../../lib/prisma";
import { getDateRangeOrThrow } from "./shared";

const REPORT_TIMEZONE = "Europe/London";
const UNCATEGORIZED_LABEL = "Uncategorised";
const WORKSHOP_LABOUR_LABEL = "Workshop Labour";
const UNCLASSIFIED_LABEL = "Unclassified";

type FinancialDateRange = {
  from: string;
  to: string;
  preset: "current_month_to_date" | "custom";
  timezone: typeof REPORT_TIMEZONE;
  label: string;
};

type FinancialCategoryAccumulator = {
  categoryName: string;
  grossSalesPence: number;
  refundsPence: number;
  revenuePence: number;
  cogsPence: number;
  quantitySold: number;
  quantityRefunded: number;
  rawRevenueWithoutCostBasisPence: number;
};

type FinancialSummaryAccumulator = {
  grossSalesPence: number;
  refundsPence: number;
  revenuePence: number;
  cogsPence: number;
  transactions: number;
  refundCount: number;
  rawRevenueWithoutCostBasisPence: number;
  workshopServiceRevenuePence: number;
  workshopPartsWithoutCostBasisPence: number;
  retailRevenueWithoutCostBasisPence: number;
};

type SaleIdRow = { id: string };
type RefundIdRow = { id: string };

type FinalizedFinancialCategory = {
  categoryName: string;
  grossSalesPence: number;
  refundsPence: number;
  revenuePence: number;
  cogsPence: number;
  grossMarginPence: number;
  grossMarginPercent: number;
  quantitySold: number;
  quantityRefunded: number;
  netQuantity: number;
  revenueWithKnownCostPence: number;
  revenueWithoutCostBasisPence: number;
  knownCostCoveragePercent: number;
};

const clampPercent = (value: number) => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
};

const toPercent = (numerator: number, denominator: number) => (
  denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(1)) : 0
);

const toCoveragePercent = (revenuePence: number, revenueWithoutCostBasisPence: number) => (
  revenuePence > 0
    ? Number(
      clampPercent(
        ((revenuePence - Math.max(0, revenueWithoutCostBasisPence)) / revenuePence) * 100,
      ).toFixed(1),
    )
    : 0
);

const normalizeCategoryName = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : UNCATEGORIZED_LABEL;
};

const formatDateKeyInTimezone = (value: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);

  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";

  return `${year}-${month}-${day}`;
};

const formatMonthLabel = (dateKey: string) => {
  const value = new Date(`${dateKey}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: REPORT_TIMEZONE,
    month: "long",
    year: "numeric",
  }).format(value);
};

const getFinancialDateRange = (from?: string, to?: string): FinancialDateRange => {
  if (from || to) {
    const range = getDateRangeOrThrow(from, to);
    return {
      ...range,
      preset: "custom",
      timezone: REPORT_TIMEZONE,
      label: formatMonthLabel(range.from),
    };
  }

  const today = formatDateKeyInTimezone(new Date(), REPORT_TIMEZONE);
  return {
    from: `${today.slice(0, 7)}-01`,
    to: today,
    preset: "current_month_to_date",
    timezone: REPORT_TIMEZONE,
    label: formatMonthLabel(today),
  };
};

const getCategoryAccumulator = (
  categoryMap: Map<string, FinancialCategoryAccumulator>,
  categoryName: string,
) => {
  const existing = categoryMap.get(categoryName);
  if (existing) {
    return existing;
  }

  const created: FinancialCategoryAccumulator = {
    categoryName,
    grossSalesPence: 0,
    refundsPence: 0,
    revenuePence: 0,
    cogsPence: 0,
    quantitySold: 0,
    quantityRefunded: 0,
    rawRevenueWithoutCostBasisPence: 0,
  };
  categoryMap.set(categoryName, created);
  return created;
};

const applySaleContribution = (
  categoryMap: Map<string, FinancialCategoryAccumulator>,
  summary: FinancialSummaryAccumulator,
  input: {
    categoryName: string;
    revenuePence: number;
    quantity: number;
    costPence: number | null;
    uncostedKind?: "retail" | "workshop-parts" | "workshop-service" | undefined;
  },
) => {
  const category = getCategoryAccumulator(categoryMap, input.categoryName);
  category.grossSalesPence += input.revenuePence;
  category.revenuePence += input.revenuePence;
  category.quantitySold += input.quantity;

  summary.revenuePence += input.revenuePence;

  if (input.costPence !== null) {
    category.cogsPence += input.costPence;
    summary.cogsPence += input.costPence;
    return;
  }

  category.rawRevenueWithoutCostBasisPence += input.revenuePence;
  summary.rawRevenueWithoutCostBasisPence += input.revenuePence;

  if (input.uncostedKind === "retail") {
    summary.retailRevenueWithoutCostBasisPence += input.revenuePence;
  } else if (input.uncostedKind === "workshop-parts") {
    summary.workshopPartsWithoutCostBasisPence += input.revenuePence;
  } else if (input.uncostedKind === "workshop-service") {
    summary.workshopServiceRevenuePence += input.revenuePence;
  }
};

const applyRefundContribution = (
  categoryMap: Map<string, FinancialCategoryAccumulator>,
  summary: FinancialSummaryAccumulator,
  input: {
    categoryName: string;
    revenuePence: number;
    quantity: number;
    costPence: number | null;
    uncostedKind?: "retail" | undefined;
  },
) => {
  const category = getCategoryAccumulator(categoryMap, input.categoryName);
  category.refundsPence += input.revenuePence;
  category.revenuePence -= input.revenuePence;
  category.quantityRefunded += input.quantity;

  summary.revenuePence -= input.revenuePence;

  if (input.costPence !== null) {
    category.cogsPence -= input.costPence;
    summary.cogsPence -= input.costPence;
    return;
  }

  category.rawRevenueWithoutCostBasisPence -= input.revenuePence;
  summary.rawRevenueWithoutCostBasisPence -= input.revenuePence;

  if (input.uncostedKind === "retail") {
    summary.retailRevenueWithoutCostBasisPence -= input.revenuePence;
  }
};

const finalizeCategory = (category: FinancialCategoryAccumulator): FinalizedFinancialCategory => {
  const revenueWithoutCostBasisPence = Math.max(0, category.rawRevenueWithoutCostBasisPence);
  const grossMarginPence = category.revenuePence - category.cogsPence;

  return {
    categoryName: category.categoryName,
    grossSalesPence: category.grossSalesPence,
    refundsPence: category.refundsPence,
    revenuePence: category.revenuePence,
    cogsPence: category.cogsPence,
    grossMarginPence,
    grossMarginPercent: toPercent(grossMarginPence, category.revenuePence),
    quantitySold: category.quantitySold,
    quantityRefunded: category.quantityRefunded,
    netQuantity: category.quantitySold - category.quantityRefunded,
    revenueWithKnownCostPence: category.revenuePence - revenueWithoutCostBasisPence,
    revenueWithoutCostBasisPence,
    knownCostCoveragePercent: toCoveragePercent(category.revenuePence, revenueWithoutCostBasisPence),
  };
};

const getCompletedSaleIdsForRange = async (range: FinancialDateRange) => {
  const rows = await prisma.$queryRaw<Array<SaleIdRow>>`
    SELECT s.id
    FROM "Sale" s
    WHERE
      s."completedAt" IS NOT NULL
      AND (s."completedAt" AT TIME ZONE 'Europe/London')::date BETWEEN ${range.from}::date AND ${range.to}::date
  `;

  return rows.map((row) => row.id);
};

const getCompletedRefundIdsForRange = async (range: FinancialDateRange) => {
  const rows = await prisma.$queryRaw<Array<RefundIdRow>>`
    SELECT r.id
    FROM "Refund" r
    WHERE
      r.status = 'COMPLETED'
      AND r."completedAt" IS NOT NULL
      AND (r."completedAt" AT TIME ZONE 'Europe/London')::date BETWEEN ${range.from}::date AND ${range.to}::date
  `;

  return rows.map((row) => row.id);
};

const getFinancialCostBasisNotes = () => [
  "Retail sale-line COGS use the current Variant.costPricePence because sale-line cost snapshots are not yet stored.",
  "Workshop used-part COGS use WorkshopJobPart.costPriceAtTime when present.",
  "Workshop labour revenue is included in revenue but counted as revenue without recorded cost basis.",
];

const buildFinancialSnapshot = async (from?: string, to?: string) => {
  const range = getFinancialDateRange(from, to);
  const [saleIds, refundIds] = await Promise.all([
    getCompletedSaleIdsForRange(range),
    getCompletedRefundIdsForRange(range),
  ]);

  const [sales, refunds] = await Promise.all([
    saleIds.length === 0
      ? Promise.resolve([])
      : prisma.sale.findMany({
        where: {
          id: {
            in: saleIds,
          },
        },
        select: {
          id: true,
          subtotalPence: true,
          workshopJobId: true,
          items: {
            select: {
              quantity: true,
              lineTotalPence: true,
              variant: {
                select: {
                  costPricePence: true,
                  product: {
                    select: {
                      category: true,
                    },
                  },
                },
              },
            },
          },
          workshopJob: {
            select: {
              parts: {
                where: { status: "USED" },
                select: {
                  quantity: true,
                  unitPriceAtTime: true,
                  costPriceAtTime: true,
                  variant: {
                    select: {
                      product: {
                        select: {
                          category: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    refundIds.length === 0
      ? Promise.resolve([])
      : prisma.refund.findMany({
        where: {
          id: {
            in: refundIds,
          },
        },
        select: {
          id: true,
          subtotalPence: true,
          lines: {
            select: {
              quantity: true,
              lineTotalPence: true,
              saleLine: {
                select: {
                  variant: {
                    select: {
                      costPricePence: true,
                      product: {
                        select: {
                          category: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
  ]);

  const categoryMap = new Map<string, FinancialCategoryAccumulator>();
  const summary: FinancialSummaryAccumulator = {
    grossSalesPence: sales.reduce((total, sale) => total + sale.subtotalPence, 0),
    refundsPence: refunds.reduce((total, refund) => total + refund.subtotalPence, 0),
    revenuePence: 0,
    cogsPence: 0,
    transactions: sales.length,
    refundCount: refunds.length,
    rawRevenueWithoutCostBasisPence: 0,
    workshopServiceRevenuePence: 0,
    workshopPartsWithoutCostBasisPence: 0,
    retailRevenueWithoutCostBasisPence: 0,
  };

  let categorizedGrossSalesPence = 0;
  for (const sale of sales) {
    let saleCategorizedRevenuePence = 0;

    for (const item of sale.items) {
      saleCategorizedRevenuePence += item.lineTotalPence;
      categorizedGrossSalesPence += item.lineTotalPence;
      applySaleContribution(categoryMap, summary, {
        categoryName: normalizeCategoryName(item.variant.product.category),
        revenuePence: item.lineTotalPence,
        quantity: item.quantity,
        costPence: item.variant.costPricePence === null ? null : item.variant.costPricePence * item.quantity,
        uncostedKind: item.variant.costPricePence === null ? "retail" : undefined,
      });
    }

    if (sale.items.length === 0 && sale.workshopJobId) {
      const parts = sale.workshopJob?.parts ?? [];
      const usedPartsRevenuePence = parts.reduce(
        (total, part) => total + (part.quantity * part.unitPriceAtTime),
        0,
      );

      for (const part of parts) {
        const partRevenuePence = part.quantity * part.unitPriceAtTime;
        saleCategorizedRevenuePence += partRevenuePence;
        categorizedGrossSalesPence += partRevenuePence;
        applySaleContribution(categoryMap, summary, {
          categoryName: normalizeCategoryName(part.variant.product.category),
          revenuePence: partRevenuePence,
          quantity: part.quantity,
          costPence: part.costPriceAtTime === null ? null : part.costPriceAtTime * part.quantity,
          uncostedKind: part.costPriceAtTime === null ? "workshop-parts" : undefined,
        });
      }

      const workshopServiceRevenuePence = Math.max(0, sale.subtotalPence - usedPartsRevenuePence);
      if (workshopServiceRevenuePence > 0) {
        saleCategorizedRevenuePence += workshopServiceRevenuePence;
        categorizedGrossSalesPence += workshopServiceRevenuePence;
        applySaleContribution(categoryMap, summary, {
          categoryName: WORKSHOP_LABOUR_LABEL,
          revenuePence: workshopServiceRevenuePence,
          quantity: 1,
          costPence: null,
          uncostedKind: "workshop-service",
        });
      }
    }

    const unclassifiedSaleRevenuePence = sale.subtotalPence - saleCategorizedRevenuePence;
    if (unclassifiedSaleRevenuePence > 0) {
      categorizedGrossSalesPence += unclassifiedSaleRevenuePence;
      applySaleContribution(categoryMap, summary, {
        categoryName: UNCLASSIFIED_LABEL,
        revenuePence: unclassifiedSaleRevenuePence,
        quantity: 1,
        costPence: null,
      });
    }
  }

  let categorizedRefundsPence = 0;
  for (const refund of refunds) {
    let refundCategorizedRevenuePence = 0;

    for (const line of refund.lines) {
      refundCategorizedRevenuePence += line.lineTotalPence;
      categorizedRefundsPence += line.lineTotalPence;
      applyRefundContribution(categoryMap, summary, {
        categoryName: normalizeCategoryName(line.saleLine.variant.product.category),
        revenuePence: line.lineTotalPence,
        quantity: line.quantity,
        costPence: line.saleLine.variant.costPricePence === null
          ? null
          : line.saleLine.variant.costPricePence * line.quantity,
        uncostedKind: line.saleLine.variant.costPricePence === null ? "retail" : undefined,
      });
    }

    const unclassifiedRefundRevenuePence = refund.subtotalPence - refundCategorizedRevenuePence;
    if (unclassifiedRefundRevenuePence > 0) {
      categorizedRefundsPence += unclassifiedRefundRevenuePence;
      applyRefundContribution(categoryMap, summary, {
        categoryName: UNCLASSIFIED_LABEL,
        revenuePence: unclassifiedRefundRevenuePence,
        quantity: 1,
        costPence: null,
      });
    }
  }

  // Keep top-level totals authoritative even if category attribution needed a fallback row.
  summary.revenuePence = summary.grossSalesPence - summary.refundsPence;

  const categories = Array.from(categoryMap.values())
    .map(finalizeCategory)
    .sort((left, right) => (
      right.revenuePence - left.revenuePence
      || right.grossSalesPence - left.grossSalesPence
      || left.categoryName.localeCompare(right.categoryName)
    ));

  const revenueWithoutCostBasisPence = Math.max(0, summary.rawRevenueWithoutCostBasisPence);
  const revenueWithKnownCostPence = summary.revenuePence - revenueWithoutCostBasisPence;
  const grossMarginPence = summary.revenuePence - summary.cogsPence;

  return {
    filters: range,
    summary: {
      grossSalesPence: summary.grossSalesPence,
      refundsPence: summary.refundsPence,
      revenuePence: summary.revenuePence,
      cogsPence: summary.cogsPence,
      grossMarginPence,
      grossMarginPercent: toPercent(grossMarginPence, summary.revenuePence),
      transactions: summary.transactions,
      refundCount: summary.refundCount,
      averageSaleValuePence: summary.transactions > 0
        ? Math.round(summary.grossSalesPence / summary.transactions)
        : 0,
    },
    costBasis: {
      revenueWithKnownCostPence,
      revenueWithoutCostBasisPence,
      knownCostCoveragePercent: toCoveragePercent(summary.revenuePence, revenueWithoutCostBasisPence),
      workshopServiceRevenuePence: Math.max(0, summary.workshopServiceRevenuePence),
      workshopPartsWithoutCostBasisPence: Math.max(0, summary.workshopPartsWithoutCostBasisPence),
      retailRevenueWithoutCostBasisPence: Math.max(0, summary.retailRevenueWithoutCostBasisPence),
      notes: getFinancialCostBasisNotes(),
    },
    categorySummary: {
      categoryCount: categories.length,
      quantitySold: categories.reduce((total, category) => total + category.quantitySold, 0),
      quantityRefunded: categories.reduce((total, category) => total + category.quantityRefunded, 0),
      coveredGrossSalesPence: categorizedGrossSalesPence,
      coveredRefundsPence: categorizedRefundsPence,
    },
    categories,
  };
};

export const getFinancialMonthlyMarginReport = async (from?: string, to?: string) => {
  const snapshot = await buildFinancialSnapshot(from, to);

  return {
    filters: snapshot.filters,
    summary: snapshot.summary,
    costBasis: snapshot.costBasis,
  };
};

export const getFinancialMonthlySalesSummaryReport = async (from?: string, to?: string) => {
  const snapshot = await buildFinancialSnapshot(from, to);

  return {
    filters: snapshot.filters,
    summary: {
      grossSalesPence: snapshot.summary.grossSalesPence,
      refundsPence: snapshot.summary.refundsPence,
      revenuePence: snapshot.summary.revenuePence,
      transactions: snapshot.summary.transactions,
      refundCount: snapshot.summary.refundCount,
      averageSaleValuePence: snapshot.summary.averageSaleValuePence,
    },
  };
};

export const getFinancialSalesByCategoryReport = async (from?: string, to?: string) => {
  const snapshot = await buildFinancialSnapshot(from, to);
  const topCategory = snapshot.categories[0] ?? null;

  return {
    filters: snapshot.filters,
    summary: {
      categoryCount: snapshot.categorySummary.categoryCount,
      grossSalesPence: snapshot.summary.grossSalesPence,
      refundsPence: snapshot.summary.refundsPence,
      revenuePence: snapshot.summary.revenuePence,
      quantitySold: snapshot.categorySummary.quantitySold,
      quantityRefunded: snapshot.categorySummary.quantityRefunded,
      netQuantity: snapshot.categorySummary.quantitySold - snapshot.categorySummary.quantityRefunded,
      revenueWithKnownCostPence: snapshot.costBasis.revenueWithKnownCostPence,
      revenueWithoutCostBasisPence: snapshot.costBasis.revenueWithoutCostBasisPence,
      knownCostCoveragePercent: snapshot.costBasis.knownCostCoveragePercent,
      topCategoryName: topCategory?.categoryName ?? null,
      topCategoryRevenuePence: topCategory?.revenuePence ?? 0,
    },
    categories: snapshot.categories,
    costBasis: {
      notes: snapshot.costBasis.notes,
    },
  };
};
