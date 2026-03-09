import { BasketStatus, Prisma, WorkshopJobLineType, WorkshopJobStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";

type WorkflowStatus = "BOOKED" | "IN_PROGRESS" | "READY" | "COLLECTED" | "CLOSED";

type CreateWorkshopJobInput = {
  customerName?: string;
  bikeDescription?: string;
  notes?: string;
  status?: string;
};

type UpdateWorkshopJobInput = {
  customerName?: string;
  bikeDescription?: string;
  notes?: string;
  status?: string;
};

type ListWorkshopJobsInput = {
  status?: string;
  q?: string;
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

const parseWorkflowStatus = (value: string): WorkflowStatus => {
  const normalized = value.trim().toUpperCase();
  switch (normalized) {
    case "BOOKED":
      return "BOOKED";
    case "IN_PROGRESS":
      return "IN_PROGRESS";
    case "READY":
      return "READY";
    case "COLLECTED":
      return "COLLECTED";
    case "CLOSED":
      return "CLOSED";
    default:
      throw new HttpError(
        400,
        "status must be BOOKED, IN_PROGRESS, READY, COLLECTED, or CLOSED",
        "INVALID_WORKSHOP_STATUS",
      );
  }
};

const toWorkshopJobStatus = (status: WorkflowStatus): WorkshopJobStatus => {
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

const ensureWorkshopJobLineExistsTx = async (
  tx: Prisma.TransactionClient,
  workshopJobId: string,
  lineId: string,
) => {
  const line = await tx.workshopJobLine.findUnique({
    where: { id: lineId },
    include: {
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
    },
  });

  if (!line || line.jobId !== workshopJobId) {
    throw new HttpError(404, "Workshop job line not found", "WORKSHOP_JOB_LINE_NOT_FOUND");
  }

  return line;
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

const toJobResponse = (job: {
  id: string;
  customerId: string | null;
  customerName: string | null;
  bikeDescription: string | null;
  status: WorkshopJobStatus;
  notes: string | null;
  finalizedBasketId: string | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: job.id,
  customerId: job.customerId,
  customerName: job.customerName,
  bikeDescription: job.bikeDescription,
  status: toWorkflowStatus(job),
  notes: job.notes,
  finalizedBasketId: job.finalizedBasketId,
  closedAt: job.closedAt,
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
  const customerName = normalizeOptionalText(input.customerName);
  const bikeDescription = normalizeOptionalText(input.bikeDescription);
  const notes = normalizeOptionalText(input.notes);

  if (!customerName) {
    throw new HttpError(400, "customerName is required", "INVALID_WORKSHOP_JOB");
  }
  if (!bikeDescription) {
    throw new HttpError(400, "bikeDescription is required", "INVALID_WORKSHOP_JOB");
  }

  const targetStatus = input.status
    ? parseWorkflowStatus(input.status)
    : ("BOOKED" as WorkflowStatus);

  const job = await prisma.workshopJob.create({
    data: {
      customerName,
      bikeDescription,
      notes,
      status: toWorkshopJobStatus(targetStatus),
      source: "IN_STORE",
      depositStatus: "NOT_REQUIRED",
      depositRequiredPence: 0,
      ...(targetStatus === "CLOSED"
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
};

export const listWorkshopJobs = async (filters: ListWorkshopJobsInput = {}) => {
  const q = normalizeOptionalText(filters.q);
  const take = normalizeTake(filters.take);
  const skip = normalizeSkip(filters.skip);
  const requestedStatus = filters.status ? parseWorkflowStatus(filters.status) : undefined;

  const jobs = await prisma.workshopJob.findMany({
    where: {
      ...(requestedStatus === "CLOSED"
        ? { closedAt: { not: null } }
        : requestedStatus
          ? {
              status: toWorkshopJobStatus(requestedStatus),
              closedAt: null,
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
      lines: {
        include: {
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
        },
        orderBy: [{ createdAt: "asc" }],
      },
    },
  });

  if (!job) {
    throw new HttpError(404, "Workshop job not found", "WORKSHOP_JOB_NOT_FOUND");
  }

  return {
    job: toJobResponse(job),
    lines: job.lines.map((line) => toLineResponse(line)),
  };
};

export const updateWorkshopJob = async (workshopJobId: string, input: UpdateWorkshopJobInput) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  const hasAnyField =
    Object.prototype.hasOwnProperty.call(input, "customerName") ||
    Object.prototype.hasOwnProperty.call(input, "bikeDescription") ||
    Object.prototype.hasOwnProperty.call(input, "notes") ||
    Object.prototype.hasOwnProperty.call(input, "status");

  if (!hasAnyField) {
    throw new HttpError(400, "No fields provided", "INVALID_WORKSHOP_JOB_UPDATE");
  }

  return prisma.$transaction(async (tx) => {
    const job = await ensureWorkshopJobExistsTx(tx, workshopJobId);
    const data: Prisma.WorkshopJobUpdateInput = {};

    if (Object.prototype.hasOwnProperty.call(input, "customerName")) {
      const customerName = normalizeOptionalText(input.customerName);
      if (!customerName) {
        throw new HttpError(400, "customerName cannot be empty", "INVALID_WORKSHOP_JOB_UPDATE");
      }
      data.customerName = customerName;
    }

    if (Object.prototype.hasOwnProperty.call(input, "bikeDescription")) {
      const bikeDescription = normalizeOptionalText(input.bikeDescription);
      if (!bikeDescription) {
        throw new HttpError(
          400,
          "bikeDescription cannot be empty",
          "INVALID_WORKSHOP_JOB_UPDATE",
        );
      }
      data.bikeDescription = bikeDescription;
    }

    if (Object.prototype.hasOwnProperty.call(input, "notes")) {
      data.notes = normalizeOptionalText(input.notes) ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(input, "status")) {
      const parsed = parseWorkflowStatus(input.status ?? "");
      data.status = toWorkshopJobStatus(parsed);
      if (parsed === "CLOSED") {
        data.closedAt = job.closedAt ?? new Date();
        data.completedAt = job.completedAt ?? new Date();
      } else {
        data.closedAt = null;
        if (parsed === "COLLECTED") {
          data.completedAt = job.completedAt ?? new Date();
        }
      }
    }

    const updated = await tx.workshopJob.update({
      where: { id: workshopJobId },
      data,
    });

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

  if (!Number.isInteger(input.qty) || (input.qty ?? 0) <= 0) {
    throw new HttpError(400, "qty must be a positive integer", "INVALID_WORKSHOP_LINE");
  }

  if (!Number.isInteger(input.unitPricePence) || (input.unitPricePence ?? -1) < 0) {
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
          qty: input.qty,
          unitPricePence: input.unitPricePence,
        },
        include: {
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
        },
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
          qty: input.qty,
          unitPricePence: input.unitPricePence,
        },
        include: {
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
        },
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
    throw new HttpError(400, "No fields provided", "INVALID_WORKSHOP_LINE_UPDATE");
  }

  return prisma.$transaction(async (tx) => {
    const job = await ensureWorkshopJobExistsTx(tx, workshopJobId);
    if (job.closedAt) {
      throw new HttpError(409, "Closed jobs cannot be edited", "WORKSHOP_JOB_CLOSED");
    }

    const existingLine = await ensureWorkshopJobLineExistsTx(tx, workshopJobId, lineId);
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
        throw new HttpError(400, "qty must be a positive integer", "INVALID_WORKSHOP_LINE_UPDATE");
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

    if (existingLine.type === "PART") {
      const productIdProvided = Object.prototype.hasOwnProperty.call(input, "productId");
      const variantIdProvided = Object.prototype.hasOwnProperty.call(input, "variantId");

      if (productIdProvided || variantIdProvided) {
        const nextProductId = productIdProvided
          ? normalizeOptionalText(input.productId ?? undefined)
          : normalizeOptionalText(existingLine.productId ?? undefined);

        if (!nextProductId) {
          throw new HttpError(
            400,
            "PART lines require productId",
            "INVALID_WORKSHOP_LINE_UPDATE",
          );
        }

        const product = await ensureProductExistsTx(tx, nextProductId);
        const variant = await ensureVariantForPartTx(tx, {
          productId: product.id,
          variantId: variantIdProvided
            ? normalizeOptionalText(input.variantId ?? undefined)
            : normalizeOptionalText(existingLine.variantId ?? undefined),
        });

        data.productId = product.id;
        data.variantId = variant.id;
      }
    } else if (
      Object.prototype.hasOwnProperty.call(input, "productId") ||
      Object.prototype.hasOwnProperty.call(input, "variantId")
    ) {
      throw new HttpError(
        400,
        "LABOUR lines cannot set productId or variantId",
        "INVALID_WORKSHOP_LINE_UPDATE",
      );
    }

    const updatedLine = await tx.workshopJobLine.update({
      where: { id: lineId },
      data,
      include: {
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
      },
    });

    return {
      line: toLineResponse(updatedLine),
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

    await ensureWorkshopJobLineExistsTx(tx, workshopJobId, lineId);
    await tx.workshopJobLine.delete({
      where: { id: lineId },
    });

    return { ok: true };
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
