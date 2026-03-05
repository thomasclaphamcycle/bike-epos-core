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

const parseOptionalIsoDate = (
  value: string | undefined,
  fieldName: "from" | "to",
): Date | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, `${fieldName} must be a valid ISO date`, "INVALID_CUSTOMER_FILTER");
  }

  return parsed;
};

const parseOptionalTake = (value: number | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 1 || value > 200) {
    throw new HttpError(
      400,
      "take must be an integer between 1 and 200",
      "INVALID_CUSTOMER_FILTER",
    );
  }
  return value;
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

export const listCustomerSales = async (input: {
  customerId: string;
  from?: string;
  to?: string;
  take?: number;
}) => {
  if (!isUuid(input.customerId)) {
    throw new HttpError(400, "Invalid customer id", "INVALID_CUSTOMER_ID");
  }

  const customer = await prisma.customer.findUnique({
    where: { id: input.customerId },
    select: { id: true },
  });
  if (!customer) {
    throw new HttpError(404, "Customer not found", "CUSTOMER_NOT_FOUND");
  }

  const fromDate = parseOptionalIsoDate(input.from, "from");
  const toDate = parseOptionalIsoDate(input.to, "to");
  const take = parseOptionalTake(input.take) ?? 50;

  const sales = await prisma.sale.findMany({
    where: {
      customerId: input.customerId,
      completedAt: {
        not: null,
        ...(fromDate ? { gte: fromDate } : {}),
        ...(toDate ? { lte: toDate } : {}),
      },
    },
    orderBy: [{ completedAt: "desc" }],
    take,
    select: {
      id: true,
      subtotalPence: true,
      taxPence: true,
      totalPence: true,
      completedAt: true,
      createdAt: true,
      receipt: {
        select: {
          receiptNumber: true,
        },
      },
    },
  });

  return {
    customerId: input.customerId,
    sales: sales.map((sale) => ({
      id: sale.id,
      subtotalPence: sale.subtotalPence,
      taxPence: sale.taxPence,
      totalPence: sale.totalPence,
      completedAt: sale.completedAt,
      createdAt: sale.createdAt,
      receiptNumber: sale.receipt?.receiptNumber ?? null,
      receiptUrl: sale.receipt?.receiptNumber ? `/r/${sale.receipt.receiptNumber}` : null,
    })),
  };
};

export const listCustomerWorkshopJobs = async (input: {
  customerId: string;
  from?: string;
  to?: string;
  take?: number;
}) => {
  if (!isUuid(input.customerId)) {
    throw new HttpError(400, "Invalid customer id", "INVALID_CUSTOMER_ID");
  }

  const customer = await prisma.customer.findUnique({
    where: { id: input.customerId },
    select: { id: true },
  });
  if (!customer) {
    throw new HttpError(404, "Customer not found", "CUSTOMER_NOT_FOUND");
  }

  const fromDate = parseOptionalIsoDate(input.from, "from");
  const toDate = parseOptionalIsoDate(input.to, "to");
  const take = parseOptionalTake(input.take) ?? 50;

  const jobs = await prisma.workshopJob.findMany({
    where: {
      customerId: input.customerId,
      createdAt: {
        ...(fromDate ? { gte: fromDate } : {}),
        ...(toDate ? { lte: toDate } : {}),
      },
    },
    orderBy: [{ createdAt: "desc" }],
    take,
    select: {
      id: true,
      status: true,
      customerName: true,
      bikeDescription: true,
      notes: true,
      scheduledDate: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return {
    customerId: input.customerId,
    workshopJobs: jobs.map((job) => ({
      id: job.id,
      status: job.status,
      customerName: job.customerName,
      bikeDescription: job.bikeDescription,
      notes: job.notes,
      scheduledDate: job.scheduledDate,
      completedAt: job.completedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    })),
  };
};
