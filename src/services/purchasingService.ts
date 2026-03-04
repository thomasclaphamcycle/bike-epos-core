import { Prisma, PurchaseOrderStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";

type CreateSupplierInput = {
  name?: string;
  email?: string;
  phone?: string;
  notes?: string;
};

type CreatePurchaseOrderInput = {
  supplierId?: string;
  orderedAt?: string;
  expectedAt?: string;
  notes?: string;
};

type PurchaseOrderItemLineInput = {
  variantId?: string;
  quantityOrdered?: number;
  unitCostPence?: number;
};

type ReceivePurchaseOrderInput = {
  locationId?: string;
  lines?: Array<{
    purchaseOrderItemId?: string;
    quantity?: number;
  }>;
};

const normalizeOptionalText = (value: string | undefined | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toDateOrUndefined = (value: string | undefined, fieldName: string): Date | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${fieldName} must be a valid date`, "INVALID_DATE");
  }

  return date;
};

const toSupplierResponse = (supplier: {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: supplier.id,
  name: supplier.name,
  email: supplier.email,
  phone: supplier.phone,
  notes: supplier.notes,
  createdAt: supplier.createdAt,
  updatedAt: supplier.updatedAt,
});

const toPurchaseOrderItemResponse = (item: {
  id: string;
  purchaseOrderId: string;
  variantId: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitCostPence: number | null;
  createdAt: Date;
  updatedAt: Date;
  variant: {
    id: string;
    sku: string;
    name: string | null;
    product: {
      id: string;
      name: string;
    };
  };
}) => ({
  id: item.id,
  purchaseOrderId: item.purchaseOrderId,
  variantId: item.variantId,
  sku: item.variant.sku,
  variantName: item.variant.name,
  productId: item.variant.product.id,
  productName: item.variant.product.name,
  quantityOrdered: item.quantityOrdered,
  quantityReceived: item.quantityReceived,
  quantityRemaining: Math.max(0, item.quantityOrdered - item.quantityReceived),
  unitCostPence: item.unitCostPence,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

const calculatePurchaseOrderStatus = (
  status: PurchaseOrderStatus,
  items: Array<{ quantityOrdered: number; quantityReceived: number }>,
): PurchaseOrderStatus => {
  if (status === "CANCELLED") {
    return "CANCELLED";
  }

  if (items.length === 0) {
    return status;
  }

  const totalOrdered = items.reduce((sum, item) => sum + item.quantityOrdered, 0);
  const totalReceived = items.reduce((sum, item) => sum + item.quantityReceived, 0);

  if (totalReceived <= 0) {
    return status === "RECEIVED" ? "PARTIALLY_RECEIVED" : status;
  }

  if (totalReceived >= totalOrdered) {
    return "RECEIVED";
  }

  return "PARTIALLY_RECEIVED";
};

const toPurchaseOrderResponse = (po: {
  id: string;
  supplierId: string;
  status: PurchaseOrderStatus;
  orderedAt: Date | null;
  expectedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  supplier: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
  };
  items: Array<{
    id: string;
    purchaseOrderId: string;
    variantId: string;
    quantityOrdered: number;
    quantityReceived: number;
    unitCostPence: number | null;
    createdAt: Date;
    updatedAt: Date;
    variant: {
      id: string;
      sku: string;
      name: string | null;
      product: {
        id: string;
        name: string;
      };
    };
  }>;
}) => {
  const items = po.items.map(toPurchaseOrderItemResponse);
  const totals = items.reduce(
    (acc, item) => {
      acc.quantityOrdered += item.quantityOrdered;
      acc.quantityReceived += item.quantityReceived;
      acc.quantityRemaining += item.quantityRemaining;
      return acc;
    },
    {
      quantityOrdered: 0,
      quantityReceived: 0,
      quantityRemaining: 0,
    },
  );

  return {
    id: po.id,
    supplierId: po.supplierId,
    supplier: po.supplier,
    status: po.status,
    orderedAt: po.orderedAt,
    expectedAt: po.expectedAt,
    notes: po.notes,
    createdAt: po.createdAt,
    updatedAt: po.updatedAt,
    items,
    totals,
  };
};

const ensureSupplierExists = async (
  tx: Prisma.TransactionClient | typeof prisma,
  supplierId: string,
) => {
  const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) {
    throw new HttpError(404, "Supplier not found", "SUPPLIER_NOT_FOUND");
  }
  return supplier;
};

const getPurchaseOrderOrThrow = async (
  tx: Prisma.TransactionClient | typeof prisma,
  purchaseOrderId: string,
) => {
  const po = await tx.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
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
        orderBy: { createdAt: "asc" },
        include: {
          variant: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!po) {
    throw new HttpError(404, "Purchase order not found", "PURCHASE_ORDER_NOT_FOUND");
  }

  return po;
};

const ensureStockLocationExists = async (
  tx: Prisma.TransactionClient,
  locationId: string,
) => {
  const location = await tx.stockLocation.findUnique({ where: { id: locationId } });
  if (!location) {
    throw new HttpError(404, "Stock location not found", "LOCATION_NOT_FOUND");
  }
  return location;
};

export const createSupplier = async (input: CreateSupplierInput) => {
  const name = normalizeOptionalText(input.name);
  if (!name) {
    throw new HttpError(400, "name is required", "INVALID_SUPPLIER");
  }

  const supplier = await prisma.supplier.create({
    data: {
      name,
      email: normalizeOptionalText(input.email),
      phone: normalizeOptionalText(input.phone),
      notes: normalizeOptionalText(input.notes),
    },
  });

  return toSupplierResponse(supplier);
};

export const searchSuppliers = async (query?: string) => {
  const normalizedQuery = normalizeOptionalText(query);

  const suppliers = await prisma.supplier.findMany({
    where: normalizedQuery
      ? {
          OR: [
            { name: { contains: normalizedQuery, mode: "insensitive" } },
            { email: { contains: normalizedQuery, mode: "insensitive" } },
            { phone: { contains: normalizedQuery, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: [{ name: "asc" }],
  });

  return {
    suppliers: suppliers.map(toSupplierResponse),
  };
};

export const createPurchaseOrder = async (input: CreatePurchaseOrderInput) => {
  const supplierId = normalizeOptionalText(input.supplierId);
  if (!supplierId || !isUuid(supplierId)) {
    throw new HttpError(400, "supplierId must be a valid UUID", "INVALID_SUPPLIER_ID");
  }

  const orderedAt = toDateOrUndefined(input.orderedAt, "orderedAt");
  const expectedAt = toDateOrUndefined(input.expectedAt, "expectedAt");

  const po = await prisma.$transaction(async (tx) => {
    await ensureSupplierExists(tx, supplierId);

    return tx.purchaseOrder.create({
      data: {
        supplierId,
        orderedAt,
        expectedAt,
        notes: normalizeOptionalText(input.notes),
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
          orderBy: { createdAt: "asc" },
          include: {
            variant: {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  return toPurchaseOrderResponse(po);
};

export const getPurchaseOrderById = async (purchaseOrderId: string) => {
  if (!isUuid(purchaseOrderId)) {
    throw new HttpError(400, "Invalid purchase order id", "INVALID_PURCHASE_ORDER_ID");
  }

  const po = await getPurchaseOrderOrThrow(prisma, purchaseOrderId);
  return toPurchaseOrderResponse(po);
};

export const upsertPurchaseOrderItems = async (
  purchaseOrderId: string,
  lines: PurchaseOrderItemLineInput[],
) => {
  if (!isUuid(purchaseOrderId)) {
    throw new HttpError(400, "Invalid purchase order id", "INVALID_PURCHASE_ORDER_ID");
  }

  if (!Array.isArray(lines) || lines.length === 0) {
    throw new HttpError(400, "lines must be a non-empty array", "INVALID_PURCHASE_ORDER_ITEMS");
  }

  const normalizedLines = lines.map((line) => {
    const variantId = normalizeOptionalText(line.variantId);
    if (!variantId) {
      throw new HttpError(400, "variantId is required", "INVALID_PURCHASE_ORDER_ITEMS");
    }

    if (!Number.isInteger(line.quantityOrdered) || (line.quantityOrdered ?? 0) <= 0) {
      throw new HttpError(
        400,
        "quantityOrdered must be a positive integer",
        "INVALID_PURCHASE_ORDER_ITEMS",
      );
    }

    if (
      line.unitCostPence !== undefined &&
      (!Number.isInteger(line.unitCostPence) || (line.unitCostPence ?? -1) < 0)
    ) {
      throw new HttpError(
        400,
        "unitCostPence must be a non-negative integer",
        "INVALID_PURCHASE_ORDER_ITEMS",
      );
    }

    return {
      variantId,
      quantityOrdered: line.quantityOrdered,
      unitCostPence: line.unitCostPence,
    };
  });

  const duplicateVariantIds = new Set<string>();
  const seenVariantIds = new Set<string>();
  for (const line of normalizedLines) {
    if (seenVariantIds.has(line.variantId)) {
      duplicateVariantIds.add(line.variantId);
    }
    seenVariantIds.add(line.variantId);
  }

  if (duplicateVariantIds.size > 0) {
    throw new HttpError(
      400,
      "Each variantId can only appear once per request",
      "DUPLICATE_VARIANT_ID",
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: {
        items: true,
      },
    });

    if (!po) {
      throw new HttpError(404, "Purchase order not found", "PURCHASE_ORDER_NOT_FOUND");
    }

    if (po.status === "CANCELLED") {
      throw new HttpError(409, "Cancelled purchase orders cannot be edited", "PURCHASE_ORDER_CANCELLED");
    }

    if (po.status === "RECEIVED") {
      throw new HttpError(409, "Received purchase orders cannot be edited", "PURCHASE_ORDER_RECEIVED");
    }

    const variantIds = normalizedLines.map((line) => line.variantId);
    const variants = await tx.variant.findMany({
      where: {
        id: {
          in: variantIds,
        },
      },
      select: {
        id: true,
        costPricePence: true,
      },
    });

    if (variants.length !== variantIds.length) {
      throw new HttpError(404, "One or more variants were not found", "VARIANT_NOT_FOUND");
    }

    const variantById = new Map(variants.map((variant) => [variant.id, variant]));
    const existingItemByVariantId = new Map(
      po.items.map((item) => [item.variantId, item]),
    );

    for (const line of normalizedLines) {
      const existingItem = existingItemByVariantId.get(line.variantId);
      const variant = variantById.get(line.variantId);
      if (!variant) {
        throw new HttpError(404, "Variant not found", "VARIANT_NOT_FOUND");
      }

      const requestedUnitCostPence =
        line.unitCostPence === undefined ? undefined : line.unitCostPence;
      const effectiveUnitCostPence =
        requestedUnitCostPence ?? existingItem?.unitCostPence ?? variant.costPricePence ?? null;

      if (existingItem) {
        if (line.quantityOrdered < existingItem.quantityReceived) {
          throw new HttpError(
            409,
            "quantityOrdered cannot be less than quantity already received",
            "PURCHASE_ORDER_QUANTITY_BELOW_RECEIVED",
          );
        }

        await tx.purchaseOrderItem.update({
          where: { id: existingItem.id },
          data: {
            quantityOrdered: line.quantityOrdered,
            ...(requestedUnitCostPence !== undefined
              ? { unitCostPence: requestedUnitCostPence }
              : { unitCostPence: effectiveUnitCostPence }),
          },
        });
        continue;
      }

      await tx.purchaseOrderItem.create({
        data: {
          purchaseOrderId,
          variantId: line.variantId,
          quantityOrdered: line.quantityOrdered,
          unitCostPence: effectiveUnitCostPence,
        },
      });
    }

    const reloaded = await getPurchaseOrderOrThrow(tx, purchaseOrderId);
    return reloaded;
  });

  return toPurchaseOrderResponse(updated);
};

export const receivePurchaseOrder = async (
  purchaseOrderId: string,
  input: ReceivePurchaseOrderInput,
  createdByStaffId?: string,
) => {
  if (!isUuid(purchaseOrderId)) {
    throw new HttpError(400, "Invalid purchase order id", "INVALID_PURCHASE_ORDER_ID");
  }

  const locationId = normalizeOptionalText(input.locationId);
  if (!locationId || !isUuid(locationId)) {
    throw new HttpError(400, "locationId must be a valid UUID", "INVALID_LOCATION_ID");
  }

  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new HttpError(400, "lines must be a non-empty array", "INVALID_RECEIVING_LINES");
  }

  const parsedLines = input.lines.map((line) => {
    const purchaseOrderItemId = normalizeOptionalText(line.purchaseOrderItemId);
    if (!purchaseOrderItemId || !isUuid(purchaseOrderItemId)) {
      throw new HttpError(400, "purchaseOrderItemId must be a valid UUID", "INVALID_RECEIVING_LINES");
    }

    if (!Number.isInteger(line.quantity) || (line.quantity ?? 0) <= 0) {
      throw new HttpError(400, "quantity must be a positive integer", "INVALID_RECEIVING_LINES");
    }

    return {
      purchaseOrderItemId,
      quantity: line.quantity,
    };
  });

  const uniqueItemIds = new Set(parsedLines.map((line) => line.purchaseOrderItemId));
  if (uniqueItemIds.size !== parsedLines.length) {
    throw new HttpError(
      400,
      "Each purchaseOrderItemId can only appear once per receive request",
      "DUPLICATE_RECEIVING_LINE",
    );
  }

  const normalizedCreatedByStaffId = normalizeOptionalText(createdByStaffId);

  const updated = await prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: {
        items: {
          include: {
            variant: true,
          },
        },
      },
    });

    if (!po) {
      throw new HttpError(404, "Purchase order not found", "PURCHASE_ORDER_NOT_FOUND");
    }

    if (po.status === "CANCELLED") {
      throw new HttpError(409, "Cancelled purchase orders cannot be received", "PURCHASE_ORDER_CANCELLED");
    }

    await ensureStockLocationExists(tx, locationId);

    if (normalizedCreatedByStaffId) {
      const staff = await tx.user.findUnique({ where: { id: normalizedCreatedByStaffId } });
      if (!staff) {
        throw new HttpError(404, "Staff member not found", "STAFF_NOT_FOUND");
      }
    }

    const itemById = new Map(po.items.map((item) => [item.id, item]));

    for (const line of parsedLines) {
      const item = itemById.get(line.purchaseOrderItemId);
      if (!item) {
        throw new HttpError(
          400,
          "Each purchaseOrderItemId must belong to the purchase order",
          "PURCHASE_ORDER_ITEM_MISMATCH",
        );
      }

      const remaining = item.quantityOrdered - item.quantityReceived;
      if (line.quantity > remaining) {
        throw new HttpError(
          409,
          "Receive quantity exceeds remaining quantity",
          "PURCHASE_ORDER_OVER_RECEIVE",
        );
      }

      const unitCost = item.unitCostPence ?? item.variant.costPricePence ?? null;

      await tx.purchaseOrderItem.update({
        where: {
          id: item.id,
        },
        data: {
          quantityReceived: {
            increment: line.quantity,
          },
        },
      });

      await tx.stockLedgerEntry.create({
        data: {
          variantId: item.variantId,
          locationId,
          type: "PURCHASE",
          quantityDelta: line.quantity,
          unitCostPence: unitCost,
          referenceType: "PURCHASE_ORDER_ITEM",
          referenceId: item.id,
          note: unitCost !== null ? `PO_RECEIVE unitCostPence=${unitCost}` : "PO_RECEIVE",
          createdByStaffId: normalizedCreatedByStaffId,
        },
      });

      await tx.inventoryMovement.create({
        data: {
          variantId: item.variantId,
          type: "PURCHASE",
          quantity: line.quantity,
          unitCost: unitCost,
          referenceType: "PURCHASE_ORDER_ITEM",
          referenceId: item.id,
          note: unitCost !== null ? `PO_RECEIVE unitCost=${unitCost}` : "PO_RECEIVE",
          createdByStaffId: normalizedCreatedByStaffId ?? null,
        },
      });
    }

    const refreshedItems = await tx.purchaseOrderItem.findMany({
      where: {
        purchaseOrderId,
      },
      select: {
        quantityOrdered: true,
        quantityReceived: true,
      },
    });

    const nextStatus = calculatePurchaseOrderStatus(po.status, refreshedItems);

    if (nextStatus !== po.status) {
      await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: {
          status: nextStatus,
        },
      });
    }

    return getPurchaseOrderOrThrow(tx, purchaseOrderId);
  });

  return toPurchaseOrderResponse(updated);
};
