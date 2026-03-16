import { prisma } from "../../lib/prisma";
import { toPositiveIntWithinRangeOrThrow } from "./shared";

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

export const getSupplierCostHistoryReport = async (take?: number) => {
  const resolvedTake = toPositiveIntWithinRangeOrThrow(take, "take", 1, 100, 10);

  const [purchaseOrderItems, supplierLinks] = await Promise.all([
    prisma.purchaseOrderItem.findMany({
      where: {
        unitCostPence: {
          not: null,
        },
      },
      orderBy: [
        { updatedAt: "desc" },
        { createdAt: "desc" },
      ],
      select: {
        id: true,
        variantId: true,
        unitCostPence: true,
        updatedAt: true,
        purchaseOrder: {
          select: {
            id: true,
            poNumber: true,
            supplierId: true,
            supplier: {
              select: {
                name: true,
              },
            },
          },
        },
        variant: {
          select: {
            sku: true,
            name: true,
            option: true,
            product: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    }),
    prisma.supplierProductLink.findMany({
      where: {
        isActive: true,
      },
      select: {
        supplierId: true,
        variantId: true,
        supplierCostPence: true,
        preferredSupplier: true,
      },
    }),
  ]);

  const linkBySupplierVariant = new Map(
    supplierLinks.map((link) => [`${link.supplierId}:${link.variantId}`, link]),
  );
  const latestBySupplierVariant = new Map<string, {
    supplierId: string;
    supplierName: string;
    variantId: string;
    productName: string;
    variantName: string | null;
    sku: string;
    currentUnitCostPence: number;
    currentRecordedAt: Date;
    currentPurchaseOrderId: string;
    currentPurchaseOrderNumber: string;
    previousUnitCostPence: number | null;
    previousRecordedAt: Date | null;
    previousPurchaseOrderId: string | null;
    previousPurchaseOrderNumber: string | null;
    supplierLinkCostPence: number | null;
    preferredSupplierLink: boolean;
  }>();

  for (const item of purchaseOrderItems) {
    if (item.unitCostPence === null) {
      continue;
    }

    const key = `${item.purchaseOrder.supplierId}:${item.variantId}`;
    const existing = latestBySupplierVariant.get(key);
    const link = linkBySupplierVariant.get(key);

    if (!existing) {
      latestBySupplierVariant.set(key, {
        supplierId: item.purchaseOrder.supplierId,
        supplierName: item.purchaseOrder.supplier.name,
        variantId: item.variantId,
        productName: item.variant.product.name,
        variantName: item.variant.name ?? item.variant.option ?? null,
        sku: item.variant.sku,
        currentUnitCostPence: item.unitCostPence,
        currentRecordedAt: item.updatedAt,
        currentPurchaseOrderId: item.purchaseOrder.id,
        currentPurchaseOrderNumber: item.purchaseOrder.poNumber,
        previousUnitCostPence: null,
        previousRecordedAt: null,
        previousPurchaseOrderId: null,
        previousPurchaseOrderNumber: null,
        supplierLinkCostPence: link?.supplierCostPence ?? null,
        preferredSupplierLink: link?.preferredSupplier ?? false,
      });
      continue;
    }

    if (existing.previousUnitCostPence === null && item.unitCostPence !== existing.currentUnitCostPence) {
      existing.previousUnitCostPence = item.unitCostPence;
      existing.previousRecordedAt = item.updatedAt;
      existing.previousPurchaseOrderId = item.purchaseOrder.id;
      existing.previousPurchaseOrderNumber = item.purchaseOrder.poNumber;
    }
  }

  const items = Array.from(latestBySupplierVariant.values())
    .map((row) => ({
      ...row,
      changePence:
        row.previousUnitCostPence === null
          ? null
          : row.currentUnitCostPence - row.previousUnitCostPence,
    }))
    .sort((left, right) => (
      Math.abs(right.changePence ?? 0) - Math.abs(left.changePence ?? 0)
      || right.currentRecordedAt.getTime() - left.currentRecordedAt.getTime()
      || left.supplierName.localeCompare(right.supplierName)
      || left.productName.localeCompare(right.productName)
    ));

  const changedItems = items.filter((row) => row.changePence !== null);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      trackedSupplierVariantCount: items.length,
      changedSupplierVariantCount: changedItems.length,
      costIncreaseCount: changedItems.filter((row) => (row.changePence ?? 0) > 0).length,
      costDecreaseCount: changedItems.filter((row) => (row.changePence ?? 0) < 0).length,
      preferredSupplierLinkCount: items.filter((row) => row.preferredSupplierLink).length,
    },
    items: items.slice(0, resolvedTake),
  };
};
