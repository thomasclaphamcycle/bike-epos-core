import { Prisma, StocktakeStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { ensureDefaultLocationTx } from "./locationService";

type CreateStocktakeInput = {
  locationId?: string;
  notes?: string;
};

type UpsertStocktakeLineInput = {
  variantId?: string;
  countedQty?: number;
};

type ListStocktakeFilters = {
  locationId?: string;
  status?: StocktakeStatus;
  take?: number;
  skip?: number;
};

type StocktakeWithLines = {
  id: string;
  locationId: string;
  status: StocktakeStatus;
  startedAt: Date;
  postedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  location: {
    id: string;
    name: string;
    isDefault: boolean;
  };
  lines: Array<{
    id: string;
    stocktakeId: string;
    variantId: string;
    countedQty: number;
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
};

const normalizeOptionalText = (value: string | undefined | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseTake = (value: number | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 1 || value > 200) {
    throw new HttpError(400, "take must be an integer between 1 and 200", "INVALID_STOCKTAKE_QUERY");
  }
  return value;
};

const parseSkip = (value: number | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new HttpError(400, "skip must be an integer >= 0", "INVALID_STOCKTAKE_QUERY");
  }
  return value;
};

const assertUuidOrThrow = (value: string, message: string, code: string) => {
  if (!isUuid(value)) {
    throw new HttpError(400, message, code);
  }
};

const ensureLocationExistsTx = async (
  tx: Prisma.TransactionClient | typeof prisma,
  locationId: string,
) => {
  const location = await tx.stockLocation.findUnique({
    where: { id: locationId },
  });

  if (!location) {
    throw new HttpError(404, "Stock location not found", "LOCATION_NOT_FOUND");
  }

  return location;
};

const ensureVariantExistsTx = async (
  tx: Prisma.TransactionClient,
  variantId: string,
) => {
  const variant = await tx.variant.findUnique({ where: { id: variantId } });
  if (!variant) {
    throw new HttpError(404, "Variant not found", "VARIANT_NOT_FOUND");
  }
  return variant;
};

const ensureStocktakeOpen = (status: StocktakeStatus) => {
  if (status !== "OPEN") {
    throw new HttpError(409, "Stocktake is not open", "STOCKTAKE_NOT_OPEN");
  }
};

const getStocktakeWithLinesOrThrow = async (
  tx: Prisma.TransactionClient | typeof prisma,
  stocktakeId: string,
): Promise<StocktakeWithLines> => {
  const stocktake = await tx.stocktake.findUnique({
    where: {
      id: stocktakeId,
    },
    include: {
      location: {
        select: {
          id: true,
          name: true,
          isDefault: true,
        },
      },
      lines: {
        orderBy: [{ createdAt: "asc" }],
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

  if (!stocktake) {
    throw new HttpError(404, "Stocktake not found", "STOCKTAKE_NOT_FOUND");
  }

  return stocktake;
};

const buildOnHandPreviewMapTx = async (
  tx: Prisma.TransactionClient | typeof prisma,
  locationId: string,
  variantIds: string[],
) => {
  if (variantIds.length === 0) {
    return new Map<string, number>();
  }

  const grouped = await tx.stockLedgerEntry.groupBy({
    by: ["variantId"],
    where: {
      locationId,
      variantId: {
        in: variantIds,
      },
    },
    _sum: {
      quantityDelta: true,
    },
  });

  return new Map<string, number>(
    grouped.map((row) => [row.variantId, row._sum.quantityDelta ?? 0]),
  );
};

const toStocktakeResponseTx = async (
  tx: Prisma.TransactionClient | typeof prisma,
  stocktake: StocktakeWithLines,
  includePreview: boolean,
) => {
  const variantIds = stocktake.lines.map((line) => line.variantId);
  const onHandByVariant = includePreview
    ? await buildOnHandPreviewMapTx(tx, stocktake.locationId, variantIds)
    : new Map<string, number>();

  const lines = stocktake.lines.map((line) => {
    const currentOnHand = onHandByVariant.get(line.variantId) ?? 0;
    const deltaNeeded = line.countedQty - currentOnHand;

    return {
      id: line.id,
      stocktakeId: line.stocktakeId,
      variantId: line.variantId,
      sku: line.variant.sku,
      variantName: line.variant.name,
      productId: line.variant.product.id,
      productName: line.variant.product.name,
      countedQty: line.countedQty,
      currentOnHand: includePreview ? currentOnHand : undefined,
      deltaNeeded: includePreview ? deltaNeeded : undefined,
      createdAt: line.createdAt,
      updatedAt: line.updatedAt,
    };
  });

  return {
    id: stocktake.id,
    locationId: stocktake.locationId,
    location: {
      id: stocktake.location.id,
      name: stocktake.location.name,
      isDefault: stocktake.location.isDefault,
    },
    status: stocktake.status,
    startedAt: stocktake.startedAt,
    postedAt: stocktake.postedAt,
    notes: stocktake.notes,
    createdAt: stocktake.createdAt,
    updatedAt: stocktake.updatedAt,
    lines,
  };
};

export const createStocktake = async (input: CreateStocktakeInput) => {
  const locationId = normalizeOptionalText(input.locationId);
  if (!locationId) {
    throw new HttpError(400, "locationId is required", "INVALID_LOCATION_ID");
  }
  assertUuidOrThrow(locationId, "Invalid location id", "INVALID_LOCATION_ID");

  return prisma.$transaction(async (tx) => {
    await ensureLocationExistsTx(tx, locationId);

    const stocktake = await tx.stocktake.create({
      data: {
        locationId,
        notes: normalizeOptionalText(input.notes),
      },
      include: {
        location: {
          select: {
            id: true,
            name: true,
            isDefault: true,
          },
        },
        lines: {
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

    return toStocktakeResponseTx(tx, stocktake, true);
  });
};

export const listStocktakes = async (filters: ListStocktakeFilters = {}) => {
  const locationId = normalizeOptionalText(filters.locationId);
  if (locationId) {
    assertUuidOrThrow(locationId, "Invalid location id", "INVALID_LOCATION_ID");
    await ensureLocationExistsTx(prisma, locationId);
  }

  const take = parseTake(filters.take);
  const skip = parseSkip(filters.skip);

  const stocktakes = await prisma.stocktake.findMany({
    where: {
      ...(locationId ? { locationId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    },
    orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
    ...(take !== undefined ? { take } : {}),
    ...(skip !== undefined ? { skip } : {}),
    include: {
      location: {
        select: {
          id: true,
          name: true,
          isDefault: true,
        },
      },
      _count: {
        select: {
          lines: true,
        },
      },
    },
  });

  return {
    stocktakes: stocktakes.map((stocktake) => ({
      id: stocktake.id,
      locationId: stocktake.locationId,
      location: stocktake.location,
      status: stocktake.status,
      startedAt: stocktake.startedAt,
      postedAt: stocktake.postedAt,
      notes: stocktake.notes,
      createdAt: stocktake.createdAt,
      updatedAt: stocktake.updatedAt,
      lineCount: stocktake._count.lines,
    })),
  };
};

export const getStocktakeById = async (stocktakeId: string, includePreview = true) => {
  assertUuidOrThrow(stocktakeId, "Invalid stocktake id", "INVALID_STOCKTAKE_ID");

  const stocktake = await getStocktakeWithLinesOrThrow(prisma, stocktakeId);
  return toStocktakeResponseTx(prisma, stocktake, includePreview);
};

export const upsertStocktakeLine = async (
  stocktakeId: string,
  input: UpsertStocktakeLineInput,
) => {
  assertUuidOrThrow(stocktakeId, "Invalid stocktake id", "INVALID_STOCKTAKE_ID");

  const variantId = normalizeOptionalText(input.variantId);
  if (!variantId) {
    throw new HttpError(400, "variantId is required", "INVALID_VARIANT_ID");
  }

  if (!Number.isInteger(input.countedQty) || (input.countedQty ?? -1) < 0) {
    throw new HttpError(400, "countedQty must be a non-negative integer", "INVALID_COUNTED_QTY");
  }

  return prisma.$transaction(async (tx) => {
    const stocktake = await tx.stocktake.findUnique({
      where: { id: stocktakeId },
      select: {
        id: true,
        status: true,
      },
    });

    if (!stocktake) {
      throw new HttpError(404, "Stocktake not found", "STOCKTAKE_NOT_FOUND");
    }

    ensureStocktakeOpen(stocktake.status);
    await ensureVariantExistsTx(tx, variantId);

    await tx.stocktakeLine.upsert({
      where: {
        stocktakeId_variantId: {
          stocktakeId,
          variantId,
        },
      },
      create: {
        stocktakeId,
        variantId,
        countedQty: input.countedQty,
      },
      update: {
        countedQty: input.countedQty,
      },
    });

    const reloaded = await getStocktakeWithLinesOrThrow(tx, stocktakeId);
    return toStocktakeResponseTx(tx, reloaded, true);
  });
};

export const deleteStocktakeLine = async (stocktakeId: string, lineId: string) => {
  assertUuidOrThrow(stocktakeId, "Invalid stocktake id", "INVALID_STOCKTAKE_ID");
  assertUuidOrThrow(lineId, "Invalid stocktake line id", "INVALID_STOCKTAKE_LINE_ID");

  return prisma.$transaction(async (tx) => {
    const stocktake = await tx.stocktake.findUnique({
      where: { id: stocktakeId },
      select: {
        id: true,
        status: true,
      },
    });

    if (!stocktake) {
      throw new HttpError(404, "Stocktake not found", "STOCKTAKE_NOT_FOUND");
    }

    ensureStocktakeOpen(stocktake.status);

    const line = await tx.stocktakeLine.findUnique({
      where: { id: lineId },
      select: {
        id: true,
        stocktakeId: true,
      },
    });

    if (!line || line.stocktakeId !== stocktakeId) {
      throw new HttpError(404, "Stocktake line not found", "STOCKTAKE_LINE_NOT_FOUND");
    }

    await tx.stocktakeLine.delete({
      where: { id: lineId },
    });

    const reloaded = await getStocktakeWithLinesOrThrow(tx, stocktakeId);
    return toStocktakeResponseTx(tx, reloaded, true);
  });
};

export const postStocktake = async (stocktakeId: string, createdByStaffId?: string) => {
  assertUuidOrThrow(stocktakeId, "Invalid stocktake id", "INVALID_STOCKTAKE_ID");
  const normalizedCreatedByStaffId = normalizeOptionalText(createdByStaffId);

  return prisma.$transaction(async (tx) => {
    const lockedRows = await tx.$queryRaw<Array<{ id: string; locationId: string; status: StocktakeStatus }>>`
      SELECT id, "locationId", status
      FROM "Stocktake"
      WHERE id = ${stocktakeId}
      FOR UPDATE
    `;

    if (lockedRows.length === 0) {
      throw new HttpError(404, "Stocktake not found", "STOCKTAKE_NOT_FOUND");
    }

    const locked = lockedRows[0];
    ensureStocktakeOpen(locked.status);

    if (normalizedCreatedByStaffId) {
      const staff = await tx.user.findUnique({ where: { id: normalizedCreatedByStaffId } });
      if (!staff) {
        throw new HttpError(404, "Staff member not found", "STAFF_NOT_FOUND");
      }
    }

    const lines = await tx.stocktakeLine.findMany({
      where: {
        stocktakeId,
      },
      select: {
        id: true,
        variantId: true,
        countedQty: true,
      },
    });

    const variantIds = lines.map((line) => line.variantId);
    const onHandByVariant = await buildOnHandPreviewMapTx(tx, locked.locationId, variantIds);
    const inventoryLocation = await ensureDefaultLocationTx(tx);

    for (const line of lines) {
      const currentOnHand = onHandByVariant.get(line.variantId) ?? 0;
      const deltaNeeded = line.countedQty - currentOnHand;

      if (deltaNeeded !== 0) {
        await tx.stockLedgerEntry.create({
          data: {
            variantId: line.variantId,
            locationId: locked.locationId,
            type: "ADJUSTMENT",
            quantityDelta: deltaNeeded,
            unitCostPence: null,
            referenceType: "STOCKTAKE_LINE",
            referenceId: line.id,
            note: `Stocktake ${stocktakeId}`,
            createdByStaffId: normalizedCreatedByStaffId,
          },
        });

        await tx.inventoryMovement.create({
          data: {
            variantId: line.variantId,
            locationId: inventoryLocation.id,
            type: "ADJUSTMENT",
            quantity: deltaNeeded,
            referenceType: "STOCKTAKE_LINE",
            referenceId: line.id,
            note: `Stocktake ${stocktakeId}`,
            createdByStaffId: normalizedCreatedByStaffId ?? null,
          },
        });
      }
    }

    await tx.stocktake.update({
      where: {
        id: stocktakeId,
      },
      data: {
        status: "POSTED",
        postedAt: new Date(),
      },
    });

    const reloaded = await getStocktakeWithLinesOrThrow(tx, stocktakeId);
    return toStocktakeResponseTx(tx, reloaded, true);
  });
};

export const cancelStocktake = async (stocktakeId: string) => {
  assertUuidOrThrow(stocktakeId, "Invalid stocktake id", "INVALID_STOCKTAKE_ID");

  return prisma.$transaction(async (tx) => {
    const stocktake = await tx.stocktake.findUnique({
      where: {
        id: stocktakeId,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!stocktake) {
      throw new HttpError(404, "Stocktake not found", "STOCKTAKE_NOT_FOUND");
    }

    ensureStocktakeOpen(stocktake.status);

    await tx.stocktake.update({
      where: {
        id: stocktakeId,
      },
      data: {
        status: "CANCELLED",
      },
    });

    const reloaded = await getStocktakeWithLinesOrThrow(tx, stocktakeId);
    return toStocktakeResponseTx(tx, reloaded, true);
  });
};
