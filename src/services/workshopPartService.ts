import { Prisma, WorkshopJobPartStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { createAuditEventTx, type AuditActor } from "./auditService";
import { ensureDefaultLocationTx } from "./locationService";

type AddWorkshopJobPartInput = {
  variantId?: string;
  quantity?: number;
  unitPriceAtTime?: number;
  costPriceAtTime?: number | null;
  status?: WorkshopJobPartStatus;
  locationId?: string;
  note?: string;
  createdByStaffId?: string;
};

type UpdateWorkshopJobPartInput = {
  quantity?: number;
  unitPriceAtTime?: number;
  costPriceAtTime?: number | null;
  status?: WorkshopJobPartStatus;
  locationId?: string;
  note?: string;
  createdByStaffId?: string;
};

const normalizeOptionalText = (value: string | undefined | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toPartResponse = (part: {
  id: string;
  workshopJobId: string;
  variantId: string;
  quantity: number;
  unitPriceAtTime: number;
  costPriceAtTime: number | null;
  status: WorkshopJobPartStatus;
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
}) => {
  const lineTotalPence = part.quantity * part.unitPriceAtTime;
  return {
    id: part.id,
    workshopJobId: part.workshopJobId,
    variantId: part.variantId,
    sku: part.variant.sku,
    variantName: part.variant.name,
    productId: part.variant.product.id,
    productName: part.variant.product.name,
    quantity: part.quantity,
    unitPriceAtTime: part.unitPriceAtTime,
    costPriceAtTime: part.costPriceAtTime,
    lineTotalPence,
    status: part.status,
    createdAt: part.createdAt,
    updatedAt: part.updatedAt,
  };
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

  const location = await tx.stockLocation.findUnique({ where: { id: normalizedLocationId } });
  if (!location) {
    throw new HttpError(404, "Stock location not found", "LOCATION_NOT_FOUND");
  }

  return location;
};

const assertMoneyIntOrThrow = (value: number | null | undefined, field: string) => {
  if (value === null || value === undefined) {
    return;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new HttpError(400, `${field} must be a non-negative integer`, "INVALID_WORKSHOP_PART");
  }
};

const assertPositiveIntOrThrow = (value: number | undefined, field: string) => {
  if (!Number.isInteger(value) || (value ?? 0) <= 0) {
    throw new HttpError(400, `${field} must be a positive integer`, "INVALID_WORKSHOP_PART");
  }
};

const ensureWorkshopJobExistsTx = async (tx: Prisma.TransactionClient, workshopJobId: string) => {
  const job = await tx.workshopJob.findUnique({
    where: { id: workshopJobId },
    select: {
      id: true,
      locationId: true,
      status: true,
      updatedAt: true,
    },
  });

  if (!job) {
    throw new HttpError(404, "Workshop job not found", "WORKSHOP_JOB_NOT_FOUND");
  }

  return job;
};

const ensureVariantExistsTx = async (tx: Prisma.TransactionClient, variantId: string) => {
  const variant = await tx.variant.findUnique({
    where: { id: variantId },
    select: {
      id: true,
      sku: true,
      name: true,
      retailPricePence: true,
      costPricePence: true,
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

const consumedQuantityFor = (part: { quantity: number; status: WorkshopJobPartStatus }) =>
  part.status === "USED" ? part.quantity : 0;

const writeWorkshopStockLedgerDeltaTx = async (
  tx: Prisma.TransactionClient,
  input: {
    workshopJobId: string;
    partId: string;
    variantId: string;
    quantityDelta: number;
    locationId?: string;
    inventoryLocationId?: string;
    note?: string;
    createdByStaffId?: string;
  },
) => {
  if (input.quantityDelta === 0) {
    return;
  }

  const location = await resolveLocationTx(tx, input.locationId);

  const staffId = normalizeOptionalText(input.createdByStaffId);
  if (staffId) {
    const staff = await tx.user.findUnique({ where: { id: staffId }, select: { id: true } });
    if (!staff) {
      throw new HttpError(404, "Staff member not found", "STAFF_NOT_FOUND");
    }
  }

  await tx.stockLedgerEntry.create({
    data: {
      variantId: input.variantId,
      locationId: location.id,
      type: "WORKSHOP",
      quantityDelta: input.quantityDelta,
      referenceType: "WORKSHOP_JOB_PART",
      referenceId: input.partId,
      note: normalizeOptionalText(input.note),
      createdByStaffId: staffId,
    },
  });

  await tx.inventoryMovement.create({
    data: {
      variantId: input.variantId,
      locationId: input.inventoryLocationId ?? (await ensureDefaultLocationTx(tx)).id,
      type: "WORKSHOP_USE",
      quantity: input.quantityDelta,
      referenceType: "WORKSHOP_JOB_PART",
      referenceId: input.partId,
      note: normalizeOptionalText(input.note) ?? null,
      createdByStaffId: staffId ?? null,
    },
  });
};

const getWorkshopJobPartsSnapshotTx = async (
  tx: Prisma.TransactionClient,
  workshopJobId: string,
) => {
  const parts = await tx.workshopJobPart.findMany({
    where: {
      workshopJobId,
    },
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
  });

  const partsUsedTotalPence = parts
    .filter((part) => part.status === "USED")
    .reduce((sum, part) => sum + part.quantity * part.unitPriceAtTime, 0);

  const partsPlannedTotalPence = parts
    .filter((part) => part.status === "PLANNED")
    .reduce((sum, part) => sum + part.quantity * part.unitPriceAtTime, 0);

  const partsReturnedTotalPence = parts
    .filter((part) => part.status === "RETURNED")
    .reduce((sum, part) => sum + part.quantity * part.unitPriceAtTime, 0);

  return {
    parts: parts.map((part) => toPartResponse(part)),
    totals: {
      partsUsedTotalPence,
      partsPlannedTotalPence,
      partsReturnedTotalPence,
    },
  };
};

export const getWorkshopJobUsedPartsTotalPenceTx = async (
  tx: Prisma.TransactionClient,
  workshopJobId: string,
) => {
  const usedParts = await tx.workshopJobPart.findMany({
    where: {
      workshopJobId,
      status: "USED",
    },
    select: {
      quantity: true,
      unitPriceAtTime: true,
    },
  });

  return usedParts.reduce(
    (sum, part) => sum + part.quantity * part.unitPriceAtTime,
    0,
  );
};

export const addWorkshopJobPart = async (
  workshopJobId: string,
  input: AddWorkshopJobPartInput,
  auditActor?: AuditActor,
) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  const variantId = normalizeOptionalText(input.variantId);
  if (!variantId) {
    throw new HttpError(400, "variantId is required", "INVALID_WORKSHOP_PART");
  }

  assertPositiveIntOrThrow(input.quantity, "quantity");
  assertMoneyIntOrThrow(input.unitPriceAtTime, "unitPriceAtTime");
  assertMoneyIntOrThrow(input.costPriceAtTime, "costPriceAtTime");

  const status = input.status ?? "PLANNED";

  return prisma.$transaction(async (tx) => {
    const job = await ensureWorkshopJobExistsTx(tx, workshopJobId);
    if (job.status === "COMPLETED" || job.status === "CANCELLED") {
      throw new HttpError(
        409,
        "Cannot add parts to a completed or cancelled workshop job",
        "WORKSHOP_JOB_NOT_EDITABLE",
      );
    }

    const variant = await ensureVariantExistsTx(tx, variantId);

    const created = await tx.workshopJobPart.create({
      data: {
        workshopJobId,
        variantId,
        quantity: input.quantity,
        unitPriceAtTime: input.unitPriceAtTime ?? variant.retailPricePence,
        costPriceAtTime:
          input.costPriceAtTime === undefined
            ? variant.costPricePence
            : input.costPriceAtTime,
        status,
      },
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
    });

    if (status === "USED") {
      await writeWorkshopStockLedgerDeltaTx(tx, {
        workshopJobId,
        partId: created.id,
        variantId,
        quantityDelta: -created.quantity,
        locationId: input.locationId,
        inventoryLocationId: job.locationId,
        note: input.note ?? "Workshop part consumed",
        createdByStaffId: input.createdByStaffId,
      });
    }

    await createAuditEventTx(
      tx,
      {
        action: "JOB_PART_ADDED",
        entityType: "WORKSHOP_JOB",
        entityId: workshopJobId,
        metadata: {
          partId: created.id,
          variantId,
          quantity: created.quantity,
          status: created.status,
          unitPriceAtTime: created.unitPriceAtTime,
          costPriceAtTime: created.costPriceAtTime,
        },
      },
      auditActor,
    );

    const snapshot = await getWorkshopJobPartsSnapshotTx(tx, workshopJobId);

    return {
      part: toPartResponse(created),
      parts: snapshot.parts,
      totals: snapshot.totals,
      idempotent: false,
    };
  });
};

export const updateWorkshopJobPart = async (
  workshopJobId: string,
  partId: string,
  input: UpdateWorkshopJobPartInput,
  auditActor?: AuditActor,
) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }
  if (!isUuid(partId)) {
    throw new HttpError(400, "Invalid workshop part id", "INVALID_WORKSHOP_PART_ID");
  }

  const hasAnyField =
    Object.prototype.hasOwnProperty.call(input, "quantity") ||
    Object.prototype.hasOwnProperty.call(input, "unitPriceAtTime") ||
    Object.prototype.hasOwnProperty.call(input, "costPriceAtTime") ||
    Object.prototype.hasOwnProperty.call(input, "status");

  if (!hasAnyField) {
    throw new HttpError(400, "No fields provided", "INVALID_WORKSHOP_PART_UPDATE");
  }

  if (Object.prototype.hasOwnProperty.call(input, "quantity")) {
    assertPositiveIntOrThrow(input.quantity, "quantity");
  }

  if (Object.prototype.hasOwnProperty.call(input, "unitPriceAtTime")) {
    assertMoneyIntOrThrow(input.unitPriceAtTime, "unitPriceAtTime");
  }

  if (Object.prototype.hasOwnProperty.call(input, "costPriceAtTime")) {
    assertMoneyIntOrThrow(input.costPriceAtTime, "costPriceAtTime");
  }

  return prisma.$transaction(async (tx) => {
    const job = await ensureWorkshopJobExistsTx(tx, workshopJobId);
    if (job.status === "COMPLETED" || job.status === "CANCELLED") {
      throw new HttpError(
        409,
        "Cannot update parts on a completed or cancelled workshop job",
        "WORKSHOP_JOB_NOT_EDITABLE",
      );
    }

    const existing = await tx.workshopJobPart.findUnique({
      where: { id: partId },
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
    });

    if (!existing || existing.workshopJobId !== workshopJobId) {
      throw new HttpError(404, "Workshop part not found", "WORKSHOP_PART_NOT_FOUND");
    }

    const nextState = {
      quantity: Object.prototype.hasOwnProperty.call(input, "quantity")
        ? input.quantity
        : existing.quantity,
      unitPriceAtTime: Object.prototype.hasOwnProperty.call(input, "unitPriceAtTime")
        ? input.unitPriceAtTime
        : existing.unitPriceAtTime,
      costPriceAtTime: Object.prototype.hasOwnProperty.call(input, "costPriceAtTime")
        ? input.costPriceAtTime
        : existing.costPriceAtTime,
      status: Object.prototype.hasOwnProperty.call(input, "status")
        ? input.status
        : existing.status,
    };

    const unchanged =
      existing.quantity === nextState.quantity &&
      existing.unitPriceAtTime === nextState.unitPriceAtTime &&
      existing.costPriceAtTime === nextState.costPriceAtTime &&
      existing.status === nextState.status;

    if (unchanged) {
      const snapshot = await getWorkshopJobPartsSnapshotTx(tx, workshopJobId);
      return {
        part: toPartResponse(existing),
        parts: snapshot.parts,
        totals: snapshot.totals,
        idempotent: true,
      };
    }

    const oldConsumedQuantity = consumedQuantityFor(existing);
    const newConsumedQuantity = consumedQuantityFor({
      quantity: nextState.quantity,
      status: nextState.status,
    });
    const consumedDelta = newConsumedQuantity - oldConsumedQuantity;

    const updated = await tx.workshopJobPart.update({
      where: { id: partId },
      data: {
        quantity: nextState.quantity,
        unitPriceAtTime: nextState.unitPriceAtTime,
        costPriceAtTime: nextState.costPriceAtTime,
        status: nextState.status,
      },
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
    });

    if (consumedDelta !== 0) {
      await writeWorkshopStockLedgerDeltaTx(tx, {
        workshopJobId,
        partId,
        variantId: existing.variantId,
        quantityDelta: -consumedDelta,
        locationId: input.locationId,
        inventoryLocationId: job.locationId,
        note:
          consumedDelta > 0
            ? (input.note ?? "Workshop part consumed")
            : (input.note ?? "Workshop part returned"),
        createdByStaffId: input.createdByStaffId,
      });
    }

    await createAuditEventTx(
      tx,
      {
        action: "JOB_PART_UPDATED",
        entityType: "WORKSHOP_JOB",
        entityId: workshopJobId,
        metadata: {
          partId,
          from: {
            quantity: existing.quantity,
            unitPriceAtTime: existing.unitPriceAtTime,
            costPriceAtTime: existing.costPriceAtTime,
            status: existing.status,
          },
          to: {
            quantity: updated.quantity,
            unitPriceAtTime: updated.unitPriceAtTime,
            costPriceAtTime: updated.costPriceAtTime,
            status: updated.status,
          },
          stockQuantityDelta: consumedDelta === 0 ? 0 : -consumedDelta,
        },
      },
      auditActor,
    );

    const snapshot = await getWorkshopJobPartsSnapshotTx(tx, workshopJobId);

    return {
      part: toPartResponse(updated),
      parts: snapshot.parts,
      totals: snapshot.totals,
      idempotent: false,
    };
  });
};

export const removeWorkshopJobPart = async (
  workshopJobId: string,
  partId: string,
  input: {
    locationId?: string;
    note?: string;
    createdByStaffId?: string;
  },
  auditActor?: AuditActor,
) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }
  if (!isUuid(partId)) {
    throw new HttpError(400, "Invalid workshop part id", "INVALID_WORKSHOP_PART_ID");
  }

  return prisma.$transaction(async (tx) => {
    const job = await ensureWorkshopJobExistsTx(tx, workshopJobId);
    if (job.status === "COMPLETED" || job.status === "CANCELLED") {
      throw new HttpError(
        409,
        "Cannot remove parts from a completed or cancelled workshop job",
        "WORKSHOP_JOB_NOT_EDITABLE",
      );
    }

    const existing = await tx.workshopJobPart.findUnique({
      where: { id: partId },
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
    });

    if (!existing || existing.workshopJobId !== workshopJobId) {
      throw new HttpError(404, "Workshop part not found", "WORKSHOP_PART_NOT_FOUND");
    }

    const consumedQuantity = consumedQuantityFor(existing);
    if (consumedQuantity > 0) {
      await writeWorkshopStockLedgerDeltaTx(tx, {
        workshopJobId,
        partId,
        variantId: existing.variantId,
        quantityDelta: consumedQuantity,
        locationId: input.locationId,
        inventoryLocationId: job.locationId,
        note: input.note ?? "Workshop part removed/returned",
        createdByStaffId: input.createdByStaffId,
      });
    }

    await tx.workshopJobPart.delete({
      where: {
        id: partId,
      },
    });

    await createAuditEventTx(
      tx,
      {
        action: "JOB_PART_REMOVED",
        entityType: "WORKSHOP_JOB",
        entityId: workshopJobId,
        metadata: {
          partId,
          variantId: existing.variantId,
          quantity: existing.quantity,
          status: existing.status,
          stockQuantityDelta: consumedQuantity,
        },
      },
      auditActor,
    );

    const snapshot = await getWorkshopJobPartsSnapshotTx(tx, workshopJobId);

    return {
      removedPartId: partId,
      parts: snapshot.parts,
      totals: snapshot.totals,
    };
  });
};

export const listWorkshopJobParts = async (workshopJobId: string) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  await ensureWorkshopJobExistsTx(prisma, workshopJobId);
  const snapshot = await getWorkshopJobPartsSnapshotTx(prisma, workshopJobId);

  return {
    workshopJobId,
    parts: snapshot.parts,
    totals: snapshot.totals,
  };
};
