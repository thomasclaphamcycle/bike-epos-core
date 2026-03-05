import { Prisma } from "@prisma/client";
import { HttpError } from "../utils/http";

type DbClient = Pick<
  Prisma.TransactionClient,
  | "stockReservation"
  | "inventoryMovement"
  | "workshopJob"
  | "workshopJobLine"
  | "sale"
  | "saleItem"
>;

export const getReservedQuantityForVariantTx = async (
  tx: DbClient,
  variantId: string,
): Promise<number> => {
  const aggregate = await tx.stockReservation.aggregate({
    where: { variantId },
    _sum: { quantity: true },
  });

  return aggregate._sum.quantity ?? 0;
};

export const getOnHandQuantityForVariantTx = async (
  tx: DbClient,
  variantId: string,
): Promise<number> => {
  const aggregate = await tx.inventoryMovement.aggregate({
    where: { variantId },
    _sum: { quantity: true },
  });

  return aggregate._sum.quantity ?? 0;
};

export const getVariantAvailabilityTx = async (
  tx: DbClient,
  variantId: string,
) => {
  const [onHandQty, reservedQty] = await Promise.all([
    getOnHandQuantityForVariantTx(tx, variantId),
    getReservedQuantityForVariantTx(tx, variantId),
  ]);

  return {
    onHandQty,
    reservedQty,
    availableQty: onHandQty - reservedQty,
  };
};

export const getReservedQuantityByVariantIdsTx = async (
  tx: DbClient,
  variantIds: string[],
): Promise<Map<string, number>> => {
  if (variantIds.length === 0) {
    return new Map();
  }

  const grouped = await tx.stockReservation.groupBy({
    by: ["variantId"],
    where: {
      variantId: {
        in: variantIds,
      },
    },
    _sum: {
      quantity: true,
    },
  });

  return new Map(grouped.map((row) => [row.variantId, row._sum.quantity ?? 0]));
};

export const consumeReservationsForSaleTx = async (
  tx: DbClient,
  input: {
    workshopJobId: string;
    saleId: string;
  },
) => {
  const sale = await tx.sale.findUnique({
    where: { id: input.saleId },
    select: {
      id: true,
      workshopJobId: true,
      completedAt: true,
    },
  });

  if (!sale) {
    throw new HttpError(404, "Sale not found", "SALE_NOT_FOUND");
  }
  if (sale.workshopJobId !== input.workshopJobId) {
    throw new HttpError(
      409,
      "Sale is not linked to the specified workshop job",
      "WORKSHOP_SALE_MISMATCH",
    );
  }
  if (!sale.completedAt) {
    return {
      consumedQuantity: 0,
      updatedReservationCount: 0,
      deletedReservationCount: 0,
    };
  }

  const saleItems = await tx.saleItem.findMany({
    where: { saleId: input.saleId },
    select: {
      variantId: true,
      quantity: true,
    },
  });

  if (saleItems.length === 0) {
    return {
      consumedQuantity: 0,
      updatedReservationCount: 0,
      deletedReservationCount: 0,
    };
  }

  const remainingToConsumeByVariant = new Map<string, number>();
  for (const item of saleItems) {
    remainingToConsumeByVariant.set(
      item.variantId,
      (remainingToConsumeByVariant.get(item.variantId) ?? 0) + item.quantity,
    );
  }

  const reservations = await tx.stockReservation.findMany({
    where: {
      workshopJobId: input.workshopJobId,
      variantId: {
        in: Array.from(remainingToConsumeByVariant.keys()),
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      variantId: true,
      quantity: true,
    },
  });

  let consumedQuantity = 0;
  let updatedReservationCount = 0;
  let deletedReservationCount = 0;

  for (const reservation of reservations) {
    const remainingForVariant = remainingToConsumeByVariant.get(reservation.variantId) ?? 0;
    if (remainingForVariant <= 0) {
      continue;
    }

    const consumeQty = Math.min(reservation.quantity, remainingForVariant);
    if (consumeQty <= 0) {
      continue;
    }

    const nextQty = reservation.quantity - consumeQty;
    if (nextQty <= 0) {
      await tx.stockReservation.delete({
        where: { id: reservation.id },
      });
      deletedReservationCount += 1;
    } else {
      await tx.stockReservation.update({
        where: { id: reservation.id },
        data: { quantity: nextQty },
      });
      updatedReservationCount += 1;
    }

    consumedQuantity += consumeQty;
    remainingToConsumeByVariant.set(reservation.variantId, remainingForVariant - consumeQty);
  }

  return {
    consumedQuantity,
    updatedReservationCount,
    deletedReservationCount,
  };
};

export const releaseReservationsForJobTx = async (
  tx: DbClient,
  workshopJobId: string,
) => {
  const result = await tx.stockReservation.deleteMany({
    where: { workshopJobId },
  });
  return {
    releasedCount: result.count,
  };
};

export const computeWorkshopPartsReconciliationTx = async (
  tx: DbClient,
  workshopJobId: string,
) => {
  const job = await tx.workshopJob.findUnique({
    where: { id: workshopJobId },
    select: {
      id: true,
      sale: {
        select: {
          id: true,
          completedAt: true,
        },
      },
    },
  });

  if (!job) {
    throw new HttpError(404, "Workshop job not found", "WORKSHOP_JOB_NOT_FOUND");
  }

  const partLines = await tx.workshopJobLine.findMany({
    where: {
      jobId: workshopJobId,
      type: "PART",
    },
    select: {
      variantId: true,
      qty: true,
    },
  });

  const requiredByVariant = new Map<string, number>();
  for (const line of partLines) {
    if (!line.variantId) {
      continue;
    }
    requiredByVariant.set(line.variantId, (requiredByVariant.get(line.variantId) ?? 0) + line.qty);
  }

  const soldByVariant = new Map<string, number>();
  if (job.sale?.id && job.sale.completedAt) {
    const soldItems = await tx.saleItem.findMany({
      where: {
        saleId: job.sale.id,
        ...(requiredByVariant.size > 0
          ? {
              variantId: {
                in: Array.from(requiredByVariant.keys()),
              },
            }
          : {}),
      },
      select: {
        variantId: true,
        quantity: true,
      },
    });

    for (const soldItem of soldItems) {
      soldByVariant.set(
        soldItem.variantId,
        (soldByVariant.get(soldItem.variantId) ?? 0) + soldItem.quantity,
      );
    }
  }

  const reservations = await tx.stockReservation.findMany({
    where: { workshopJobId },
    select: {
      variantId: true,
      quantity: true,
    },
  });

  const reservedByVariant = new Map<string, number>();
  for (const reservation of reservations) {
    reservedByVariant.set(
      reservation.variantId,
      (reservedByVariant.get(reservation.variantId) ?? 0) + reservation.quantity,
    );
  }

  let requiredQty = 0;
  let soldQty = 0;
  let requiredRemainingQty = 0;
  for (const [variantId, qty] of requiredByVariant.entries()) {
    requiredQty += qty;
    const sold = soldByVariant.get(variantId) ?? 0;
    soldQty += sold;
    requiredRemainingQty += Math.max(0, qty - sold);
  }

  const reservedQty = Array.from(reservedByVariant.values()).reduce((sum, qty) => sum + qty, 0);

  const unresolvedVariants = Array.from(requiredByVariant.entries()).some(([variantId, qty]) => {
    const sold = soldByVariant.get(variantId) ?? 0;
    const remaining = Math.max(0, qty - sold);
    if (remaining === 0) {
      return false;
    }
    const reserved = reservedByVariant.get(variantId) ?? 0;
    return reserved < remaining;
  });

  return {
    requiredQty,
    soldQty,
    requiredRemainingQty,
    reservedQty,
    shortageQty: Math.max(0, requiredRemainingQty - reservedQty),
    partsStatus: unresolvedVariants ? ("SHORT" as const) : ("OK" as const),
  };
};
