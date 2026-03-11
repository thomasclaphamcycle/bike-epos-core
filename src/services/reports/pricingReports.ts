import { prisma } from "../../lib/prisma";

type PricingExceptionType = "MISSING_RETAIL_PRICE" | "RETAIL_AT_OR_BELOW_COST" | "LOW_MARGIN";

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
