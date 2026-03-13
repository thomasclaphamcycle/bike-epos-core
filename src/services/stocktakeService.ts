import { Prisma, StocktakeStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { createAuditEventTx, type AuditActor } from "./auditService";
import {
  createStockAdjustmentTx,
  emitStockAdjusted,
  type StockAdjustmentResult,
} from "./stockService";

type CreateStocktakeInput = {
  locationId?: string;
  notes?: string;
};

type UpsertStocktakeLineInput = {
  variantId?: string;
  countedQty?: number;
};

type ScanStocktakeLineInput = {
  code?: string;
  quantityDelta?: number;
};

type BulkStocktakeLinesInput = {
  lines?: Array<{
    code?: string;
    countedQty?: number;
  }>;
};

type ListStocktakeFilters = {
  locationId?: string;
  status?: StocktakeStatus;
  take?: number;
  skip?: number;
};

type StocktakeWorkflowState = "DRAFT" | "COUNTING" | "REVIEW" | "COMPLETED" | "CANCELLED";

type StocktakeWithLines = {
  id: string;
  locationId: string;
  status: StocktakeStatus;
  startedAt: Date;
  reviewRequestedAt: Date | null;
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
    expectedQtySnapshot: number | null;
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

const resolveVariantByCodeTx = async (
  tx: Prisma.TransactionClient,
  rawCode: string,
) => {
  const code = normalizeOptionalText(rawCode);
  if (!code) {
    throw new HttpError(400, "code is required", "INVALID_STOCKTAKE_SCAN");
  }

  const variant = await tx.variant.findFirst({
    where: {
      OR: [
        {
          sku: {
            equals: code,
            mode: "insensitive",
          },
        },
        {
          barcode: {
            equals: code,
            mode: "insensitive",
          },
        },
        {
          barcodes: {
            some: {
              code: {
                equals: code,
                mode: "insensitive",
              },
            },
          },
        },
      ],
    },
    select: {
      id: true,
      sku: true,
      name: true,
      product: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!variant) {
    throw new HttpError(404, "Variant not found for scanned code", "VARIANT_NOT_FOUND");
  }

  return variant;
};

const ensureStaffExistsTx = async (tx: Prisma.TransactionClient, staffId: string) => {
  const staff = await tx.user.findUnique({ where: { id: staffId } });
  if (!staff) {
    throw new HttpError(404, "Staff member not found", "STAFF_NOT_FOUND");
  }
  return staff;
};

const ensureStocktakeOpen = (status: StocktakeStatus) => {
  if (status !== "OPEN") {
    throw new HttpError(409, "Stocktake is not open", "STOCKTAKE_NOT_OPEN");
  }
};

const ensureStocktakeHasLines = (lineCount: number) => {
  if (lineCount <= 0) {
    throw new HttpError(
      400,
      "Stocktake must contain at least one counted line",
      "EMPTY_STOCKTAKE",
    );
  }
};

const toWorkflowState = (
  status: StocktakeStatus,
  reviewRequestedAt: Date | null,
  lineCount: number,
): StocktakeWorkflowState => {
  if (status === "CANCELLED") {
    return "CANCELLED";
  }
  if (status === "POSTED") {
    return "COMPLETED";
  }
  if (reviewRequestedAt) {
    return "REVIEW";
  }
  if (lineCount > 0) {
    return "COUNTING";
  }
  return "DRAFT";
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

const clearReviewRequestedAtTx = async (
  tx: Prisma.TransactionClient,
  stocktakeId: string,
  reviewRequestedAt: Date | null,
) => {
  if (!reviewRequestedAt) {
    return;
  }

  await tx.stocktake.update({
    where: { id: stocktakeId },
    data: {
      reviewRequestedAt: null,
    },
  });
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
    const expectedQty = line.expectedQtySnapshot ?? (includePreview ? currentOnHand : null);
    const varianceQty = expectedQty === null ? null : line.countedQty - expectedQty;
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
      expectedQty,
      varianceQty,
      currentOnHand: includePreview ? currentOnHand : undefined,
      deltaNeeded: includePreview ? deltaNeeded : undefined,
      hasLiveDrift:
        includePreview && expectedQty !== null ? currentOnHand !== expectedQty : undefined,
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
    workflowState: toWorkflowState(
      stocktake.status,
      stocktake.reviewRequestedAt,
      stocktake.lines.length,
    ),
    startedAt: stocktake.startedAt,
    reviewRequestedAt: stocktake.reviewRequestedAt,
    postedAt: stocktake.postedAt,
    notes: stocktake.notes,
    createdAt: stocktake.createdAt,
    updatedAt: stocktake.updatedAt,
    lineCount: stocktake.lines.length,
    lines,
  };
};

export const createStocktake = async (input: CreateStocktakeInput, auditActor?: AuditActor) => {
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

    await createAuditEventTx(
      tx,
      {
        action: "STOCKTAKE_CREATED",
        entityType: "STOCKTAKE",
        entityId: stocktake.id,
        metadata: {
          locationId,
          notes: stocktake.notes,
        },
      },
      auditActor,
    );

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
      workflowState: toWorkflowState(
        stocktake.status,
        stocktake.reviewRequestedAt,
        stocktake._count.lines,
      ),
      startedAt: stocktake.startedAt,
      reviewRequestedAt: stocktake.reviewRequestedAt,
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
  auditActor?: AuditActor,
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
        locationId: true,
        status: true,
        reviewRequestedAt: true,
      },
    });

    if (!stocktake) {
      throw new HttpError(404, "Stocktake not found", "STOCKTAKE_NOT_FOUND");
    }

    ensureStocktakeOpen(stocktake.status);
    await ensureVariantExistsTx(tx, variantId);

    const existingLine = await tx.stocktakeLine.findUnique({
      where: {
        stocktakeId_variantId: {
          stocktakeId,
          variantId,
        },
      },
      select: {
        id: true,
        countedQty: true,
        expectedQtySnapshot: true,
      },
    });

    const snapshotMap = await buildOnHandPreviewMapTx(tx, stocktake.locationId, [variantId]);
    const expectedQtySnapshot = existingLine?.expectedQtySnapshot ?? snapshotMap.get(variantId) ?? 0;

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
        expectedQtySnapshot,
        countedQty: input.countedQty,
      },
      update: {
        countedQty: input.countedQty,
        expectedQtySnapshot,
      },
    });

    await clearReviewRequestedAtTx(tx, stocktakeId, stocktake.reviewRequestedAt);

    await createAuditEventTx(
      tx,
      {
        action: existingLine ? "STOCKTAKE_LINE_UPDATED" : "STOCKTAKE_LINE_CREATED",
        entityType: "STOCKTAKE",
        entityId: stocktakeId,
        metadata: {
          variantId,
          previousCountedQty: existingLine?.countedQty ?? null,
          countedQty: input.countedQty,
          expectedQtySnapshot,
          reviewReset: Boolean(stocktake.reviewRequestedAt),
        },
      },
      auditActor,
    );

    const reloaded = await getStocktakeWithLinesOrThrow(tx, stocktakeId);
    return toStocktakeResponseTx(tx, reloaded, true);
  });
};

export const scanStocktakeLine = async (
  stocktakeId: string,
  input: ScanStocktakeLineInput,
  auditActor?: AuditActor,
) => {
  assertUuidOrThrow(stocktakeId, "Invalid stocktake id", "INVALID_STOCKTAKE_ID");

  const code = normalizeOptionalText(input.code);
  if (!code) {
    throw new HttpError(400, "code is required", "INVALID_STOCKTAKE_SCAN");
  }

  const quantityDelta = input.quantityDelta ?? 1;
  if (!Number.isInteger(quantityDelta) || quantityDelta <= 0) {
    throw new HttpError(
      400,
      "quantityDelta must be a positive integer",
      "INVALID_STOCKTAKE_SCAN",
    );
  }

  return prisma.$transaction(async (tx) => {
    const stocktake = await tx.stocktake.findUnique({
      where: { id: stocktakeId },
      select: {
        id: true,
        locationId: true,
        status: true,
        reviewRequestedAt: true,
      },
    });

    if (!stocktake) {
      throw new HttpError(404, "Stocktake not found", "STOCKTAKE_NOT_FOUND");
    }

    ensureStocktakeOpen(stocktake.status);

    const variant = await resolveVariantByCodeTx(tx, code);
    const existingLine = await tx.stocktakeLine.findUnique({
      where: {
        stocktakeId_variantId: {
          stocktakeId,
          variantId: variant.id,
        },
      },
      select: {
        id: true,
        countedQty: true,
        expectedQtySnapshot: true,
      },
    });

    const snapshotMap = await buildOnHandPreviewMapTx(tx, stocktake.locationId, [variant.id]);
    const expectedQtySnapshot = existingLine?.expectedQtySnapshot ?? snapshotMap.get(variant.id) ?? 0;
    const nextCountedQty = (existingLine?.countedQty ?? 0) + quantityDelta;

    await tx.stocktakeLine.upsert({
      where: {
        stocktakeId_variantId: {
          stocktakeId,
          variantId: variant.id,
        },
      },
      create: {
        stocktakeId,
        variantId: variant.id,
        expectedQtySnapshot,
        countedQty: nextCountedQty,
      },
      update: {
        countedQty: nextCountedQty,
        expectedQtySnapshot,
      },
    });

    await clearReviewRequestedAtTx(tx, stocktakeId, stocktake.reviewRequestedAt);

    await createAuditEventTx(
      tx,
      {
        action: "STOCKTAKE_LINE_SCANNED",
        entityType: "STOCKTAKE",
        entityId: stocktakeId,
        metadata: {
          code,
          variantId: variant.id,
          previousCountedQty: existingLine?.countedQty ?? 0,
          quantityDelta,
          countedQty: nextCountedQty,
          expectedQtySnapshot,
          reviewReset: Boolean(stocktake.reviewRequestedAt),
        },
      },
      auditActor,
    );

    const reloaded = await getStocktakeWithLinesOrThrow(tx, stocktakeId);
    return {
      stocktake: await toStocktakeResponseTx(tx, reloaded, true),
      scannedLine: {
        variantId: variant.id,
        sku: variant.sku,
        variantName: variant.name,
        productId: variant.product.id,
        productName: variant.product.name,
        countedQty: nextCountedQty,
        quantityDelta,
      },
    };
  });
};

export const bulkUpsertStocktakeLines = async (
  stocktakeId: string,
  input: BulkStocktakeLinesInput,
  auditActor?: AuditActor,
) => {
  assertUuidOrThrow(stocktakeId, "Invalid stocktake id", "INVALID_STOCKTAKE_ID");

  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new HttpError(400, "lines must be a non-empty array", "INVALID_STOCKTAKE_BULK_LINES");
  }

  const normalizedLines = input.lines.map((line) => {
    const code = normalizeOptionalText(line.code);
    if (!code) {
      throw new HttpError(400, "Each line requires a code", "INVALID_STOCKTAKE_BULK_LINES");
    }
    if (!Number.isInteger(line.countedQty) || (line.countedQty ?? -1) < 0) {
      throw new HttpError(
        400,
        "Each line countedQty must be a non-negative integer",
        "INVALID_STOCKTAKE_BULK_LINES",
      );
    }
    return {
      code,
      countedQty: line.countedQty,
    };
  });

  return prisma.$transaction(async (tx) => {
    const stocktake = await tx.stocktake.findUnique({
      where: { id: stocktakeId },
      select: {
        id: true,
        locationId: true,
        status: true,
        reviewRequestedAt: true,
      },
    });

    if (!stocktake) {
      throw new HttpError(404, "Stocktake not found", "STOCKTAKE_NOT_FOUND");
    }

    ensureStocktakeOpen(stocktake.status);

    const resolvedVariants = [];
    const seenVariantIds = new Set<string>();
    for (const line of normalizedLines) {
      const variant = await resolveVariantByCodeTx(tx, line.code);
      if (seenVariantIds.has(variant.id)) {
        throw new HttpError(
          409,
          "Each variant can only appear once per bulk import",
          "DUPLICATE_STOCKTAKE_VARIANT",
        );
      }
      seenVariantIds.add(variant.id);
      resolvedVariants.push({
        ...line,
        variant,
      });
    }

    const variantIds = resolvedVariants.map((line) => line.variant.id);
    const existingLines = await tx.stocktakeLine.findMany({
      where: {
        stocktakeId,
        variantId: {
          in: variantIds,
        },
      },
      select: {
        variantId: true,
        expectedQtySnapshot: true,
      },
    });
    const existingLineByVariantId = new Map(
      existingLines.map((line) => [line.variantId, line]),
    );
    const snapshotMap = await buildOnHandPreviewMapTx(tx, stocktake.locationId, variantIds);

    for (const line of resolvedVariants) {
      const existingLine = existingLineByVariantId.get(line.variant.id);
      const expectedQtySnapshot = existingLine?.expectedQtySnapshot ?? snapshotMap.get(line.variant.id) ?? 0;

      await tx.stocktakeLine.upsert({
        where: {
          stocktakeId_variantId: {
            stocktakeId,
            variantId: line.variant.id,
          },
        },
        create: {
          stocktakeId,
          variantId: line.variant.id,
          expectedQtySnapshot,
          countedQty: line.countedQty,
        },
        update: {
          countedQty: line.countedQty,
          expectedQtySnapshot,
        },
      });
    }

    await clearReviewRequestedAtTx(tx, stocktakeId, stocktake.reviewRequestedAt);

    await createAuditEventTx(
      tx,
      {
        action: "STOCKTAKE_LINES_BULK_UPSERTED",
        entityType: "STOCKTAKE",
        entityId: stocktakeId,
        metadata: {
          appliedCount: resolvedVariants.length,
          reviewReset: Boolean(stocktake.reviewRequestedAt),
          codes: resolvedVariants.map((line) => line.code),
        },
      },
      auditActor,
    );

    const reloaded = await getStocktakeWithLinesOrThrow(tx, stocktakeId);
    return {
      stocktake: await toStocktakeResponseTx(tx, reloaded, true),
      appliedCount: resolvedVariants.length,
    };
  });
};

export const deleteStocktakeLine = async (
  stocktakeId: string,
  lineId: string,
  auditActor?: AuditActor,
) => {
  assertUuidOrThrow(stocktakeId, "Invalid stocktake id", "INVALID_STOCKTAKE_ID");
  assertUuidOrThrow(lineId, "Invalid stocktake line id", "INVALID_STOCKTAKE_LINE_ID");

  return prisma.$transaction(async (tx) => {
    const stocktake = await tx.stocktake.findUnique({
      where: { id: stocktakeId },
      select: {
        id: true,
        status: true,
        reviewRequestedAt: true,
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
        variantId: true,
        countedQty: true,
        expectedQtySnapshot: true,
      },
    });

    if (!line || line.stocktakeId !== stocktakeId) {
      throw new HttpError(404, "Stocktake line not found", "STOCKTAKE_LINE_NOT_FOUND");
    }

    await tx.stocktakeLine.delete({
      where: { id: lineId },
    });

    await clearReviewRequestedAtTx(tx, stocktakeId, stocktake.reviewRequestedAt);

    await createAuditEventTx(
      tx,
      {
        action: "STOCKTAKE_LINE_DELETED",
        entityType: "STOCKTAKE",
        entityId: stocktakeId,
        metadata: {
          lineId,
          variantId: line.variantId,
          countedQty: line.countedQty,
          expectedQtySnapshot: line.expectedQtySnapshot,
          reviewReset: Boolean(stocktake.reviewRequestedAt),
        },
      },
      auditActor,
    );

    const reloaded = await getStocktakeWithLinesOrThrow(tx, stocktakeId);
    return toStocktakeResponseTx(tx, reloaded, true);
  });
};

export const requestStocktakeReview = async (
  stocktakeId: string,
  auditActor?: AuditActor,
) => {
  assertUuidOrThrow(stocktakeId, "Invalid stocktake id", "INVALID_STOCKTAKE_ID");

  return prisma.$transaction(async (tx) => {
    const stocktake = await tx.stocktake.findUnique({
      where: { id: stocktakeId },
      select: {
        id: true,
        status: true,
        reviewRequestedAt: true,
      },
    });

    if (!stocktake) {
      throw new HttpError(404, "Stocktake not found", "STOCKTAKE_NOT_FOUND");
    }

    ensureStocktakeOpen(stocktake.status);

    const lineCount = await tx.stocktakeLine.count({
      where: { stocktakeId },
    });
    ensureStocktakeHasLines(lineCount);

    if (!stocktake.reviewRequestedAt) {
      const reviewRequestedAt = new Date();

      await tx.stocktake.update({
        where: { id: stocktakeId },
        data: {
          reviewRequestedAt,
        },
      });

      await createAuditEventTx(
        tx,
        {
          action: "STOCKTAKE_REVIEW_REQUESTED",
          entityType: "STOCKTAKE",
          entityId: stocktakeId,
          metadata: {
            lineCount,
            reviewRequestedAt: reviewRequestedAt.toISOString(),
          },
        },
        auditActor,
      );
    }

    const reloaded = await getStocktakeWithLinesOrThrow(tx, stocktakeId);
    return toStocktakeResponseTx(tx, reloaded, true);
  });
};

export const postStocktake = async (stocktakeId: string, auditActor?: AuditActor) => {
  assertUuidOrThrow(stocktakeId, "Invalid stocktake id", "INVALID_STOCKTAKE_ID");
  const actorId = normalizeOptionalText(auditActor?.actorId);

  const result = await prisma.$transaction(async (tx) => {
    const lockedRows = await tx.$queryRaw<Array<{
      id: string;
      locationId: string;
      status: StocktakeStatus;
      reviewRequestedAt: Date | null;
    }>>`
      SELECT id, "locationId", status, "reviewRequestedAt"
      FROM "Stocktake"
      WHERE id = ${stocktakeId}
      FOR UPDATE
    `;

    if (lockedRows.length === 0) {
      throw new HttpError(404, "Stocktake not found", "STOCKTAKE_NOT_FOUND");
    }

    const locked = lockedRows[0];
    ensureStocktakeOpen(locked.status);

    if (actorId) {
      await ensureStaffExistsTx(tx, actorId);
    }

    const lines = await tx.stocktakeLine.findMany({
      where: {
        stocktakeId,
      },
      select: {
        id: true,
        variantId: true,
        expectedQtySnapshot: true,
        countedQty: true,
      },
    });

    ensureStocktakeHasLines(lines.length);

    const variantIds = lines.map((line) => line.variantId);
    const onHandByVariant = await buildOnHandPreviewMapTx(tx, locked.locationId, variantIds);
    const adjustments: StockAdjustmentResult[] = [];

    let varianceLineCount = 0;
    let adjustedLineCount = 0;

    for (const line of lines) {
      const currentOnHand = onHandByVariant.get(line.variantId) ?? 0;
      const expectedQty = line.expectedQtySnapshot ?? currentOnHand;
      const varianceQty = line.countedQty - expectedQty;
      if (varianceQty !== 0) {
        varianceLineCount += 1;
      }

      const deltaNeeded = line.countedQty - currentOnHand;
      if (deltaNeeded === 0) {
        continue;
      }

      const adjustment = await createStockAdjustmentTx(tx, {
        variantId: line.variantId,
        locationId: locked.locationId,
        quantityDelta: deltaNeeded,
        note: `Stocktake ${stocktakeId}`,
        referenceType: "STOCKTAKE_LINE",
        referenceId: line.id,
        createdByStaffId: actorId,
      });

      adjustments.push(adjustment);
      adjustedLineCount += 1;
    }

    const postedAt = new Date();
    await tx.stocktake.update({
      where: {
        id: stocktakeId,
      },
      data: {
        status: "POSTED",
        postedAt,
      },
    });

    await createAuditEventTx(
      tx,
      {
        action: "STOCKTAKE_FINALIZED",
        entityType: "STOCKTAKE",
        entityId: stocktakeId,
        metadata: {
          lineCount: lines.length,
          varianceLineCount,
          adjustedLineCount,
          reviewRequestedAt: locked.reviewRequestedAt?.toISOString() ?? null,
          postedAt: postedAt.toISOString(),
        },
      },
      auditActor,
    );

    const reloaded = await getStocktakeWithLinesOrThrow(tx, stocktakeId);
    return {
      stocktake: await toStocktakeResponseTx(tx, reloaded, true),
      adjustments,
    };
  });

  for (const adjustment of result.adjustments) {
    emitStockAdjusted(adjustment);
  }

  return result.stocktake;
};

export const cancelStocktake = async (stocktakeId: string, auditActor?: AuditActor) => {
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

    await createAuditEventTx(
      tx,
      {
        action: "STOCKTAKE_CANCELLED",
        entityType: "STOCKTAKE",
        entityId: stocktakeId,
      },
      auditActor,
    );

    const reloaded = await getStocktakeWithLinesOrThrow(tx, stocktakeId);
    return toStocktakeResponseTx(tx, reloaded, true);
  });
};
