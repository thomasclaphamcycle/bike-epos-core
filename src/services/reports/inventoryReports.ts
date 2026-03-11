import { prisma } from "../../lib/prisma";
import { HttpError } from "../../utils/http";
import {
  assertLocationIdOrThrow,
  getDateRangeWithTakeOrThrow,
  normalizeOptionalSearch,
  parseActiveFilterOrThrow,
  parseDateOnlyOrThrow,
  toInteger,
  toNumber,
} from "./shared";

export const getInventoryOnHandReport = async (locationId?: string) => {
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
