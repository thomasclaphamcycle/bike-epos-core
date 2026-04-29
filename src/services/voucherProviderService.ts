import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";

type VoucherProviderInput = {
  name?: unknown;
  commissionBps?: unknown;
  isActive?: unknown;
  notes?: unknown;
};

const normalizeName = (value: unknown, existingName?: string) => {
  if (value === undefined) {
    if (existingName !== undefined) {
      return existingName;
    }
    throw new HttpError(400, "name is required", "INVALID_VOUCHER_PROVIDER");
  }
  if (typeof value !== "string") {
    throw new HttpError(400, "name must be a string", "INVALID_VOUCHER_PROVIDER");
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new HttpError(400, "name is required", "INVALID_VOUCHER_PROVIDER");
  }
  if (normalized.length > 120) {
    throw new HttpError(400, "name must be 120 characters or fewer", "INVALID_VOUCHER_PROVIDER");
  }

  return normalized;
};

const normalizeCommissionBps = (value: unknown, existingCommissionBps = 0) => {
  if (value === undefined) {
    return existingCommissionBps;
  }
  if (!Number.isInteger(value) || value < 0 || value > 10000) {
    throw new HttpError(
      400,
      "commissionBps must be a whole number from 0 to 10000",
      "INVALID_VOUCHER_PROVIDER",
    );
  }

  return value;
};

const normalizeIsActive = (value: unknown, existingIsActive = true) => {
  if (value === undefined) {
    return existingIsActive;
  }
  if (typeof value !== "boolean") {
    throw new HttpError(400, "isActive must be a boolean", "INVALID_VOUCHER_PROVIDER");
  }

  return value;
};

const normalizeNotes = (value: unknown, existingNotes?: string | null) => {
  if (value === undefined) {
    return existingNotes ?? null;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, "notes must be a string or null", "INVALID_VOUCHER_PROVIDER");
  }

  const normalized = value.trim();
  if (normalized.length > 500) {
    throw new HttpError(400, "notes must be 500 characters or fewer", "INVALID_VOUCHER_PROVIDER");
  }

  return normalized || null;
};

const toVoucherProviderResponse = (provider: {
  id: string;
  name: string;
  commissionBps: number;
  isActive: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: provider.id,
  name: provider.name,
  commissionBps: provider.commissionBps,
  isActive: provider.isActive,
  notes: provider.notes,
  createdAt: provider.createdAt,
  updatedAt: provider.updatedAt,
});

const handleUniqueProviderNameError = (error: unknown): never => {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new HttpError(409, "A voucher provider with that name already exists", "VOUCHER_PROVIDER_EXISTS");
  }

  throw error;
};

export const listVoucherProviders = async (input: { activeOnly?: boolean } = {}) => {
  const providers = await prisma.voucherProvider.findMany({
    where: input.activeOnly ? { isActive: true } : undefined,
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });

  return {
    providers: providers.map(toVoucherProviderResponse),
  };
};

export const createVoucherProvider = async (input: VoucherProviderInput) => {
  const name = normalizeName(input.name);
  const commissionBps = normalizeCommissionBps(input.commissionBps);
  const isActive = normalizeIsActive(input.isActive);
  const notes = normalizeNotes(input.notes);

  try {
    const provider = await prisma.voucherProvider.create({
      data: {
        name,
        commissionBps,
        isActive,
        notes,
      },
    });

    return {
      provider: toVoucherProviderResponse(provider),
    };
  } catch (error) {
    handleUniqueProviderNameError(error);
  }
};

export const updateVoucherProvider = async (providerId: string, input: VoucherProviderInput) => {
  if (!isUuid(providerId)) {
    throw new HttpError(400, "Invalid voucher provider id", "INVALID_VOUCHER_PROVIDER_ID");
  }

  const existing = await prisma.voucherProvider.findUnique({
    where: { id: providerId },
  });
  if (!existing) {
    throw new HttpError(404, "Voucher provider not found", "VOUCHER_PROVIDER_NOT_FOUND");
  }

  const name = normalizeName(input.name, existing.name);
  const commissionBps = normalizeCommissionBps(input.commissionBps, existing.commissionBps);
  const isActive = normalizeIsActive(input.isActive, existing.isActive);
  const notes = normalizeNotes(input.notes, existing.notes);

  try {
    const provider = await prisma.voucherProvider.update({
      where: { id: providerId },
      data: {
        name,
        commissionBps,
        isActive,
        notes,
      },
    });

    return {
      provider: toVoucherProviderResponse(provider),
    };
  } catch (error) {
    handleUniqueProviderNameError(error);
  }
};
