import { InventoryMovementType, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";
import { ensureVariantExistsById } from "./productService";

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

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const normalizeOptionalText = (value: string | undefined | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

  return {
    variantId: normalizedVariantId,
    onHand: aggregate._sum.quantity ?? 0,
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
