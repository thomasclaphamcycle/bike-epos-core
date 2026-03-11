import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

const DEFAULT_LOCATION_CODE = (() => {
  const raw = (process.env.DEFAULT_LOCATION_CODE ?? "MAIN").trim().toUpperCase();
  return raw.length > 0 ? raw : "MAIN";
})();

const DEFAULT_LOCATION_NAME = DEFAULT_LOCATION_CODE === "MAIN" ? "Main" : DEFAULT_LOCATION_CODE;

const findDefaultLocationTx = async (tx: Prisma.TransactionClient) =>
  tx.location.findFirst({
    where: {
      code: {
        equals: DEFAULT_LOCATION_CODE,
        mode: "insensitive",
      },
    },
    orderBy: { createdAt: "asc" },
  });

export const getOrCreateDefaultLocationTx = async (tx: Prisma.TransactionClient) => {
  const existing = await findDefaultLocationTx(tx);
  if (existing) {
    return existing;
  }

  return tx.location.create({
    data: {
      name: DEFAULT_LOCATION_NAME,
      code: DEFAULT_LOCATION_CODE,
      isActive: true,
    },
  });
};

export const getOrCreateDefaultLocation = async () =>
  prisma.$transaction((tx) => getOrCreateDefaultLocationTx(tx));

export const listStockLocations = async () => {
  const locations = await prisma.stockLocation.findMany({
    orderBy: [
      { isDefault: "desc" },
      { name: "asc" },
      { createdAt: "asc" },
    ],
  });

  return {
    locations: locations.map((location) => ({
      id: location.id,
      name: location.name,
      isDefault: location.isDefault,
    })),
  };
};
