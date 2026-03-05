import { BasketStatus, Prisma, WorkshopJobLineType, WorkshopJobStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import {
  getVariantAvailabilityTx,
  computeWorkshopPartsReconciliationTx,
  releaseReservationsForJobTx,
} from "./stockReservationService";

type WorkflowStatus = "BOOKED" | "IN_PROGRESS" | "READY" | "COLLECTED" | "CLOSED";
type WorkshopStatusV1 =
  | "NEW"
  | "IN_PROGRESS"
  | "AWAITING_PARTS"
  | "READY"
  | "COLLECTED"
  | "CANCELLED";

type CreateWorkshopJobInput = {
  customerName?: string;
  customerId?: string;
  title?: string;
  bikeDescription?: string;
  notes?: string;
  promisedAt?: string;
  assignedToStaffId?: string;
  status?: string;
};

type UpdateWorkshopJobInput = {
  customerName?: string;
  customerId?: string | null;
  title?: string;
  bikeDescription?: string;
  notes?: string;
  promisedAt?: string | null;
  assignedToStaffId?: string | null;
  status?: string;
};

type ListWorkshopJobsInput = {
  status?: string;
  q?: string;
  search?: string;
  from?: string;
  to?: string;
  take?: number;
  skip?: number;
};

type AddWorkshopJobLineInput = {
  type?: string;
  productId?: string | null;
  variantId?: string | null;
  description?: string;
  qty?: number;
  unitPricePence?: number;
};

type UpdateWorkshopJobLineInput = {
  description?: string;
  qty?: number;
  unitPricePence?: number;
  productId?: string | null;
  variantId?: string | null;
};

type AddWorkshopJobReservationInput = {
  productId?: string;
  variantId?: string;
  quantity?: number;
};

const LABOUR_VARIANT_SKU = "WORKSHOP-LABOUR-SERVICE";

const normalizeOptionalText = (value: string | undefined | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeTake = (take: number | undefined): number => {
  if (take === undefined) {
    return 50;
  }
  if (!Number.isInteger(take) || take < 1 || take > 200) {
    throw new HttpError(400, "take must be an integer between 1 and 200", "INVALID_FILTER");
  }
  return take;
};

const normalizeSkip = (skip: number | undefined): number => {
  if (skip === undefined) {
    return 0;
  }
  if (!Number.isInteger(skip) || skip < 0) {
    throw new HttpError(400, "skip must be an integer >= 0", "INVALID_FILTER");
  }
  return skip;
};

const parseDateOnlyOrThrow = (value: string, label: "from" | "to"): Date => {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateOnly.test(value)) {
    throw new HttpError(400, `${label} must be YYYY-MM-DD`, "INVALID_FILTER");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${label} is invalid`, "INVALID_FILTER");
  }
  return date;
};

const parseDateTimeOrThrow = (value: string, label: "promisedAt"): Date => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, `${label} must be a valid date-time`, "INVALID_WORKSHOP_JOB");
  }
  return parsed;
};

const parseWorkflowStatus = (value: string): WorkflowStatus => {
  const normalized = value.trim().toUpperCase();
  switch (normalized) {
    case "NEW":
    case "BOOKED":
    case "BOOKING_MADE":
      return "BOOKED";
    case "AWAITING_PARTS":
    case "WAITING_FOR_PARTS":
    case "WAITING_FOR_APPROVAL":
    case "APPROVED":
    case "ON_HOLD":
    case "BIKE_ARRIVED":
    case "IN_PROGRESS":
      return "IN_PROGRESS";
    case "READY":
    case "BIKE_READY":
      return "READY";
    case "COLLECTED":
    case "COMPLETED":
      return "COLLECTED";
    case "CANCELLED":
    case "CLOSED":
      return "CLOSED";
    default:
      throw new HttpError(
        400,
        "status must be NEW, IN_PROGRESS, AWAITING_PARTS, READY, COLLECTED, CANCELLED, or legacy BOOKED/CLOSED",
        "INVALID_WORKSHOP_STATUS",
      );
  }
};

const toWorkshopJobStatus = (status: WorkflowStatus, rawStatus?: string): WorkshopJobStatus => {
  const normalizedRaw = normalizeOptionalText(rawStatus)?.toUpperCase();
  if (normalizedRaw === "AWAITING_PARTS" || normalizedRaw === "WAITING_FOR_PARTS") {
    return "WAITING_FOR_PARTS";
  }
  if (normalizedRaw === "CANCELLED") {
    return "CANCELLED";
  }

  switch (status) {
    case "BOOKED":
      return "BOOKING_MADE";
    case "IN_PROGRESS":
      return "BIKE_ARRIVED";
    case "READY":
      return "BIKE_READY";
    case "COLLECTED":
      return "COMPLETED";
    case "CLOSED":
      return "COMPLETED";
  }
};

const toWorkflowStatus = (job: {
  status: WorkshopJobStatus;
  closedAt: Date | null;
}): WorkflowStatus => {
  if (job.closedAt) {
    return "CLOSED";
  }

  switch (job.status) {
    case "BOOKING_MADE":
      return "BOOKED";
    case "BIKE_READY":
      return "READY";
    case "COMPLETED":
      return "COLLECTED";
    case "CANCELLED":
      return "CLOSED";
    default:
      return "IN_PROGRESS";
  }
};

const toStatusV1 = (job: { status: WorkshopJobStatus }): WorkshopStatusV1 => {
  switch (job.status) {
    case "BOOKING_MADE":
      return "NEW";
    case "WAITING_FOR_PARTS":
      return "AWAITING_PARTS";
    case "BIKE_READY":
      return "READY";
    case "COMPLETED":
      return "COLLECTED";
    case "CANCELLED":
      return "CANCELLED";
    default:
      return "IN_PROGRESS";
  }
};

const parseStatusFilter = (value: string): Prisma.WorkshopJobWhereInput => {
  const normalized = value.trim().toUpperCase();
  switch (normalized) {
    case "NEW":
    case "BOOKED":
    case "BOOKING_MADE":
      return {
        status: "BOOKING_MADE",
        closedAt: null,
      };
    case "IN_PROGRESS":
      return {
        status: {
          in: ["BIKE_ARRIVED", "WAITING_FOR_APPROVAL", "APPROVED", "ON_HOLD"],
        },
        closedAt: null,
      };
    case "AWAITING_PARTS":
    case "WAITING_FOR_PARTS":
      return {
        status: "WAITING_FOR_PARTS",
        closedAt: null,
      };
    case "READY":
    case "BIKE_READY":
      return {
        status: "BIKE_READY",
        closedAt: null,
      };
    case "COLLECTED":
    case "COMPLETED":
      return {
        status: "COMPLETED",
        closedAt: null,
      };
    case "CANCELLED":
      return {
        status: "CANCELLED",
      };
    case "CLOSED":
      return {
        closedAt: { not: null },
      };
    default:
      throw new HttpError(
        400,
        "status must be NEW, IN_PROGRESS, AWAITING_PARTS, READY, COLLECTED, CANCELLED, or legacy BOOKED/CLOSED",
        "INVALID_WORKSHOP_STATUS",
      );
  }
};

const ensureWorkshopJobExistsTx = async (
  tx: Prisma.TransactionClient,
  workshopJobId: string,
) => {
  const job = await tx.workshopJob.findUnique({
    where: { id: workshopJobId },
  });
  if (!job) {
    throw new HttpError(404, "Workshop job not found", "WORKSHOP_JOB_NOT_FOUND");
  }
  return job;
};

const resolveCustomerDisplayName = (customer: {
  name: string;
  firstName: string;
  lastName: string;
}) =>
  normalizeOptionalText(customer.name) ??
  [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();

const resolveCustomerByIdTx = async (
  tx: Prisma.TransactionClient,
  customerId: string,
) => {
  const customer = await tx.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
    },
  });

  if (!customer) {
    throw new HttpError(404, "Customer not found", "CUSTOMER_NOT_FOUND");
  }

  return customer;
};

const resolveAssignedStaffByIdTx = async (
  tx: Prisma.TransactionClient,
  staffId: string,
) => {
  const staff = await tx.user.findUnique({
    where: { id: staffId },
    select: {
      id: true,
      username: true,
      name: true,
    },
  });

  if (!staff) {
    throw new HttpError(404, "Staff member not found", "STAFF_NOT_FOUND");
  }

  return staff;
};

const ensureProductExistsTx = async (tx: Prisma.TransactionClient, productId: string) => {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
    },
  });

  if (!product) {
    throw new HttpError(404, "Product not found", "PRODUCT_NOT_FOUND");
  }

  return product;
};

const ensureVariantForPartTx = async (
  tx: Prisma.TransactionClient,
  input: {
    productId: string;
    variantId?: string;
  },
) => {
  if (input.variantId) {
    const variant = await tx.variant.findUnique({
      where: { id: input.variantId },
      select: {
        id: true,
        productId: true,
        sku: true,
        name: true,
      },
    });
    if (!variant || variant.productId !== input.productId) {
      throw new HttpError(404, "Variant not found for product", "VARIANT_NOT_FOUND");
    }
    return variant;
  }

  const firstVariant = await tx.variant.findFirst({
    where: {
      productId: input.productId,
      isActive: true,
    },
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true,
      productId: true,
      sku: true,
      name: true,
    },
  });

  if (!firstVariant) {
    throw new HttpError(
      400,
      "PART lines require a product with at least one active variant",
      "MISSING_PRODUCT_VARIANT",
    );
  }

  return firstVariant;
};

const getOrCreateLabourVariantTx = async (tx: Prisma.TransactionClient) => {
  const existing = await tx.variant.findUnique({
    where: { sku: LABOUR_VARIANT_SKU },
    select: {
      id: true,
      sku: true,
      retailPricePence: true,
    },
  });

  if (existing) {
    return existing;
  }

  let labourProduct = await tx.product.findFirst({
    where: {
      name: "Workshop Labour",
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
    },
  });

  if (!labourProduct) {
    labourProduct = await tx.product.create({
      data: {
        name: "Workshop Labour",
        brand: "Internal",
        description: "Service labour line item for workshop checkout",
      },
      select: {
        id: true,
      },
    });
  }

  try {
    return await tx.variant.create({
      data: {
        productId: labourProduct.id,
        sku: LABOUR_VARIANT_SKU,
        name: "Workshop Labour",
        option: "Service",
        retailPrice: new Prisma.Decimal(0),
        retailPricePence: 0,
      },
      select: {
        id: true,
        sku: true,
        retailPricePence: true,
      },
    });
  } catch (error) {
    const prismaError = error as { code?: string };
    if (prismaError.code === "P2002") {
      const variant = await tx.variant.findUnique({
        where: { sku: LABOUR_VARIANT_SKU },
        select: {
          id: true,
          sku: true,
          retailPricePence: true,
        },
      });
      if (variant) {
        return variant;
      }
    }
    throw error;
  }
};

const toLineResponse = (line: {
  id: string;
  jobId: string;
  type: WorkshopJobLineType;
  productId: string | null;
  variantId: string | null;
  description: string;
  qty: number;
  unitPricePence: number;
  createdAt: Date;
  updatedAt: Date;
  product: {
    id: string;
    name: string;
  } | null;
  variant: {
    id: string;
    sku: string;
    name: string | null;
  } | null;
}) => ({
  id: line.id,
  jobId: line.jobId,
  type: line.type,
  productId: line.productId,
  productName: line.product?.name ?? null,
  variantId: line.variantId,
  variantSku: line.variant?.sku ?? null,
  variantName: line.variant?.name ?? null,
  description: line.description,
  qty: line.qty,
  unitPricePence: line.unitPricePence,
  lineTotalPence: line.qty * line.unitPricePence,
  createdAt: line.createdAt,
  updatedAt: line.updatedAt,
});

const toReservationResponse = (reservation: {
  id: string;
  workshopJobId: string;
  productId: string;
  variantId: string;
  quantity: number;
  createdAt: Date;
  product: {
    id: string;
    name: string;
  };
  variant: {
    id: string;
    sku: string;
    name: string | null;
  };
}) => ({
  id: reservation.id,
  workshopJobId: reservation.workshopJobId,
  productId: reservation.productId,
  productName: reservation.product.name,
  variantId: reservation.variantId,
  variantSku: reservation.variant.sku,
  variantName: reservation.variant.name,
  quantity: reservation.quantity,
  createdAt: reservation.createdAt,
});

const workshopLineInclude = {
  product: {
    select: {
      id: true,
      name: true,
    },
  },
  variant: {
    select: {
      id: true,
      sku: true,
      name: true,
    },
  },
};

const workshopReservationInclude = {
  product: {
    select: {
      id: true,
      name: true,
    },
  },
  variant: {
    select: {
      id: true,
      sku: true,
      name: true,
    },
  },
};

const toWorkshopJobTotals = (
  lines: Array<{
    qty: number;
    unitPricePence: number;
  }>,
) => {
  const subtotalPence = lines.reduce((sum, line) => sum + line.qty * line.unitPricePence, 0);
  const taxPence = 0;
  return {
    subtotalPence,
    taxPence,
    totalPence: subtotalPence + taxPence,
  };
};

const toJobResponse = (job: {
  id: string;
  customerId: string | null;
  customerName: string | null;
  bikeDescription: string | null;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  scheduledDate: Date | null;
  status: WorkshopJobStatus;
  notes: string | null;
  cancelledAt: Date | null;
  completedAt: Date | null;
  finalizedBasketId: string | null;
  closedAt: Date | null;
  saleId?: string | null;
  sale?: {
    id: string;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: job.id,
  customerId: job.customerId,
  customerName: job.customerName,
  title: job.bikeDescription,
  bikeDescription: job.bikeDescription,
  assignedToStaffId: job.assignedStaffId,
  assignedToStaffName: job.assignedStaffName,
  promisedAt: job.scheduledDate,
  statusV1: toStatusV1(job),
  status: toWorkflowStatus(job),
  notes: job.notes,
  cancelledAt: job.cancelledAt,
  completedAt: job.completedAt,
  finalizedBasketId: job.finalizedBasketId,
  closedAt: job.closedAt,
  saleId: job.saleId ?? job.sale?.id ?? null,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
});

const buildBasketResponseTx = async (tx: Prisma.TransactionClient, basketId: string) => {
  const basket = await tx.basket.findUnique({
    where: { id: basketId },
    include: {
      items: {
        orderBy: [{ createdAt: "asc" }],
        include: {
          variant: {
            include: {
              product: true,
            },
          },
        },
      },
    },
  });

  if (!basket) {
    throw new HttpError(500, "Could not load finalized basket", "FINALIZE_BASKET_NOT_FOUND");
  }

  const subtotalPence = basket.items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0,
  );

  return {
    id: basket.id,
    status: basket.status,
    createdAt: basket.createdAt,
    updatedAt: basket.updatedAt,
    items: basket.items.map((item) => ({
      id: item.id,
      variantId: item.variantId,
      sku: item.variant.sku,
      productName: item.variant.product.name,
      variantName: item.variant.name,
      quantity: item.quantity,
      unitPricePence: item.unitPrice,
      lineTotalPence: item.quantity * item.unitPrice,
    })),
    totals: {
      subtotalPence,
      taxPence: 0,
      totalPence: subtotalPence,
    },
  };
};

export const createWorkshopJob = async (input: CreateWorkshopJobInput) => {
  const rawCustomerName = normalizeOptionalText(input.customerName);
  const customerId = normalizeOptionalText(input.customerId);
  const title = normalizeOptionalText(input.title);
  const bikeDescription = normalizeOptionalText(input.bikeDescription) ?? title;
  const notes = normalizeOptionalText(input.notes);
  const promisedAtRaw = normalizeOptionalText(input.promisedAt);
  const assignedToStaffId = normalizeOptionalText(input.assignedToStaffId);
  const promisedAt = promisedAtRaw ? parseDateTimeOrThrow(promisedAtRaw, "promisedAt") : undefined;

  if (customerId && !isUuid(customerId)) {
    throw new HttpError(400, "customerId must be a uuid", "INVALID_WORKSHOP_JOB");
  }
  if (!bikeDescription) {
    throw new HttpError(
      400,
      "title or bikeDescription is required",
      "INVALID_WORKSHOP_JOB",
    );
  }
  if (assignedToStaffId && !isUuid(assignedToStaffId)) {
    throw new HttpError(400, "assignedToStaffId must be a uuid", "INVALID_WORKSHOP_JOB");
  }

  const targetStatus = input.status
    ? parseWorkflowStatus(input.status)
    : ("BOOKED" as WorkflowStatus);

  return prisma.$transaction(async (tx) => {
    let customerName = rawCustomerName;
    if (customerId) {
      const customer = await resolveCustomerByIdTx(tx, customerId);
      customerName = customerName ?? resolveCustomerDisplayName(customer);
    }

    if (!customerName) {
      throw new HttpError(400, "customerName or customerId is required", "INVALID_WORKSHOP_JOB");
    }

    let assignedStaffName: string | undefined;
    if (assignedToStaffId) {
      const staff = await resolveAssignedStaffByIdTx(tx, assignedToStaffId);
      assignedStaffName = normalizeOptionalText(staff.name) ?? staff.username;
    }

    const job = await tx.workshopJob.create({
      data: {
        customerId: customerId ?? undefined,
        customerName,
        bikeDescription,
        notes,
        scheduledDate: promisedAt ?? null,
        assignedStaffId: assignedToStaffId ?? undefined,
        assignedStaffName: assignedStaffName ?? null,
        status: toWorkshopJobStatus(targetStatus, input.status),
        source: "IN_STORE",
        depositStatus: "NOT_REQUIRED",
        depositRequiredPence: 0,
        ...(normalizeOptionalText(input.status)?.toUpperCase() === "CANCELLED"
          ? {
              cancelledAt: new Date(),
            }
          : targetStatus === "CLOSED"
            ? {
                closedAt: new Date(),
                completedAt: new Date(),
              }
            : targetStatus === "COLLECTED"
              ? {
                  completedAt: new Date(),
                }
              : {}),
      },
    });

    return toJobResponse(job);
  });
};

export const listWorkshopJobs = async (filters: ListWorkshopJobsInput = {}) => {
  const q = normalizeOptionalText(filters.q) ?? normalizeOptionalText(filters.search);
  const take = normalizeTake(filters.take);
  const skip = normalizeSkip(filters.skip);
  const requestedStatusWhere = filters.status ? parseStatusFilter(filters.status) : undefined;
  const fromDate = filters.from ? parseDateOnlyOrThrow(filters.from, "from") : undefined;
  const toDateExclusive = filters.to ? parseDateOnlyOrThrow(filters.to, "to") : undefined;
  if (toDateExclusive) {
    toDateExclusive.setUTCDate(toDateExclusive.getUTCDate() + 1);
  }
  if (fromDate && toDateExclusive && fromDate >= toDateExclusive) {
    throw new HttpError(400, "from must be before or equal to to", "INVALID_FILTER");
  }

  const jobs = await prisma.workshopJob.findMany({
    where: {
      ...(requestedStatusWhere ?? {}),
      ...(fromDate || toDateExclusive
        ? {
            createdAt: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDateExclusive ? { lt: toDateExclusive } : {}),
            },
          }
        : {}),
      ...(q
        ? {
            OR: [
              { customerName: { contains: q, mode: "insensitive" } },
              { bikeDescription: { contains: q, mode: "insensitive" } },
              { notes: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }],
    take,
    skip,
    include: {
      _count: {
        select: {
          lines: true,
        },
      },
    },
  });

  return {
    jobs: jobs.map((job) => ({
      ...toJobResponse(job),
      lineCount: job._count.lines,
    })),
  };
};

export const getWorkshopJobById = async (workshopJobId: string) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  const job = await prisma.workshopJob.findUnique({
    where: { id: workshopJobId },
    include: {
      sale: {
        select: {
          id: true,
        },
      },
      stockReservations: {
        include: workshopReservationInclude,
        orderBy: [{ createdAt: "asc" }],
      },
      lines: {
        include: workshopLineInclude,
        orderBy: [{ createdAt: "asc" }],
      },
    },
  });

  if (!job) {
    throw new HttpError(404, "Workshop job not found", "WORKSHOP_JOB_NOT_FOUND");
  }

  const reconciliation = await computeWorkshopPartsReconciliationTx(prisma, workshopJobId);

  return {
    job: toJobResponse(job),
    lines: job.lines.map((line) => toLineResponse(line)),
    reservations: job.stockReservations.map((reservation) => toReservationResponse(reservation)),
    totals: toWorkshopJobTotals(job.lines),
    partsStatus: reconciliation.partsStatus,
    statusSuggestion: reconciliation.partsStatus === "SHORT" ? "AWAITING_PARTS" : null,
    partsReconciliation: reconciliation,
  };
};

export const convertWorkshopJobToSale = async (
  workshopJobId: string,
  createdByStaffId?: string,
) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  const normalizedCreatedBy = normalizeOptionalText(createdByStaffId) ?? null;

  return prisma.$transaction(async (tx) => {
    // Serialize conversion attempts to keep idempotent behavior deterministic.
    await tx.$queryRaw`SELECT id FROM "WorkshopJob" WHERE id = ${workshopJobId} FOR UPDATE`;

    const job = await tx.workshopJob.findUnique({
      where: { id: workshopJobId },
      include: {
        sale: {
          select: {
            id: true,
          },
        },
        lines: {
          include: workshopLineInclude,
          orderBy: [{ createdAt: "asc" }],
        },
      },
    });

    if (!job) {
      throw new HttpError(404, "Workshop job not found", "WORKSHOP_JOB_NOT_FOUND");
    }

    if (job.status === "CANCELLED") {
      throw new HttpError(
        409,
        "Cancelled workshop jobs cannot be converted to sale",
        "WORKSHOP_JOB_NOT_CONVERTIBLE",
      );
    }

    if (job.lines.length === 0) {
      throw new HttpError(400, "Workshop job has no lines", "EMPTY_WORKSHOP_JOB");
    }

    if (job.sale) {
      return {
        workshopJobId: job.id,
        saleId: job.sale.id,
        saleUrl: `/pos?saleId=${encodeURIComponent(job.sale.id)}`,
        idempotent: true,
      };
    }

    const needsLabourVariant = job.lines.some((line) => line.type === "LABOUR");
    const labourVariant = needsLabourVariant ? await getOrCreateLabourVariantTx(tx) : null;

    const saleLineInput = job.lines.map((line) => {
      if (line.type === "PART") {
        if (!line.variantId) {
          throw new HttpError(
            400,
            "PART workshop lines must include variantId before conversion",
            "INVALID_WORKSHOP_LINE",
          );
        }

        return {
          variantId: line.variantId,
          quantity: line.qty,
          unitPricePence: line.unitPricePence,
          lineTotalPence: line.qty * line.unitPricePence,
        };
      }

      if (!labourVariant) {
        throw new HttpError(500, "Could not resolve labour variant", "LABOUR_VARIANT_NOT_FOUND");
      }

      return {
        variantId: labourVariant.id,
        quantity: line.qty,
        unitPricePence: line.unitPricePence,
        lineTotalPence: line.qty * line.unitPricePence,
      };
    });

    const subtotalPence = saleLineInput.reduce((sum, line) => sum + line.lineTotalPence, 0);
    const taxPence = 0;
    const totalPence = subtotalPence + taxPence;

    const sale = await tx.sale.create({
      data: {
        workshopJobId: job.id,
        customerId: job.customerId,
        subtotalPence,
        taxPence,
        totalPence,
        createdByStaffId: normalizedCreatedBy,
      },
    });

    await tx.saleItem.createMany({
      data: saleLineInput.map((line) => ({
        saleId: sale.id,
        variantId: line.variantId,
        quantity: line.quantity,
        unitPricePence: line.unitPricePence,
        lineTotalPence: line.lineTotalPence,
      })),
    });

    return {
      workshopJobId: job.id,
      saleId: sale.id,
      saleUrl: `/pos?saleId=${encodeURIComponent(sale.id)}`,
      idempotent: false,
    };
  });
};

export const updateWorkshopJob = async (workshopJobId: string, input: UpdateWorkshopJobInput) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  const hasAnyField =
    Object.prototype.hasOwnProperty.call(input, "customerName") ||
    Object.prototype.hasOwnProperty.call(input, "customerId") ||
    Object.prototype.hasOwnProperty.call(input, "title") ||
    Object.prototype.hasOwnProperty.call(input, "bikeDescription") ||
    Object.prototype.hasOwnProperty.call(input, "notes") ||
    Object.prototype.hasOwnProperty.call(input, "promisedAt") ||
    Object.prototype.hasOwnProperty.call(input, "assignedToStaffId") ||
    Object.prototype.hasOwnProperty.call(input, "status");

  if (!hasAnyField) {
    throw new HttpError(400, "No fields provided", "INVALID_WORKSHOP_JOB_UPDATE");
  }

  return prisma.$transaction(async (tx) => {
    const job = await ensureWorkshopJobExistsTx(tx, workshopJobId);
    const data: Prisma.WorkshopJobUpdateInput = {};
    let shouldReleaseReservations = false;
    let customerNameFromCustomer: string | undefined;

    if (Object.prototype.hasOwnProperty.call(input, "customerName")) {
      const customerName = normalizeOptionalText(input.customerName);
      if (!customerName) {
        throw new HttpError(400, "customerName cannot be empty", "INVALID_WORKSHOP_JOB_UPDATE");
      }
      data.customerName = customerName;
    }

    if (Object.prototype.hasOwnProperty.call(input, "customerId")) {
      const customerId = input.customerId;
      if (customerId !== null && !normalizeOptionalText(customerId)) {
        throw new HttpError(400, "customerId must be a uuid or null", "INVALID_WORKSHOP_JOB_UPDATE");
      }
      if (customerId !== null && !isUuid(customerId)) {
        throw new HttpError(400, "customerId must be a uuid or null", "INVALID_WORKSHOP_JOB_UPDATE");
      }

      if (customerId) {
        const customer = await resolveCustomerByIdTx(tx, customerId);
        customerNameFromCustomer = resolveCustomerDisplayName(customer);
      }
      data.customerId = customerId ?? null;
      if (!Object.prototype.hasOwnProperty.call(input, "customerName")) {
        data.customerName = customerId ? customerNameFromCustomer : null;
      }
    }

    const nextBikeDescriptionValue = Object.prototype.hasOwnProperty.call(input, "title")
      ? input.title
      : input.bikeDescription;

    if (
      Object.prototype.hasOwnProperty.call(input, "bikeDescription") ||
      Object.prototype.hasOwnProperty.call(input, "title")
    ) {
      const bikeDescription = normalizeOptionalText(nextBikeDescriptionValue);
      if (!bikeDescription) {
        throw new HttpError(
          400,
          "title or bikeDescription cannot be empty",
          "INVALID_WORKSHOP_JOB_UPDATE",
        );
      }
      data.bikeDescription = bikeDescription;
    }

    if (Object.prototype.hasOwnProperty.call(input, "notes")) {
      data.notes = normalizeOptionalText(input.notes) ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(input, "promisedAt")) {
      const promisedAtRaw = normalizeOptionalText(input.promisedAt ?? undefined);
      data.scheduledDate = promisedAtRaw ? parseDateTimeOrThrow(promisedAtRaw, "promisedAt") : null;
    }

    if (Object.prototype.hasOwnProperty.call(input, "assignedToStaffId")) {
      const assignedToStaffId = input.assignedToStaffId;
      if (assignedToStaffId !== null && !normalizeOptionalText(assignedToStaffId)) {
        throw new HttpError(
          400,
          "assignedToStaffId must be a uuid or null",
          "INVALID_WORKSHOP_JOB_UPDATE",
        );
      }
      if (assignedToStaffId !== null && !isUuid(assignedToStaffId)) {
        throw new HttpError(
          400,
          "assignedToStaffId must be a uuid or null",
          "INVALID_WORKSHOP_JOB_UPDATE",
        );
      }

      if (assignedToStaffId) {
        const staff = await resolveAssignedStaffByIdTx(tx, assignedToStaffId);
        data.assignedStaffId = assignedToStaffId;
        data.assignedStaffName = normalizeOptionalText(staff.name) ?? staff.username;
      } else {
        data.assignedStaffId = null;
        data.assignedStaffName = null;
      }
    }

    if (Object.prototype.hasOwnProperty.call(input, "status")) {
      const rawStatus = input.status ?? "";
      const parsed = parseWorkflowStatus(rawStatus);
      const normalizedRaw = normalizeOptionalText(rawStatus)?.toUpperCase();
      data.status = toWorkshopJobStatus(parsed, rawStatus);
      if (normalizedRaw === "CANCELLED") {
        shouldReleaseReservations = true;
        data.cancelledAt = job.cancelledAt ?? new Date();
        data.closedAt = null;
      } else if (parsed === "CLOSED") {
        data.closedAt = job.closedAt ?? new Date();
        data.completedAt = job.completedAt ?? new Date();
        data.cancelledAt = null;
      } else {
        data.closedAt = null;
        data.cancelledAt = null;
        if (parsed === "COLLECTED") {
          const linkedSale = await tx.sale.findUnique({
            where: { workshopJobId },
            select: {
              id: true,
              completedAt: true,
            },
          });
          if (linkedSale && !linkedSale.completedAt) {
            throw new HttpError(
              409,
              "Linked sale must be completed before collecting this job",
              "WORKSHOP_JOB_SALE_NOT_COMPLETED",
            );
          }
          data.completedAt = job.completedAt ?? new Date();
        }
      }
    }

    const updated = await tx.workshopJob.update({
      where: { id: workshopJobId },
      data,
    });

    if (shouldReleaseReservations) {
      await releaseReservationsForJobTx(tx, workshopJobId);
    }

    return toJobResponse(updated);
  });
};

export const attachCustomerToWorkshopJob = async (
  workshopJobId: string,
  customerId: string | null,
) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }
  if (customerId !== null && !isUuid(customerId)) {
    throw new HttpError(400, "Invalid customer id", "INVALID_CUSTOMER_ID");
  }

  return prisma.$transaction(async (tx) => {
    const job = await ensureWorkshopJobExistsTx(tx, workshopJobId);

    let customerNameToSet: string | undefined;
    if (customerId !== null) {
      const customer = await tx.customer.findUnique({
        where: { id: customerId },
        select: {
          id: true,
          name: true,
          firstName: true,
          lastName: true,
        },
      });

      if (!customer) {
        throw new HttpError(404, "Customer not found", "CUSTOMER_NOT_FOUND");
      }

      const existingName = normalizeOptionalText(job.customerName);
      if (!existingName) {
        const explicitName = normalizeOptionalText(customer.name);
        customerNameToSet =
          explicitName ?? [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();
      }
    }

    const updated = await tx.workshopJob.update({
      where: { id: workshopJobId },
      data: {
        customerId,
        ...(customerNameToSet ? { customerName: customerNameToSet } : {}),
      },
    });

    return toJobResponse(updated);
  });
};

export const addWorkshopJobLine = async (
  workshopJobId: string,
  input: AddWorkshopJobLineInput,
) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  if (!input.type || (input.type !== "PART" && input.type !== "LABOUR")) {
    throw new HttpError(400, "type must be PART or LABOUR", "INVALID_WORKSHOP_LINE");
  }

  const quantity = input.qty ?? 1;
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new HttpError(400, "qty must be a positive integer", "INVALID_WORKSHOP_LINE");
  }

  const unitPricePence = input.unitPricePence ?? 0;
  if (!Number.isInteger(unitPricePence) || unitPricePence < 0) {
    throw new HttpError(
      400,
      "unitPricePence must be a non-negative integer",
      "INVALID_WORKSHOP_LINE",
    );
  }

  return prisma.$transaction(async (tx) => {
    const job = await ensureWorkshopJobExistsTx(tx, workshopJobId);
    if (job.closedAt) {
      throw new HttpError(409, "Closed jobs cannot be edited", "WORKSHOP_JOB_CLOSED");
    }

    let line;
    if (input.type === "PART") {
      const productId = normalizeOptionalText(input.productId);
      if (!productId) {
        throw new HttpError(400, "PART lines require productId", "INVALID_WORKSHOP_LINE");
      }
      const product = await ensureProductExistsTx(tx, productId);
      const variant = await ensureVariantForPartTx(tx, {
        productId,
        variantId: normalizeOptionalText(input.variantId),
      });

      const description =
        normalizeOptionalText(input.description) ??
        [product.name, variant.name ?? variant.sku].filter(Boolean).join(" - ");

      line = await tx.workshopJobLine.create({
        data: {
          jobId: workshopJobId,
          type: "PART",
          productId,
          variantId: variant.id,
          description,
          qty: quantity,
          unitPricePence,
        },
        include: workshopLineInclude,
      });
    } else {
      const description = normalizeOptionalText(input.description);
      if (!description) {
        throw new HttpError(400, "LABOUR lines require description", "INVALID_WORKSHOP_LINE");
      }

      line = await tx.workshopJobLine.create({
        data: {
          jobId: workshopJobId,
          type: "LABOUR",
          description,
          qty: quantity,
          unitPricePence,
        },
        include: workshopLineInclude,
      });
    }

    return {
      line: toLineResponse(line),
    };
  });
};

export const updateWorkshopJobLine = async (
  workshopJobId: string,
  lineId: string,
  input: UpdateWorkshopJobLineInput,
) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }
  if (!isUuid(lineId)) {
    throw new HttpError(400, "Invalid workshop line id", "INVALID_WORKSHOP_LINE_ID");
  }

  const hasAnyField =
    Object.prototype.hasOwnProperty.call(input, "description") ||
    Object.prototype.hasOwnProperty.call(input, "qty") ||
    Object.prototype.hasOwnProperty.call(input, "unitPricePence") ||
    Object.prototype.hasOwnProperty.call(input, "productId") ||
    Object.prototype.hasOwnProperty.call(input, "variantId");

  if (!hasAnyField) {
    throw new HttpError(400, "No line fields provided", "INVALID_WORKSHOP_LINE_UPDATE");
  }

  return prisma.$transaction(async (tx) => {
    const job = await ensureWorkshopJobExistsTx(tx, workshopJobId);
    if (job.closedAt) {
      throw new HttpError(409, "Closed jobs cannot be edited", "WORKSHOP_JOB_CLOSED");
    }

    const line = await tx.workshopJobLine.findUnique({
      where: { id: lineId },
      include: workshopLineInclude,
    });
    if (!line || line.jobId !== workshopJobId) {
      throw new HttpError(404, "Workshop line not found", "WORKSHOP_LINE_NOT_FOUND");
    }

    const data: Prisma.WorkshopJobLineUpdateInput = {};

    if (Object.prototype.hasOwnProperty.call(input, "description")) {
      const description = normalizeOptionalText(input.description);
      if (!description) {
        throw new HttpError(400, "description cannot be empty", "INVALID_WORKSHOP_LINE_UPDATE");
      }
      data.description = description;
    }

    if (Object.prototype.hasOwnProperty.call(input, "qty")) {
      if (!Number.isInteger(input.qty) || (input.qty ?? 0) <= 0) {
        throw new HttpError(
          400,
          "qty must be a positive integer",
          "INVALID_WORKSHOP_LINE_UPDATE",
        );
      }
      data.qty = input.qty;
    }

    if (Object.prototype.hasOwnProperty.call(input, "unitPricePence")) {
      if (!Number.isInteger(input.unitPricePence) || (input.unitPricePence ?? -1) < 0) {
        throw new HttpError(
          400,
          "unitPricePence must be a non-negative integer",
          "INVALID_WORKSHOP_LINE_UPDATE",
        );
      }
      data.unitPricePence = input.unitPricePence;
    }

    const hasProductId = Object.prototype.hasOwnProperty.call(input, "productId");
    const hasVariantId = Object.prototype.hasOwnProperty.call(input, "variantId");

    if (line.type === "LABOUR") {
      if (hasProductId && normalizeOptionalText(input.productId ?? undefined)) {
        throw new HttpError(
          400,
          "LABOUR lines cannot set productId",
          "INVALID_WORKSHOP_LINE_UPDATE",
        );
      }
      if (hasVariantId && normalizeOptionalText(input.variantId ?? undefined)) {
        throw new HttpError(
          400,
          "LABOUR lines cannot set variantId",
          "INVALID_WORKSHOP_LINE_UPDATE",
        );
      }
      if (hasProductId) {
        data.productId = null;
      }
      if (hasVariantId) {
        data.variantId = null;
      }
    }

    if (line.type === "PART" && (hasProductId || hasVariantId)) {
      let nextProductId = line.productId;
      let nextVariantId = line.variantId;

      if (hasProductId) {
        const productId = normalizeOptionalText(input.productId ?? undefined) ?? null;
        nextProductId = productId;
        if (nextProductId === null) {
          nextVariantId = null;
        } else {
          await ensureProductExistsTx(tx, nextProductId);
          if (!hasVariantId) {
            if (nextVariantId) {
              const currentVariant = await tx.variant.findUnique({
                where: { id: nextVariantId },
                select: { id: true, productId: true },
              });
              if (!currentVariant || currentVariant.productId !== nextProductId) {
                const fallbackVariant = await ensureVariantForPartTx(tx, {
                  productId: nextProductId,
                });
                nextVariantId = fallbackVariant.id;
              }
            } else {
              const fallbackVariant = await ensureVariantForPartTx(tx, {
                productId: nextProductId,
              });
              nextVariantId = fallbackVariant.id;
            }
          }
        }
      }

      if (hasVariantId) {
        const variantId = normalizeOptionalText(input.variantId ?? undefined) ?? null;
        if (variantId === null) {
          nextVariantId = null;
        } else {
          if (!nextProductId) {
            throw new HttpError(
              400,
              "productId is required when setting variantId on PART lines",
              "INVALID_WORKSHOP_LINE_UPDATE",
            );
          }
          const variant = await ensureVariantForPartTx(tx, {
            productId: nextProductId,
            variantId,
          });
          nextVariantId = variant.id;
        }
      }

      data.productId = nextProductId;
      data.variantId = nextVariantId;
    }

    const updated = await tx.workshopJobLine.update({
      where: { id: lineId },
      data,
      include: workshopLineInclude,
    });

    return {
      line: toLineResponse(updated),
    };
  });
};

export const deleteWorkshopJobLine = async (workshopJobId: string, lineId: string) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }
  if (!isUuid(lineId)) {
    throw new HttpError(400, "Invalid workshop line id", "INVALID_WORKSHOP_LINE_ID");
  }

  return prisma.$transaction(async (tx) => {
    const job = await ensureWorkshopJobExistsTx(tx, workshopJobId);
    if (job.closedAt) {
      throw new HttpError(409, "Closed jobs cannot be edited", "WORKSHOP_JOB_CLOSED");
    }

    const line = await tx.workshopJobLine.findUnique({
      where: { id: lineId },
      select: {
        id: true,
        jobId: true,
      },
    });
    if (!line || line.jobId !== workshopJobId) {
      throw new HttpError(404, "Workshop line not found", "WORKSHOP_LINE_NOT_FOUND");
    }

    await tx.workshopJobLine.delete({
      where: { id: lineId },
    });

    return {
      deleted: true,
      workshopJobId,
      lineId,
    };
  });
};

export const addWorkshopJobReservation = async (
  workshopJobId: string,
  input: AddWorkshopJobReservationInput,
) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  const productId = normalizeOptionalText(input.productId);
  if (!productId) {
    throw new HttpError(400, "productId is required", "INVALID_STOCK_RESERVATION");
  }

  const quantity = input.quantity;
  if (!Number.isInteger(quantity) || (quantity ?? 0) <= 0) {
    throw new HttpError(400, "quantity must be a positive integer", "INVALID_STOCK_RESERVATION");
  }

  return prisma.$transaction(async (tx) => {
    const job = await ensureWorkshopJobExistsTx(tx, workshopJobId);
    if (job.closedAt || job.status === "CANCELLED") {
      throw new HttpError(
        409,
        "Closed or cancelled workshop jobs cannot reserve stock",
        "WORKSHOP_JOB_NOT_EDITABLE",
      );
    }

    await ensureProductExistsTx(tx, productId);
    const variant = await ensureVariantForPartTx(tx, {
      productId,
      variantId: normalizeOptionalText(input.variantId),
    });
    const availability = await getVariantAvailabilityTx(tx, variant.id);
    if (quantity > availability.availableQty) {
      throw new HttpError(
        409,
        `Insufficient stock available. Requested ${quantity}, available ${availability.availableQty}`,
        "INSUFFICIENT_AVAILABLE_STOCK",
      );
    }

    const created = await tx.stockReservation.create({
      data: {
        workshopJobId,
        productId,
        variantId: variant.id,
        quantity,
      },
      include: workshopReservationInclude,
    });

    return {
      reservation: toReservationResponse(created),
      stock: {
        variantId: variant.id,
        onHandQty: availability.onHandQty,
        reservedQty: availability.reservedQty + quantity,
        availableQty: availability.availableQty - quantity,
      },
    };
  });
};

export const deleteWorkshopJobReservation = async (
  workshopJobId: string,
  reservationId: string,
) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }
  if (!isUuid(reservationId)) {
    throw new HttpError(400, "Invalid reservation id", "INVALID_STOCK_RESERVATION_ID");
  }

  return prisma.$transaction(async (tx) => {
    const job = await ensureWorkshopJobExistsTx(tx, workshopJobId);
    if (job.closedAt || job.status === "CANCELLED") {
      throw new HttpError(
        409,
        "Closed or cancelled workshop jobs cannot be edited",
        "WORKSHOP_JOB_NOT_EDITABLE",
      );
    }

    const reservation = await tx.stockReservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        workshopJobId: true,
      },
    });

    if (!reservation || reservation.workshopJobId !== workshopJobId) {
      throw new HttpError(404, "Stock reservation not found", "STOCK_RESERVATION_NOT_FOUND");
    }

    await tx.stockReservation.delete({
      where: { id: reservationId },
    });

    return {
      deleted: true,
      workshopJobId,
      reservationId,
    };
  });
};

export const finalizeWorkshopJob = async (workshopJobId: string) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  return prisma.$transaction(async (tx) => {
    const job = await tx.workshopJob.findUnique({
      where: { id: workshopJobId },
      include: {
        lines: {
          orderBy: [{ createdAt: "asc" }],
        },
      },
    });

    if (!job) {
      throw new HttpError(404, "Workshop job not found", "WORKSHOP_JOB_NOT_FOUND");
    }

    if (job.closedAt) {
      throw new HttpError(409, "Closed jobs cannot be finalized", "WORKSHOP_JOB_CLOSED");
    }

    if (job.lines.length === 0) {
      throw new HttpError(400, "Workshop job has no lines", "EMPTY_WORKSHOP_JOB");
    }

    if (job.finalizedBasketId) {
      const existingBasket = await tx.basket.findUnique({
        where: { id: job.finalizedBasketId },
      });
      if (existingBasket) {
        const basket = await buildBasketResponseTx(tx, existingBasket.id);
        return {
          job: toJobResponse(job),
          basket,
          idempotent: true,
        };
      }
    }

    const basket = await tx.basket.create({
      data: {
        status: BasketStatus.OPEN,
      },
    });

    const labourVariant = await getOrCreateLabourVariantTx(tx);

    for (const line of job.lines) {
      let variantId: string;
      if (line.type === "PART") {
        const productId = normalizeOptionalText(line.productId);
        if (!productId) {
          throw new HttpError(
            400,
            `PART line ${line.id} is missing productId`,
            "INVALID_WORKSHOP_LINE",
          );
        }
        const variant = await ensureVariantForPartTx(tx, {
          productId,
          variantId: normalizeOptionalText(line.variantId),
        });
        variantId = variant.id;
        if (line.variantId !== variant.id) {
          await tx.workshopJobLine.update({
            where: { id: line.id },
            data: { variantId: variant.id },
          });
        }
      } else {
        variantId = labourVariant.id;
      }

      await tx.basketItem.upsert({
        where: {
          basketId_variantId: {
            basketId: basket.id,
            variantId,
          },
        },
        create: {
          basketId: basket.id,
          variantId,
          quantity: line.qty,
          unitPrice: line.unitPricePence,
        },
        update: {
          quantity: {
            increment: line.qty,
          },
          unitPrice: line.unitPricePence,
        },
      });

      if (line.type === "PART") {
        await tx.inventoryMovement.create({
          data: {
            variantId,
            type: "WORKSHOP_USE",
            quantity: -line.qty,
            referenceType: "WORKSHOP_JOB_LINE",
            referenceId: line.id,
            note: line.description,
          },
        });
      }
    }

    const updatedJob = await tx.workshopJob.update({
      where: { id: workshopJobId },
      data: {
        finalizedBasketId: basket.id,
        ...(job.status === "BOOKING_MADE" || job.status === "BIKE_ARRIVED"
          ? { status: "BIKE_READY" }
          : {}),
      },
    });

    const basketResponse = await buildBasketResponseTx(tx, basket.id);

    return {
      job: toJobResponse(updatedJob),
      basket: basketResponse,
      idempotent: false,
    };
  });
};

export const closeWorkshopJob = async (workshopJobId: string) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  return prisma.$transaction(async (tx) => {
    const job = await ensureWorkshopJobExistsTx(tx, workshopJobId);
    if (job.closedAt) {
      return {
        job: toJobResponse(job),
        idempotent: true,
      };
    }

    const closed = await tx.workshopJob.update({
      where: { id: workshopJobId },
      data: {
        status: "COMPLETED",
        completedAt: job.completedAt ?? new Date(),
        closedAt: new Date(),
      },
    });

    return {
      job: toJobResponse(closed),
      idempotent: false,
    };
  });
};
