import { prisma } from "../lib/prisma";

export const listStockLocations = async () => {
  const locations = await prisma.stockLocation.findMany({
    orderBy: [{ isDefault: "desc" }, { name: "asc" }, { createdAt: "asc" }],
  });

  return {
    locations: locations.map((location) => ({
      id: location.id,
      name: location.name,
      isDefault: location.isDefault,
      createdAt: location.createdAt,
    })),
  };
};
