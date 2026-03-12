import { Prisma, PurchaseOrderStatus } from "@prisma/client";
import { emit } from "../core/events";
import { logOperationalEvent } from "../lib/operationalLogger";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";

type CreateSupplierInput = {
  name?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  notes?: string;
};

type UpdateSupplierInput = {
  name?: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
};

type CreatePurchaseOrderInput = {
  supplierId?: string;
  orderedAt?: string;
  expectedAt?: string;
  notes?: string;
};

type ListPurchaseOrderFilters = {
  status?: PurchaseOrderStatus;
  supplierId?: string;
  q?: string;
  from?: string;
  to?: string;
  take?: number;
  skip?: number;
};

type UpdatePurchaseOrderInput = {
  status?: PurchaseOrderStatus;
  orderedAt?: string | null;
  expectedAt?: string | null;
  notes?: string | null;
};

type PurchaseOrderItemLineInput = {
  variantId?: string;
  quantityOrdered?: number;
  unitCostPence?: number;
};

type UpdatePurchaseOrderItemInput = {
  quantityOrdered?: number;
  unitCostPence?: number | null;
};

type ReceivePurchaseOrderInput = {
  locationId?: string;
  lines?: Array<{
    purchaseOrderItemId?: string;
    quantity?: number;
    unitCostPence?: number;
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

const parseOptionalTake = (value: number | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 1 || value > 200) {
    throw new HttpError(400, "take must be an integer between 1 and 200", "INVALID_PURCHASE_ORDER_QUERY");
  }
  return value;
};

const parseOptionalSkip = (value: number | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new HttpError(400, "skip must be an integer >= 0", "INVALID_PURCHASE_ORDER_QUERY");
  }
  return value;
};

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const parseDateFilter = (value: string | undefined, field: "from" | "to"): Date | undefined => {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return undefined;
  }

  if (!DATE_ONLY_REGEX.test(normalized)) {
    throw new HttpError(400, `${field} must be YYYY-MM-DD`, "INVALID_PURCHASE_ORDER_QUERY");
  }

  const suffix = field === "from" ? "T00:00:00.000Z" : "T23:59:59.999Z";
  const date = new Date(`${normalized}${suffix}`);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${field} is invalid`, "INVALID_PURCHASE_ORDER_QUERY");
  }
  return date;
};

const toSupplierResponse = (supplier: {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: supplier.id,
  name: supplier.name,
  contactName: supplier.contactName,
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

const assertDraftForLineEdits = (status: PurchaseOrderStatus) => {
  if (status !== "DRAFT") {
    throw new HttpError(
      409,
      "Purchase order lines can only be edited while status is DRAFT",
      "PURCHASE_ORDER_NOT_DRAFT",
    );
  }
};

const getNextStatusOrThrow = (
  current: PurchaseOrderStatus,
  requested: PurchaseOrderStatus,
): PurchaseOrderStatus => {
  if (requested === "PARTIALLY_RECEIVED" || requested === "RECEIVED") {
    throw new HttpError(
      400,
      "status PARTIALLY_RECEIVED/RECEIVED is system-managed via receiving",
      "INVALID_PURCHASE_ORDER_STATUS",
    );
  }

  if (current === requested) {
    return current;
  }

  if (current === "RECEIVED") {
    throw new HttpError(409, "Received purchase orders cannot be edited", "PURCHASE_ORDER_RECEIVED");
  }
  if (current === "CANCELLED") {
    throw new HttpError(409, "Cancelled purchase orders cannot be edited", "PURCHASE_ORDER_CANCELLED");
  }

  if (current === "DRAFT") {
    if (requested === "SENT" || requested === "CANCELLED") {
      return requested;
    }
  }

  if (current === "SENT") {
    if (requested === "CANCELLED") {
      return "CANCELLED";
    }
    throw new HttpError(
      409,
      "SENT purchase orders can only transition to CANCELLED",
      "INVALID_PURCHASE_ORDER_STATUS_TRANSITION",
    );
  }

  if (current === "PARTIALLY_RECEIVED") {
    throw new HttpError(
      409,
      "Partially received purchase orders cannot be manually re-stated",
      "INVALID_PURCHASE_ORDER_STATUS_TRANSITION",
    );
  }

  throw new HttpError(409, "Invalid purchase order status transition", "INVALID_PURCHASE_ORDER_STATUS_TRANSITION");
};

const toPurchaseOrderResponse = (po: {
  id: string;
  poNumber: string;
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
    poNumber: po.poNumber,
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

const getLegacyPurchaseOrderNumberPrefixForYear = (year: number) => `COREPOS-PO-${year}-`;

const getCompactPurchaseOrderNumberPrefixForYear = (year: number) =>
  `PO${year.toString().slice(-2)}`;

const buildPurchaseOrderNumber = (year: number, sequenceNumber: number) =>
  `${getCompactPurchaseOrderNumberPrefixForYear(year)}${String(sequenceNumber).padStart(6, "0")}`;

const getNextPurchaseOrderNumber = async (
  tx: Prisma.TransactionClient,
  createdAt: Date,
) => {
  const year = createdAt.getUTCFullYear();
  const legacyPrefix = getLegacyPurchaseOrderNumberPrefixForYear(year);
  const compactPrefix = getCompactPurchaseOrderNumberPrefixForYear(year);

  const purchaseOrders = await tx.purchaseOrder.findMany({
    where: {
      OR: [
        {
          poNumber: {
            startsWith: legacyPrefix,
          },
        },
        {
          poNumber: {
            startsWith: compactPrefix,
          },
        },
      ],
    },
    select: {
      poNumber: true,
    },
  });

  const nextSequence =
    purchaseOrders.reduce((maxSequence, purchaseOrder) => {
      const sequence = Number.parseInt(purchaseOrder.poNumber.slice(-6), 10);
      if (Number.isNaN(sequence)) {
        return maxSequence;
      }
      return Math.max(maxSequence, sequence);
    }, 0) + 1;

  return buildPurchaseOrderNumber(year, nextSequence);
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
          contactName: true,
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
      contactName: normalizeOptionalText(input.contactName),
      email: normalizeOptionalText(input.email),
      phone: normalizeOptionalText(input.phone),
      notes: normalizeOptionalText(input.notes),
    },
  });

  return toSupplierResponse(supplier);
};

export const updateSupplier = async (supplierId: string, input: UpdateSupplierInput) => {
  if (!isUuid(supplierId)) {
    throw new HttpError(400, "Invalid supplier id", "INVALID_SUPPLIER_ID");
  }

  const hasName = Object.prototype.hasOwnProperty.call(input, "name");
  const hasContactName = Object.prototype.hasOwnProperty.call(input, "contactName");
  const hasEmail = Object.prototype.hasOwnProperty.call(input, "email");
  const hasPhone = Object.prototype.hasOwnProperty.call(input, "phone");
  const hasNotes = Object.prototype.hasOwnProperty.call(input, "notes");

  if (!hasName && !hasContactName && !hasEmail && !hasPhone && !hasNotes) {
    throw new HttpError(400, "No fields supplied for update", "INVALID_SUPPLIER_UPDATE");
  }

  const current = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!current) {
    throw new HttpError(404, "Supplier not found", "SUPPLIER_NOT_FOUND");
  }

  const nextName = hasName ? normalizeOptionalText(input.name ?? undefined) : current.name;
  if (!nextName) {
    throw new HttpError(400, "name is required", "INVALID_SUPPLIER_UPDATE");
  }

  const supplier = await prisma.supplier.update({
    where: { id: supplierId },
    data: {
      name: nextName,
      ...(hasContactName ? { contactName: normalizeOptionalText(input.contactName ?? undefined) ?? null } : {}),
      ...(hasEmail ? { email: normalizeOptionalText(input.email ?? undefined) ?? null } : {}),
      ...(hasPhone ? { phone: normalizeOptionalText(input.phone ?? undefined) ?? null } : {}),
      ...(hasNotes ? { notes: normalizeOptionalText(input.notes ?? undefined) ?? null } : {}),
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
            { contactName: { contains: normalizedQuery, mode: "insensitive" } },
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

  let po;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      po = await prisma.$transaction(async (tx) => {
        await ensureSupplierExists(tx, supplierId);
        const createdAt = new Date();
        const poNumber = await getNextPurchaseOrderNumber(tx, createdAt);

        return tx.purchaseOrder.create({
          data: {
            poNumber,
            supplierId,
            orderedAt,
            expectedAt,
            notes: normalizeOptionalText(input.notes),
            createdAt,
          },
          include: {
            supplier: {
              select: {
                id: true,
                name: true,
                contactName: true,
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
      break;
    } catch (createError) {
      if (
        createError instanceof Prisma.PrismaClientKnownRequestError &&
        createError.code === "P2002" &&
        attempt < 2
      ) {
        continue;
      }
      throw createError;
    }
  }

  if (!po) {
    throw new HttpError(500, "Failed to create purchase order", "PURCHASE_ORDER_CREATE_FAILED");
  }

  return toPurchaseOrderResponse(po);
};

export const listPurchaseOrders = async (filters: ListPurchaseOrderFilters = {}) => {
  const supplierId = normalizeOptionalText(filters.supplierId);
  if (supplierId && !isUuid(supplierId)) {
    throw new HttpError(400, "supplierId must be a valid UUID", "INVALID_SUPPLIER_ID");
  }

  const take = parseOptionalTake(filters.take);
  const skip = parseOptionalSkip(filters.skip);
  const normalizedQuery = normalizeOptionalText(filters.q);
  const fromDate = parseDateFilter(filters.from, "from");
  const toDate = parseDateFilter(filters.to, "to");

  if (fromDate && toDate && fromDate > toDate) {
    throw new HttpError(400, "from must be <= to", "INVALID_PURCHASE_ORDER_QUERY");
  }

  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: {
      ...(filters.status ? { status: filters.status } : {}),
      ...(supplierId ? { supplierId } : {}),
      ...(fromDate || toDate
        ? {
            createdAt: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDate ? { lte: toDate } : {}),
            },
          }
        : {}),
      ...(normalizedQuery
        ? {
            OR: [
              ...(isUuid(normalizedQuery) ? [{ id: normalizedQuery }] : []),
              { poNumber: { contains: normalizedQuery, mode: "insensitive" } },
              { notes: { contains: normalizedQuery, mode: "insensitive" } },
              { supplier: { name: { contains: normalizedQuery, mode: "insensitive" } } },
              { supplier: { email: { contains: normalizedQuery, mode: "insensitive" } } },
              {
                items: {
                  some: {
                    variant: {
                      sku: { contains: normalizedQuery, mode: "insensitive" },
                    },
                  },
                },
              },
              {
                items: {
                  some: {
                    variant: {
                      product: {
                        name: { contains: normalizedQuery, mode: "insensitive" },
                      },
                    },
                  },
                },
              },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }],
    ...(take !== undefined ? { take } : {}),
    ...(skip !== undefined ? { skip } : {}),
    include: {
      supplier: {
        select: {
          id: true,
          name: true,
          contactName: true,
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

  return {
    purchaseOrders: purchaseOrders.map(toPurchaseOrderResponse),
  };
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

    assertDraftForLineEdits(po.status);

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

    const supplierLinks = await tx.supplierProductLink.findMany({
      where: {
        supplierId: po.supplierId,
        variantId: {
          in: variantIds,
        },
        isActive: true,
      },
      select: {
        variantId: true,
        supplierCostPence: true,
      },
    });

    if (variants.length !== variantIds.length) {
      throw new HttpError(404, "One or more variants were not found", "VARIANT_NOT_FOUND");
    }

    const variantById = new Map(variants.map((variant) => [variant.id, variant]));
    const supplierLinkByVariantId = new Map(
      supplierLinks.map((link) => [link.variantId, link]),
    );
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
        requestedUnitCostPence
        ?? existingItem?.unitCostPence
        ?? supplierLinkByVariantId.get(line.variantId)?.supplierCostPence
        ?? variant.costPricePence
        ?? null;

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

export const updatePurchaseOrder = async (
  purchaseOrderId: string,
  input: UpdatePurchaseOrderInput,
) => {
  if (!isUuid(purchaseOrderId)) {
    throw new HttpError(400, "Invalid purchase order id", "INVALID_PURCHASE_ORDER_ID");
  }

  const hasStatus = input.status !== undefined;
  const hasOrderedAt = Object.prototype.hasOwnProperty.call(input, "orderedAt");
  const hasExpectedAt = Object.prototype.hasOwnProperty.call(input, "expectedAt");
  const hasNotes = Object.prototype.hasOwnProperty.call(input, "notes");

  if (!hasStatus && !hasOrderedAt && !hasExpectedAt && !hasNotes) {
    throw new HttpError(400, "No fields supplied for update", "INVALID_PURCHASE_ORDER_UPDATE");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: {
        items: {
          select: {
            quantityOrdered: true,
            quantityReceived: true,
          },
        },
      },
    });

    if (!po) {
      throw new HttpError(404, "Purchase order not found", "PURCHASE_ORDER_NOT_FOUND");
    }

    let nextStatus = po.status;
    if (hasStatus) {
      nextStatus = getNextStatusOrThrow(po.status, input.status!);
    }

    const data: {
      status?: PurchaseOrderStatus;
      orderedAt?: Date | null;
      expectedAt?: Date | null;
      notes?: string | null;
    } = {};

    if (nextStatus !== po.status) {
      data.status = nextStatus;
    }

    if (hasOrderedAt) {
      if (input.orderedAt === null) {
        data.orderedAt = null;
      } else {
        data.orderedAt = toDateOrUndefined(input.orderedAt ?? undefined, "orderedAt") ?? null;
      }
    }

    if (hasExpectedAt) {
      if (input.expectedAt === null) {
        data.expectedAt = null;
      } else {
        data.expectedAt = toDateOrUndefined(input.expectedAt ?? undefined, "expectedAt") ?? null;
      }
    }

    if (hasNotes) {
      data.notes = normalizeOptionalText(input.notes ?? undefined) ?? null;
    }

    await tx.purchaseOrder.update({
      where: { id: purchaseOrderId },
      data,
    });

    const refreshedItems = await tx.purchaseOrderItem.findMany({
      where: { purchaseOrderId },
      select: {
        quantityOrdered: true,
        quantityReceived: true,
      },
    });

    const calculatedStatus = calculatePurchaseOrderStatus(
      data.status ?? po.status,
      refreshedItems,
    );

    if (calculatedStatus !== (data.status ?? po.status)) {
      await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: { status: calculatedStatus },
      });
    }

    return getPurchaseOrderOrThrow(tx, purchaseOrderId);
  });

  return toPurchaseOrderResponse(updated);
};

export const updatePurchaseOrderItem = async (
  purchaseOrderId: string,
  lineId: string,
  input: UpdatePurchaseOrderItemInput,
) => {
  if (!isUuid(purchaseOrderId)) {
    throw new HttpError(400, "Invalid purchase order id", "INVALID_PURCHASE_ORDER_ID");
  }
  if (!isUuid(lineId)) {
    throw new HttpError(400, "Invalid purchase order line id", "INVALID_PURCHASE_ORDER_ITEM_ID");
  }

  const hasQuantityOrdered = input.quantityOrdered !== undefined;
  const hasUnitCostPence = Object.prototype.hasOwnProperty.call(input, "unitCostPence");
  if (!hasQuantityOrdered && !hasUnitCostPence) {
    throw new HttpError(400, "No fields supplied for line update", "INVALID_PURCHASE_ORDER_ITEMS");
  }

  if (
    hasQuantityOrdered &&
    (!Number.isInteger(input.quantityOrdered) || (input.quantityOrdered ?? 0) <= 0)
  ) {
    throw new HttpError(
      400,
      "quantityOrdered must be a positive integer",
      "INVALID_PURCHASE_ORDER_ITEMS",
    );
  }

  if (
    hasUnitCostPence &&
    input.unitCostPence !== null &&
    (!Number.isInteger(input.unitCostPence) || (input.unitCostPence ?? -1) < 0)
  ) {
    throw new HttpError(
      400,
      "unitCostPence must be a non-negative integer or null",
      "INVALID_PURCHASE_ORDER_ITEMS",
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      select: {
        id: true,
        status: true,
      },
    });

    if (!po) {
      throw new HttpError(404, "Purchase order not found", "PURCHASE_ORDER_NOT_FOUND");
    }

    assertDraftForLineEdits(po.status);

    const item = await tx.purchaseOrderItem.findUnique({
      where: { id: lineId },
      select: {
        id: true,
        purchaseOrderId: true,
        quantityReceived: true,
      },
    });

    if (!item || item.purchaseOrderId !== purchaseOrderId) {
      throw new HttpError(404, "Purchase order line not found", "PURCHASE_ORDER_ITEM_NOT_FOUND");
    }

    if (
      hasQuantityOrdered &&
      (input.quantityOrdered ?? 0) < item.quantityReceived
    ) {
      throw new HttpError(
        409,
        "quantityOrdered cannot be less than quantity already received",
        "PURCHASE_ORDER_QUANTITY_BELOW_RECEIVED",
      );
    }

    await tx.purchaseOrderItem.update({
      where: { id: lineId },
      data: {
        ...(hasQuantityOrdered ? { quantityOrdered: input.quantityOrdered } : {}),
        ...(hasUnitCostPence ? { unitCostPence: input.unitCostPence ?? null } : {}),
      },
    });

    return getPurchaseOrderOrThrow(tx, purchaseOrderId);
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

    if (
      line.unitCostPence !== undefined &&
      (!Number.isInteger(line.unitCostPence) || (line.unitCostPence ?? -1) < 0)
    ) {
      throw new HttpError(
        400,
        "unitCostPence must be a non-negative integer",
        "INVALID_RECEIVING_LINES",
      );
    }

    return {
      purchaseOrderItemId,
      quantity: line.quantity,
      unitCostPence: line.unitCostPence,
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

    if (po.status === "DRAFT") {
      throw new HttpError(
        409,
        "Draft purchase orders must be sent before receiving",
        "PURCHASE_ORDER_NOT_SENT",
      );
    }
    if (po.status === "CANCELLED") {
      throw new HttpError(409, "Cancelled purchase orders cannot be received", "PURCHASE_ORDER_CANCELLED");
    }
    if (po.status === "RECEIVED") {
      throw new HttpError(409, "Received purchase orders cannot be received", "PURCHASE_ORDER_RECEIVED");
    }

    await ensureStockLocationExists(tx, locationId);

    if (normalizedCreatedByStaffId) {
      const staff = await tx.user.findUnique({ where: { id: normalizedCreatedByStaffId } });
      if (!staff) {
        throw new HttpError(404, "Staff member not found", "STAFF_NOT_FOUND");
      }
    }

    const itemById = new Map(po.items.map((item) => [item.id, item]));
    const supplierLinks = await tx.supplierProductLink.findMany({
      where: {
        supplierId: po.supplierId,
        variantId: {
          in: Array.from(new Set(po.items.map((item) => item.variantId))),
        },
        isActive: true,
      },
      select: {
        variantId: true,
        supplierCostPence: true,
      },
    });
    const supplierLinkByVariantId = new Map(
      supplierLinks.map((link) => [link.variantId, link]),
    );

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

      const unitCost =
        line.unitCostPence
        ?? item.unitCostPence
        ?? supplierLinkByVariantId.get(item.variantId)?.supplierCostPence
        ?? item.variant.costPricePence
        ?? null;

      await tx.purchaseOrderItem.update({
        where: {
          id: item.id,
        },
        data: {
          quantityReceived: {
            increment: line.quantity,
          },
          ...(line.unitCostPence !== undefined ? { unitCostPence: line.unitCostPence } : {}),
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
          locationId,
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

    return {
      purchaseOrder: await getPurchaseOrderOrThrow(tx, purchaseOrderId),
      event: {
        purchaseOrderId,
        locationId,
        lineCount: parsedLines.length,
        quantityReceived: parsedLines.reduce((sum, line) => sum + line.quantity, 0),
      },
    };
  });

  const response = toPurchaseOrderResponse(updated.purchaseOrder);
  emit("purchaseOrder.received", {
    id: response.id,
    type: "purchaseOrder.received",
    timestamp: new Date().toISOString(),
    purchaseOrderId: response.id,
    poNumber: response.poNumber,
    locationId: updated.event.locationId,
    lineCount: updated.event.lineCount,
    quantityReceived: updated.event.quantityReceived,
    status: response.status,
  });

  logOperationalEvent("purchasing.purchase_order.received", {
    purchaseOrderId: response.id,
    poNumber: response.poNumber,
    locationId: updated.event.locationId,
    lineCount: updated.event.lineCount,
    quantityReceived: updated.event.quantityReceived,
    status: response.status,
  });

  return response;
};
