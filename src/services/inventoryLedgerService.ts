import { InventoryMovementType, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";
import { ensureVariantExistsById } from "./productService";
import { getReservedQuantityByVariantIdsTx, getReservedQuantityForVariantTx } from "./stockReservationService";

type RecordMovementInput = {
  variantId?: string;
  type?: InventoryMovementType;
  quantity?: number;
  unitCost?: string | number | null;
  referenceType?: string;
  referenceId?: string;
  note?: string;
  createdByStaffId?: string;
};

type ListMovementFilters = {
  variantId?: string;
  from?: string;
  to?: string;
  type?: InventoryMovementType;
};

type ListOnHandFilters = {
  q?: string;
  isActive?: boolean;
  take?: number;
  skip?: number;
};

type InventoryAdjustmentReason =
  | "COUNT_CORRECTION"
  | "DAMAGED"
  | "SUPPLIER_ERROR"
  | "THEFT"
  | "OTHER";

type RecordAdjustmentInput = {
  variantId?: string;
  quantityDelta?: number;
  reason?: InventoryAdjustmentReason;
  note?: string;
  createdByStaffId?: string;
};

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const normalizeOptionalText = (value: string | undefined | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseTake = (take: number | undefined): number | undefined => {
  if (take === undefined) {
    return undefined;
  }
  if (!Number.isInteger(take) || take < 1 || take > 200) {
    throw new HttpError(400, "take must be an integer between 1 and 200", "INVALID_ON_HAND_QUERY");
  }
  return take;
};

const parseSkip = (skip: number | undefined): number | undefined => {
  if (skip === undefined) {
    return undefined;
  }
  if (!Number.isInteger(skip) || skip < 0) {
    throw new HttpError(400, "skip must be an integer >= 0", "INVALID_ON_HAND_QUERY");
  }
  return skip;
};

const parseUnitCost = (
  value: string | number | null | undefined,
): Prisma.Decimal | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  try {
    return new Prisma.Decimal(value);
  } catch {
    throw new HttpError(400, "unitCost must be a valid decimal value", "INVALID_MOVEMENT_UNIT_COST");
  }
};

const parseFromDate = (value: string): Date => {
  if (DATE_ONLY_REGEX.test(value)) {
    return new Date(`${value}T00:00:00.000Z`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, "from must be a valid date", "INVALID_MOVEMENT_DATE_RANGE");
  }
  return parsed;
};

const parseToDate = (value: string): Date => {
  if (DATE_ONLY_REGEX.test(value)) {
    return new Date(`${value}T23:59:59.999Z`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, "to must be a valid date", "INVALID_MOVEMENT_DATE_RANGE");
  }
  return parsed;
};

const toMovementResponse = (movement: {
  id: string;
  variantId: string;
  type: InventoryMovementType;
  quantity: number;
  unitCost: Prisma.Decimal | null;
  referenceType: string | null;
  referenceId: string | null;
  note: string | null;
  createdByStaffId: string | null;
  createdAt: Date;
}) => ({
  id: movement.id,
  variantId: movement.variantId,
  type: movement.type,
  quantity: movement.quantity,
  unitCost: movement.unitCost === null ? null : movement.unitCost.toString(),
  referenceType: movement.referenceType,
  referenceId: movement.referenceId,
  note: movement.note,
  createdByStaffId: movement.createdByStaffId,
  createdAt: movement.createdAt,
});

const VALID_ADJUSTMENT_REASONS = new Set<InventoryAdjustmentReason>([
  "COUNT_CORRECTION",
  "DAMAGED",
  "SUPPLIER_ERROR",
  "THEFT",
  "OTHER",
]);

export const recordMovement = async (input: RecordMovementInput) => {
  const variantId = normalizeOptionalText(input.variantId);
  if (!variantId) {
    throw new HttpError(400, "variantId is required", "INVALID_INVENTORY_MOVEMENT");
  }

  if (!input.type) {
    throw new HttpError(400, "type is required", "INVALID_INVENTORY_MOVEMENT");
  }

  if (!Number.isInteger(input.quantity) || (input.quantity ?? 0) === 0) {
    throw new HttpError(
      400,
      "quantity must be a non-zero integer",
      "INVALID_INVENTORY_MOVEMENT",
    );
  }

  const unitCost = parseUnitCost(input.unitCost);

  const movement = await prisma.$transaction(async (tx) => {
    await ensureVariantExistsById(tx, variantId);

    const referenceType = normalizeOptionalText(input.referenceType) ?? null;
    const referenceId = normalizeOptionalText(input.referenceId) ?? null;
    const note = normalizeOptionalText(input.note) ?? null;
    const createdByStaffId = normalizeOptionalText(input.createdByStaffId) ?? null;

    return tx.inventoryMovement.create({
      data: {
        variantId,
        type: input.type,
        quantity: input.quantity,
        unitCost: unitCost === undefined ? null : unitCost,
        referenceType,
        referenceId,
        note,
        createdByStaffId,
      },
    });
  });

  return toMovementResponse(movement);
};

export const recordAdjustment = async (input: RecordAdjustmentInput) => {
  const variantId = normalizeOptionalText(input.variantId);
  if (!variantId) {
    throw new HttpError(400, "variantId is required", "INVALID_INVENTORY_ADJUSTMENT");
  }
  if (!Number.isInteger(input.quantityDelta) || (input.quantityDelta ?? 0) === 0) {
    throw new HttpError(
      400,
      "quantityDelta must be a non-zero integer",
      "INVALID_INVENTORY_ADJUSTMENT",
    );
  }
  if (!input.reason || !VALID_ADJUSTMENT_REASONS.has(input.reason)) {
    throw new HttpError(
      400,
      "reason must be one of COUNT_CORRECTION, DAMAGED, SUPPLIER_ERROR, THEFT, OTHER",
      "INVALID_INVENTORY_ADJUSTMENT",
    );
  }

  const movement = await recordMovement({
    variantId,
    type: "ADJUSTMENT",
    quantity: input.quantityDelta,
    referenceType: "ADJUSTMENT",
    referenceId: input.reason,
    note: normalizeOptionalText(input.note) ?? undefined,
    createdByStaffId: normalizeOptionalText(input.createdByStaffId),
  });

  const onHand = await getOnHand(variantId);

  return {
    movement: {
      ...movement,
      reason: input.reason,
    },
    onHand: onHand.onHand,
  };
};

export const getOnHand = async (variantId?: string) => {
  const normalizedVariantId = normalizeOptionalText(variantId);
  if (!normalizedVariantId) {
    throw new HttpError(400, "variantId is required", "INVALID_VARIANT_ID");
  }

  await ensureVariantExistsById(prisma, normalizedVariantId);

  const aggregate = await prisma.inventoryMovement.aggregate({
    where: {
      variantId: normalizedVariantId,
    },
    _sum: {
      quantity: true,
    },
  });
  const reservedQty = await getReservedQuantityForVariantTx(prisma, normalizedVariantId);
  const onHand = aggregate._sum.quantity ?? 0;

  return {
    variantId: normalizedVariantId,
    onHand,
    reservedQty,
    availableQty: onHand - reservedQty,
  };
};

export const listMovements = async (filters: ListMovementFilters) => {
  const variantId = normalizeOptionalText(filters.variantId);
  if (!variantId) {
    throw new HttpError(400, "variantId is required", "INVALID_VARIANT_ID");
  }

  await ensureVariantExistsById(prisma, variantId);

  const from = filters.from ? parseFromDate(filters.from) : undefined;
  const to = filters.to ? parseToDate(filters.to) : undefined;

  if (from && to && from > to) {
    throw new HttpError(
      400,
      "from must be before or equal to to",
      "INVALID_MOVEMENT_DATE_RANGE",
    );
  }

  const movements = await prisma.inventoryMovement.findMany({
    where: {
      variantId,
      ...(filters.type ? { type: filters.type } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  return {
    variantId,
    movements: movements.map((movement) => toMovementResponse(movement)),
  };
};

export const listOnHand = async (filters: ListOnHandFilters = {}) => {
  const normalizedQuery = normalizeOptionalText(filters.q);
  const take = parseTake(filters.take);
  const skip = parseSkip(filters.skip);

  const variants = await prisma.variant.findMany({
    where: {
      ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
      ...(normalizedQuery
        ? {
            OR: [
              { sku: { contains: normalizedQuery, mode: "insensitive" } },
              { barcode: { contains: normalizedQuery, mode: "insensitive" } },
              { name: { contains: normalizedQuery, mode: "insensitive" } },
              { option: { contains: normalizedQuery, mode: "insensitive" } },
              {
                product: {
                  name: { contains: normalizedQuery, mode: "insensitive" },
                },
              },
              {
                product: {
                  brand: { contains: normalizedQuery, mode: "insensitive" },
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
      product: {
        select: {
          id: true,
          name: true,
          brand: true,
        },
      },
    },
  });

  const variantIds = variants.map((variant) => variant.id);
  const grouped =
    variantIds.length > 0
      ? await prisma.inventoryMovement.groupBy({
          by: ["variantId"],
          where: {
            variantId: {
              in: variantIds,
            },
          },
          _sum: {
            quantity: true,
          },
        })
      : [];

  const onHandByVariant = new Map(
    grouped.map((row) => [row.variantId, row._sum.quantity ?? 0]),
  );
  const reservedByVariant = await getReservedQuantityByVariantIdsTx(prisma, variantIds);

  return {
    rows: variants.map((variant) => ({
      variantId: variant.id,
      sku: variant.sku,
      barcode: variant.barcode,
      variantName: variant.name ?? variant.option,
      option: variant.option,
      productId: variant.product.id,
      productName: variant.product.name,
      brand: variant.product.brand,
      retailPricePence: variant.retailPricePence,
      isActive: variant.isActive,
      onHand: onHandByVariant.get(variant.id) ?? 0,
      reservedQty: reservedByVariant.get(variant.id) ?? 0,
      availableQty:
        (onHandByVariant.get(variant.id) ?? 0) - (reservedByVariant.get(variant.id) ?? 0),
    })),
  };
};
