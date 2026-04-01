import { Prisma, StockTransferStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { createAuditEventTx, type AuditActor } from "./auditService";
import { lockInventoryPositionsTx } from "./inventoryLedgerService";

type CreateStockTransferInput = {
  fromLocationId?: string;
  toLocationId?: string;
  notes?: string;
  lines?: Array<{
    variantId?: string;
    quantity?: number;
  }>;
};

type ListStockTransferFilters = {
  status?: StockTransferStatus;
  fromLocationId?: string;
  toLocationId?: string;
  take?: number;
  skip?: number;
};

const normalizeOptionalText = (value: string | undefined | null) => {
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
    throw new HttpError(400, "take must be an integer between 1 and 200", "INVALID_STOCK_TRANSFER_QUERY");
  }
  return take;
};

const parseSkip = (skip: number | undefined): number | undefined => {
  if (skip === undefined) {
    return undefined;
  }
  if (!Number.isInteger(skip) || skip < 0) {
    throw new HttpError(400, "skip must be an integer >= 0", "INVALID_STOCK_TRANSFER_QUERY");
  }
  return skip;
};

const assertUuidOrThrow = (
  value: string | undefined,
  message: string,
  code: string,
): string => {
  const normalized = normalizeOptionalText(value);
  if (!normalized || !isUuid(normalized)) {
    throw new HttpError(400, message, code);
  }
  return normalized;
};

const ensureLocationExistsTx = async (tx: Prisma.TransactionClient, locationId: string) => {
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

const ensureVariantExistsTx = async (tx: Prisma.TransactionClient, variantId: string) => {
  const variant = await tx.variant.findUnique({
    where: { id: variantId },
    select: {
      id: true,
      sku: true,
      barcode: true,
      name: true,
      option: true,
      product: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!variant) {
    throw new HttpError(404, "Variant not found", "VARIANT_NOT_FOUND");
  }

  return variant;
};

const mapTransfer = (transfer: {
  id: string;
  status: StockTransferStatus;
  notes: string | null;
  createdByStaffId: string | null;
  sentByStaffId: string | null;
  receivedByStaffId: string | null;
  sentAt: Date | null;
  receivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  fromLocation: {
    id: string;
    name: string;
    isDefault: boolean;
  };
  toLocation: {
    id: string;
    name: string;
    isDefault: boolean;
  };
  lines: Array<{
    id: string;
    quantity: number;
    variant: {
      id: string;
      sku: string;
      barcode: string | null;
      name: string | null;
      option: string | null;
      product: {
        id: string;
        name: string;
      };
    };
  }>;
}) => ({
  id: transfer.id,
  status: transfer.status,
  notes: transfer.notes,
  sentAt: transfer.sentAt,
  receivedAt: transfer.receivedAt,
  createdAt: transfer.createdAt,
  updatedAt: transfer.updatedAt,
  createdByStaffId: transfer.createdByStaffId,
  sentByStaffId: transfer.sentByStaffId,
  receivedByStaffId: transfer.receivedByStaffId,
  fromLocation: transfer.fromLocation,
  toLocation: transfer.toLocation,
  totals: {
    lineCount: transfer.lines.length,
    quantity: transfer.lines.reduce((sum, line) => sum + line.quantity, 0),
  },
  lines: transfer.lines.map((line) => ({
    id: line.id,
    variantId: line.variant.id,
    sku: line.variant.sku,
    barcode: line.variant.barcode,
    variantName: line.variant.name ?? line.variant.option ?? null,
    productId: line.variant.product.id,
    productName: line.variant.product.name,
    quantity: line.quantity,
  })),
});

const transferInclude = {
  fromLocation: {
    select: {
      id: true,
      name: true,
      isDefault: true,
    },
  },
  toLocation: {
    select: {
      id: true,
      name: true,
      isDefault: true,
    },
  },
  lines: {
    include: {
      variant: {
        select: {
          id: true,
          sku: true,
          barcode: true,
          name: true,
          option: true,
          product: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.StockTransferInclude;

const getStockTransferOrThrowTx = async (
  tx: Prisma.TransactionClient,
  stockTransferId: string,
) => {
  const transfer = await tx.stockTransfer.findUnique({
    where: { id: stockTransferId },
    include: transferInclude,
  });

  if (!transfer) {
    throw new HttpError(404, "Stock transfer not found", "STOCK_TRANSFER_NOT_FOUND");
  }

  return transfer;
};

const getLockedStockTransferOrThrowTx = async (
  tx: Prisma.TransactionClient,
  stockTransferId: string,
) => {
  const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM "StockTransfer"
    WHERE id = ${stockTransferId}
    FOR UPDATE
  `;

  if (lockedRows.length === 0) {
    throw new HttpError(404, "Stock transfer not found", "STOCK_TRANSFER_NOT_FOUND");
  }

  return getStockTransferOrThrowTx(tx, stockTransferId);
};

export const listStockTransfers = async (filters: ListStockTransferFilters) => {
  const status = filters.status;
  const fromLocationId = normalizeOptionalText(filters.fromLocationId);
  const toLocationId = normalizeOptionalText(filters.toLocationId);

  if (fromLocationId && !isUuid(fromLocationId)) {
    throw new HttpError(400, "fromLocationId must be a valid UUID", "INVALID_STOCK_TRANSFER_QUERY");
  }
  if (toLocationId && !isUuid(toLocationId)) {
    throw new HttpError(400, "toLocationId must be a valid UUID", "INVALID_STOCK_TRANSFER_QUERY");
  }

  const take = parseTake(filters.take);
  const skip = parseSkip(filters.skip);

  const [transfers, total] = await Promise.all([
    prisma.stockTransfer.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(fromLocationId ? { fromLocationId } : {}),
        ...(toLocationId ? { toLocationId } : {}),
      },
      include: transferInclude,
      orderBy: [
        { status: "asc" },
        { createdAt: "desc" },
      ],
      ...(take ? { take } : {}),
      ...(skip ? { skip } : {}),
    }),
    prisma.stockTransfer.count({
      where: {
        ...(status ? { status } : {}),
        ...(fromLocationId ? { fromLocationId } : {}),
        ...(toLocationId ? { toLocationId } : {}),
      },
    }),
  ]);

  return {
    filters: {
      status: status ?? null,
      fromLocationId: fromLocationId ?? null,
      toLocationId: toLocationId ?? null,
      take: take ?? null,
      skip: skip ?? null,
    },
    total,
    transfers: transfers.map(mapTransfer),
  };
};

export const getStockTransferById = async (stockTransferId: string) => {
  const validatedId = assertUuidOrThrow(
    stockTransferId,
    "Invalid stock transfer id",
    "INVALID_STOCK_TRANSFER_ID",
  );
  const transfer = await prisma.stockTransfer.findUnique({
    where: { id: validatedId },
    include: transferInclude,
  });

  if (!transfer) {
    throw new HttpError(404, "Stock transfer not found", "STOCK_TRANSFER_NOT_FOUND");
  }

  return mapTransfer(transfer);
};

export const createStockTransfer = async (input: CreateStockTransferInput, auditActor?: AuditActor) => {
  const fromLocationId = assertUuidOrThrow(
    input.fromLocationId,
    "fromLocationId must be a valid UUID",
    "INVALID_STOCK_TRANSFER",
  );
  const toLocationId = assertUuidOrThrow(
    input.toLocationId,
    "toLocationId must be a valid UUID",
    "INVALID_STOCK_TRANSFER",
  );

  if (fromLocationId === toLocationId) {
    throw new HttpError(
      409,
      "Transfer source and target locations must differ",
      "STOCK_TRANSFER_LOCATION_CONFLICT",
    );
  }

  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new HttpError(400, "lines must be a non-empty array", "INVALID_STOCK_TRANSFER");
  }

  const notes = normalizeOptionalText(input.notes) ?? null;
  const actorId = normalizeOptionalText(auditActor?.actorId) ?? null;
  const seenVariantIds = new Set<string>();

  const lines = input.lines.map((line) => {
    const variantId = normalizeOptionalText(line.variantId);
    if (!variantId) {
      throw new HttpError(400, "line variantId is required", "INVALID_STOCK_TRANSFER");
    }
    if (seenVariantIds.has(variantId)) {
      throw new HttpError(409, "Duplicate variants are not allowed in one transfer", "DUPLICATE_TRANSFER_VARIANT");
    }
    seenVariantIds.add(variantId);
    if (!Number.isInteger(line.quantity) || (line.quantity ?? 0) <= 0) {
      throw new HttpError(400, "line quantity must be a positive integer", "INVALID_STOCK_TRANSFER");
    }
    return {
      variantId,
      quantity: line.quantity as number,
    };
  });

  const transfer = await prisma.$transaction(async (tx) => {
    await ensureLocationExistsTx(tx, fromLocationId);
    await ensureLocationExistsTx(tx, toLocationId);

    for (const line of lines) {
      await ensureVariantExistsTx(tx, line.variantId);
    }

    const created = await tx.stockTransfer.create({
      data: {
        fromLocationId,
        toLocationId,
        notes,
        createdByStaffId: actorId,
        lines: {
          create: lines,
        },
      },
      include: transferInclude,
    });

    await createAuditEventTx(
      tx,
      {
        action: "STOCK_TRANSFER_CREATED",
        entityType: "STOCK_TRANSFER",
        entityId: created.id,
        metadata: {
          fromLocationId,
          toLocationId,
          lineCount: created.lines.length,
        },
      },
      auditActor,
    );

    return created;
  });

  return mapTransfer(transfer);
};

export const sendStockTransfer = async (stockTransferId: string, auditActor?: AuditActor) => {
  const validatedId = assertUuidOrThrow(
    stockTransferId,
    "Invalid stock transfer id",
    "INVALID_STOCK_TRANSFER_ID",
  );
  const actorId = normalizeOptionalText(auditActor?.actorId) ?? null;

  const transfer = await prisma.$transaction(async (tx) => {
    const current = await getLockedStockTransferOrThrowTx(tx, validatedId);

    if (current.status !== "DRAFT") {
      throw new HttpError(409, "Only draft transfers can be sent", "STOCK_TRANSFER_NOT_DRAFT");
    }
    if (current.lines.length === 0) {
      throw new HttpError(409, "Transfer must contain at least one line before sending", "STOCK_TRANSFER_EMPTY");
    }

    const updated = await tx.stockTransfer.update({
      where: { id: validatedId },
      data: {
        status: "SENT",
        sentAt: new Date(),
        sentByStaffId: actorId,
      },
      include: transferInclude,
    });

    await createAuditEventTx(
      tx,
      {
        action: "STOCK_TRANSFER_SENT",
        entityType: "STOCK_TRANSFER",
        entityId: updated.id,
        metadata: {
          fromLocationId: updated.fromLocationId,
          toLocationId: updated.toLocationId,
          quantity: updated.lines.reduce((sum, line) => sum + line.quantity, 0),
        },
      },
      auditActor,
    );

    return updated;
  });

  return mapTransfer(transfer);
};

export const receiveStockTransfer = async (stockTransferId: string, auditActor?: AuditActor) => {
  const validatedId = assertUuidOrThrow(
    stockTransferId,
    "Invalid stock transfer id",
    "INVALID_STOCK_TRANSFER_ID",
  );
  const actorId = normalizeOptionalText(auditActor?.actorId) ?? null;

  const transfer = await prisma.$transaction(async (tx) => {
    const current = await getLockedStockTransferOrThrowTx(tx, validatedId);

    if (current.status === "RECEIVED") {
      return current;
    }

    if (current.status !== "SENT") {
      throw new HttpError(409, "Only sent transfers can be received", "STOCK_TRANSFER_NOT_SENT");
    }

    await lockInventoryPositionsTx(
      tx,
      current.lines.flatMap((line) => [
        {
          variantId: line.variant.id,
          locationId: current.fromLocation.id,
        },
        {
          variantId: line.variant.id,
          locationId: current.toLocation.id,
        },
      ]),
    );

    const onHandRows = await tx.stockLedgerEntry.groupBy({
      by: ["variantId"],
      where: {
        locationId: current.fromLocation.id,
        variantId: {
          in: current.lines.map((line) => line.variant.id),
        },
      },
      _sum: {
        quantityDelta: true,
      },
    });
    const onHandByVariantId = new Map(
      onHandRows.map((row) => [row.variantId, row._sum.quantityDelta ?? 0]),
    );

    for (const line of current.lines) {
      const available = onHandByVariantId.get(line.variant.id) ?? 0;
      if (available < line.quantity) {
        throw new HttpError(
          409,
          `Not enough stock in ${current.fromLocation.name} to transfer ${line.variant.product.name}`,
          "STOCK_TRANSFER_INSUFFICIENT_STOCK",
        );
      }
    }

    for (const line of current.lines) {
      const sourceNote = `Transfer to ${current.toLocation.name}`;
      const targetNote = `Transfer from ${current.fromLocation.name}`;

      await tx.inventoryMovement.create({
        data: {
          variantId: line.variant.id,
          locationId: current.fromLocation.id,
          type: "TRANSFER",
          quantity: -line.quantity,
          referenceType: "STOCK_TRANSFER_OUT",
          referenceId: current.id,
          note: sourceNote,
          createdByStaffId: actorId,
        },
      });

      await tx.inventoryMovement.create({
        data: {
          variantId: line.variant.id,
          locationId: current.toLocation.id,
          type: "TRANSFER",
          quantity: line.quantity,
          referenceType: "STOCK_TRANSFER_IN",
          referenceId: current.id,
          note: targetNote,
          createdByStaffId: actorId,
        },
      });

      await tx.stockLedgerEntry.create({
        data: {
          variantId: line.variant.id,
          locationId: current.fromLocation.id,
          type: "TRANSFER",
          quantityDelta: -line.quantity,
          referenceType: "STOCK_TRANSFER_OUT",
          referenceId: current.id,
          note: sourceNote,
          createdByStaffId: actorId,
        },
      });

      await tx.stockLedgerEntry.create({
        data: {
          variantId: line.variant.id,
          locationId: current.toLocation.id,
          type: "TRANSFER",
          quantityDelta: line.quantity,
          referenceType: "STOCK_TRANSFER_IN",
          referenceId: current.id,
          note: targetNote,
          createdByStaffId: actorId,
        },
      });
    }

    const updated = await tx.stockTransfer.update({
      where: { id: current.id },
      data: {
        status: "RECEIVED",
        receivedAt: new Date(),
        receivedByStaffId: actorId,
      },
      include: transferInclude,
    });

    await createAuditEventTx(
      tx,
      {
        action: "STOCK_TRANSFER_RECEIVED",
        entityType: "STOCK_TRANSFER",
        entityId: updated.id,
        metadata: {
          fromLocationId: updated.fromLocationId,
          toLocationId: updated.toLocationId,
          quantity: updated.lines.reduce((sum, line) => sum + line.quantity, 0),
        },
      },
      auditActor,
    );

    return updated;
  });

  return mapTransfer(transfer);
};

export const cancelStockTransfer = async (stockTransferId: string, auditActor?: AuditActor) => {
  const validatedId = assertUuidOrThrow(
    stockTransferId,
    "Invalid stock transfer id",
    "INVALID_STOCK_TRANSFER_ID",
  );

  const transfer = await prisma.$transaction(async (tx) => {
    const current = await getLockedStockTransferOrThrowTx(tx, validatedId);

    if (current.status === "RECEIVED") {
      throw new HttpError(409, "Received transfers cannot be cancelled", "STOCK_TRANSFER_RECEIVED");
    }
    if (current.status === "CANCELLED") {
      throw new HttpError(409, "Transfer is already cancelled", "STOCK_TRANSFER_CANCELLED");
    }

    const updated = await tx.stockTransfer.update({
      where: { id: current.id },
      data: {
        status: "CANCELLED",
      },
      include: transferInclude,
    });

    await createAuditEventTx(
      tx,
      {
        action: "STOCK_TRANSFER_CANCELLED",
        entityType: "STOCK_TRANSFER",
        entityId: updated.id,
      },
      auditActor,
    );

    return updated;
  });

  return mapTransfer(transfer);
};
