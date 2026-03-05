import { PaymentIntentStatus, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { CashProvider } from "../payments/providers/cashProvider";
import { completeSaleIfEligibleTx } from "./salesService";
import { recordCashSaleMovementForPaymentTx } from "./tillService";

type PaymentIntentProvider = "CASH" | "CARD";

type CreatePaymentIntentInput = {
  saleId?: string;
  amountPence?: number;
  provider?: string;
  externalRef?: string;
};

type ListPaymentIntentFilters = {
  status?: string;
  provider?: string;
  from?: string;
  to?: string;
};

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const normalizeOptionalText = (value: string | undefined | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseProviderOrThrow = (value: string | undefined): PaymentIntentProvider => {
  const normalized = normalizeOptionalText(value)?.toUpperCase();
  if (!normalized) {
    return "CASH";
  }
  if (normalized !== "CASH" && normalized !== "CARD") {
    throw new HttpError(400, "provider must be CASH or CARD", "INVALID_PAYMENT_INTENT");
  }
  return normalized;
};

const parseStatusOrThrow = (value: string | undefined): PaymentIntentStatus | undefined => {
  const normalized = normalizeOptionalText(value)?.toUpperCase();
  if (!normalized) {
    return undefined;
  }

  if (
    normalized !== "REQUIRES_ACTION" &&
    normalized !== "AUTHORIZED" &&
    normalized !== "CAPTURED" &&
    normalized !== "FAILED" &&
    normalized !== "CANCELED"
  ) {
    throw new HttpError(
      400,
      "status must be REQUIRES_ACTION, AUTHORIZED, CAPTURED, FAILED, or CANCELED",
      "INVALID_PAYMENT_INTENT_FILTER",
    );
  }

  return normalized as PaymentIntentStatus;
};

const parseFromDate = (value: string): Date => {
  if (DATE_ONLY_REGEX.test(value)) {
    return new Date(`${value}T00:00:00.000Z`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, "from must be a valid date", "INVALID_PAYMENT_INTENT_FILTER");
  }
  return parsed;
};

const parseToDate = (value: string): Date => {
  if (DATE_ONLY_REGEX.test(value)) {
    return new Date(`${value}T23:59:59.999Z`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, "to must be a valid date", "INVALID_PAYMENT_INTENT_FILTER");
  }
  return parsed;
};

const toIntentResponse = (intent: {
  id: string;
  provider: string;
  status: PaymentIntentStatus;
  amountPence: number;
  saleId: string;
  externalRef: string | null;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: intent.id,
  provider: intent.provider,
  status: intent.status,
  amountPence: intent.amountPence,
  saleId: intent.saleId,
  externalRef: intent.externalRef,
  createdAt: intent.createdAt,
  updatedAt: intent.updatedAt,
});

const getCapturedIntentTotalForSaleTx = async (
  tx: Prisma.TransactionClient,
  saleId: string,
): Promise<number> => {
  const aggregate = await tx.paymentIntent.aggregate({
    where: {
      saleId,
      status: "CAPTURED",
    },
    _sum: {
      amountPence: true,
    },
  });

  return aggregate._sum.amountPence ?? 0;
};

const ensureSaleExistsTx = async (tx: Prisma.TransactionClient, saleId: string) => {
  const sale = await tx.sale.findUnique({
    where: { id: saleId },
    select: {
      id: true,
      totalPence: true,
    },
  });

  if (!sale) {
    throw new HttpError(404, "Sale not found", "SALE_NOT_FOUND");
  }

  return sale;
};

const upsertSalePaymentForIntentTx = async (
  tx: Prisma.TransactionClient,
  input: {
    intentId: string;
    saleId: string;
    provider: PaymentIntentProvider;
    amountPence: number;
    createdByStaffId?: string;
  },
) => {
  const providerRef = `intent:${input.intentId}`;
  const existing = await tx.payment.findFirst({
    where: {
      saleId: input.saleId,
      providerRef,
    },
    select: {
      id: true,
    },
  });

  if (existing) {
    return;
  }

  const payment = await tx.payment.create({
    data: {
      saleId: input.saleId,
      method: input.provider === "CASH" ? "CASH" : "CARD",
      purpose: "FINAL",
      status: "COMPLETED",
      amountPence: input.amountPence,
      providerRef,
    },
  });

  await recordCashSaleMovementForPaymentTx(tx, {
    paymentId: payment.id,
    paymentMethod: payment.method,
    amountPence: payment.amountPence,
    ...(input.createdByStaffId ? { createdByStaffId: input.createdByStaffId } : {}),
  });
};

const getSalePaymentSummaryTx = async (tx: Prisma.TransactionClient, saleId: string) => {
  const sale = await ensureSaleExistsTx(tx, saleId);
  const capturedTotal = await getCapturedIntentTotalForSaleTx(tx, saleId);
  const outstandingPence = Math.max(0, sale.totalPence - capturedTotal);

  return {
    saleId,
    saleTotalPence: sale.totalPence,
    capturedTotalPence: capturedTotal,
    outstandingPence,
    paid: outstandingPence === 0,
  };
};

const toCompleteSaleInput = (staffActorId?: string) =>
  staffActorId ? { staffActorId } : {};

export const createPaymentIntent = async (
  input: CreatePaymentIntentInput,
  staffActorId?: string,
) => {
  const saleId = normalizeOptionalText(input.saleId);
  if (!saleId || !isUuid(saleId)) {
    throw new HttpError(400, "saleId must be a valid UUID", "INVALID_PAYMENT_INTENT");
  }
  if (!Number.isInteger(input.amountPence) || (input.amountPence ?? 0) <= 0) {
    throw new HttpError(400, "amountPence must be a positive integer", "INVALID_PAYMENT_INTENT");
  }
  const amountPence = input.amountPence;
  if (amountPence === undefined) {
    throw new HttpError(400, "amountPence must be a positive integer", "INVALID_PAYMENT_INTENT");
  }

  const provider = parseProviderOrThrow(input.provider);
  const cashProvider = new CashProvider();

  return prisma.$transaction(async (tx) => {
    const sale = await ensureSaleExistsTx(tx, saleId);
    const capturedTotal = await getCapturedIntentTotalForSaleTx(tx, saleId);
    const outstandingPence = Math.max(0, sale.totalPence - capturedTotal);
    if (outstandingPence <= 0) {
      throw new HttpError(409, "Sale is already fully paid", "SALE_ALREADY_PAID");
    }
    if (amountPence > outstandingPence) {
      throw new HttpError(
        400,
        "amountPence cannot exceed remaining outstanding amount",
        "PAYMENT_INTENT_AMOUNT_EXCEEDS_OUTSTANDING",
      );
    }

    const externalRefInput = normalizeOptionalText(input.externalRef) ?? null;
    let status: PaymentIntentStatus = "REQUIRES_ACTION";
    let externalRef = externalRefInput;

    if (provider === "CASH") {
      const providerResult = await cashProvider.createPaymentIntent(saleId, amountPence);
      status = providerResult.status;
      externalRef = providerResult.externalRef ?? externalRefInput;
    } else {
      status = "REQUIRES_ACTION";
    }

    const intent = await tx.paymentIntent.create({
      data: {
        provider,
        status,
        amountPence,
        saleId,
        externalRef,
      },
    });

    if (intent.status === "CAPTURED") {
      await upsertSalePaymentForIntentTx(tx, {
        intentId: intent.id,
        saleId: intent.saleId,
        provider,
        amountPence: intent.amountPence,
        ...(staffActorId ? { createdByStaffId: staffActorId } : {}),
      });

      await completeSaleIfEligibleTx(tx, intent.saleId, toCompleteSaleInput(staffActorId));
    }

    const salePayment = await getSalePaymentSummaryTx(tx, saleId);

    return {
      intent: toIntentResponse(intent),
      salePayment,
      idempotent: false,
    };
  });
};

export const capturePaymentIntentById = async (
  intentId: string,
  staffActorId?: string,
) => {
  if (!isUuid(intentId)) {
    throw new HttpError(400, "Invalid payment intent id", "INVALID_PAYMENT_INTENT_ID");
  }

  const cashProvider = new CashProvider();

  return prisma.$transaction(async (tx) => {
    const intent = await tx.paymentIntent.findUnique({
      where: { id: intentId },
    });

    if (!intent) {
      throw new HttpError(404, "Payment intent not found", "PAYMENT_INTENT_NOT_FOUND");
    }

    if (intent.status === "CANCELED") {
      throw new HttpError(409, "Cannot capture a canceled intent", "INVALID_PAYMENT_INTENT_STATE");
    }
    if (intent.status === "FAILED") {
      throw new HttpError(409, "Cannot capture a failed intent", "INVALID_PAYMENT_INTENT_STATE");
    }

    if (intent.status === "CAPTURED") {
      await upsertSalePaymentForIntentTx(tx, {
        intentId: intent.id,
        saleId: intent.saleId,
        provider: intent.provider === "CASH" ? "CASH" : "CARD",
        amountPence: intent.amountPence,
        ...(staffActorId ? { createdByStaffId: staffActorId } : {}),
      });

      await completeSaleIfEligibleTx(tx, intent.saleId, toCompleteSaleInput(staffActorId));

      const salePayment = await getSalePaymentSummaryTx(tx, intent.saleId);
      return {
        intent: toIntentResponse(intent),
        salePayment,
        idempotent: true,
      };
    }

    const sale = await ensureSaleExistsTx(tx, intent.saleId);
    const capturedTotal = await getCapturedIntentTotalForSaleTx(tx, intent.saleId);
    const remaining = Math.max(0, sale.totalPence - capturedTotal);
    if (intent.amountPence > remaining) {
      throw new HttpError(
        409,
        "Capturing this intent would exceed sale total",
        "PAYMENT_INTENT_CAPTURE_EXCEEDS_TOTAL",
      );
    }

    const providerResult =
      intent.provider === "CASH"
        ? await cashProvider.capturePayment(intent.id)
        : { status: "CAPTURED" as const, externalRef: intent.externalRef ?? undefined };

    const updated = await tx.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status: providerResult.status,
        externalRef: providerResult.externalRef ?? intent.externalRef,
      },
    });

    if (updated.status === "CAPTURED") {
      await upsertSalePaymentForIntentTx(tx, {
        intentId: updated.id,
        saleId: updated.saleId,
        provider: updated.provider === "CASH" ? "CASH" : "CARD",
        amountPence: updated.amountPence,
        ...(staffActorId ? { createdByStaffId: staffActorId } : {}),
      });

      await completeSaleIfEligibleTx(tx, updated.saleId, toCompleteSaleInput(staffActorId));
    }

    const salePayment = await getSalePaymentSummaryTx(tx, updated.saleId);
    return {
      intent: toIntentResponse(updated),
      salePayment,
      idempotent: false,
    };
  });
};

export const cancelPaymentIntentById = async (intentId: string) => {
  if (!isUuid(intentId)) {
    throw new HttpError(400, "Invalid payment intent id", "INVALID_PAYMENT_INTENT_ID");
  }

  const cashProvider = new CashProvider();

  return prisma.$transaction(async (tx) => {
    const intent = await tx.paymentIntent.findUnique({
      where: { id: intentId },
    });

    if (!intent) {
      throw new HttpError(404, "Payment intent not found", "PAYMENT_INTENT_NOT_FOUND");
    }

    if (intent.status === "CAPTURED") {
      throw new HttpError(
        409,
        "Captured intents cannot be canceled",
        "INVALID_PAYMENT_INTENT_STATE",
      );
    }

    if (intent.status === "CANCELED") {
      const salePayment = await getSalePaymentSummaryTx(tx, intent.saleId);
      return {
        intent: toIntentResponse(intent),
        salePayment,
        idempotent: true,
      };
    }

    if (intent.provider === "CASH") {
      await cashProvider.cancelPayment(intent.id);
    }

    const canceled = await tx.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status: "CANCELED",
      },
    });

    const salePayment = await getSalePaymentSummaryTx(tx, canceled.saleId);
    return {
      intent: toIntentResponse(canceled),
      salePayment,
      idempotent: false,
    };
  });
};

export const listPaymentIntents = async (filters: ListPaymentIntentFilters = {}) => {
  const status = parseStatusOrThrow(filters.status);
  const provider = normalizeOptionalText(filters.provider)?.toUpperCase();
  if (provider !== undefined && provider !== "CASH" && provider !== "CARD") {
    throw new HttpError(400, "provider must be CASH or CARD", "INVALID_PAYMENT_INTENT_FILTER");
  }

  const from = filters.from ? parseFromDate(filters.from) : undefined;
  const to = filters.to ? parseToDate(filters.to) : undefined;
  if (from && to && from > to) {
    throw new HttpError(400, "from must be before or equal to to", "INVALID_PAYMENT_INTENT_FILTER");
  }

  const intents = await prisma.paymentIntent.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(provider ? { provider } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  return {
    intents: intents.map((intent) => toIntentResponse(intent)),
  };
};

export const getPaymentsReportRows = async (filters: ListPaymentIntentFilters = {}) => {
  const listed = await listPaymentIntents(filters);
  return listed.intents.map((intent) => ({
    intentId: intent.id,
    provider: intent.provider,
    status: intent.status,
    amount: intent.amountPence,
    saleId: intent.saleId,
    timestamp: intent.createdAt.toISOString(),
  }));
};
