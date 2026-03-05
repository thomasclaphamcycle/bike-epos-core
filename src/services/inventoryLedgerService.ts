import { InventoryMovementType, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";
import { ensureDefaultLocationTx } from "./locationService";
import { ensureVariantExistsById } from "./productService";

type RecordMovementInput = {
  variantId?: string;
  locationId?: string;
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
  locationId?: string;
  from?: string;
  to?: string;
  type?: InventoryMovementType;
};

type ListOnHandFilters = {
  q?: string;
  locationId?: string;
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
  locationId?: string;
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
  locationId: string;
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
  locationId: movement.locationId,
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
  const requestedLocationId = normalizeOptionalText(input.locationId);

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
    const location = requestedLocationId
      ? await tx.location.findUnique({ where: { id: requestedLocationId } })
      : await ensureDefaultLocationTx(tx);
    if (!location) {
      throw new HttpError(404, "Location not found", "LOCATION_NOT_FOUND");
    }

    const referenceType = normalizeOptionalText(input.referenceType) ?? null;
    const referenceId = normalizeOptionalText(input.referenceId) ?? null;
    const note = normalizeOptionalText(input.note) ?? null;
    const createdByStaffId = normalizeOptionalText(input.createdByStaffId) ?? null;

    return tx.inventoryMovement.create({
      data: {
        variantId,
        locationId: location.id,
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
  const locationId = normalizeOptionalText(input.locationId);
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
    ...(locationId ? { locationId } : {}),
    type: "ADJUSTMENT",
    quantity: input.quantityDelta,
    referenceType: "ADJUSTMENT",
    referenceId: input.reason,
    note: normalizeOptionalText(input.note) ?? undefined,
    createdByStaffId: normalizeOptionalText(input.createdByStaffId),
  });

  const onHand = await getOnHand(variantId, locationId);

  return {
    movement: {
      ...movement,
      reason: input.reason,
    },
    onHand: onHand.onHand,
  };
};

export const getOnHand = async (variantId?: string, locationId?: string) => {
  const normalizedVariantId = normalizeOptionalText(variantId);
  if (!normalizedVariantId) {
    throw new HttpError(400, "variantId is required", "INVALID_VARIANT_ID");
  }
  const requestedLocationId = normalizeOptionalText(locationId);

  const onHandResult = await prisma.$transaction(async (tx) => {
    await ensureVariantExistsById(tx, normalizedVariantId);
    const location = requestedLocationId
      ? await tx.location.findUnique({ where: { id: requestedLocationId } })
      : await ensureDefaultLocationTx(tx);
    if (!location) {
      throw new HttpError(404, "Location not found", "LOCATION_NOT_FOUND");
    }

    const aggregate = await tx.inventoryMovement.aggregate({
      where: {
        variantId: normalizedVariantId,
        locationId: location.id,
      },
      _sum: {
        quantity: true,
      },
    });

    return {
      location,
      aggregate,
    };
  });

  return {
    variantId: normalizedVariantId,
    locationId: onHandResult.location.id,
    onHand: onHandResult.aggregate._sum.quantity ?? 0,
  };
};

export const listMovements = async (filters: ListMovementFilters) => {
  const variantId = normalizeOptionalText(filters.variantId);
  const requestedLocationId = normalizeOptionalText(filters.locationId);
  if (!variantId) {
    throw new HttpError(400, "variantId is required", "INVALID_VARIANT_ID");
  }

  const from = filters.from ? parseFromDate(filters.from) : undefined;
  const to = filters.to ? parseToDate(filters.to) : undefined;

  if (from && to && from > to) {
    throw new HttpError(
      400,
      "from must be before or equal to to",
      "INVALID_MOVEMENT_DATE_RANGE",
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    await ensureVariantExistsById(tx, variantId);
    const location = requestedLocationId
      ? await tx.location.findUnique({ where: { id: requestedLocationId } })
      : await ensureDefaultLocationTx(tx);
    if (!location) {
      throw new HttpError(404, "Location not found", "LOCATION_NOT_FOUND");
    }

    const movements = await tx.inventoryMovement.findMany({
      where: {
        variantId,
        locationId: location.id,
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
      locationId: location.id,
      movements,
    };
  });

  return {
    variantId,
    locationId: result.locationId,
    movements: result.movements.map((movement) => toMovementResponse(movement)),
  };
};

export const listOnHand = async (filters: ListOnHandFilters = {}) => {
  const requestedLocationId = normalizeOptionalText(filters.locationId);
  const normalizedQuery = normalizeOptionalText(filters.q);
  const take = parseTake(filters.take);
  const skip = parseSkip(filters.skip);

  return prisma.$transaction(async (tx) => {
    const location = requestedLocationId
      ? await tx.location.findUnique({ where: { id: requestedLocationId } })
      : await ensureDefaultLocationTx(tx);
    if (!location) {
      throw new HttpError(404, "Location not found", "LOCATION_NOT_FOUND");
    }

    const variants = await tx.variant.findMany({
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
        ? await tx.inventoryMovement.groupBy({
            by: ["variantId"],
            where: {
              locationId: location.id,
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

    return {
      locationId: location.id,
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
      })),
    };
  });
};
