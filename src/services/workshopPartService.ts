import { Prisma, WorkshopJobPartStatus, WorkshopJobStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { createAuditEventTx, type AuditActor } from "./auditService";
import {
  assertNonNegativeProjectedStockTx,
  lockVariantRowsTx,
} from "./inventoryLedgerService";

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

type WorkshopPartsStatus = "OK" | "UNALLOCATED" | "SHORT";

type WorkshopJobRecord = {
  id: string;
  status: WorkshopJobStatus;
  locationId: string;
  location: {
    id: string;
    name: string;
    code: string | null;
  };
  updatedAt: Date;
};

type WorkshopPartWithRelations = {
  id: string;
  workshopJobId: string;
  variantId: string;
  stockLocationId: string;
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
  stockLocation: {
    id: string;
    name: string;
    isDefault: boolean;
  };
};

type ResolvedStockLocation = {
  id: string;
  name: string;
  isDefault: boolean;
  source: "explicit" | "matched-name" | "default-for-main" | "default-fallback";
};

type JobPartRequirement = {
  variantId: string;
  sku: string;
  variantName: string | null;
  productId: string;
  productName: string;
  requiredQty: number;
  allocatedQty: number;
  consumedQty: number;
  returnedQty: number;
  outstandingQty: number;
  availableToAllocate: number;
  missingQty: number;
  stockOnHand: number;
  estimateValuePence: number;
  partsStatus: WorkshopPartsStatus;
};

type WorkshopPartsOverview = {
  stockLocation: {
    id: string;
    name: string;
    isDefault: boolean;
    source: ResolvedStockLocation["source"];
  };
  requirements: JobPartRequirement[];
  summary: {
    requiredQty: number;
    allocatedQty: number;
    consumedQty: number;
    returnedQty: number;
    outstandingQty: number;
    missingQty: number;
    partsStatus: WorkshopPartsStatus;
  };
};

const DEFAULT_LOCATION_CODE = (() => {
  const raw = (process.env.DEFAULT_LOCATION_CODE ?? "MAIN").trim().toUpperCase();
  return raw.length > 0 ? raw : "MAIN";
})();

const normalizeOptionalText = (value: string | undefined | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toPartResponse = (part: WorkshopPartWithRelations) => {
  const lineTotalPence = part.quantity * part.unitPriceAtTime;
  return {
    id: part.id,
    workshopJobId: part.workshopJobId,
    variantId: part.variantId,
    stockLocationId: part.stockLocationId,
    stockLocationName: part.stockLocation.name,
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
  stockLocationId: string,
) => {
  const location = await tx.stockLocation.findUnique({ where: { id: stockLocationId } });
  if (!location) {
    throw new HttpError(404, "Stock location not found", "LOCATION_NOT_FOUND");
  }
  return location;
};

const resolveExplicitStockLocationTx = async (
  tx: Prisma.TransactionClient,
  stockLocationId: string,
): Promise<ResolvedStockLocation> => {
  if (!isUuid(stockLocationId)) {
    throw new HttpError(400, "Invalid location id", "INVALID_LOCATION_ID");
  }

  const location = await ensureStockLocationExistsTx(tx, stockLocationId);
  return {
    id: location.id,
    name: location.name,
    isDefault: location.isDefault,
    source: "explicit",
  };
};

const ensureWorkshopJobExistsTx = async (
  tx: Prisma.TransactionClient,
  workshopJobId: string,
): Promise<WorkshopJobRecord> => {
  const job = await tx.workshopJob.findUnique({
    where: { id: workshopJobId },
    select: {
      id: true,
      status: true,
      locationId: true,
      updatedAt: true,
      location: {
        select: {
          id: true,
          name: true,
          code: true,
        },
      },
    },
  });

  if (!job) {
    throw new HttpError(404, "Workshop job not found", "WORKSHOP_JOB_NOT_FOUND");
  }

  return job;
};

const resolveWorkshopJobStockLocationTx = async (
  tx: Prisma.TransactionClient,
  job: WorkshopJobRecord,
  requestedLocationId?: string,
): Promise<ResolvedStockLocation> => {
  const normalizedLocationId = normalizeOptionalText(requestedLocationId);
  if (normalizedLocationId) {
    return resolveExplicitStockLocationTx(tx, normalizedLocationId);
  }

  const businessLocationName = normalizeOptionalText(job.location.name);
  if (businessLocationName) {
    const matchedByName = await tx.stockLocation.findFirst({
      where: {
        name: {
          equals: businessLocationName,
          mode: "insensitive",
        },
      },
      orderBy: { createdAt: "asc" },
    });

    if (matchedByName) {
      return {
        id: matchedByName.id,
        name: matchedByName.name,
        isDefault: matchedByName.isDefault,
        source: "matched-name",
      };
    }
  }

  const defaultLocation = await getOrCreateDefaultStockLocationTx(tx);
  return {
    id: defaultLocation.id,
    name: defaultLocation.name,
    isDefault: defaultLocation.isDefault,
    source:
      (job.location.code ?? "").trim().toUpperCase() === DEFAULT_LOCATION_CODE
        ? "default-for-main"
        : "default-fallback",
  };
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

const getLocationOnHandTx = async (
  tx: Prisma.TransactionClient,
  variantId: string,
  stockLocationId: string,
) => {
  const aggregate = await tx.stockLedgerEntry.aggregate({
    where: {
      variantId,
      locationId: stockLocationId,
    },
    _sum: {
      quantityDelta: true,
    },
  });

  return aggregate._sum.quantityDelta ?? 0;
};

const getPlannedReservedQtyTx = async (
  tx: Prisma.TransactionClient,
  variantId: string,
  stockLocationId: string,
  excludePartId?: string,
) => {
  const aggregate = await tx.workshopJobPart.aggregate({
    where: {
      variantId,
      stockLocationId,
      status: "PLANNED",
      ...(excludePartId
        ? {
            id: {
              not: excludePartId,
            },
          }
        : {}),
    },
    _sum: {
      quantity: true,
    },
  });

  return aggregate._sum.quantity ?? 0;
};

const getLocationAvailabilityTx = async (
  tx: Prisma.TransactionClient,
  input: {
    variantId: string;
    stockLocationId: string;
    excludePartId?: string;
    restoreConsumedQty?: number;
  },
) => {
  const onHandAtLocation = await getLocationOnHandTx(tx, input.variantId, input.stockLocationId);
  const reservedPlannedQty = await getPlannedReservedQtyTx(
    tx,
    input.variantId,
    input.stockLocationId,
    input.excludePartId,
  );

  const availableToAllocate = onHandAtLocation + (input.restoreConsumedQty ?? 0) - reservedPlannedQty;

  return {
    onHandAtLocation,
    reservedPlannedQty,
    availableToAllocate,
  };
};

const assertCanAllocateQuantityTx = async (
  tx: Prisma.TransactionClient,
  input: {
    variantId: string;
    stockLocationId: string;
    requiredQty: number;
    excludePartId?: string;
    restoreConsumedQty?: number;
  },
) => {
  const availability = await getLocationAvailabilityTx(tx, input);

  if (input.requiredQty > availability.availableToAllocate) {
    throw new HttpError(
      409,
      "Insufficient available stock at the selected location",
      "INSUFFICIENT_WORKSHOP_PART_STOCK",
    );
  }

  return availability;
};

const writeWorkshopStockLedgerDeltaTx = async (
  tx: Prisma.TransactionClient,
  input: {
    workshopJobId: string;
    partId: string;
    variantId: string;
    quantityDelta: number;
    stockLocationId: string;
    note?: string;
    createdByStaffId?: string;
  },
) => {
  if (input.quantityDelta === 0) {
    return;
  }

  const location = await ensureStockLocationExistsTx(tx, input.stockLocationId);

  const staffId = normalizeOptionalText(input.createdByStaffId);
  if (staffId) {
    const staff = await tx.user.findUnique({ where: { id: staffId }, select: { id: true } });
    if (!staff) {
      throw new HttpError(404, "Staff member not found", "STAFF_NOT_FOUND");
    }
  }

  if (input.quantityDelta < 0) {
    await lockVariantRowsTx(tx, [input.variantId]);
    await assertNonNegativeProjectedStockTx(tx, {
      variantId: input.variantId,
      locationId: location.id,
      quantityDelta: input.quantityDelta,
      message: "Insufficient available stock at the selected location",
      code: "INSUFFICIENT_WORKSHOP_PART_STOCK",
    });
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
      locationId: location.id,
      type: "WORKSHOP_USE",
      quantity: input.quantityDelta,
      referenceType: "WORKSHOP_JOB_PART",
      referenceId: input.partId,
      note: normalizeOptionalText(input.note) ?? null,
      createdByStaffId: staffId ?? null,
    },
  });
};

const loadWorkshopPartsTx = async (
  tx: Prisma.TransactionClient,
  workshopJobId: string,
): Promise<WorkshopPartWithRelations[]> =>
  tx.workshopJobPart.findMany({
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
      stockLocation: {
        select: {
          id: true,
          name: true,
          isDefault: true,
        },
      },
    },
  });

const derivePartsStatus = (
  requirements: Array<Pick<JobPartRequirement, "missingQty" | "outstandingQty">>,
): WorkshopPartsStatus => {
  if (requirements.some((requirement) => requirement.missingQty > 0)) {
    return "SHORT";
  }
  if (requirements.some((requirement) => requirement.outstandingQty > 0)) {
    return "UNALLOCATED";
  }
  return "OK";
};

export const getWorkshopJobPartsOverviewTx = async (
  tx: Prisma.TransactionClient,
  workshopJobId: string,
): Promise<WorkshopPartsOverview> => {
  const job = await ensureWorkshopJobExistsTx(tx, workshopJobId);
  const resolvedStockLocation = await resolveWorkshopJobStockLocationTx(tx, job);

  const parts = await loadWorkshopPartsTx(tx, workshopJobId);
  const partLines = await tx.workshopJobLine.findMany({
    where: {
      jobId: workshopJobId,
      type: "PART",
      variantId: {
        not: null,
      },
    },
    orderBy: [{ createdAt: "asc" }],
    include: {
      product: {
        select: {
          id: true,
          name: true,
        },
      },
      variant: {
        select: {
          id: true,
          sku: true,
          name: true,
        },
      },
    },
  });

  const requirementSeed = new Map<string, JobPartRequirement>();
  for (const line of partLines) {
    if (!line.variantId || !line.variant || !line.product) {
      continue;
    }

    const existing = requirementSeed.get(line.variantId);
    if (existing) {
      existing.requiredQty += line.qty;
      existing.estimateValuePence += line.qty * line.unitPricePence;
      continue;
    }

    requirementSeed.set(line.variantId, {
      variantId: line.variantId,
      sku: line.variant.sku,
      variantName: line.variant.name,
      productId: line.product.id,
      productName: line.product.name,
      requiredQty: line.qty,
      allocatedQty: 0,
      consumedQty: 0,
      returnedQty: 0,
      outstandingQty: 0,
      availableToAllocate: 0,
      missingQty: 0,
      stockOnHand: 0,
      estimateValuePence: line.qty * line.unitPricePence,
      partsStatus: "OK",
    });
  }

  const onHandByVariantId = new Map<string, number>();
  const availableByVariantId = new Map<string, number>();
  for (const variantId of requirementSeed.keys()) {
    const availability = await getLocationAvailabilityTx(tx, {
      variantId,
      stockLocationId: resolvedStockLocation.id,
    });
    onHandByVariantId.set(variantId, availability.onHandAtLocation);
    availableByVariantId.set(variantId, Math.max(0, availability.availableToAllocate));
  }

  for (const part of parts) {
    const requirement = requirementSeed.get(part.variantId);
    if (!requirement) {
      continue;
    }

    if (part.status === "PLANNED") {
      requirement.allocatedQty += part.quantity;
    } else if (part.status === "USED") {
      requirement.consumedQty += part.quantity;
    } else if (part.status === "RETURNED") {
      requirement.returnedQty += part.quantity;
    }
  }

  const requirements = Array.from(requirementSeed.values()).map((requirement) => {
    const coveredQty = requirement.allocatedQty + requirement.consumedQty;
    const outstandingQty = Math.max(0, requirement.requiredQty - coveredQty);
    const availableToAllocate = availableByVariantId.get(requirement.variantId) ?? 0;
    const missingQty = Math.max(0, outstandingQty - availableToAllocate);
    const stockOnHand = onHandByVariantId.get(requirement.variantId) ?? 0;
    const partsStatus = derivePartsStatus([
      {
        outstandingQty,
        missingQty,
      },
    ]);

    return {
      ...requirement,
      outstandingQty,
      availableToAllocate,
      missingQty,
      stockOnHand,
      partsStatus,
    };
  });

  return {
    stockLocation: {
      id: resolvedStockLocation.id,
      name: resolvedStockLocation.name,
      isDefault: resolvedStockLocation.isDefault,
      source: resolvedStockLocation.source,
    },
    requirements,
    summary: {
      requiredQty: requirements.reduce((sum, requirement) => sum + requirement.requiredQty, 0),
      allocatedQty: requirements.reduce((sum, requirement) => sum + requirement.allocatedQty, 0),
      consumedQty: requirements.reduce((sum, requirement) => sum + requirement.consumedQty, 0),
      returnedQty: requirements.reduce((sum, requirement) => sum + requirement.returnedQty, 0),
      outstandingQty: requirements.reduce((sum, requirement) => sum + requirement.outstandingQty, 0),
      missingQty: requirements.reduce((sum, requirement) => sum + requirement.missingQty, 0),
      partsStatus: derivePartsStatus(requirements),
    },
  };
};

const getWorkshopJobPartsSnapshotTx = async (
  tx: Prisma.TransactionClient,
  workshopJobId: string,
) => {
  const parts = await loadWorkshopPartsTx(tx, workshopJobId);
  const overview = await getWorkshopJobPartsOverviewTx(tx, workshopJobId);

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
    overview,
  };
};

export const getWorkshopJobPartsOverview = async (workshopJobId: string) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  return prisma.$transaction((tx) => getWorkshopJobPartsOverviewTx(tx, workshopJobId));
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
    const stockLocation = await resolveWorkshopJobStockLocationTx(tx, job, input.locationId);

    if (status === "PLANNED" || status === "USED") {
      await assertCanAllocateQuantityTx(tx, {
        variantId,
        stockLocationId: stockLocation.id,
        requiredQty: input.quantity ?? 0,
      });
    }

    const created = await tx.workshopJobPart.create({
      data: {
        workshopJobId,
        variantId,
        stockLocationId: stockLocation.id,
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
        stockLocation: {
          select: {
            id: true,
            name: true,
            isDefault: true,
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
        stockLocationId: stockLocation.id,
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
          stockLocationId: stockLocation.id,
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
      overview: snapshot.overview,
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
    Object.prototype.hasOwnProperty.call(input, "status") ||
    Object.prototype.hasOwnProperty.call(input, "locationId");

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
        stockLocation: {
          select: {
            id: true,
            name: true,
            isDefault: true,
          },
        },
      },
    });

    if (!existing || existing.workshopJobId !== workshopJobId) {
      throw new HttpError(404, "Workshop part not found", "WORKSHOP_PART_NOT_FOUND");
    }

    const nextStockLocation = Object.prototype.hasOwnProperty.call(input, "locationId")
      ? await resolveWorkshopJobStockLocationTx(tx, job, input.locationId)
      : {
          id: existing.stockLocation.id,
          name: existing.stockLocation.name,
          isDefault: existing.stockLocation.isDefault,
          source: "explicit" as const,
        };

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
      stockLocationId: nextStockLocation.id,
    };

    const unchanged =
      existing.quantity === nextState.quantity &&
      existing.unitPriceAtTime === nextState.unitPriceAtTime &&
      existing.costPriceAtTime === nextState.costPriceAtTime &&
      existing.status === nextState.status &&
      existing.stockLocationId === nextState.stockLocationId;

    if (unchanged) {
      const snapshot = await getWorkshopJobPartsSnapshotTx(tx, workshopJobId);
      return {
        part: toPartResponse(existing),
        parts: snapshot.parts,
        totals: snapshot.totals,
        overview: snapshot.overview,
        idempotent: true,
      };
    }

    if (nextState.status === "PLANNED" || nextState.status === "USED") {
      await assertCanAllocateQuantityTx(tx, {
        variantId: existing.variantId,
        stockLocationId: nextState.stockLocationId,
        requiredQty: nextState.quantity ?? 0,
        excludePartId: existing.id,
        restoreConsumedQty:
          existing.status === "USED" && existing.stockLocationId === nextState.stockLocationId
            ? existing.quantity
            : 0,
      });
    }

    const oldConsumedQuantity = consumedQuantityFor(existing);
    const newConsumedQuantity = consumedQuantityFor({
      quantity: nextState.quantity ?? existing.quantity,
      status: nextState.status ?? existing.status,
    });

    const updated = await tx.workshopJobPart.update({
      where: { id: partId },
      data: {
        quantity: nextState.quantity,
        unitPriceAtTime: nextState.unitPriceAtTime,
        costPriceAtTime: nextState.costPriceAtTime,
        status: nextState.status,
        stockLocationId: nextState.stockLocationId,
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
        stockLocation: {
          select: {
            id: true,
            name: true,
            isDefault: true,
          },
        },
      },
    });

    if (existing.stockLocationId === nextState.stockLocationId) {
      const consumedDelta = newConsumedQuantity - oldConsumedQuantity;
      if (consumedDelta !== 0) {
        await writeWorkshopStockLedgerDeltaTx(tx, {
          workshopJobId,
          partId,
          variantId: existing.variantId,
          quantityDelta: -consumedDelta,
          stockLocationId: nextState.stockLocationId,
          note:
            consumedDelta > 0
              ? (input.note ?? "Workshop part consumed")
              : (input.note ?? "Workshop part returned"),
          createdByStaffId: input.createdByStaffId,
        });
      }
    } else {
      if (oldConsumedQuantity > 0) {
        await writeWorkshopStockLedgerDeltaTx(tx, {
          workshopJobId,
          partId,
          variantId: existing.variantId,
          quantityDelta: oldConsumedQuantity,
          stockLocationId: existing.stockLocationId,
          note: input.note ?? "Workshop part moved from previous stock location",
          createdByStaffId: input.createdByStaffId,
        });
      }
      if (newConsumedQuantity > 0) {
        await writeWorkshopStockLedgerDeltaTx(tx, {
          workshopJobId,
          partId,
          variantId: existing.variantId,
          quantityDelta: -newConsumedQuantity,
          stockLocationId: nextState.stockLocationId,
          note: input.note ?? "Workshop part consumed",
          createdByStaffId: input.createdByStaffId,
        });
      }
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
            stockLocationId: existing.stockLocationId,
          },
          to: {
            quantity: updated.quantity,
            unitPriceAtTime: updated.unitPriceAtTime,
            costPriceAtTime: updated.costPriceAtTime,
            status: updated.status,
            stockLocationId: updated.stockLocationId,
          },
          stockQuantityDelta: newConsumedQuantity - oldConsumedQuantity,
        },
      },
      auditActor,
    );

    const snapshot = await getWorkshopJobPartsSnapshotTx(tx, workshopJobId);

    return {
      part: toPartResponse(updated),
      parts: snapshot.parts,
      totals: snapshot.totals,
      overview: snapshot.overview,
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
        stockLocation: {
          select: {
            id: true,
            name: true,
            isDefault: true,
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
        stockLocationId: existing.stockLocationId,
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
          stockLocationId: existing.stockLocationId,
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
      overview: snapshot.overview,
    };
  });
};

export const listWorkshopJobParts = async (workshopJobId: string) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  const snapshot = await prisma.$transaction((tx) => getWorkshopJobPartsSnapshotTx(tx, workshopJobId));

  return {
    workshopJobId,
    stockLocation: snapshot.overview.stockLocation,
    summary: snapshot.overview.summary,
    requirements: snapshot.overview.requirements,
    parts: snapshot.parts,
    totals: snapshot.totals,
  };
};
