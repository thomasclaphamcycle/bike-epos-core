import { prisma } from "../../lib/prisma";

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
