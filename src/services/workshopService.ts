import { BasketStatus, Prisma, WorkshopJobLineType, WorkshopJobStatus, WorkshopServicePricingMode } from "@prisma/client";
import { emit } from "../core/events";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { getCustomerDisplayName } from "../utils/customerName";
import { createAuditEventTx, type AuditActor } from "./auditService";
import {
  buildCustomerBikeDisplayName,
  getCustomerBikeByIdTx,
  toWorkshopBikeResponse,
} from "./customerBikeService";
import { getOrCreateDefaultLocationTx } from "./locationService";
import { toPosLineItemType, WORKSHOP_LABOUR_VARIANT_SKU } from "./posLineItemType";
import { getWorkshopJobEstimateData, invalidateCurrentWorkshopEstimateTx } from "./workshopEstimateService";
import {
  assertWorkshopScheduleAllowed,
  resolveWorkshopSchedulePatch,
} from "./workshopCalendarService";
import { getWorkshopJobPartsOverview } from "./workshopPartService";
import {
  buildWorkshopStatusAuditMetadata,
  parseWorkshopExecutionStatus,
  toWorkshopExecutionStatus,
  toWorkshopJobStatus,
  type WorkshopExecutionStatus,
} from "./workshopStatusService";

type CreateWorkshopJobInput = {
  customerId?: string | null;
  customerName?: string;
  bikeId?: string | null;
  bikeDescription?: string;
  scheduledStartAt?: string | Date | null;
  scheduledEndAt?: string | Date | null;
  durationMinutes?: number | null;
  notes?: string;
  locationId?: string;
  status?: string;
};

type UpdateWorkshopJobInput = {
  customerName?: string;
  bikeId?: string | null;
  bikeDescription?: string;
  scheduledStartAt?: string | Date | null;
  scheduledEndAt?: string | Date | null;
  durationMinutes?: number | null;
  notes?: string;
  status?: string;
};

type ListWorkshopJobsInput = {
  status?: string;
  q?: string;
  locationId?: string;
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

export type WorkshopJobLineDraftInput = {
  type: "PART" | "LABOUR";
  productId?: string | null;
  variantId?: string | null;
  description?: string;
  qty: number;
  unitPricePence: number;
};

type UpdateWorkshopJobLineInput = {
  description?: string;
  qty?: number;
  unitPricePence?: number;
  productId?: string | null;
  variantId?: string | null;
};

const normalizeOptionalText = (value: string | undefined | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeOptionalUuid = (
  value: string | undefined | null,
  field: string,
  code: string,
) => {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return undefined;
  }
  if (!isUuid(normalized)) {
    throw new HttpError(400, `Invalid ${field}`, code);
  }
  return normalized;
};

const buildCustomerDisplayName = (customer: { firstName: string; lastName: string }) =>
  getCustomerDisplayName(customer, "");

const getOrCreateDefaultStockLocationTx = async (tx: Prisma.TransactionClient) => {
  const existingDefault = await tx.stockLocation.findFirst({
    where: { isDefault: true },
    orderBy: { createdAt: "asc" },
  });

  if (existingDefault) {
    return existingDefault;
  }

  return tx.stockLocation.create({
    data: {
      name: "Default",
      isDefault: true,
    },
  });
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

const getCustomerByIdTx = async (
  tx: Prisma.TransactionClient,
  customerId: string,
) => {
  const customer = await tx.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  });

  if (!customer) {
    throw new HttpError(404, "Customer not found", "CUSTOMER_NOT_FOUND");
  }

  return customer;
};

const resolveWorkshopJobCustomerAndBikeTx = async (
  tx: Prisma.TransactionClient,
  input: {
    currentCustomerId?: string | null;
    requestedCustomerId?: string;
    currentBikeId?: string | null;
    requestedBikeId?: string | null;
    requestedBikeDescription?: string;
    currentBikeDescription?: string | null;
  },
) => {
  let customerId = input.requestedCustomerId ?? input.currentCustomerId ?? null;
  let customerName: string | undefined;
  let bikeId =
    input.requestedBikeId === null
      ? null
      : input.requestedBikeId ?? input.currentBikeId ?? null;
  let bikeDescription = input.requestedBikeDescription;
  let bike: Awaited<ReturnType<typeof getCustomerBikeByIdTx>> | null = null;

  if (bikeId) {
    bike = await getCustomerBikeByIdTx(tx, bikeId);
    if (customerId && bike.customerId !== customerId) {
      throw new HttpError(
        409,
        "Linked bike belongs to a different customer",
        "WORKSHOP_BIKE_CUSTOMER_MISMATCH",
      );
    }

    if (!customerId) {
      customerId = bike.customerId;
    }

    if (!bikeDescription) {
      const currentDescription = normalizeOptionalText(input.currentBikeDescription);
      const bikeDisplayName = buildCustomerBikeDisplayName(bike);
      if (!currentDescription || input.requestedBikeId !== undefined) {
        bikeDescription = bikeDisplayName;
      } else {
        bikeDescription = currentDescription;
      }
    }
  }

  if (customerId) {
    const customer = await getCustomerByIdTx(tx, customerId);
    customerName = buildCustomerDisplayName(customer);
  }

  return {
    customerId,
    customerName,
    bikeId,
    bike,
    bikeDescription,
  };
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

export const createWorkshopJobLineRecordTx = async (
  tx: Prisma.TransactionClient,
  workshopJobId: string,
  input: WorkshopJobLineDraftInput,
) => {
  const job = await ensureWorkshopJobExistsTx(tx, workshopJobId);
  if (job.closedAt) {
    throw new HttpError(409, "Closed jobs cannot be edited", "WORKSHOP_JOB_CLOSED");
  }

  if (input.type !== "PART" && input.type !== "LABOUR") {
    throw new HttpError(400, "type must be PART or LABOUR", "INVALID_WORKSHOP_LINE");
  }

  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    throw new HttpError(400, "qty must be a positive integer", "INVALID_WORKSHOP_LINE");
  }

  if (!Number.isInteger(input.unitPricePence) || input.unitPricePence < 0) {
    throw new HttpError(
      400,
      "unitPricePence must be a non-negative integer",
      "INVALID_WORKSHOP_LINE",
    );
  }

  if (input.type === "PART") {
    const productId = normalizeOptionalText(input.productId);
    const variantId = normalizeOptionalText(input.variantId);

    if (productId) {
      const product = await ensureProductExistsTx(tx, productId);
      const variant = await ensureVariantForPartTx(tx, {
        productId,
        variantId,
      });

      const description =
        normalizeOptionalText(input.description)
        ?? [product.name, variant.name ?? variant.sku].filter(Boolean).join(" - ");

      return tx.workshopJobLine.create({
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
    }

    if (variantId) {
      throw new HttpError(
        400,
        "variantId requires productId on PART lines",
        "INVALID_WORKSHOP_LINE",
      );
    }

    const description = normalizeOptionalText(input.description);
    if (!description) {
      throw new HttpError(
        400,
        "PART lines without a linked product require description",
        "INVALID_WORKSHOP_LINE",
      );
    }

    return tx.workshopJobLine.create({
      data: {
        jobId: workshopJobId,
        type: "PART",
        productId: null,
        variantId: null,
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

  const description = normalizeOptionalText(input.description);
  if (!description) {
    throw new HttpError(400, "LABOUR lines require description", "INVALID_WORKSHOP_LINE");
  }

  return tx.workshopJobLine.create({
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
};

const getOrCreateLabourVariantTx = async (tx: Prisma.TransactionClient) => {
  const existing = await tx.variant.findUnique({
    where: { sku: WORKSHOP_LABOUR_VARIANT_SKU },
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
        sku: WORKSHOP_LABOUR_VARIANT_SKU,
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
        where: { sku: WORKSHOP_LABOUR_VARIANT_SKU },
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

type WorkshopJobServicePricingConfig = {
  pricingMode: WorkshopServicePricingMode | null;
  targetTotalPence: number | null;
  adjustmentLineId: string | null;
};

export const configureWorkshopJobServicePricingTx = async (
  tx: Prisma.TransactionClient,
  workshopJobId: string,
  config: WorkshopJobServicePricingConfig,
) => {
  await tx.workshopJob.update({
    where: { id: workshopJobId },
    data: {
      servicePricingMode: config.pricingMode,
      serviceTargetTotalPence: config.targetTotalPence,
      servicePricingAdjustmentLineId: config.adjustmentLineId,
    },
  });
};

export const rebalanceWorkshopJobServicePricingTx = async (
  tx: Prisma.TransactionClient,
  workshopJobId: string,
) => {
  const job = await tx.workshopJob.findUnique({
    where: { id: workshopJobId },
    select: {
      id: true,
      servicePricingMode: true,
      serviceTargetTotalPence: true,
      servicePricingAdjustmentLineId: true,
    },
  });

  if (!job || job.servicePricingMode !== "FIXED_PRICE_SERVICE") {
    return {
      active: false,
      rebalanced: false,
      targetTotalPence: null,
      adjustedLineId: null,
      adjustedLineUnitPricePence: null,
    };
  }

  if (!job.serviceTargetTotalPence || !job.servicePricingAdjustmentLineId) {
    throw new HttpError(
      409,
      "Fixed-price workshop job is missing pricing configuration",
      "WORKSHOP_FIXED_PRICE_CONFIGURATION_INVALID",
    );
  }

  const lines = await tx.workshopJobLine.findMany({
    where: { jobId: workshopJobId },
    select: {
      id: true,
      type: true,
      qty: true,
      unitPricePence: true,
    },
  });

  const adjustmentLine = lines.find((line) => line.id === job.servicePricingAdjustmentLineId);
  if (!adjustmentLine) {
    throw new HttpError(
      409,
      "Fixed-price workshop job is missing its pricing labour line",
      "WORKSHOP_FIXED_PRICE_CONFIGURATION_INVALID",
    );
  }

  if (adjustmentLine.type !== "LABOUR") {
    throw new HttpError(
      409,
      "Fixed-price workshop jobs require a labour adjustment line",
      "WORKSHOP_FIXED_PRICE_CONFIGURATION_INVALID",
    );
  }

  if (adjustmentLine.qty !== 1) {
    throw new HttpError(
      409,
      "Fixed-price labour lines must keep qty 1",
      "WORKSHOP_FIXED_PRICE_CONFIGURATION_INVALID",
    );
  }

  const nonAdjustmentTotalPence = lines
    .filter((line) => line.id !== adjustmentLine.id)
    .reduce((sum, line) => sum + (line.qty * line.unitPricePence), 0);

  if (nonAdjustmentTotalPence > job.serviceTargetTotalPence) {
    throw new HttpError(
      409,
      "This change would take the job over its fixed service price target",
      "WORKSHOP_FIXED_PRICE_TARGET_EXCEEDED",
    );
  }

  const adjustmentUnitPricePence = job.serviceTargetTotalPence - nonAdjustmentTotalPence;

  if (adjustmentLine.unitPricePence !== adjustmentUnitPricePence) {
    await tx.workshopJobLine.update({
      where: { id: adjustmentLine.id },
      data: {
        unitPricePence: adjustmentUnitPricePence,
      },
    });
  }

  return {
    active: true,
    rebalanced: adjustmentLine.unitPricePence !== adjustmentUnitPricePence,
    targetTotalPence: job.serviceTargetTotalPence,
    adjustedLineId: adjustmentLine.id,
    adjustedLineUnitPricePence: adjustmentUnitPricePence,
  };
};

const toJobResponse = (job: {
  id: string;
  customerId: string | null;
  bikeId: string | null;
  locationId: string;
  customerName: string | null;
  bikeDescription: string | null;
  status: WorkshopJobStatus;
  notes: string | null;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  scheduledDate: Date | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  durationMinutes: number | null;
  servicePricingMode: WorkshopServicePricingMode | null;
  serviceTargetTotalPence: number | null;
  servicePricingAdjustmentLineId: string | null;
  depositRequiredPence: number;
  depositStatus: string;
  finalizedBasketId: string | null;
  completedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  bike?: Awaited<ReturnType<typeof getCustomerBikeByIdTx>> | null;
  sale?: {
    id: string;
    totalPence: number;
    createdAt: Date;
  } | null;
}) => ({
  id: job.id,
  customerId: job.customerId,
  bikeId: job.bikeId,
  locationId: job.locationId,
  customerName: job.customerName,
  bikeDescription: job.bikeDescription ?? (job.bike ? buildCustomerBikeDisplayName(job.bike) : null),
  bike: toWorkshopBikeResponse(job.bike ?? null),
  status: toWorkshopExecutionStatus(job),
  rawStatus: job.status,
  notes: job.notes,
  assignedStaffId: job.assignedStaffId,
  assignedStaffName: job.assignedStaffName,
  scheduledDate: job.scheduledDate,
  scheduledStartAt: job.scheduledStartAt,
  scheduledEndAt: job.scheduledEndAt,
  durationMinutes: job.durationMinutes,
  servicePricingMode: job.servicePricingMode,
  serviceTargetTotalPence: job.serviceTargetTotalPence,
  servicePricingAdjustmentLineId: job.servicePricingAdjustmentLineId,
  depositRequiredPence: job.depositRequiredPence,
  depositStatus: job.depositStatus,
  finalizedBasketId: job.finalizedBasketId,
  sale: job.sale
    ? {
        id: job.sale.id,
        totalPence: job.sale.totalPence,
        createdAt: job.sale.createdAt,
      }
    : null,
  completedAt: job.completedAt,
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
      type: toPosLineItemType(item.variant.sku),
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
  const customerId = input.customerId === null
    ? null
    : normalizeOptionalUuid(input.customerId, "customer id", "INVALID_CUSTOMER_ID");
  const bikeId = input.bikeId === null
    ? null
    : normalizeOptionalUuid(input.bikeId, "bike id", "INVALID_CUSTOMER_BIKE_ID");
  const customerName = normalizeOptionalText(input.customerName);
  const bikeDescription = normalizeOptionalText(input.bikeDescription);
  const locationId = normalizeOptionalText(input.locationId);
  const notes = normalizeOptionalText(input.notes);

  const targetStatus = input.status
    ? parseWorkshopExecutionStatus(input.status)
    : ("BOOKED" as WorkshopExecutionStatus);

  return prisma.$transaction(async (tx) => {
    const scheduleResolution = await resolveWorkshopSchedulePatch(
      {
        scheduledStartAt: input.scheduledStartAt,
        scheduledEndAt: input.scheduledEndAt,
        durationMinutes: input.durationMinutes,
      },
      {
        scheduledDate: null,
        scheduledStartAt: null,
        scheduledEndAt: null,
        durationMinutes: null,
      },
      tx,
    );

    await assertWorkshopScheduleAllowed(
      {
        scheduledDate: scheduleResolution.schedule.scheduledDate,
        scheduledStartAt: scheduleResolution.schedule.scheduledStartAt,
        scheduledEndAt: scheduleResolution.schedule.scheduledEndAt,
        durationMinutes: scheduleResolution.schedule.durationMinutes,
      },
      tx,
    );

    const resolvedCustomerAndBike = await resolveWorkshopJobCustomerAndBikeTx(tx, {
      requestedCustomerId: customerId ?? undefined,
      requestedBikeId: bikeId,
      requestedBikeDescription: bikeDescription,
    });

    const resolvedCustomerName = customerName ?? resolvedCustomerAndBike.customerName;
    const resolvedBikeDescription =
      bikeDescription ?? resolvedCustomerAndBike.bikeDescription;

    if (!resolvedCustomerName) {
      throw new HttpError(
        400,
        "customerName is required unless a linked customer or bike supplies it",
        "INVALID_WORKSHOP_JOB",
      );
    }
    if (!resolvedBikeDescription) {
      throw new HttpError(
        400,
        "bikeDescription is required unless a linked bike supplies it",
        "INVALID_WORKSHOP_JOB",
      );
    }

    const location = locationId
      ? await tx.location.findUnique({
          where: { id: locationId },
          select: { id: true },
        })
      : await getOrCreateDefaultLocationTx(tx);

    if (!location) {
      throw new HttpError(404, "Location not found", "LOCATION_NOT_FOUND");
    }

    const job = await tx.workshopJob.create({
      data: {
        customerId: resolvedCustomerAndBike.customerId,
        bikeId: resolvedCustomerAndBike.bikeId,
        customerName: resolvedCustomerName,
        bikeDescription: resolvedBikeDescription,
        notes,
        status: toWorkshopJobStatus(targetStatus),
        scheduledDate: scheduleResolution.schedule.scheduledDate,
        scheduledStartAt: scheduleResolution.schedule.scheduledStartAt,
        scheduledEndAt: scheduleResolution.schedule.scheduledEndAt,
        durationMinutes: scheduleResolution.schedule.durationMinutes,
        source: "IN_STORE",
        depositStatus: "NOT_REQUIRED",
        depositRequiredPence: 0,
        locationId: location.id,
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
  });
};

export const listWorkshopJobs = async (filters: ListWorkshopJobsInput = {}) => {
  const q = normalizeOptionalText(filters.q);
  const locationId = normalizeOptionalText(filters.locationId);
  const take = normalizeTake(filters.take);
  const skip = normalizeSkip(filters.skip);
  const requestedStatus = filters.status ? parseWorkshopExecutionStatus(filters.status) : undefined;

  const jobs = await prisma.workshopJob.findMany({
    where: {
      ...(locationId ? { locationId } : {}),
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
              { bike: { is: { label: { contains: q, mode: "insensitive" } } } },
              { bike: { is: { make: { contains: q, mode: "insensitive" } } } },
              { bike: { is: { model: { contains: q, mode: "insensitive" } } } },
              { bike: { is: { frameNumber: { contains: q, mode: "insensitive" } } } },
              { bike: { is: { serialNumber: { contains: q, mode: "insensitive" } } } },
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
      bike: {
        select: {
          id: true,
          customerId: true,
          label: true,
          make: true,
          model: true,
          colour: true,
          frameNumber: true,
          serialNumber: true,
          registrationNumber: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      sale: {
        select: {
          id: true,
          totalPence: true,
          createdAt: true,
        },
      },
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

  const [partsOverview, estimateData] = await Promise.all([
    getWorkshopJobPartsOverview(workshopJobId),
    getWorkshopJobEstimateData(workshopJobId),
  ]);

  return {
    job: toJobResponse(job),
    lines: job.lines.map((line) => toLineResponse(line)),
    partsOverview,
    ...estimateData,
  };
};

export const updateWorkshopJob = async (workshopJobId: string, input: UpdateWorkshopJobInput) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  const hasAnyField =
    Object.prototype.hasOwnProperty.call(input, "customerName") ||
    Object.prototype.hasOwnProperty.call(input, "bikeId") ||
    Object.prototype.hasOwnProperty.call(input, "bikeDescription") ||
    Object.prototype.hasOwnProperty.call(input, "scheduledStartAt") ||
    Object.prototype.hasOwnProperty.call(input, "scheduledEndAt") ||
    Object.prototype.hasOwnProperty.call(input, "durationMinutes") ||
    Object.prototype.hasOwnProperty.call(input, "notes") ||
    Object.prototype.hasOwnProperty.call(input, "status");

  if (!hasAnyField) {
    throw new HttpError(400, "No fields provided", "INVALID_WORKSHOP_JOB_UPDATE");
  }

  const result = await prisma.$transaction(async (tx) => {
    const job = await ensureWorkshopJobExistsTx(tx, workshopJobId);
    const data: Prisma.WorkshopJobUpdateInput = {};
    let shouldEmitCompletion = false;
    let customerNamePatchedExplicitly = false;

    if (Object.prototype.hasOwnProperty.call(input, "customerName")) {
      const customerName = normalizeOptionalText(input.customerName);
      if (!customerName) {
        throw new HttpError(400, "customerName cannot be empty", "INVALID_WORKSHOP_JOB_UPDATE");
      }
      data.customerName = customerName;
      customerNamePatchedExplicitly = true;
    }

    const bikeIdProvided = Object.prototype.hasOwnProperty.call(input, "bikeId");
    const bikeDescriptionProvided = Object.prototype.hasOwnProperty.call(input, "bikeDescription");

    if (bikeIdProvided || bikeDescriptionProvided) {
      const resolvedBikeId = input.bikeId === null
        ? null
        : normalizeOptionalUuid(input.bikeId, "bike id", "INVALID_CUSTOMER_BIKE_ID");
      const resolvedBikeDescription = bikeDescriptionProvided
        ? normalizeOptionalText(input.bikeDescription)
        : undefined;

      if (bikeDescriptionProvided && !resolvedBikeDescription) {
        throw new HttpError(
          400,
          "bikeDescription cannot be empty",
          "INVALID_WORKSHOP_JOB_UPDATE",
        );
      }

      const resolvedCustomerAndBike = await resolveWorkshopJobCustomerAndBikeTx(tx, {
        currentCustomerId: job.customerId,
        requestedBikeId: bikeIdProvided ? resolvedBikeId : undefined,
        currentBikeId: job.bikeId,
        requestedBikeDescription: resolvedBikeDescription,
        currentBikeDescription: job.bikeDescription,
      });

      if (bikeIdProvided) {
        data.bikeId = resolvedCustomerAndBike.bikeId;
      }

      if (bikeDescriptionProvided || bikeIdProvided) {
        const nextBikeDescription =
          resolvedBikeDescription ?? resolvedCustomerAndBike.bikeDescription;
        if (!nextBikeDescription) {
          throw new HttpError(
            400,
            "bikeDescription cannot be empty",
            "INVALID_WORKSHOP_JOB_UPDATE",
          );
        }
        data.bikeDescription = nextBikeDescription;
      }

      if (!job.customerId && resolvedCustomerAndBike.customerId) {
        data.customerId = resolvedCustomerAndBike.customerId;
        if (!customerNamePatchedExplicitly && !normalizeOptionalText(job.customerName)) {
          data.customerName = resolvedCustomerAndBike.customerName ?? job.customerName;
        }
      }
    }

    if (Object.prototype.hasOwnProperty.call(input, "notes")) {
      data.notes = normalizeOptionalText(input.notes) ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(input, "status")) {
      const parsed = parseWorkshopExecutionStatus(input.status ?? "");
      if (parsed === "COLLECTED" || parsed === "CLOSED") {
        const existingSale = await tx.sale.findUnique({
          where: { workshopJobId },
          select: { id: true },
        });
        if (!existingSale) {
          throw new HttpError(
            409,
            "Workshop job must be checked out to a sale before collection",
            "WORKSHOP_COLLECTION_REQUIRES_SALE",
          );
        }
      }
      data.status = toWorkshopJobStatus(parsed);
      if (parsed === "CLOSED") {
        data.closedAt = job.closedAt ?? new Date();
        data.completedAt = job.completedAt ?? new Date();
        shouldEmitCompletion = !job.completedAt;
      } else {
        data.closedAt = null;
        if (parsed === "COLLECTED") {
          data.completedAt = job.completedAt ?? new Date();
          shouldEmitCompletion = !job.completedAt;
        }
      }
    }

    const scheduleResolution = await resolveWorkshopSchedulePatch(
      {
        scheduledStartAt: input.scheduledStartAt,
        scheduledEndAt: input.scheduledEndAt,
        durationMinutes: input.durationMinutes,
      },
      {
        scheduledDate: job.scheduledDate,
        scheduledStartAt: job.scheduledStartAt,
        scheduledEndAt: job.scheduledEndAt,
        durationMinutes: job.durationMinutes,
      },
      tx,
    );

    if (scheduleResolution.hasScheduleChanges) {
      await assertWorkshopScheduleAllowed(
        {
          workshopJobId,
          staffId: job.assignedStaffId,
          scheduledDate: scheduleResolution.schedule.scheduledDate,
          scheduledStartAt: scheduleResolution.schedule.scheduledStartAt,
          scheduledEndAt: scheduleResolution.schedule.scheduledEndAt,
          durationMinutes: scheduleResolution.schedule.durationMinutes,
        },
        tx,
      );

      data.scheduledDate = scheduleResolution.schedule.scheduledDate;
      data.scheduledStartAt = scheduleResolution.schedule.scheduledStartAt;
      data.scheduledEndAt = scheduleResolution.schedule.scheduledEndAt;
      data.durationMinutes = scheduleResolution.schedule.durationMinutes;
    }

    const updated = await tx.workshopJob.update({
      where: { id: workshopJobId },
      data,
    });

    return {
      job: toJobResponse(updated),
      emittedCompletion: shouldEmitCompletion && Boolean(updated.completedAt),
      completedAt: updated.completedAt,
    };
  });

  if (result.emittedCompletion && result.completedAt) {
    emit("workshop.job.completed", {
      id: result.job.id,
      type: "workshop.job.completed",
      timestamp: new Date().toISOString(),
      workshopJobId: result.job.id,
      status: "COMPLETED",
      completedAt: result.completedAt.toISOString(),
    });
  }

  return result.job;
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
    if (job.bikeId) {
      if (customerId === null) {
        throw new HttpError(
          409,
          "Cannot remove the customer while a bike record is linked",
          "WORKSHOP_BIKE_REQUIRES_CUSTOMER",
        );
      }

      const linkedBike = await getCustomerBikeByIdTx(tx, job.bikeId);
      if (linkedBike.customerId !== customerId) {
        throw new HttpError(
          409,
          "Linked bike belongs to a different customer",
          "WORKSHOP_BIKE_CUSTOMER_MISMATCH",
        );
      }
    }

    if (customerId !== null) {
      const customer = await getCustomerByIdTx(tx, customerId);

      const existingName = normalizeOptionalText(job.customerName);
      if (!existingName) {
        customerNameToSet = buildCustomerDisplayName(customer);
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
    const line = await createWorkshopJobLineRecordTx(tx, workshopJobId, {
      type: input.type,
      productId: input.productId,
      variantId: input.variantId,
      description: input.description,
      qty: input.qty,
      unitPricePence: input.unitPricePence,
    });

    await rebalanceWorkshopJobServicePricingTx(tx, workshopJobId);

    await invalidateCurrentWorkshopEstimateTx(
      tx,
      workshopJobId,
      "Workshop estimate lines changed",
    );

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
    if (
      job.servicePricingMode === "FIXED_PRICE_SERVICE"
      && job.servicePricingAdjustmentLineId === lineId
      && Object.prototype.hasOwnProperty.call(input, "qty")
      && input.qty !== 1
    ) {
      throw new HttpError(
        409,
        "The fixed-price labour line must keep qty 1",
        "WORKSHOP_FIXED_PRICE_CONFIGURATION_INVALID",
      );
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

    await rebalanceWorkshopJobServicePricingTx(tx, workshopJobId);

    await invalidateCurrentWorkshopEstimateTx(
      tx,
      workshopJobId,
      "Workshop estimate lines changed",
    );

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
    if (
      job.servicePricingMode === "FIXED_PRICE_SERVICE"
      && job.servicePricingAdjustmentLineId === lineId
    ) {
      throw new HttpError(
        409,
        "The fixed-price labour line cannot be removed while fixed pricing is active",
        "WORKSHOP_FIXED_PRICE_CONFIGURATION_INVALID",
      );
    }
    await tx.workshopJobLine.delete({
      where: { id: lineId },
    });

    await rebalanceWorkshopJobServicePricingTx(tx, workshopJobId);

    await invalidateCurrentWorkshopEstimateTx(
      tx,
      workshopJobId,
      "Workshop estimate lines changed",
    );

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
    const defaultStockLocation = await getOrCreateDefaultStockLocationTx(tx);

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
        await tx.stockLedgerEntry.create({
          data: {
            variantId,
            locationId: defaultStockLocation.id,
            type: "WORKSHOP",
            quantityDelta: -line.qty,
            referenceType: "WORKSHOP_JOB_LINE",
            referenceId: line.id,
            note: line.description,
          },
        });

        await tx.inventoryMovement.create({
          data: {
            variantId,
            locationId: defaultStockLocation.id,
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
        ...((job.status === "BOOKED" || job.status === "BIKE_ARRIVED" || job.status === "IN_PROGRESS")
          ? { status: "READY_FOR_COLLECTION" }
          : {}),
      },
    });

    if (updatedJob.status !== job.status) {
      await createAuditEventTx(tx, {
        action: "JOB_STATUS_CHANGED",
        entityType: "WORKSHOP_JOB",
        entityId: workshopJobId,
        metadata: {
          fromStage: toWorkshopExecutionStatus({ status: job.status, closedAt: job.closedAt }),
          toStage: toWorkshopExecutionStatus({ status: updatedJob.status, closedAt: updatedJob.closedAt }),
          ...buildWorkshopStatusAuditMetadata({
            fromStatus: job.status,
            toStatus: updatedJob.status,
            changeSource: "AUTOMATIC",
            trigger: "POS_HANDOFF_READY",
          }),
        },
      });
    }

    const basketResponse = await buildBasketResponseTx(tx, basket.id);

    return {
      job: toJobResponse(updatedJob),
      basket: basketResponse,
      idempotent: false,
    };
  });
};

export const closeWorkshopJob = async (
  workshopJobId: string,
  auditActor?: AuditActor,
) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  const result = await prisma.$transaction(async (tx) => {
    const job = await ensureWorkshopJobExistsTx(tx, workshopJobId);
    if (job.closedAt) {
      return {
        job: toJobResponse(job),
        idempotent: true,
        emittedCompletion: false,
        completedAt: job.completedAt,
      };
    }

    const existingSale = await tx.sale.findUnique({
      where: { workshopJobId },
      select: { id: true },
    });

    if (!existingSale) {
      throw new HttpError(
        409,
        "Workshop job must be checked out to a sale before collection",
        "WORKSHOP_COLLECTION_REQUIRES_SALE",
      );
    }

    const closed = await tx.workshopJob.update({
      where: { id: workshopJobId },
      data: {
        status: "COMPLETED",
        completedAt: job.completedAt ?? new Date(),
        closedAt: new Date(),
      },
    });

    await createAuditEventTx(
      tx,
      {
        action: "WORKSHOP_JOB_CLOSED",
        entityType: "WORKSHOP_JOB",
        entityId: workshopJobId,
        metadata: {
          saleId: existingSale.id,
          fromStatus: job.status,
          toStatus: closed.status,
          completedAt: closed.completedAt?.toISOString() ?? null,
          closedAt: closed.closedAt?.toISOString() ?? null,
        },
      },
      auditActor,
    );

    return {
      job: toJobResponse(closed),
      idempotent: false,
      emittedCompletion: !job.completedAt && Boolean(closed.completedAt),
      completedAt: closed.completedAt,
    };
  });

  if (result.emittedCompletion && result.completedAt) {
    emit("workshop.job.completed", {
      id: result.job.id,
      type: "workshop.job.completed",
      timestamp: new Date().toISOString(),
      workshopJobId: result.job.id,
      status: "COMPLETED",
      completedAt: result.completedAt.toISOString(),
    });
  }

  return {
    job: result.job,
    idempotent: result.idempotent,
  };
};
