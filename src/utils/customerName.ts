import { Prisma } from "@prisma/client";
import { HttpError } from "./http";

const normalizeOptionalText = (value: string | undefined | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeNameWord = (value: string) =>
  value
    .split("-")
    .map((segment) => {
      if (!segment) {
        return segment;
      }

      const lower = segment.toLowerCase();
      return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join("-");

export const normalizeNamePart = (value: string | undefined | null): string => {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return "";
  }

  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeNameWord)
    .join(" ");
};

export const parseCombinedCustomerName = (
  value: string | undefined | null,
): { firstName: string; lastName: string } => {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw new HttpError(400, "name must not be empty", "INVALID_CUSTOMER");
  }

  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    throw new HttpError(400, "name must not be empty", "INVALID_CUSTOMER");
  }

  return {
    firstName: normalizeNamePart(tokens[0] ?? ""),
    lastName: normalizeNamePart(tokens.slice(1).join(" ")),
  };
};

export const getCustomerDisplayName = (
  customer: {
    firstName?: string | null;
    lastName?: string | null;
  },
  fallback = "Unknown customer",
) => {
  const firstName = normalizeOptionalText(customer.firstName);
  const lastName = normalizeOptionalText(customer.lastName);
  const combined = [firstName, lastName].filter(Boolean).join(" ").trim();
  return combined || fallback;
};

export const buildCustomerSearchWhere = (query: string): Prisma.CustomerWhereInput => {
  const normalized = query.trim();
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const compoundNameClauses: Prisma.CustomerWhereInput[] = [];

  if (tokens.length > 1) {
    const firstName = tokens[0] ?? "";
    const lastName = tokens.slice(1).join(" ");
    compoundNameClauses.push({
      AND: [
        { firstName: { contains: firstName, mode: "insensitive" } },
        { lastName: { contains: lastName, mode: "insensitive" } },
      ],
    });
    compoundNameClauses.push({
      AND: [
        { firstName: { contains: lastName, mode: "insensitive" } },
        { lastName: { contains: firstName, mode: "insensitive" } },
      ],
    });
  }

  return {
    OR: [
      { firstName: { contains: normalized, mode: "insensitive" } },
      { lastName: { contains: normalized, mode: "insensitive" } },
      ...compoundNameClauses,
      { email: { contains: normalized, mode: "insensitive" } },
      { phone: { contains: normalized, mode: "insensitive" } },
      { postcode: { contains: normalized, mode: "insensitive" } },
      { addressLine1: { contains: normalized, mode: "insensitive" } },
      { addressLine2: { contains: normalized, mode: "insensitive" } },
      { city: { contains: normalized, mode: "insensitive" } },
    ],
  };
};
