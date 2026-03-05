import { Prisma } from "@prisma/client";

type DbClient = Pick<Prisma.TransactionClient, "stockReservation" | "inventoryMovement">;

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
