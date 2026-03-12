import { BasketStatus, PaymentMethod, Prisma, SaleTenderMethod } from "@prisma/client";
import { emit } from "../core/events";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import {
  recordCashRefundMovementForPaymentTx,
  recordCashSaleMovementForSaleTx,
  recordCashSaleMovementForPaymentTx,
} from "./tillService";

type CheckoutPaymentInput = {
  paymentMethod?: PaymentMethod;
  amountPence?: number;
  providerRef?: string;
};

type SaleReturnItemInput = {
  saleItemId: string;
  quantity: number;
};

type SaleReturnRefundInput = {
  method?: PaymentMethod;
  amountPence?: number;
  providerRef?: string;
};

type DateRangeInput = {
  from?: string;
  to?: string;
};

type CompleteSaleInput = {
  requireCapturedIntent?: boolean;
  requireTenders?: boolean;
  staffActorId?: string;
};

const emitSaleCompletedEvent = (payload: {
  saleId: string;
  completedAt: Date;
  totalPence?: number;
  changeDuePence?: number;
}) => {
  emit("sale.completed", {
    id: payload.saleId,
    type: "sale.completed",
    timestamp: new Date().toISOString(),
    saleId: payload.saleId,
    completedAt: payload.completedAt.toISOString(),
    ...(payload.totalPence !== undefined ? { totalPence: payload.totalPence } : {}),
    ...(payload.changeDuePence !== undefined ? { changeDuePence: payload.changeDuePence } : {}),
  });
};

type SaleTenderInput = {
  method?: SaleTenderMethod;
  amountPence?: number;
};

const toDateOrThrow = (value: string, label: "from" | "to"): Date => {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateOnly.test(value)) {
    throw new HttpError(400, `${label} must be YYYY-MM-DD`, "INVALID_DATE");
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${label} is invalid`, "INVALID_DATE");
  }

  return date;
};

const normalizeOptionalText = (value: string | undefined | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toCustomerName = (customer: {
  name?: string | null;
  firstName: string;
  lastName: string;
}) => {
  const explicitName = normalizeOptionalText(customer.name ?? undefined);
  if (explicitName) {
    return explicitName;
  }
  return [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();
};

const toReceiptNumber = (saleId: string, completedAt: Date) => {
  const y = completedAt.getUTCFullYear();
  const m = String(completedAt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(completedAt.getUTCDate()).padStart(2, "0");
  const normalizedSaleId = saleId.replaceAll("-", "").toUpperCase();
  return `S-${y}${m}${d}-${normalizedSaleId}`;
};

const toSaleTenderMethodFromPaymentMethod = (method: PaymentMethod): SaleTenderMethod => {
  switch (method) {
    case "CASH":
      return "CASH";
    case "CARD":
      return "CARD";
    default:
      return "VOUCHER";
  }
};

const toSaleTenderMethodFromProvider = (provider: string): SaleTenderMethod => {
  const normalized = normalizeOptionalText(provider)?.toUpperCase();
  if (normalized === "CASH") {
    return "CASH";
  }
  if (normalized === "CARD") {
    return "CARD";
  }
  return "CARD";
};

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

const getWorkshopJobForBasketTx = async (
  tx: Prisma.TransactionClient,
  basketId: string,
) => {
  const matches = await tx.workshopJob.findMany({
    where: { finalizedBasketId: basketId },
    select: {
      id: true,
      customerId: true,
      status: true,
      completedAt: true,
      cancelledAt: true,
    },
    take: 2,
  });

  if (matches.length > 1) {
    throw new HttpError(
      409,
      "Basket is linked to multiple workshop jobs",
      "WORKSHOP_BASKET_CONFLICT",
    );
  }

  return matches[0] ?? null;
};

const toSaleResponse = async (saleId: string) => {
  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    include: {
      customer: true,
      createdByStaff: true,
      items: {
        include: {
          variant: {
            include: {
              product: true,
            },
          },
        },
      },
      payments: {
        orderBy: { createdAt: "asc" },
      },
      tenders: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });

  if (!sale) {
    throw new HttpError(404, "Sale not found", "SALE_NOT_FOUND");
  }

  const primaryPayment = sale.payments[0] ?? null;

  return {
    sale: {
      id: sale.id,
      basketId: sale.basketId,
      subtotalPence: sale.subtotalPence,
      taxPence: sale.taxPence,
      totalPence: sale.totalPence,
      changeDuePence: sale.changeDuePence,
      createdAt: sale.createdAt,
      completedAt: sale.completedAt,
      receiptNumber: sale.receiptNumber,
      createdByStaff: sale.createdByStaff
        ? {
            id: sale.createdByStaff.id,
            username: sale.createdByStaff.username,
            name: sale.createdByStaff.name,
          }
        : null,
      customer: sale.customer
        ? {
            id: sale.customer.id,
            name: toCustomerName(sale.customer),
            firstName: sale.customer.firstName,
            lastName: sale.customer.lastName,
            email: sale.customer.email,
            phone: sale.customer.phone,
          }
        : null,
    },
    saleItems: sale.items.map((item) => ({
      id: item.id,
      saleId: item.saleId,
      variantId: item.variantId,
      sku: item.variant.sku,
      productName: item.variant.product.name,
      variantName: item.variant.name,
      quantity: item.quantity,
      unitPricePence: item.unitPricePence,
      lineTotalPence: item.lineTotalPence,
    })),
    payment: primaryPayment
      ? {
          id: primaryPayment.id,
          saleId: primaryPayment.saleId,
          method: primaryPayment.method,
          amountPence: primaryPayment.amountPence,
          providerRef: primaryPayment.providerRef,
          createdAt: primaryPayment.createdAt,
        }
      : null,
    tenders: sale.tenders.map((tender) => ({
      id: tender.id,
      saleId: tender.saleId,
      method: tender.method,
      amountPence: tender.amountPence,
      createdAt: tender.createdAt,
      createdByStaffId: tender.createdByStaffId,
    })),
    tenderSummary: (() => {
      const tenderedPence = sale.tenders.reduce((sum, tender) => sum + tender.amountPence, 0);
      const changeDuePence = Math.max(0, tenderedPence - sale.totalPence);
      return {
        totalPence: sale.totalPence,
        tenderedPence,
        remainingPence: Math.max(0, sale.totalPence - tenderedPence),
        changeDuePence,
        cashTenderedPence: sale.tenders
          .filter((tender) => tender.method === "CASH")
          .reduce((sum, tender) => sum + tender.amountPence, 0),
      };
    })(),
  };
};

const validateCheckoutPayment = (
  payment: CheckoutPaymentInput,
  totalPence: number,
): { method: PaymentMethod; amountPence: number; providerRef?: string } | null => {
  const hasMethod = payment.paymentMethod !== undefined;
  const hasAmount = payment.amountPence !== undefined;

  if (!hasMethod && !hasAmount && payment.providerRef === undefined) {
    return null;
  }

  if (!hasMethod || !hasAmount) {
    throw new HttpError(
      400,
      "paymentMethod and amountPence are both required when payment is provided",
      "INVALID_PAYMENT",
    );
  }

  const amountPence = payment.amountPence;
  const method = payment.paymentMethod;
  if (amountPence === undefined || method === undefined) {
    throw new HttpError(
      400,
      "paymentMethod and amountPence are both required when payment is provided",
      "INVALID_PAYMENT",
    );
  }

  if (!Number.isInteger(amountPence) || amountPence <= 0) {
    throw new HttpError(400, "amountPence must be a positive integer", "INVALID_PAYMENT");
  }

  if (amountPence !== totalPence) {
    throw new HttpError(400, "Payment amount must match basket total", "PAYMENT_MISMATCH");
  }

  const providerRef = payment.providerRef;
  return providerRef === undefined
    ? {
        method,
        amountPence,
      }
    : {
        method,
        amountPence,
        providerRef,
      };
};

const validateReturnRefund = (
  refund: SaleReturnRefundInput,
  returnTotalPence: number,
): { method: PaymentMethod; amountPence: number; providerRef?: string } | null => {
  const hasMethod = refund.method !== undefined;
  const hasAmount = refund.amountPence !== undefined;

  if (!hasMethod && !hasAmount && refund.providerRef === undefined) {
    return null;
  }

  if (!hasMethod || !hasAmount) {
    throw new HttpError(
      400,
      "refund.method and refund.amountPence are both required when refund is provided",
      "INVALID_REFUND",
    );
  }

  const amountPence = refund.amountPence;
  const method = refund.method;
  if (amountPence === undefined || method === undefined) {
    throw new HttpError(
      400,
      "refund.method and refund.amountPence are both required when refund is provided",
      "INVALID_REFUND",
    );
  }

  if (!Number.isInteger(amountPence) || amountPence <= 0) {
    throw new HttpError(400, "refund.amountPence must be a positive integer", "INVALID_REFUND");
  }

  if (amountPence !== returnTotalPence) {
    throw new HttpError(
      400,
      "Refund amount must match returned items total",
      "RETURN_PAYMENT_MISMATCH",
    );
  }

  const providerRef = refund.providerRef;
  return providerRef === undefined
    ? {
        method,
        amountPence,
      }
    : {
        method,
        amountPence,
        providerRef,
      };
};

const ensureCapturedIntentExistsTx = async (
  tx: Prisma.TransactionClient,
  saleId: string,
) => {
  const capturedIntent = await tx.paymentIntent.findFirst({
    where: {
      saleId,
      status: "CAPTURED",
    },
    select: {
      id: true,
    },
  });

  if (!capturedIntent) {
    throw new HttpError(
      409,
      "Sale cannot be completed until at least one payment intent is captured",
      "SALE_NOT_ELIGIBLE_FOR_COMPLETION",
    );
  }
};

const getSaleTenderSummaryTx = async (tx: Prisma.TransactionClient, saleId: string) => {
  const sale = await tx.sale.findUnique({
    where: { id: saleId },
    select: {
      id: true,
      totalPence: true,
      completedAt: true,
      changeDuePence: true,
      tenders: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          method: true,
          amountPence: true,
          createdAt: true,
          createdByStaffId: true,
        },
      },
    },
  });

  if (!sale) {
    throw new HttpError(404, "Sale not found", "SALE_NOT_FOUND");
  }

  const tenderedPence = sale.tenders.reduce((sum, tender) => sum + tender.amountPence, 0);
  const changeDuePence = Math.max(0, tenderedPence - sale.totalPence);
  const cashTenderedPence = sale.tenders
    .filter((tender) => tender.method === "CASH")
    .reduce((sum, tender) => sum + tender.amountPence, 0);

  return {
    saleId: sale.id,
    totalPence: sale.totalPence,
    tenderedPence,
    remainingPence: Math.max(0, sale.totalPence - tenderedPence),
    changeDuePence,
    cashTenderedPence,
    isCompleted: Boolean(sale.completedAt),
    tenders: sale.tenders.map((tender) => ({
      id: tender.id,
      method: tender.method,
      amountPence: tender.amountPence,
      createdAt: tender.createdAt,
      createdByStaffId: tender.createdByStaffId,
    })),
  };
};

const hydrateSaleTendersFromLegacyPaymentSourcesTx = async (
  tx: Prisma.TransactionClient,
  saleId: string,
  staffActorId?: string,
) => {
  const existingTenderCount = await tx.saleTender.count({
    where: { saleId },
  });

  if (existingTenderCount > 0) {
    return;
  }

  const capturedIntents = await tx.paymentIntent.findMany({
    where: {
      saleId,
      status: "CAPTURED",
      amountPence: { gt: 0 },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      provider: true,
      amountPence: true,
    },
  });

  if (capturedIntents.length > 0) {
    await tx.saleTender.createMany({
      data: capturedIntents.map((intent) => ({
        saleId,
        method: toSaleTenderMethodFromProvider(intent.provider),
        amountPence: intent.amountPence,
        createdByStaffId: staffActorId ?? null,
      })),
    });
    return;
  }

  const positivePayments = await tx.payment.findMany({
    where: {
      saleId,
      amountPence: { gt: 0 },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      method: true,
      amountPence: true,
    },
  });

  if (positivePayments.length === 0) {
    return;
  }

  await tx.saleTender.createMany({
    data: positivePayments.map((payment) => ({
      saleId,
      method: toSaleTenderMethodFromPaymentMethod(payment.method),
      amountPence: payment.amountPence,
      createdByStaffId: staffActorId ?? null,
    })),
  });
};

const assertTenderRulesForCompletion = (input: {
  totalPence: number;
  tenderedPence: number;
  cashTenderedPence: number;
  requireTenders: boolean;
}) => {
  if (input.requireTenders && input.tenderedPence <= 0) {
    throw new HttpError(
      409,
      "Sale cannot be completed without at least one tender",
      "SALE_TENDER_REQUIRED",
    );
  }

  if (input.tenderedPence < input.totalPence) {
    throw new HttpError(
      409,
      "Sale cannot be completed until tendered amount covers total",
      "SALE_TENDER_INSUFFICIENT",
    );
  }

  const overTenderPence = Math.max(0, input.tenderedPence - input.totalPence);
  if (overTenderPence > 0 && input.cashTenderedPence < overTenderPence) {
    throw new HttpError(
      409,
      "Only cash tenders can exceed sale total",
      "SALE_TENDER_OVERPAY_INVALID",
    );
  }
};

export const completeSaleIfEligibleTx = async (
  tx: Prisma.TransactionClient,
  saleId: string,
  input: CompleteSaleInput = {},
) => {
  const requireCapturedIntent = input.requireCapturedIntent ?? false;
  const requireTenders = input.requireTenders ?? true;
  const staffActorId = normalizeOptionalText(input.staffActorId);

  const sale = await tx.sale.findUnique({
    where: { id: saleId },
    select: {
      id: true,
      totalPence: true,
      changeDuePence: true,
      completedAt: true,
      receiptNumber: true,
      createdByStaffId: true,
    },
  });

  if (!sale) {
    throw new HttpError(404, "Sale not found", "SALE_NOT_FOUND");
  }

  if (sale.completedAt) {
    if (!sale.createdByStaffId && staffActorId) {
      await tx.sale.update({
        where: { id: sale.id },
        data: {
          createdByStaffId: staffActorId,
        },
      });
    }
    return {
      saleId: sale.id,
      completedAt: sale.completedAt,
      changeDuePence: sale.changeDuePence,
    };
  }

  if (requireCapturedIntent) {
    await ensureCapturedIntentExistsTx(tx, sale.id);
  }

  await hydrateSaleTendersFromLegacyPaymentSourcesTx(tx, sale.id, staffActorId ?? undefined);
  const tenderSummary = await getSaleTenderSummaryTx(tx, sale.id);
  assertTenderRulesForCompletion({
    totalPence: tenderSummary.totalPence,
    tenderedPence: tenderSummary.tenderedPence,
    cashTenderedPence: tenderSummary.cashTenderedPence,
    requireTenders,
  });

  const changeDuePence = Math.max(0, tenderSummary.tenderedPence - sale.totalPence);
  const completedAt = new Date();
  const receiptNumber = sale.receiptNumber ?? toReceiptNumber(sale.id, completedAt);

  const updatedSale = await tx.sale.update({
    where: { id: sale.id },
    data: {
      completedAt,
      changeDuePence,
      receiptNumber,
      ...(sale.createdByStaffId ? {} : { createdByStaffId: staffActorId ?? null }),
    },
    select: {
      id: true,
      completedAt: true,
      changeDuePence: true,
    },
  });

  await recordCashSaleMovementForSaleTx(tx, {
    saleId: sale.id,
    cashTenderedPence: tenderSummary.cashTenderedPence,
    changeDuePence,
    ...(staffActorId ? { createdByStaffId: staffActorId } : {}),
  });

  return {
    saleId: updatedSale.id,
    completedAt,
    changeDuePence: updatedSale.changeDuePence,
    totalPence: sale.totalPence,
    didComplete: true,
  };
};

export const completeSaleIfEligible = async (
  saleId: string,
  input: CompleteSaleInput = {},
) => {
  if (!isUuid(saleId)) {
    throw new HttpError(400, "Invalid sale id", "INVALID_SALE_ID");
  }

  const result = await prisma.$transaction((tx) => completeSaleIfEligibleTx(tx, saleId, input));

  if ("didComplete" in result && result.didComplete) {
    emitSaleCompletedEvent(result);
  }

  return {
    saleId: result.saleId,
    completedAt: result.completedAt,
    changeDuePence: result.changeDuePence,
  };
};

export { emitSaleCompletedEvent };

const parseSaleTenderMethodOrThrow = (value: SaleTenderMethod | undefined): SaleTenderMethod => {
  if (
    value !== "CASH" &&
    value !== "CARD" &&
    value !== "BANK_TRANSFER" &&
    value !== "VOUCHER"
  ) {
    throw new HttpError(
      400,
      "method must be one of CASH, CARD, BANK_TRANSFER, VOUCHER",
      "INVALID_SALE_TENDER",
    );
  }
  return value;
};

export const listSaleTenders = async (saleId: string) => {
  if (!isUuid(saleId)) {
    throw new HttpError(400, "Invalid sale id", "INVALID_SALE_ID");
  }

  return prisma.$transaction(async (tx) => {
    await hydrateSaleTendersFromLegacyPaymentSourcesTx(tx, saleId);
    return getSaleTenderSummaryTx(tx, saleId);
  });
};

export const addSaleTender = async (
  saleId: string,
  input: SaleTenderInput,
  createdByStaffId?: string,
) => {
  if (!isUuid(saleId)) {
    throw new HttpError(400, "Invalid sale id", "INVALID_SALE_ID");
  }

  const method = parseSaleTenderMethodOrThrow(input.method);
  const rawAmountPence = input.amountPence;
  if (
    rawAmountPence === undefined ||
    !Number.isInteger(rawAmountPence) ||
    rawAmountPence <= 0
  ) {
    throw new HttpError(400, "amountPence must be a positive integer", "INVALID_SALE_TENDER");
  }
  const amountPence = rawAmountPence;

  const normalizedCreatedByStaffId = normalizeOptionalText(createdByStaffId);

  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findUnique({
      where: { id: saleId },
      select: {
        id: true,
        completedAt: true,
      },
    });

    if (!sale) {
      throw new HttpError(404, "Sale not found", "SALE_NOT_FOUND");
    }
    if (sale.completedAt) {
      throw new HttpError(409, "Cannot modify tenders for a completed sale", "SALE_COMPLETED");
    }

    const tender = await tx.saleTender.create({
      data: {
        saleId,
        method,
        amountPence,
        createdByStaffId: normalizedCreatedByStaffId ?? null,
      },
      select: {
        id: true,
        saleId: true,
        method: true,
        amountPence: true,
        createdAt: true,
        createdByStaffId: true,
      },
    });

    const summary = await getSaleTenderSummaryTx(tx, saleId);
    return { tender, summary };
  });
};

export const deleteSaleTender = async (saleId: string, tenderId: string) => {
  if (!isUuid(saleId)) {
    throw new HttpError(400, "Invalid sale id", "INVALID_SALE_ID");
  }
  if (!isUuid(tenderId)) {
    throw new HttpError(400, "Invalid tender id", "INVALID_TENDER_ID");
  }

  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findUnique({
      where: { id: saleId },
      select: {
        id: true,
        completedAt: true,
      },
    });

    if (!sale) {
      throw new HttpError(404, "Sale not found", "SALE_NOT_FOUND");
    }
    if (sale.completedAt) {
      throw new HttpError(409, "Cannot modify tenders for a completed sale", "SALE_COMPLETED");
    }

    const tender = await tx.saleTender.findUnique({
      where: { id: tenderId },
      select: {
        id: true,
        saleId: true,
      },
    });
    if (!tender || tender.saleId !== saleId) {
      throw new HttpError(404, "Tender not found", "SALE_TENDER_NOT_FOUND");
    }

    await tx.saleTender.delete({
      where: { id: tenderId },
    });

    return getSaleTenderSummaryTx(tx, saleId);
  });
};

export const checkoutBasketToSale = async (
  basketId: string,
  paymentInput: CheckoutPaymentInput,
  createdByStaffId?: string,
) => {
  if (!isUuid(basketId)) {
    throw new HttpError(400, "Invalid basket id", "INVALID_BASKET_ID");
  }
  const normalizedCreatedByStaffId = normalizeOptionalText(createdByStaffId);

  const txResult = await prisma.$transaction(async (tx) => {
    const existingSale = await tx.sale.findUnique({ where: { basketId } });
    if (existingSale) {
      const workshopJob = await getWorkshopJobForBasketTx(tx, basketId);
      let emittedWorkshopCompletion = false;
      let workshopCompletedAt: Date | null = null;

      if (workshopJob) {
        if (!existingSale.workshopJobId) {
          await tx.sale.update({
            where: { id: existingSale.id },
            data: {
              workshopJobId: workshopJob.id,
              ...(existingSale.customerId ? {} : { customerId: workshopJob.customerId }),
            },
          });
        }

        if (workshopJob.status !== "COMPLETED" && workshopJob.status !== "CANCELLED") {
          workshopCompletedAt = workshopJob.completedAt ?? new Date();
          await tx.workshopJob.update({
            where: { id: workshopJob.id },
            data: {
              status: "COMPLETED",
              completedAt: workshopCompletedAt,
            },
          });
          emittedWorkshopCompletion = true;
        }
      }

      return {
        saleId: existingSale.id,
        created: false,
        emittedWorkshopCompletion,
        workshopJobId: workshopJob?.id ?? null,
        workshopCompletedAt,
      };
    }

    const basket = await tx.basket.findUnique({
      where: { id: basketId },
      include: {
        items: true,
      },
    });

    if (!basket) {
      throw new HttpError(404, "Basket not found", "BASKET_NOT_FOUND");
    }

    if (basket.status !== BasketStatus.OPEN) {
      throw new HttpError(409, "Basket is not open", "BASKET_NOT_OPEN");
    }

    if (basket.items.length === 0) {
      throw new HttpError(400, "Cannot checkout an empty basket", "EMPTY_BASKET");
    }

    const workshopJob = await getWorkshopJobForBasketTx(tx, basket.id);
    if (workshopJob) {
      const existingWorkshopSale = await tx.sale.findUnique({
        where: { workshopJobId: workshopJob.id },
      });

      if (existingWorkshopSale) {
        await tx.basket.update({
          where: { id: basket.id },
          data: { status: BasketStatus.CHECKED_OUT },
        });

        let workshopCompletedAt = workshopJob.completedAt;
        let emittedWorkshopCompletion = false;
        if (workshopJob.status !== "COMPLETED" && workshopJob.status !== "CANCELLED") {
          workshopCompletedAt = workshopJob.completedAt ?? new Date();
          await tx.workshopJob.update({
            where: { id: workshopJob.id },
            data: {
              status: "COMPLETED",
              completedAt: workshopCompletedAt,
            },
          });
          emittedWorkshopCompletion = true;
        }

        return {
          saleId: existingWorkshopSale.id,
          created: false,
          emittedWorkshopCompletion,
          workshopJobId: workshopJob.id,
          workshopCompletedAt,
        };
      }
    }

    const subtotalPence = basket.items.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0,
    );
    const taxPence = 0;
    const totalPence = subtotalPence + taxPence;

    const payment = validateCheckoutPayment(paymentInput, totalPence);

    const sale = await tx.sale.create({
      data: {
        basketId: basket.id,
        ...(workshopJob
          ? {
              workshopJobId: workshopJob.id,
              customerId: workshopJob.customerId,
            }
          : {}),
        subtotalPence,
        taxPence,
        totalPence,
        ...(normalizedCreatedByStaffId ? { createdByStaffId: normalizedCreatedByStaffId } : {}),
      },
    });

    const defaultLocation = await getOrCreateDefaultStockLocationTx(tx);

    for (const item of basket.items) {
      const saleItem = await tx.saleItem.create({
        data: {
          saleId: sale.id,
          variantId: item.variantId,
          quantity: item.quantity,
          unitPricePence: item.unitPrice,
          lineTotalPence: item.quantity * item.unitPrice,
        },
      });

      await tx.stockLedgerEntry.create({
        data: {
          variantId: item.variantId,
          locationId: defaultLocation.id,
          type: "SALE",
          quantityDelta: -item.quantity,
          referenceType: "SALE_ITEM",
          referenceId: saleItem.id,
        },
      });

      await tx.inventoryMovement.create({
        data: {
          variantId: item.variantId,
          locationId: defaultLocation.id,
          type: "SALE",
          quantity: -item.quantity,
          referenceType: "SALE_ITEM",
          referenceId: saleItem.id,
        },
      });
    }

    if (payment) {
      const createdPayment = await tx.payment.create({
        data: {
          saleId: sale.id,
          method: payment.method,
          amountPence: payment.amountPence,
          ...(payment.providerRef !== undefined ? { providerRef: payment.providerRef } : {}),
        },
      });

      await recordCashSaleMovementForPaymentTx(tx, {
        paymentId: createdPayment.id,
        paymentMethod: createdPayment.method,
        amountPence: createdPayment.amountPence,
        saleId: sale.id,
        ...(normalizedCreatedByStaffId
          ? { createdByStaffId: normalizedCreatedByStaffId }
          : {}),
      });
    }

    await tx.basket.update({
      where: { id: basket.id },
      data: { status: BasketStatus.CHECKED_OUT },
    });

    let workshopCompletedAt: Date | null = null;
    let emittedWorkshopCompletion = false;

    if (workshopJob && workshopJob.status !== "COMPLETED" && workshopJob.status !== "CANCELLED") {
      workshopCompletedAt = workshopJob.completedAt ?? new Date();
      await tx.workshopJob.update({
        where: { id: workshopJob.id },
        data: {
          status: "COMPLETED",
          completedAt: workshopCompletedAt,
        },
      });
      emittedWorkshopCompletion = true;
    }

    return {
      saleId: sale.id,
      created: true,
      emittedWorkshopCompletion,
      workshopJobId: workshopJob?.id ?? null,
      workshopCompletedAt,
    };
  });

  const response = await toSaleResponse(txResult.saleId);
  if (txResult.emittedWorkshopCompletion && txResult.workshopJobId && txResult.workshopCompletedAt) {
    emit("workshop.job.completed", {
      id: txResult.workshopJobId,
      type: "workshop.job.completed",
      timestamp: new Date().toISOString(),
      workshopJobId: txResult.workshopJobId,
      status: "COMPLETED",
      completedAt: txResult.workshopCompletedAt.toISOString(),
    });
  }

  return {
    ...response,
    idempotent: !txResult.created,
  };
};

export const createSaleReturn = async (
  saleId: string,
  items: SaleReturnItemInput[],
  refundInput: SaleReturnRefundInput,
) => {
  if (!isUuid(saleId)) {
    throw new HttpError(400, "Invalid sale id", "INVALID_SALE_ID");
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, "items must be a non-empty array", "INVALID_RETURN_ITEMS");
  }

  const seenSaleItems = new Set<string>();
  for (const item of items) {
    if (!isUuid(item.saleItemId)) {
      throw new HttpError(400, "Invalid saleItemId", "INVALID_SALE_ITEM_ID");
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new HttpError(400, "quantity must be a positive integer", "INVALID_RETURN_QUANTITY");
    }
    if (seenSaleItems.has(item.saleItemId)) {
      throw new HttpError(
        400,
        "saleItemId must be unique within a return request",
        "DUPLICATE_RETURN_ITEM",
      );
    }
    seenSaleItems.add(item.saleItemId);
  }

  const txResult = await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findUnique({
      where: { id: saleId },
      include: {
        items: true,
      },
    });

    if (!sale) {
      throw new HttpError(404, "Sale not found", "SALE_NOT_FOUND");
    }

    const requestedSaleItemIds = items.map((item) => item.saleItemId);
    const saleItemById = new Map(sale.items.map((item) => [item.id, item]));

    for (const saleItemId of requestedSaleItemIds) {
      if (!saleItemById.has(saleItemId)) {
        throw new HttpError(
          400,
          "Each saleItemId must belong to the specified sale",
          "INVALID_RETURN_ITEM",
        );
      }
    }

    const returnedQtyBySaleItem = new Map<string, number>();
    const returnedAggregates = await tx.saleReturnItem.groupBy({
      by: ["saleItemId"],
      where: {
        saleItemId: {
          in: requestedSaleItemIds,
        },
      },
      _sum: {
        quantity: true,
      },
    });

    for (const entry of returnedAggregates) {
      returnedQtyBySaleItem.set(entry.saleItemId, entry._sum.quantity ?? 0);
    }

    const computedItems = items.map((item) => {
      const saleItem = saleItemById.get(item.saleItemId)!;
      const alreadyReturned = returnedQtyBySaleItem.get(item.saleItemId) ?? 0;
      const maxReturnable = saleItem.quantity - alreadyReturned;

      if (item.quantity > maxReturnable) {
        throw new HttpError(
          409,
          "Return quantity exceeds remaining returnable quantity",
          "RETURN_QUANTITY_EXCEEDED",
        );
      }

      return {
        saleItemId: item.saleItemId,
        variantId: saleItem.variantId,
        quantity: item.quantity,
        unitPricePence: saleItem.unitPricePence,
        lineTotalPence: item.quantity * saleItem.unitPricePence,
      };
    });

    const returnTotalPence = computedItems.reduce(
      (sum, item) => sum + item.lineTotalPence,
      0,
    );

    const refund = validateReturnRefund(refundInput, returnTotalPence);

    const saleReturn = await tx.saleReturn.create({
      data: {
        saleId,
      },
    });

    const createdReturnItems: Array<{
      id: string;
      returnId: string;
      saleItemId: string;
      quantity: number;
      unitPricePence: number;
      lineTotalPence: number;
      createdAt: Date;
    }> = [];
    const defaultLocation = await getOrCreateDefaultStockLocationTx(tx);

    for (const item of computedItems) {
      const returnItem = await tx.saleReturnItem.create({
        data: {
          returnId: saleReturn.id,
          saleItemId: item.saleItemId,
          quantity: item.quantity,
          unitPricePence: item.unitPricePence,
          lineTotalPence: item.lineTotalPence,
        },
      });
      createdReturnItems.push(returnItem);

      await tx.stockLedgerEntry.create({
        data: {
          variantId: item.variantId,
          locationId: defaultLocation.id,
          type: "RETURN",
          quantityDelta: item.quantity,
          referenceType: "SALE_RETURN_ITEM",
          referenceId: returnItem.id,
        },
      });

      await tx.inventoryMovement.create({
        data: {
          variantId: item.variantId,
          locationId: defaultLocation.id,
          type: "RETURN",
          quantity: item.quantity,
          referenceType: "SALE_RETURN_ITEM",
          referenceId: returnItem.id,
        },
      });
    }

    let refundPayment: {
      id: string;
      saleId: string | null;
      method: PaymentMethod;
      amountPence: number;
      providerRef: string | null;
      createdAt: Date;
    } | null = null;

    if (refund) {
      refundPayment = await tx.payment.create({
        data: {
          saleId,
          method: refund.method,
          amountPence: -refund.amountPence,
          ...(refund.providerRef !== undefined ? { providerRef: refund.providerRef } : {}),
        },
      });

      await recordCashRefundMovementForPaymentTx(tx, {
        paymentId: refundPayment.id,
        paymentMethod: refundPayment.method,
        amountPence: refundPayment.amountPence,
        saleId: refundPayment.saleId,
        ref: `SALE_RETURN_REFUND:${refundPayment.id}`,
      });
    }

    return {
      saleReturn,
      returnItems: createdReturnItems,
      refundPayment,
      returnTotalPence,
    };
  });

  return {
    return: {
      id: txResult.saleReturn.id,
      saleId: txResult.saleReturn.saleId,
      createdAt: txResult.saleReturn.createdAt,
      totalPence: txResult.returnTotalPence,
    },
    returnItems: txResult.returnItems.map((item) => ({
      id: item.id,
      returnId: item.returnId,
      saleItemId: item.saleItemId,
      quantity: item.quantity,
      unitPricePence: item.unitPricePence,
      lineTotalPence: item.lineTotalPence,
      createdAt: item.createdAt,
    })),
    refundPayment: txResult.refundPayment
      ? {
          id: txResult.refundPayment.id,
          saleId: txResult.refundPayment.saleId ?? saleId,
          method: txResult.refundPayment.method,
          amountPence: txResult.refundPayment.amountPence,
          providerRef: txResult.refundPayment.providerRef,
          createdAt: txResult.refundPayment.createdAt,
        }
      : null,
  };
};

export const getSaleById = async (saleId: string) => {
  if (!isUuid(saleId)) {
    throw new HttpError(400, "Invalid sale id", "INVALID_SALE_ID");
  }

  return toSaleResponse(saleId);
};

export const attachCustomerToSale = async (
  saleId: string,
  customerId: string | null,
) => {
  if (!isUuid(saleId)) {
    throw new HttpError(400, "Invalid sale id", "INVALID_SALE_ID");
  }

  if (customerId !== null && !isUuid(customerId)) {
    throw new HttpError(400, "Invalid customer id", "INVALID_CUSTOMER_ID");
  }

  await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findUnique({ where: { id: saleId } });
    if (!sale) {
      throw new HttpError(404, "Sale not found", "SALE_NOT_FOUND");
    }

    if (customerId !== null) {
      const customer = await tx.customer.findUnique({
        where: { id: customerId },
      });
      if (!customer) {
        throw new HttpError(404, "Customer not found", "CUSTOMER_NOT_FOUND");
      }
    }

    await tx.sale.update({
      where: { id: saleId },
      data: { customerId },
    });
  });

  return toSaleResponse(saleId);
};

export const listSales = async ({ from, to }: DateRangeInput) => {
  const createdAt: Prisma.DateTimeFilter = {};

  if (from) {
    createdAt.gte = toDateOrThrow(from, "from");
  }

  if (to) {
    const toDate = toDateOrThrow(to, "to");
    toDate.setUTCDate(toDate.getUTCDate() + 1);
    createdAt.lt = toDate;
  }

  const where: Prisma.SaleWhereInput = {};
  if (Object.keys(createdAt).length > 0) {
    where.createdAt = createdAt;
  }

  const sales = await prisma.sale.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      payments: {
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });

  return {
    sales: sales.map((sale) => ({
      id: sale.id,
      basketId: sale.basketId,
      subtotalPence: sale.subtotalPence,
      taxPence: sale.taxPence,
      totalPence: sale.totalPence,
      createdAt: sale.createdAt,
      payment: sale.payments[0]
        ? {
            method: sale.payments[0].method,
            amountPence: sale.payments[0].amountPence,
          }
        : null,
    })),
  };
};
