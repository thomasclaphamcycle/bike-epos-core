import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { ensureVariantExistsById } from "./productService";
import { getReservedQuantityForVariantTx } from "./stockReservationService";

type CreateStockAdjustmentInput = {
  variantId?: string;
  locationId?: string;
  quantityDelta?: number;
  note?: string;
  referenceType?: string;
  referenceId?: string;
  createdByStaffId?: string;
};

const normalizeOptionalText = (value: string | undefined | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const getOrCreateDefaultLocationTx = async (tx: Prisma.TransactionClient) => {
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

const resolveLocationTx = async (
  tx: Prisma.TransactionClient,
  locationId?: string,
) => {
  const normalizedLocationId = normalizeOptionalText(locationId);
  if (!normalizedLocationId) {
    return getOrCreateDefaultLocationTx(tx);
  }

  if (!isUuid(normalizedLocationId)) {
    throw new HttpError(400, "Invalid location id", "INVALID_LOCATION_ID");
  }

  const location = await tx.stockLocation.findUnique({
    where: { id: normalizedLocationId },
  });

  if (!location) {
    throw new HttpError(404, "Stock location not found", "LOCATION_NOT_FOUND");
  }

  return location;
};

const getLocationOnHandTx = async (
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

const getTotalOnHandTx = async (tx: Prisma.TransactionClient, variantId: string) => {
  const aggregate = await tx.stockLedgerEntry.aggregate({
    where: { variantId },
    _sum: { quantityDelta: true },
  });

  return aggregate._sum.quantityDelta ?? 0;
};

export const getStockForVariant = async (variantId: string, locationId?: string) => {
  const normalizedVariantId = normalizeOptionalText(variantId);
  if (!normalizedVariantId) {
    throw new HttpError(400, "Invalid variant id", "INVALID_VARIANT_ID");
  }

  await ensureVariantExistsById(prisma, normalizedVariantId);

  const normalizedLocationId = normalizeOptionalText(locationId);
  if (normalizedLocationId && !isUuid(normalizedLocationId)) {
    throw new HttpError(400, "Invalid location id", "INVALID_LOCATION_ID");
  }

  if (normalizedLocationId) {
    const location = await prisma.stockLocation.findUnique({
      where: { id: normalizedLocationId },
    });

    if (!location) {
      throw new HttpError(404, "Stock location not found", "LOCATION_NOT_FOUND");
    }

    const onHand = await getLocationOnHandTx(prisma, normalizedVariantId, normalizedLocationId);
    const reservedQty = await getReservedQuantityForVariantTx(prisma, normalizedVariantId);

    return {
      variantId: normalizedVariantId,
      onHand,
      reservedQty,
      availableQty: onHand - reservedQty,
      locations: [
        {
          id: location.id,
          name: location.name,
          isDefault: location.isDefault,
          onHand,
        },
      ],
    };
  }

  const grouped = await prisma.stockLedgerEntry.groupBy({
    by: ["locationId"],
    where: {
      variantId: normalizedVariantId,
    },
    _sum: {
      quantityDelta: true,
    },
  });

  const locationIds = grouped.map((row) => row.locationId);
  const locations =
    locationIds.length > 0
      ? await prisma.stockLocation.findMany({
          where: {
            id: {
              in: locationIds,
            },
          },
        })
      : [];

  const locationById = new Map(locations.map((location) => [location.id, location]));

  const locationsResponse = grouped.map((row) => {
    const location = locationById.get(row.locationId);
    return {
      id: row.locationId,
      name: location?.name ?? "Unknown",
      isDefault: location?.isDefault ?? false,
      onHand: row._sum.quantityDelta ?? 0,
    };
  });

  const totalOnHand = locationsResponse.reduce((sum, row) => sum + row.onHand, 0);
  const reservedQty = await getReservedQuantityForVariantTx(prisma, normalizedVariantId);

  return {
    variantId: normalizedVariantId,
    onHand: totalOnHand,
    reservedQty,
    availableQty: totalOnHand - reservedQty,
    locations: locationsResponse,
  };
};

export const createStockAdjustment = async (input: CreateStockAdjustmentInput) => {
  const variantId = normalizeOptionalText(input.variantId);
  if (!variantId) {
    throw new HttpError(400, "variantId is required", "INVALID_STOCK_ADJUSTMENT");
  }

  if (!Number.isInteger(input.quantityDelta) || (input.quantityDelta ?? 0) === 0) {
    throw new HttpError(
      400,
      "quantityDelta must be a non-zero integer",
      "INVALID_STOCK_ADJUSTMENT",
    );
  }

  const note = normalizeOptionalText(input.note);
  const referenceType = normalizeOptionalText(input.referenceType) ?? "STOCK_ADJUSTMENT";
  const referenceId = normalizeOptionalText(input.referenceId) ?? randomUUID();
  const createdByStaffId = normalizeOptionalText(input.createdByStaffId);

  return prisma.$transaction(async (tx) => {
    await ensureVariantExistsById(tx, variantId);

    if (createdByStaffId) {
      const staff = await tx.user.findUnique({ where: { id: createdByStaffId } });
      if (!staff) {
        throw new HttpError(404, "Staff member not found", "STAFF_NOT_FOUND");
      }
    }

    const location = await resolveLocationTx(tx, input.locationId);

    const entry = await tx.stockLedgerEntry.create({
      data: {
        variantId,
        locationId: location.id,
        type: "ADJUSTMENT",
        quantityDelta: input.quantityDelta,
        referenceType,
        referenceId,
        note,
        createdByStaffId,
      },
      include: {
        location: true,
      },
    });

    await tx.inventoryMovement.create({
      data: {
        variantId,
        type: "ADJUSTMENT",
        quantity: input.quantityDelta,
        referenceType,
        referenceId,
        note: note ?? null,
        createdByStaffId: createdByStaffId ?? null,
      },
    });

    const onHandAtLocation = await getLocationOnHandTx(tx, variantId, location.id);
    const totalOnHand = await getTotalOnHandTx(tx, variantId);

    return {
      entry: {
        id: entry.id,
        variantId: entry.variantId,
        locationId: entry.locationId,
        locationName: entry.location.name,
        type: entry.type,
        quantityDelta: entry.quantityDelta,
        referenceType: entry.referenceType,
        referenceId: entry.referenceId,
        note: entry.note,
        createdByStaffId: entry.createdByStaffId,
        createdAt: entry.createdAt,
      },
      stock: {
        variantId,
        locationId: location.id,
        onHandAtLocation,
        totalOnHand,
      },
    };
  });
};
