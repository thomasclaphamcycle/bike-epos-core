import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";

type CreateCustomerInput = {
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  notes?: string;
};

const normalizeOptionalText = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const splitNameToParts = (name: string): { firstName: string; lastName: string } => {
  const tokens = name
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    throw new HttpError(400, "name must not be empty", "INVALID_CUSTOMER");
  }

  if (tokens.length === 1) {
    return {
      firstName: tokens[0],
      lastName: tokens[0],
    };
  }

  return {
    firstName: tokens[0],
    lastName: tokens.slice(1).join(" "),
  };
};

const toDisplayName = (customer: {
  name: string;
  firstName: string;
  lastName: string;
}) => {
  const explicit = normalizeOptionalText(customer.name);
  if (explicit) {
    return explicit;
  }

  return [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();
};

const toCustomerResponse = (customer: {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) => {
  const name = toDisplayName(customer);

  return {
    id: customer.id,
    name,
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    phone: customer.phone,
    notes: customer.notes,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
};

export const createCustomer = async (input: CreateCustomerInput) => {
  const explicitName = normalizeOptionalText(input.name);
  const suppliedFirstName = normalizeOptionalText(input.firstName);
  const suppliedLastName = normalizeOptionalText(input.lastName);

  let firstName = suppliedFirstName;
  let lastName = suppliedLastName;
  let name = explicitName;

  if (name && (!firstName || !lastName)) {
    const split = splitNameToParts(name);
    firstName = firstName ?? split.firstName;
    lastName = lastName ?? split.lastName;
  }

  if (!name && firstName && lastName) {
    name = `${firstName} ${lastName}`;
  }

  if (!name || !firstName || !lastName) {
    throw new HttpError(
      400,
      "name is required (or provide firstName and lastName)",
      "INVALID_CUSTOMER",
    );
  }

  const email = normalizeOptionalText(input.email)?.toLowerCase();
  const phone = normalizeOptionalText(input.phone);
  const notes = normalizeOptionalText(input.notes);

  try {
    const customer = await prisma.customer.create({
      data: {
        name,
        firstName,
        lastName,
        email,
        phone,
        notes,
      },
    });

    return toCustomerResponse(customer);
  } catch (error) {
    const prismaError = error as { code?: string };
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

export const searchCustomers = async (query?: string, take = 20) => {
  const normalizedQuery = normalizeOptionalText(query);

  const customers = await prisma.customer.findMany({
    where: normalizedQuery
      ? {
          OR: [
            { name: { contains: normalizedQuery, mode: "insensitive" } },
            { firstName: { contains: normalizedQuery, mode: "insensitive" } },
            { lastName: { contains: normalizedQuery, mode: "insensitive" } },
            { email: { contains: normalizedQuery, mode: "insensitive" } },
            { phone: { contains: normalizedQuery, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take,
  });

  return {
    customers: customers.map(toCustomerResponse),
  };
};

export const listCustomerSales = async (customerId: string) => {
  if (!isUuid(customerId)) {
    throw new HttpError(400, "Invalid customer id", "INVALID_CUSTOMER_ID");
  }

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true },
  });
  if (!customer) {
    throw new HttpError(404, "Customer not found", "CUSTOMER_NOT_FOUND");
  }

  const sales = await prisma.sale.findMany({
    where: {
      customerId,
      completedAt: {
        not: null,
      },
    },
    include: {
      receipt: {
        select: {
          receiptNumber: true,
        },
      },
    },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    take: 50,
  });

  return {
    sales: sales.map((sale) => ({
      id: sale.id,
      totalPence: sale.totalPence,
      createdAt: sale.createdAt,
      completedAt: sale.completedAt,
      receiptNumber: sale.receipt?.receiptNumber ?? sale.receiptNumber ?? null,
    })),
  };
};

export const listCustomerWorkshopJobs = async (customerId: string) => {
  if (!isUuid(customerId)) {
    throw new HttpError(400, "Invalid customer id", "INVALID_CUSTOMER_ID");
  }

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true },
  });
  if (!customer) {
    throw new HttpError(404, "Customer not found", "CUSTOMER_NOT_FOUND");
  }

  const jobs = await prisma.workshopJob.findMany({
    where: { customerId },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: 50,
    select: {
      id: true,
      status: true,
      bikeDescription: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
      completedAt: true,
    },
  });

  return {
    jobs,
  };
};
