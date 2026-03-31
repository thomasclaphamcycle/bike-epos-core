import { WorkshopJobStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import {
  buildCustomerSearchWhere,
  getCustomerDisplayName,
  normalizeNamePart,
  parseCombinedCustomerName,
} from "../utils/customerName";
import { buildCustomerBikeDisplayName } from "./customerBikeService";
import { listTimelineEvents } from "./timelineFormatter";
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

const ACTIVE_WORKSHOP_JOB_STATUSES = new Set<WorkshopJobStatus>([
  "BOOKED",
  "BIKE_ARRIVED",
  "IN_PROGRESS",
  "WAITING_FOR_APPROVAL",
  "WAITING_FOR_PARTS",
  "ON_HOLD",
  "READY_FOR_COLLECTION",
]);

const getStaffDisplayName = (input: { name?: string | null; username?: string | null } | null | undefined) =>
  input?.name?.trim() || input?.username?.trim() || null;

const buildReceiptUrl = (receiptNumber: string | null | undefined) =>
  receiptNumber ? `/r/${encodeURIComponent(receiptNumber)}` : null;

const formatTenderMethod = (value: string) => {
  switch (value) {
    case "BANK_TRANSFER":
      return "Bank transfer";
    case "CARD":
      return "Card";
    case "CASH":
      return "Cash";
    case "VOUCHER":
      return "Voucher";
    default:
      return value.replaceAll("_", " ").toLowerCase();
  }
};

const buildPaymentSummary = (
  tenders: Array<{ method: string; amountPence: number }>,
) => {
  if (tenders.length === 0) {
    return null;
  }

  return tenders
    .slice()
    .sort((left, right) => right.amountPence - left.amountPence)
    .map((tender) => `${formatTenderMethod(tender.method)} £${(tender.amountPence / 100).toFixed(2)}`)
    .join(" • ");
};

const buildCustomerSummary = async (
  customerId: string,
  customerCreatedAt: Date,
) => {
  const [
    completedSalesCount,
    finalizedSpend,
    activeWorkshopJobsCount,
    linkedBikeCount,
    latestSale,
    latestWorkshop,
    latestBike,
  ] = await Promise.all([
    prisma.sale.count({
      where: {
        customerId,
        completedAt: {
          not: null,
        },
      },
    }),
    prisma.sale.aggregate({
      where: {
        customerId,
        completedAt: {
          not: null,
        },
      },
      _sum: {
        totalPence: true,
      },
    }),
    prisma.workshopJob.count({
      where: {
        customerId,
        status: {
          in: [...ACTIVE_WORKSHOP_JOB_STATUSES],
        },
      },
    }),
    prisma.customerBike.count({
      where: { customerId },
    }),
    prisma.sale.findFirst({
      where: {
        customerId,
        completedAt: {
          not: null,
        },
      },
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
      select: {
        completedAt: true,
      },
    }),
    prisma.workshopJob.findFirst({
      where: { customerId },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: {
        updatedAt: true,
      },
    }),
    prisma.customerBike.findFirst({
      where: { customerId },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: {
        updatedAt: true,
      },
    }),
  ]);

  const mostRecentActivityAt = [
    latestSale?.completedAt ?? null,
    latestWorkshop?.updatedAt ?? null,
    latestBike?.updatedAt ?? null,
    customerCreatedAt,
  ]
    .filter((value): value is Date => Boolean(value))
    .sort((left, right) => right.getTime() - left.getTime())[0];

  return {
    completedSalesCount,
    finalizedSpendPence: finalizedSpend._sum.totalPence ?? 0,
    activeWorkshopJobsCount,
    linkedBikeCount,
    mostRecentActivityAt,
    lastSaleAt: latestSale?.completedAt ?? null,
    lastWorkshopActivityAt: latestWorkshop?.updatedAt ?? null,
  };
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
  return {
    ...toCustomerResponse(customer),
    summary: await buildCustomerSummary(customerId, customer.createdAt),
  };
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
      createdByStaff: {
        select: {
          username: true,
          name: true,
        },
      },
      receipt: {
        select: {
          receiptNumber: true,
          issuedByStaff: {
            select: {
              username: true,
              name: true,
            },
          },
        },
      },
      tenders: {
        select: {
          method: true,
          amountPence: true,
          createdByStaff: {
            select: {
              username: true,
              name: true,
            },
          },
        },
      },
      workshopJob: {
        select: {
          id: true,
          bikeId: true,
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
      receiptUrl: buildReceiptUrl(sale.receipt?.receiptNumber ?? sale.receiptNumber ?? null),
      paymentSummary: buildPaymentSummary(sale.tenders),
      tenderBreakdown: sale.tenders
        .slice()
        .sort((left, right) => right.amountPence - left.amountPence)
        .map((tender) => ({
          method: tender.method,
          amountPence: tender.amountPence,
        })),
      checkoutStaffName:
        getStaffDisplayName(sale.receipt?.issuedByStaff)
        ?? getStaffDisplayName(sale.createdByStaff)
        ?? getStaffDisplayName(sale.tenders[0]?.createdByStaff)
        ?? null,
      workshopJobId: sale.workshopJob?.id ?? null,
      bikeId: sale.workshopJob?.bikeId ?? null,
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
      jobNotes: {
        orderBy: [{ createdAt: "desc" }],
        take: 1,
        select: {
          id: true,
          note: true,
          visibility: true,
          createdAt: true,
          authorStaff: {
            select: {
              username: true,
              name: true,
            },
          },
        },
      },
      estimates: {
        orderBy: [{ version: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: {
          id: true,
          version: true,
          status: true,
          subtotalPence: true,
          approvedAt: true,
          rejectedAt: true,
          decisionByStaff: {
            select: {
              username: true,
              name: true,
            },
          },
        },
      },
      sale: {
        select: {
          id: true,
          totalPence: true,
          completedAt: true,
          receiptNumber: true,
          createdByStaff: {
            select: {
              username: true,
              name: true,
            },
          },
          receipt: {
            select: {
              receiptNumber: true,
              issuedByStaff: {
                select: {
                  username: true,
                  name: true,
                },
              },
            },
          },
          tenders: {
            select: {
              method: true,
              amountPence: true,
              createdByStaff: {
                select: {
                  username: true,
                  name: true,
                },
              },
            },
          },
        },
      },
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
    latestNote: job.jobNotes[0]
      ? {
          id: job.jobNotes[0].id,
          note: job.jobNotes[0].note,
          visibility: job.jobNotes[0].visibility,
          createdAt: job.jobNotes[0].createdAt,
          authorName: getStaffDisplayName(job.jobNotes[0].authorStaff),
        }
      : null,
    estimate: job.estimates[0]
      ? {
          id: job.estimates[0].id,
          version: job.estimates[0].version,
          status: job.estimates[0].status,
          subtotalPence: job.estimates[0].subtotalPence,
          approvedAt: job.estimates[0].approvedAt,
          rejectedAt: job.estimates[0].rejectedAt,
          decisionByStaffName: getStaffDisplayName(job.estimates[0].decisionByStaff),
        }
      : null,
    sale: job.sale
      ? {
          id: job.sale.id,
          totalPence: job.sale.totalPence,
          completedAt: job.sale.completedAt,
          receiptNumber: job.sale.receipt?.receiptNumber ?? job.sale.receiptNumber ?? null,
          receiptUrl: buildReceiptUrl(job.sale.receipt?.receiptNumber ?? job.sale.receiptNumber ?? null),
          paymentSummary: buildPaymentSummary(job.sale.tenders),
          checkoutStaffName:
            getStaffDisplayName(job.sale.receipt?.issuedByStaff)
            ?? getStaffDisplayName(job.sale.createdByStaff)
            ?? getStaffDisplayName(job.sale.tenders[0]?.createdByStaff)
            ?? null,
        }
      : null,
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
    | "WORKSHOP_STATUS_CHANGED"
    | "WORKSHOP_COMPLETED"
    | "ESTIMATE_UPDATE"
    | "WORKSHOP_NOTE"
    | "CUSTOMER_COMMUNICATION"
    | "BIKE_LINKED"
    | "CREDIT_ENTRY";
  occurredAt: Date;
  title: string;
  summary: string;
  entityType: "CUSTOMER" | "SALE" | "WORKSHOP_JOB" | "CREDIT_ACCOUNT" | "BIKE";
  entityId: string;
  amountPence?: number;
  meta?: {
    actorName?: string | null;
    authorName?: string | null;
    bikeDisplayName?: string | null;
    category?: string | null;
    checkoutStaffName?: string | null;
    paymentSummary?: string | null;
    receiptNumber?: string | null;
    receiptUrl?: string | null;
    sourceRef?: string | null;
    sourceType?: string | null;
    visibility?: string | null;
  };
};

export const getCustomerTimeline = async (customerId: string) => {
  const customer = await assertCustomerExists(customerId);

  const [eventTimeline, salesPayload, workshopPayload, bikes, creditAccounts, summary] = await Promise.all([
    listTimelineEvents({
      entityType: "CUSTOMER",
      entityId: customerId,
      limit: 100,
    }),
    listCustomerSales({
      customerId,
      take: 100,
    }),
    listCustomerWorkshopJobs({
      customerId,
      take: 100,
    }),
    prisma.customerBike.findMany({
      where: { customerId },
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        label: true,
        make: true,
        model: true,
        year: true,
        bikeType: true,
        colour: true,
        wheelSize: true,
        frameSize: true,
        groupset: true,
        motorBrand: true,
        motorModel: true,
        createdAt: true,
      },
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
    buildCustomerSummary(customerId, customer.createdAt),
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
  const fallbackKeys = new Set<string>();

  const pushTimelineEntry = (key: string, entry: CustomerTimelineEntry) => {
    if (fallbackKeys.has(key)) {
      return;
    }
    fallbackKeys.add(key);
    timeline.push(entry);
  };

  for (const item of eventTimeline) {
    switch (item.eventName) {
      case "sale.completed":
        pushTimelineEntry(`sale:${item.entityId}`, {
          id: item.id,
          type: "SALE_COMPLETED",
          occurredAt: new Date(item.occurredAt),
          title: item.label,
          summary: item.description,
          entityType: item.entityType,
          entityId: item.entityId,
          meta: {
            category: item.category,
            actorName: item.metadata?.actorName ?? null,
            checkoutStaffName: item.metadata?.checkoutStaffName ?? null,
            paymentSummary: item.metadata?.paymentSummary ?? null,
            receiptNumber: item.metadata?.receiptNumber ?? null,
            receiptUrl: item.metadata?.receiptUrl ?? null,
          },
        });
        break;
      case "workshop.job.created":
        pushTimelineEntry(`workshop-created:${item.entityId}`, {
          id: item.id,
          type: "WORKSHOP_CREATED",
          occurredAt: new Date(item.occurredAt),
          title: item.label,
          summary: item.description,
          entityType: item.entityType,
          entityId: item.entityId,
          meta: {
            actorName: item.metadata?.actorName ?? null,
            bikeDisplayName: item.metadata?.bikeDisplayName ?? item.metadata?.bikeDescription ?? null,
            category: item.category,
          },
        });
        break;
      case "workshop.job.status_changed":
      case "workshop.job.ready_for_collection":
        pushTimelineEntry(`workshop-status:${item.id}`, {
          id: item.id,
          type: "WORKSHOP_STATUS_CHANGED",
          occurredAt: new Date(item.occurredAt),
          title: item.label,
          summary: item.description,
          entityType: item.entityType,
          entityId: item.entityId,
          meta: {
            actorName: item.metadata?.actorName ?? null,
            bikeDisplayName: item.metadata?.bikeDescription ?? null,
            category: item.category,
          },
        });
        break;
      case "workshop.job.completed":
        pushTimelineEntry(`workshop-completed:${item.entityId}`, {
          id: item.id,
          type: "WORKSHOP_COMPLETED",
          occurredAt: new Date(item.occurredAt),
          title: item.label,
          summary: item.description,
          entityType: item.entityType,
          entityId: item.entityId,
          meta: {
            actorName: item.metadata?.actorName ?? null,
            category: item.category,
            paymentSummary: item.metadata?.paymentSummary ?? null,
            receiptNumber: item.metadata?.receiptNumber ?? null,
            receiptUrl: item.metadata?.receiptUrl ?? null,
          },
        });
        break;
      case "workshop.quote.ready":
      case "workshop.estimate.decided":
        pushTimelineEntry(`estimate:${item.id}`, {
          id: item.id,
          type: "ESTIMATE_UPDATE",
          occurredAt: new Date(item.occurredAt),
          title: item.label,
          summary: item.description,
          entityType: item.entityType,
          entityId: item.entityId,
          meta: {
            actorName: item.metadata?.actorName ?? null,
            bikeDisplayName: item.metadata?.bikeDescription ?? null,
            category: item.category,
          },
        });
        break;
      case "workshop.note.added":
        pushTimelineEntry(`workshop-note:${item.id}`, {
          id: item.id,
          type: "WORKSHOP_NOTE",
          occurredAt: new Date(item.occurredAt),
          title: item.label,
          summary: item.description,
          entityType: item.entityType,
          entityId: item.entityId,
          meta: {
            actorName: item.metadata?.actorName ?? null,
            category: item.category,
            visibility: item.metadata?.noteVisibility ?? null,
          },
        });
        break;
      case "workshop.portal_message.ready":
      case "workshop.portal_message.received":
        pushTimelineEntry(`communication:${item.id}`, {
          id: item.id,
          type: "CUSTOMER_COMMUNICATION",
          occurredAt: new Date(item.occurredAt),
          title: item.label,
          summary: item.description,
          entityType: item.entityType,
          entityId: item.entityId,
          meta: {
            actorName: item.metadata?.actorName ?? null,
            category: item.category,
          },
        });
        break;
      case "customer.bike.created":
        pushTimelineEntry(`bike:${item.entityId}`, {
          id: item.id,
          type: "BIKE_LINKED",
          occurredAt: new Date(item.occurredAt),
          title: item.label,
          summary: item.description,
          entityType: item.entityType,
          entityId: item.entityId,
          meta: {
            actorName: item.metadata?.actorName ?? null,
            bikeDisplayName: item.metadata?.bikeDisplayName ?? null,
            category: item.category,
          },
        });
        break;
      default:
        break;
    }
  }

  for (const sale of salesPayload.sales) {
    pushTimelineEntry(`sale:${sale.id}`, {
      id: `sale-${sale.id}`,
      type: "SALE_COMPLETED",
      occurredAt: new Date(sale.completedAt ?? sale.createdAt),
      title: "Sale completed",
      summary: [
        `Finalized sale for £${(sale.totalPence / 100).toFixed(2)}`,
        sale.receiptNumber ? `Receipt ${sale.receiptNumber}` : null,
        sale.paymentSummary ?? null,
      ]
        .filter((value): value is string => Boolean(value))
        .join(" • "),
      entityType: "SALE",
      entityId: sale.id,
      amountPence: sale.totalPence,
      meta: {
        checkoutStaffName: sale.checkoutStaffName,
        paymentSummary: sale.paymentSummary,
        receiptNumber: sale.receiptNumber,
        receiptUrl: sale.receiptUrl,
      },
    });
  }

  for (const job of workshopPayload.workshopJobs) {
    pushTimelineEntry(`workshop-created:${job.id}`, {
      id: `workshop-created-${job.id}`,
      type: "WORKSHOP_CREATED",
      occurredAt: new Date(job.createdAt),
      title: "Workshop job created",
      summary: job.bikeDescription ? `Workshop opened for ${job.bikeDescription}` : "Workshop job opened",
      entityType: "WORKSHOP_JOB",
      entityId: job.id,
      meta: {
        bikeDisplayName: job.bikeDescription,
      },
    });

    if (job.completedAt) {
      pushTimelineEntry(`workshop-completed:${job.id}`, {
        id: `workshop-completed-${job.id}`,
        type: "WORKSHOP_COMPLETED",
        occurredAt: new Date(job.completedAt),
        title: "Workshop job completed",
        summary: job.sale
          ? [
              job.bikeDescription ? `${job.bikeDescription} completed` : "Workshop job completed",
              job.sale.receiptNumber ? `Receipt ${job.sale.receiptNumber}` : null,
              job.sale.paymentSummary ?? null,
            ]
              .filter((value): value is string => Boolean(value))
              .join(" • ")
          : job.bikeDescription
            ? `${job.bikeDescription} completed`
            : "Workshop job completed",
        entityType: "WORKSHOP_JOB",
        entityId: job.id,
        meta: {
          paymentSummary: job.sale?.paymentSummary ?? null,
          receiptNumber: job.sale?.receiptNumber ?? null,
          receiptUrl: job.sale?.receiptUrl ?? null,
        },
      });
    }

    if (job.latestNote) {
      pushTimelineEntry(`workshop-note:${job.latestNote.id}`, {
        id: `workshop-note-${job.latestNote.id}`,
        type: "WORKSHOP_NOTE",
        occurredAt: new Date(job.latestNote.createdAt),
        title: job.latestNote.visibility === "CUSTOMER" ? "Customer-visible workshop note" : "Workshop note",
        summary: job.latestNote.note,
        entityType: "WORKSHOP_JOB",
        entityId: job.id,
        meta: {
          authorName: job.latestNote.authorName,
          visibility: job.latestNote.visibility,
        },
      });
    }
  }

  for (const bike of bikes) {
    pushTimelineEntry(`bike:${bike.id}`, {
      id: `bike-${bike.id}`,
      type: "BIKE_LINKED",
      occurredAt: bike.createdAt,
      title: "Bike added",
      summary: `Bike added to customer record: ${buildCustomerBikeDisplayName(bike)}.`,
      entityType: "BIKE",
      entityId: bike.id,
      meta: {
        bikeDisplayName: buildCustomerBikeDisplayName(bike),
      },
    });
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
    customer: {
      ...toCustomerResponse(customer),
      summary,
    },
    timeline: timeline.map((entry) => ({
      ...entry,
      occurredAt: entry.occurredAt,
    })),
  };
};
