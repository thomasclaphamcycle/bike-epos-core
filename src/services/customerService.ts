import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import {
  buildCustomerSearchWhere,
  getCustomerDisplayName,
  normalizeNamePart,
  parseCombinedCustomerName,
} from "../utils/customerName";
import { toWorkshopExecutionStatus } from "./workshopStatusService";

type CreateCustomerInput = {
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  notes?: string;
};

type UpdateCustomerCommunicationPreferencesInput = {
  emailAllowed: boolean;
  smsAllowed: boolean;
  whatsappAllowed: boolean;
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

const toCustomerResponse = (customer: {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  emailAllowed: boolean;
  smsAllowed: boolean;
  whatsappAllowed: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) => {
  const name = getCustomerDisplayName(customer);

  return {
    id: customer.id,
    name,
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    phone: customer.phone,
    emailAllowed: customer.emailAllowed,
    smsAllowed: customer.smsAllowed,
    whatsappAllowed: customer.whatsappAllowed,
    notes: customer.notes,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
};

const assertCustomerExists = async (customerId: string) => {
  if (!isUuid(customerId)) {
    throw new HttpError(400, "Invalid customer id", "INVALID_CUSTOMER_ID");
  }

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
  });
  if (!customer) {
    throw new HttpError(404, "Customer not found", "CUSTOMER_NOT_FOUND");
  }

  return customer;
};

export const createCustomer = async (input: CreateCustomerInput) => {
  const explicitName = normalizeOptionalText(input.name);
  const suppliedFirstName = normalizeOptionalText(normalizeNamePart(input.firstName));
  const suppliedLastName = normalizeOptionalText(normalizeNamePart(input.lastName));

  let firstName = suppliedFirstName;
  let lastName = suppliedLastName;

  if (explicitName && !firstName) {
    const split = parseCombinedCustomerName(explicitName);
    firstName = firstName ?? split.firstName;
    lastName = lastName ?? split.lastName;
  }

  if (!firstName) {
    throw new HttpError(
      400,
      "name is required (or provide firstName)",
      "INVALID_CUSTOMER",
    );
  }

  const email = normalizeOptionalText(input.email)?.toLowerCase();
  const phone = normalizeOptionalText(input.phone);
  const notes = normalizeOptionalText(input.notes);

  try {
    const customer = await prisma.customer.create({
      data: {
        firstName,
        lastName: lastName ?? "",
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
  const customer = await assertCustomerExists(customerId);
  return toCustomerResponse(customer);
};

export const updateCustomerCommunicationPreferences = async (
  customerId: string,
  input: UpdateCustomerCommunicationPreferencesInput,
) => {
  await assertCustomerExists(customerId);

  const customer = await prisma.customer.update({
    where: { id: customerId },
    data: {
      emailAllowed: input.emailAllowed,
      smsAllowed: input.smsAllowed,
      whatsappAllowed: input.whatsappAllowed,
    },
  });

  return toCustomerResponse(customer);
};

export const searchCustomers = async (query?: string, take = 20) => {
  const normalizedQuery = normalizeOptionalText(query);

  const customers = await prisma.customer.findMany({
    where: normalizedQuery ? buildCustomerSearchWhere(normalizedQuery) : undefined,
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
  await assertCustomerExists(input.customerId);
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
    include: {
      receipt: {
        select: {
          receiptNumber: true,
        },
      },
    },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    take,
  });

  return {
    customerId: input.customerId,
    sales: sales.map((sale) => ({
      id: sale.id,
      subtotalPence: sale.subtotalPence,
      taxPence: sale.taxPence,
      totalPence: sale.totalPence,
      createdAt: sale.createdAt,
      completedAt: sale.completedAt,
      receiptNumber: sale.receipt?.receiptNumber ?? sale.receiptNumber ?? null,
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
  await assertCustomerExists(input.customerId);
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
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take,
    select: {
      id: true,
      bikeId: true,
      status: true,
      customerName: true,
      bikeDescription: true,
      notes: true,
      scheduledDate: true,
      createdAt: true,
      updatedAt: true,
      completedAt: true,
    },
  });

  const workshopJobs = jobs.map((job) => ({
    id: job.id,
    bikeId: job.bikeId,
    status: toWorkshopExecutionStatus(job),
    rawStatus: job.status,
    customerName: job.customerName,
    bikeDescription: job.bikeDescription,
    notes: job.notes,
    scheduledDate: job.scheduledDate,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
  }));

  return {
    customerId: input.customerId,
    workshopJobs,
    jobs: workshopJobs,
  };
};

type CustomerTimelineEntry = {
  id: string;
  type:
    | "CUSTOMER_CREATED"
    | "SALE_COMPLETED"
    | "WORKSHOP_CREATED"
    | "WORKSHOP_COMPLETED"
    | "WORKSHOP_NOTE"
    | "CREDIT_ENTRY";
  occurredAt: Date;
  title: string;
  summary: string;
  entityType: "CUSTOMER" | "SALE" | "WORKSHOP_JOB" | "CREDIT_ACCOUNT";
  entityId: string;
  amountPence?: number;
  meta?: Record<string, unknown>;
};

export const getCustomerTimeline = async (customerId: string) => {
  const customer = await assertCustomerExists(customerId);

  const [sales, workshopJobs, creditAccounts] = await Promise.all([
    prisma.sale.findMany({
      where: { customerId },
      include: {
        receipt: {
          select: {
            receiptNumber: true,
          },
        },
      },
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
      take: 100,
    }),
    prisma.workshopJob.findMany({
      where: { customerId },
      select: {
        id: true,
        status: true,
        bikeDescription: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
        jobNotes: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            note: true,
            visibility: true,
            createdAt: true,
            authorStaff: {
              select: {
                id: true,
                username: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: 100,
    }),
    prisma.creditAccount.findMany({
      where: { customerId },
      select: {
        id: true,
        entries: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            amountPence: true,
            sourceType: true,
            sourceRef: true,
            notes: true,
            createdAt: true,
          },
        },
      },
      take: 10,
    }),
  ]);

  const timeline: CustomerTimelineEntry[] = [
    {
      id: `customer-created-${customer.id}`,
      type: "CUSTOMER_CREATED",
      occurredAt: customer.createdAt,
      title: "Customer record created",
      summary: "Customer added to CorePOS",
      entityType: "CUSTOMER",
      entityId: customer.id,
    },
  ];

  for (const sale of sales) {
    const occurredAt = sale.completedAt ?? sale.createdAt;
    timeline.push({
      id: `sale-${sale.id}`,
      type: "SALE_COMPLETED",
      occurredAt,
      title: "Sale completed",
      summary: `Sale total £${(sale.totalPence / 100).toFixed(2)}`,
      entityType: "SALE",
      entityId: sale.id,
      amountPence: sale.totalPence,
      meta: {
        receiptNumber: sale.receipt?.receiptNumber ?? sale.receiptNumber ?? null,
      },
    });
  }

  for (const job of workshopJobs) {
    timeline.push({
      id: `workshop-created-${job.id}`,
      type: "WORKSHOP_CREATED",
      occurredAt: job.createdAt,
      title: "Workshop job created",
      summary: job.bikeDescription ? `Job opened for ${job.bikeDescription}` : "Workshop job opened",
      entityType: "WORKSHOP_JOB",
      entityId: job.id,
      meta: {
        status: job.status,
      },
    });

    if (job.completedAt) {
      timeline.push({
        id: `workshop-completed-${job.id}`,
        type: "WORKSHOP_COMPLETED",
        occurredAt: job.completedAt,
        title: "Workshop job completed",
        summary: job.bikeDescription ? `${job.bikeDescription} completed` : "Workshop job completed",
        entityType: "WORKSHOP_JOB",
        entityId: job.id,
        meta: {
          status: job.status,
        },
      });
    }

    for (const note of job.jobNotes) {
      timeline.push({
        id: `workshop-note-${note.id}`,
        type: "WORKSHOP_NOTE",
        occurredAt: note.createdAt,
        title: note.visibility === "CUSTOMER" ? "Customer-visible workshop note" : "Workshop note",
        summary: note.note,
        entityType: "WORKSHOP_JOB",
        entityId: job.id,
        meta: {
          noteId: note.id,
          visibility: note.visibility,
          authorName: note.authorStaff?.name ?? note.authorStaff?.username ?? null,
        },
      });
    }
  }

  for (const account of creditAccounts) {
    for (const entry of account.entries) {
      timeline.push({
        id: `credit-entry-${entry.id}`,
        type: "CREDIT_ENTRY",
        occurredAt: entry.createdAt,
        title: "Credit account entry",
        summary: entry.notes ?? `${entry.sourceType} ${entry.amountPence >= 0 ? "credit" : "debit"}`,
        entityType: "CREDIT_ACCOUNT",
        entityId: account.id,
        amountPence: entry.amountPence,
        meta: {
          sourceType: entry.sourceType,
          sourceRef: entry.sourceRef,
        },
      });
    }
  }

  timeline.sort((left, right) => (
    right.occurredAt.getTime() - left.occurredAt.getTime()
    || left.id.localeCompare(right.id)
  ));

  return {
    customer: toCustomerResponse(customer),
    timeline: timeline.map((entry) => ({
      ...entry,
      occurredAt: entry.occurredAt,
    })),
  };
};
