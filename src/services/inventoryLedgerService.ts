import { InventoryMovementType, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { createAuditEventTx } from "./auditService";
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
  allowNegativeStock?: boolean;
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
  allowNegativeStock?: boolean;
};

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const normalizeOptionalText = (value: string | undefined | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const getOrCreateDefaultStockLocationTx = async (tx: Prisma.TransactionClient) => {
  const existingDefault = await tx.stockLocation.findFirst({
    where: { isDefault: true },
    orderBy: { createdAt: "asc" },
  });

  if (existingDefault) {
    return existingDefault;
  }

  return tx.stockLocation.create({
    data: {
      name: "Default",
      isDefault: true,
    },
  });
};

const ensureStockLocationExistsTx = async (
  tx: Prisma.TransactionClient,
  locationId: string,
) => {
  if (!isUuid(locationId)) {
    throw new HttpError(400, "locationId must be a valid UUID", "INVALID_LOCATION_ID");
  }

  const location = await tx.stockLocation.findUnique({
    where: { id: locationId },
    select: {
      id: true,
      name: true,
      isDefault: true,
    },
  });

  if (!location) {
    throw new HttpError(404, "Stock location not found", "LOCATION_NOT_FOUND");
  }

  return location;
};

const ensureStockLocationExists = async (locationId: string) => {
  if (!isUuid(locationId)) {
    throw new HttpError(400, "locationId must be a valid UUID", "INVALID_LOCATION_ID");
  }

  const location = await prisma.stockLocation.findUnique({
    where: { id: locationId },
    select: {
      id: true,
      name: true,
      isDefault: true,
    },
  });

  if (!location) {
    throw new HttpError(404, "Stock location not found", "LOCATION_NOT_FOUND");
  }

  return location;
};

const resolveStockLocationTx = async (
  tx: Prisma.TransactionClient,
  locationId?: string,
) => {
  const normalizedLocationId = normalizeOptionalText(locationId);
  if (!normalizedLocationId) {
    return getOrCreateDefaultStockLocationTx(tx);
  }

  return ensureStockLocationExistsTx(tx, normalizedLocationId);
};

const toStockLedgerEntryType = (type: InventoryMovementType) => {
  switch (type) {
    case "PURCHASE":
      return "PURCHASE" as const;
    case "SALE":
      return "SALE" as const;
    case "ADJUSTMENT":
      return "ADJUSTMENT" as const;
    case "WORKSHOP_USE":
      return "WORKSHOP" as const;
    case "RETURN":
      return "RETURN" as const;
    case "TRANSFER":
      return "TRANSFER" as const;
    default: {
      const exhaustiveCheck: never = type;
      return exhaustiveCheck;
    }
  }
};

const toStockLedgerUnitCostPence = (
  value: Prisma.Decimal | null | undefined,
) => {
  if (value === undefined || value === null) {
    return null;
  }

  if (value.decimalPlaces() > 0) {
    return null;
  }

  return value.toNumber();
};

const resolveLedgerCreatedByStaffIdTx = async (
  tx: Prisma.TransactionClient,
  createdByStaffId: string | null,
) => {
  if (!createdByStaffId) {
    return null;
  }

  const staff = await tx.user.findUnique({
    where: { id: createdByStaffId },
    select: { id: true },
  });

  return staff?.id ?? null;
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
  locationId: string | null;
  type: InventoryMovementType;
  quantity: number;
  unitCost: Prisma.Decimal | null;
  referenceType: string | null;
  referenceId: string | null;
  note: string | null;
  createdByStaffId: string | null;
  createdAt: Date;
  location?: {
    id: string;
    name: string;
    isDefault: boolean;
  } | null;
}) => ({
  id: movement.id,
  variantId: movement.variantId,
  locationId: movement.locationId,
  locationName: movement.location?.name ?? null,
  locationIsDefault: movement.location?.isDefault ?? null,
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

const getOnHandAtLocationTx = async (
  tx: Prisma.TransactionClient,
  variantId: string,
  locationId: string,
) => {
  const aggregate = await tx.stockLedgerEntry.aggregate({
    where: {
      variantId,
      locationId,
    },
    _sum: {
      quantityDelta: true,
    },
  });

  return aggregate._sum.quantityDelta ?? 0;
};

const getTotalOnHandTx = async (
  tx: Prisma.TransactionClient,
  variantId: string,
) => {
  const aggregate = await tx.stockLedgerEntry.aggregate({
    where: {
      variantId,
    },
    _sum: {
      quantityDelta: true,
    },
  });

  return aggregate._sum.quantityDelta ?? 0;
};

export const assertNonNegativeProjectedStockTx = async (
  tx: Prisma.TransactionClient,
  input: {
    variantId: string;
    locationId: string;
    quantityDelta: number;
    allowNegativeStock?: boolean;
    message?: string;
    code?: string;
  },
) => {
  if (input.allowNegativeStock || input.quantityDelta >= 0) {
    return;
  }

  const onHandAtLocation = await getOnHandAtLocationTx(
    tx,
    input.variantId,
    input.locationId,
  );
  const projectedOnHand = onHandAtLocation + input.quantityDelta;

  if (projectedOnHand < 0) {
    throw new HttpError(
      409,
      input.message ?? "Inventory movement would reduce stock below zero",
      input.code ?? "NEGATIVE_STOCK_NOT_ALLOWED",
    );
  }
};

const recordMovementTx = async (
  tx: Prisma.TransactionClient,
  input: {
    variantId: string;
    locationId?: string;
    type: InventoryMovementType;
    quantity: number;
    unitCost?: string | number | null;
    referenceType?: string;
    referenceId?: string;
    note?: string;
    createdByStaffId?: string;
    allowNegativeStock?: boolean;
  },
) => {
  await ensureVariantExistsById(tx, input.variantId);

  const referenceType = normalizeOptionalText(input.referenceType) ?? null;
  const referenceId = normalizeOptionalText(input.referenceId) ?? null;
  const note = normalizeOptionalText(input.note) ?? null;
  const createdByStaffId = normalizeOptionalText(input.createdByStaffId) ?? null;
  const unitCost = parseUnitCost(input.unitCost);
  const location = await resolveStockLocationTx(tx, input.locationId);

  await assertNonNegativeProjectedStockTx(tx, {
    variantId: input.variantId,
    locationId: location.id,
    quantityDelta: input.quantity,
    allowNegativeStock: input.allowNegativeStock,
  });

  const movement = await tx.inventoryMovement.create({
    data: {
      variantId: input.variantId,
      locationId: location.id,
      type: input.type,
      quantity: input.quantity,
      unitCost: unitCost === undefined ? null : unitCost,
      referenceType,
      referenceId,
      note,
      createdByStaffId,
    },
    include: {
      location: {
        select: {
          id: true,
          name: true,
          isDefault: true,
        },
      },
    },
  });

  const ledgerCreatedByStaffId = await resolveLedgerCreatedByStaffIdTx(tx, createdByStaffId);

  await tx.stockLedgerEntry.create({
    data: {
      variantId: input.variantId,
      locationId: location.id,
      type: toStockLedgerEntryType(input.type),
      quantityDelta: input.quantity,
      unitCostPence: toStockLedgerUnitCostPence(unitCost),
      referenceType: referenceType ?? "INVENTORY_MOVEMENT",
      referenceId: referenceId ?? movement.id,
      note,
      createdByStaffId: ledgerCreatedByStaffId,
    },
  });

  return movement;
};

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

  const movement = await prisma.$transaction((tx) =>
    recordMovementTx(tx, {
      variantId,
      locationId: input.locationId,
      type: input.type,
      quantity: input.quantity,
      unitCost: input.unitCost,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      note: input.note,
      createdByStaffId: input.createdByStaffId,
      allowNegativeStock: input.allowNegativeStock,
    }),
  );

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

  const createdByStaffId = normalizeOptionalText(input.createdByStaffId);

  const result = await prisma.$transaction(async (tx) => {
    const movement = await recordMovementTx(tx, {
      variantId,
      locationId: normalizeOptionalText(input.locationId),
      type: "ADJUSTMENT",
      quantity: input.quantityDelta,
      referenceType: "ADJUSTMENT",
      referenceId: input.reason,
      note: normalizeOptionalText(input.note) ?? undefined,
      createdByStaffId,
      allowNegativeStock: input.allowNegativeStock,
    });

    await createAuditEventTx(
      tx,
      {
        action: "INVENTORY_ADJUSTMENT_RECORDED",
        entityType: "INVENTORY_MOVEMENT",
        entityId: movement.id,
        metadata: {
          variantId,
          locationId: movement.locationId,
          quantityDelta: movement.quantity,
          reason: input.reason,
          referenceType: movement.referenceType,
          referenceId: movement.referenceId,
          note: movement.note,
        },
      },
      createdByStaffId ? { actorId: createdByStaffId } : undefined,
    );

    return {
      movement: toMovementResponse(movement),
      onHand: await getTotalOnHandTx(tx, variantId),
    };
  });

  return {
    movement: {
      ...result.movement,
      reason: input.reason,
    },
    onHand: result.onHand,
  };
};

export const getOnHand = async (variantId?: string, locationId?: string) => {
  const normalizedVariantId = normalizeOptionalText(variantId);
  if (!normalizedVariantId) {
    throw new HttpError(400, "variantId is required", "INVALID_VARIANT_ID");
  }

  await ensureVariantExistsById(prisma, normalizedVariantId);
  const normalizedLocationId = normalizeOptionalText(locationId);
  if (normalizedLocationId) {
    await ensureStockLocationExists(normalizedLocationId);
  }

  const aggregate = await prisma.stockLedgerEntry.aggregate({
    where: {
      variantId: normalizedVariantId,
      ...(normalizedLocationId ? { locationId: normalizedLocationId } : {}),
    },
    _sum: {
      quantityDelta: true,
    },
  });

  return {
    variantId: normalizedVariantId,
    locationId: normalizedLocationId ?? null,
    onHand: aggregate._sum.quantityDelta ?? 0,
  };
};

export const listMovements = async (filters: ListMovementFilters) => {
  const variantId = normalizeOptionalText(filters.variantId);
  if (!variantId) {
    throw new HttpError(400, "variantId is required", "INVALID_VARIANT_ID");
  }

  await ensureVariantExistsById(prisma, variantId);
  const normalizedLocationId = normalizeOptionalText(filters.locationId);
  if (normalizedLocationId) {
    await ensureStockLocationExists(normalizedLocationId);
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

  const movements = await prisma.inventoryMovement.findMany({
    where: {
      variantId,
      ...(normalizedLocationId ? { locationId: normalizedLocationId } : {}),
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
    include: {
      location: {
        select: {
          id: true,
          name: true,
          isDefault: true,
        },
      },
    },
  });

  return {
    variantId,
    locationId: normalizedLocationId ?? null,
    movements: movements.map((movement) => toMovementResponse(movement)),
  };
};

export const listOnHand = async (filters: ListOnHandFilters = {}) => {
  const normalizedQuery = normalizeOptionalText(filters.q);
  const normalizedLocationId = normalizeOptionalText(filters.locationId);
  const take = parseTake(filters.take);
  const skip = parseSkip(filters.skip);
  if (normalizedLocationId) {
    await ensureStockLocationExists(normalizedLocationId);
  }

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
      ? await prisma.stockLedgerEntry.groupBy({
          by: ["variantId"],
          where: {
            variantId: {
              in: variantIds,
            },
            ...(normalizedLocationId ? { locationId: normalizedLocationId } : {}),
          },
          _sum: {
            quantityDelta: true,
          },
        })
      : [];

  const onHandByVariant = new Map(
    grouped.map((row) => [row.variantId, row._sum.quantityDelta ?? 0]),
  );

  return {
    locationId: normalizedLocationId ?? null,
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
};
