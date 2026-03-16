import { Prisma } from "@prisma/client";
import { Request } from "express";
import { assertRoleAtLeast } from "../middleware/staffRole";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { createAuditEventTx, type AuditActor } from "./auditService";

const LOCATION_CODE_HEADER = "x-location-code";
const LOCATION_CODE_REGEX = /^[A-Z0-9_-]{2,24}$/;
const DEFAULT_LOCATION_CODE = (process.env.DEFAULT_LOCATION_CODE ?? "MAIN").trim().toUpperCase();
const DEFAULT_LOCATION_NAME = process.env.DEFAULT_LOCATION_NAME?.trim() || "Main";

if (!LOCATION_CODE_REGEX.test(DEFAULT_LOCATION_CODE)) {
  throw new Error(
    "DEFAULT_LOCATION_CODE must match /^[A-Z0-9_-]{2,24}$/ (for example: MAIN, BRANCH_1)",
  );
}

type LocationTx = Prisma.TransactionClient;
type StockLocation = {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: Date;
};

type BusinessLocation = {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const normalizeText = (value: string | undefined | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeLocationCodeOrThrow = (
  value: string | undefined,
  code: string,
) => {
  const normalized = normalizeText(value)?.toUpperCase();
  if (!normalized) {
    throw new HttpError(400, "code is required", code);
  }
  if (!LOCATION_CODE_REGEX.test(normalized)) {
    throw new HttpError(
      400,
      "code must use only A-Z, 0-9, underscore, or dash (2-24 chars)",
      code,
    );
  }
  return normalized;
};

const toRequestLocation = (
  location: BusinessLocation,
  stockLocationId: string | null,
) => ({
  id: location.id,
  locationId: location.id,
  stockLocationId,
  name: location.name,
  code: location.code,
  isActive: location.isActive,
  createdAt: location.createdAt,
  updatedAt: location.updatedAt,
});

const toNameKey = (name: string) => name.trim().toLowerCase();

const findLocationByCodeTx = async (
  tx: LocationTx,
  code: string,
) =>
  tx.location.findFirst({
    where: {
      code: {
        equals: code,
        mode: "insensitive",
      },
    },
  });

const findLocationByNameTx = async (tx: LocationTx, name: string) =>
  tx.location.findFirst({
    where: {
      name: {
        equals: name,
        mode: "insensitive",
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

const findStockLocationByNameTx = async (tx: LocationTx, name: string) =>
  tx.stockLocation.findFirst({
    where: {
      name: {
        equals: name,
        mode: "insensitive",
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

const ensureStockLocationForBusinessLocationTx = async (
  tx: LocationTx,
  location: BusinessLocation,
) => {
  const defaultLocation = await ensureDefaultLocationTx(tx);
  if (location.id === defaultLocation.id) {
    return ensureDefaultStockLocationTx(tx);
  }

  const existing = await findStockLocationByNameTx(tx, location.name);
  if (existing) {
    return existing;
  }

  return tx.stockLocation.create({
    data: {
      name: location.name,
      isDefault: false,
    },
  });
};

export const ensureDefaultStockLocationTx = async (tx: LocationTx): Promise<StockLocation> => {
  const existingDefault = await tx.stockLocation.findFirst({
    where: { isDefault: true },
    orderBy: { createdAt: "asc" },
  });
  if (existingDefault) {
    return existingDefault;
  }

  return tx.stockLocation.create({
    data: {
      name: DEFAULT_LOCATION_NAME,
      isDefault: true,
    },
  });
};

export const ensureDefaultLocationTx = async (tx: LocationTx) => {
  const existing = await findLocationByCodeTx(tx, DEFAULT_LOCATION_CODE);
  if (existing) {
    await ensureDefaultStockLocationTx(tx);
    return existing;
  }

  try {
    const created = await tx.location.create({
      data: {
        name: DEFAULT_LOCATION_NAME,
        code: DEFAULT_LOCATION_CODE,
        isActive: true,
      },
    });
    await ensureDefaultStockLocationTx(tx);
    return created;
  } catch (error) {
    const prismaError = error as { code?: string };
    if (prismaError.code === "P2002") {
      const retried = await findLocationByCodeTx(tx, DEFAULT_LOCATION_CODE);
      if (retried) {
        await ensureDefaultStockLocationTx(tx);
        return retried;
      }
    }
    throw error;
  }
};

export const ensureDefaultLocation = async () =>
  prisma.$transaction((tx) => ensureDefaultLocationTx(tx));

export const getOrCreateDefaultLocationTx = ensureDefaultLocationTx;
export const getOrCreateDefaultLocation = ensureDefaultLocation;

export const resolveLocationByCodeOrThrowTx = async (
  tx: LocationTx,
  code: string,
) => {
  const location = await findLocationByCodeTx(tx, code);
  if (!location) {
    throw new HttpError(404, "Location not found", "LOCATION_NOT_FOUND");
  }
  return location;
};

export const resolveLocationByCodeOrThrow = async (code: string) =>
  prisma.$transaction((tx) => resolveLocationByCodeOrThrowTx(tx, code));

export const resolveRequestLocation = async (req: Request) => {
  if (req.location) {
    return req.location;
  }

  const headerCode = normalizeText(req.header(LOCATION_CODE_HEADER) ?? undefined)?.toUpperCase();
  if (headerCode && !LOCATION_CODE_REGEX.test(headerCode)) {
    throw new HttpError(
      400,
      "X-Location-Code must match /^[A-Z0-9_-]{2,24}$/",
      "INVALID_LOCATION_CODE",
    );
  }

  if (headerCode) {
    // Header override is only for authenticated staff/admin requests.
    assertRoleAtLeast(req, "STAFF");
  }

  const code = headerCode ?? DEFAULT_LOCATION_CODE;
  const location = await prisma.$transaction(async (tx) =>
    code === DEFAULT_LOCATION_CODE
      ? ensureDefaultLocationTx(tx)
      : resolveLocationByCodeOrThrowTx(tx, code),
  );

  const stockLocation = await prisma.$transaction((tx) =>
    ensureStockLocationForBusinessLocationTx(tx, location),
  );

  req.location = toRequestLocation(location, stockLocation?.id ?? null);
  return req.location;
};

export const resolveInventoryStockLocationIdTx = async (
  tx: LocationTx,
  requestedLocationId?: string | null,
) => {
  const normalizedLocationId = normalizeText(requestedLocationId);
  if (!normalizedLocationId) {
    const defaultStockLocation = await ensureDefaultStockLocationTx(tx);
    return defaultStockLocation.id;
  }

  if (isUuid(normalizedLocationId)) {
    const stockLocation = await tx.stockLocation.findUnique({
      where: { id: normalizedLocationId },
      select: { id: true },
    });
    if (stockLocation) {
      return stockLocation.id;
    }
  }

  const location = await tx.location.findUnique({
    where: { id: normalizedLocationId },
  });
  if (!location) {
    throw new HttpError(404, "Location not found", "LOCATION_NOT_FOUND");
  }

  const mappedStockLocation = await ensureStockLocationForBusinessLocationTx(tx, location);
  return mappedStockLocation.id;
};

export const listLocations = async () => {
  return prisma.$transaction(async (tx) => {
    const defaultLocation = await ensureDefaultLocationTx(tx);
    const defaultStockLocation = await ensureDefaultStockLocationTx(tx);
    const locations = await tx.location.findMany({
      orderBy: [{ createdAt: "asc" }],
    });
    const stockLocations = await tx.stockLocation.findMany({
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });

    const stockLocationByName = new Map<string, StockLocation>();
    for (const stockLocation of stockLocations) {
      const key = toNameKey(stockLocation.name);
      if (!stockLocationByName.has(key)) {
        stockLocationByName.set(key, stockLocation);
      }
    }

    for (const location of locations) {
      if (location.id === defaultLocation.id) {
        continue;
      }
      const key = toNameKey(location.name);
      if (stockLocationByName.has(key)) {
        continue;
      }

      const created = await tx.stockLocation.create({
        data: {
          name: location.name,
          isDefault: false,
        },
      });
      stockLocationByName.set(key, created);
    }

    return {
      defaultLocationCode: DEFAULT_LOCATION_CODE,
      locations: locations.map((location) => {
        const stockLocation =
          location.id === defaultLocation.id
            ? defaultStockLocation
            : stockLocationByName.get(toNameKey(location.name)) ?? null;

        const isDefault =
          location.id === defaultLocation.id || Boolean(stockLocation?.isDefault);

        // `id` keeps legacy consumers working (stock-location id) while `locationId`
        // is the canonical id for location-scoped APIs.
        return {
          id: stockLocation?.id ?? location.id,
          locationId: location.id,
          stockLocationId: stockLocation?.id ?? null,
          name: location.name,
          code: location.code,
          isActive: location.isActive,
          isDefault,
          createdAt: location.createdAt,
          updatedAt: location.updatedAt,
        };
      }),
    };
  });
};

export const createLocation = async (
  input: {
    name?: string;
    code?: string;
  },
  auditActor?: AuditActor,
) => {
  const name = normalizeText(input.name);
  if (!name) {
    throw new HttpError(400, "name is required", "INVALID_LOCATION_CREATE");
  }

  const code = normalizeLocationCodeOrThrow(input.code, "INVALID_LOCATION_CREATE");

  return prisma.$transaction(async (tx) => {
    const existingByName = await findLocationByNameTx(tx, name);
    if (existingByName) {
      throw new HttpError(409, "Location name already exists", "LOCATION_NAME_EXISTS");
    }

    let created;
    try {
      created = await tx.location.create({
        data: {
          name,
          code,
          isActive: true,
        },
      });
    } catch (error) {
      const prismaError = error as { code?: string };
      if (prismaError.code === "P2002") {
        throw new HttpError(409, "Location code already exists", "LOCATION_CODE_EXISTS");
      }
      throw error;
    }
    const createdStockLocation = await tx.stockLocation.create({
      data: {
        name: created.name,
        isDefault: false,
      },
    });

    await createAuditEventTx(
      tx,
      {
        action: "LOCATION_CREATED",
        entityType: "LOCATION",
        entityId: created.id,
        metadata: {
          code: created.code,
          name: created.name,
        },
      },
      auditActor,
    );

    return {
      id: createdStockLocation.id,
      locationId: created.id,
      stockLocationId: createdStockLocation.id,
      name: created.name,
      code: created.code,
      isActive: created.isActive,
      isDefault: false,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  });
};

export const getDefaultLocationCode = () => DEFAULT_LOCATION_CODE;
