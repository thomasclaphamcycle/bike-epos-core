import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";

type CreateCustomerInput = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  notes?: string;
};

const toCustomerResponse = (customer: {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) => {
  return {
    id: customer.id,
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    phone: customer.phone,
    notes: customer.notes,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
};

const normalizeOptionalText = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const createCustomer = async (input: CreateCustomerInput) => {
  const firstName = normalizeOptionalText(input.firstName);
  const lastName = normalizeOptionalText(input.lastName);

  if (!firstName || !lastName) {
    throw new HttpError(400, "firstName and lastName are required", "INVALID_CUSTOMER");
  }

  const email = normalizeOptionalText(input.email)?.toLowerCase();
  const phone = normalizeOptionalText(input.phone);
  const notes = normalizeOptionalText(input.notes);

  try {
    const customer = await prisma.customer.create({
      data: {
        firstName,
        lastName,
        email,
        phone,
        notes,
      },
    });

    return toCustomerResponse(customer);
  } catch (error) {
    const prismaError = error as { code?: string; meta?: { target?: unknown } };
    if (prismaError.code === "P2002") {
      throw new HttpError(409, "Customer email already exists", "CUSTOMER_EMAIL_EXISTS");
    }
    throw error;
  }
};

export const getCustomerById = async (customerId: string) => {
  if (!isUuid(customerId)) {
    throw new HttpError(400, "Invalid customer id", "INVALID_CUSTOMER_ID");
  }

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) {
    throw new HttpError(404, "Customer not found", "CUSTOMER_NOT_FOUND");
  }

  return toCustomerResponse(customer);
};

export const searchCustomers = async (query?: string) => {
  const normalizedQuery = normalizeOptionalText(query);

  const where = normalizedQuery
    ? {
        OR: [
          { firstName: { contains: normalizedQuery, mode: "insensitive" as const } },
          { lastName: { contains: normalizedQuery, mode: "insensitive" as const } },
          { email: { contains: normalizedQuery, mode: "insensitive" as const } },
          { phone: { contains: normalizedQuery, mode: "insensitive" as const } },
        ],
      }
    : undefined;

  const customers = await prisma.customer.findMany({
    where,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  return {
    customers: customers.map(toCustomerResponse),
  };
};
