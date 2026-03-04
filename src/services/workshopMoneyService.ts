import {
  CancellationOutcome,
  PaymentMethod,
  PaymentPurpose,
  PaymentStatus,
  Prisma,
  RefundStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { createAuditEventTx, type AuditActor } from "./auditService";

type SerializableTx = Prisma.TransactionClient;

type CancelWorkshopInput = {
  outcome?: CancellationOutcome;
  notes?: string;
  refundReason?: string;
  idempotencyKey?: string;
};

type RefundPaymentInput = {
  amountPence?: number;
  reason?: string;
  status?: RefundStatus;
  processorRefundId?: string;
  idempotencyKey?: string;
};

type CreditIdentityInput = {
  customerId?: string | null;
  email?: string | null;
  phone?: string | null;
};

type IssueCreditInput = CreditIdentityInput & {
  amountPence?: number;
  notes?: string;
  sourceRef?: string;
  idempotencyKey?: string;
};

type ApplyCreditInput = CreditIdentityInput & {
  saleId?: string;
  workshopJobId?: string;
  amountPence?: number;
  notes?: string;
  idempotencyKey?: string;
};

const SERIALIZABLE_RETRY_LIMIT = 3;

const normalizeText = (value: string | null | undefined): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const optionalLowercase = (value: string | null | undefined): string | undefined => {
  const normalized = normalizeText(value);
  return normalized ? normalized.toLowerCase() : undefined;
};

const toPositiveIntOrThrow = (value: number | undefined, field: string) => {
  if (!Number.isInteger(value) || (value ?? 0) <= 0) {
    throw new HttpError(400, `${field} must be a positive integer`, "INVALID_AMOUNT");
  }
  return value;
};

const toUuidOrThrow = (value: string | undefined, field: string, code: string) => {
  if (!value || !isUuid(value)) {
    throw new HttpError(400, `Invalid ${field}`, code);
  }
  return value;
};

const isRetryableSerializableError = (error: unknown) => {
  const prismaError = error as { code?: string };
  return prismaError?.code === "P2034";
};

const withSerializableTransaction = async <T>(
  fn: (tx: SerializableTx) => Promise<T>,
): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 0; attempt < SERIALIZABLE_RETRY_LIMIT; attempt++) {
    try {
      return await prisma.$transaction((tx) => fn(tx), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      lastError = error;
      if (!isRetryableSerializableError(error) || attempt === SERIALIZABLE_RETRY_LIMIT - 1) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("Transaction failed");
};

const getCreditAccountBalanceTx = async (tx: SerializableTx, creditAccountId: string) => {
  const aggregate = await tx.creditLedgerEntry.aggregate({
    where: { creditAccountId },
    _sum: { amountPence: true },
  });
  return aggregate._sum.amountPence ?? 0;
};

const findCreditAccountTx = async (
  tx: SerializableTx,
  identity: CreditIdentityInput,
) => {
  if (identity.customerId) {
    return tx.creditAccount.findUnique({
      where: { customerId: identity.customerId },
    });
  }

  const email = optionalLowercase(identity.email);
  const phone = normalizeText(identity.phone);

  if (email && phone) {
    return tx.creditAccount.findUnique({
      where: {
        email_phone: {
          email,
          phone,
        },
      },
    });
  }

  if (email) {
    return tx.creditAccount.findFirst({
      where: { email },
      orderBy: { createdAt: "asc" },
    });
  }

  if (phone) {
    return tx.creditAccount.findFirst({
      where: { phone },
      orderBy: { createdAt: "asc" },
    });
  }

  return null;
};

const getOrCreateCreditAccountTx = async (
  tx: SerializableTx,
  identity: CreditIdentityInput,
) => {
  if (identity.customerId && !isUuid(identity.customerId)) {
    throw new HttpError(400, "Invalid customerId", "INVALID_CUSTOMER_ID");
  }

  const email = optionalLowercase(identity.email);
  const phone = normalizeText(identity.phone);
  const customerId = identity.customerId ?? undefined;

  if (customerId) {
    const existingByCustomer = await tx.creditAccount.findUnique({
      where: { customerId },
    });
    if (existingByCustomer) {
      return existingByCustomer;
    }
  }

  const existingByContact = await findCreditAccountTx(tx, {
    email,
    phone,
  });
  if (existingByContact) {
    if (customerId && !existingByContact.customerId) {
      return tx.creditAccount.update({
        where: { id: existingByContact.id },
        data: { customerId },
      });
    }
    return existingByContact;
  }

  if (!customerId && !email && !phone) {
    throw new HttpError(
      409,
      "Cannot create credit account without customer or contact details",
      "CREDIT_ACCOUNT_UNRESOLVED",
    );
  }

  try {
    return await tx.creditAccount.create({
      data: {
        customerId,
        email,
        phone,
      },
    });
  } catch (error) {
    const prismaError = error as { code?: string };
    if (prismaError.code === "P2002") {
      if (customerId) {
        const retriedByCustomer = await tx.creditAccount.findUnique({
          where: { customerId },
        });
        if (retriedByCustomer) {
          return retriedByCustomer;
        }
      }

      const retriedByContact = await findCreditAccountTx(tx, { email, phone });
      if (retriedByContact) {
        if (customerId && !retriedByContact.customerId) {
          return tx.creditAccount.update({
            where: { id: retriedByContact.id },
            data: { customerId },
          });
        }
        return retriedByContact;
      }
    }
    throw error;
  }
};

const getPaymentWithRefundsOrThrow = async (tx: SerializableTx, paymentId: string) => {
  const payment = await tx.payment.findUnique({
    where: { id: paymentId },
    include: {
      refunds: true,
    },
  });

  if (!payment) {
    throw new HttpError(404, "Payment not found", "PAYMENT_NOT_FOUND");
  }

  return payment;
};

const createRefundTx = async (
  tx: SerializableTx,
  paymentId: string,
  input: {
    amountPence: number;
    reason: string;
    status?: RefundStatus;
    processorRefundId?: string;
    idempotencyKey?: string;
  },
  auditActor?: AuditActor,
) => {
  if (input.idempotencyKey) {
    const existing = await tx.paymentRefund.findUnique({
      where: {
        paymentId_idempotencyKey: {
          paymentId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      include: {
        payment: true,
      },
    });

    if (existing) {
      return {
        refund: existing,
        payment: existing.payment,
        idempotent: true,
      };
    }
  }

  const payment = await getPaymentWithRefundsOrThrow(tx, paymentId);
  const alreadyRefunded = payment.refunds
    .filter((refund) => refund.status !== "PROCESSOR_FAILED")
    .reduce((sum, refund) => sum + refund.amountPence, 0);
  const refundablePence = payment.amountPence - alreadyRefunded;

  if (input.amountPence > refundablePence) {
    throw new HttpError(
      409,
      "Refund amount exceeds refundable balance",
      "REFUND_EXCEEDS_PAYMENT",
    );
  }

  const refund = await tx.paymentRefund.create({
    data: {
      paymentId,
      amountPence: input.amountPence,
      reason: input.reason,
      status: input.status ?? "RECORDED",
      processorRefundId: input.processorRefundId,
      idempotencyKey: input.idempotencyKey,
    },
  });

  const newRefundedTotalPence = alreadyRefunded + input.amountPence;
  const newStatus: PaymentStatus =
    newRefundedTotalPence >= payment.amountPence ? "REFUNDED" : "PARTIALLY_REFUNDED";

  const updatedPayment = await tx.payment.update({
    where: { id: payment.id },
    data: {
      refundedTotalPence: newRefundedTotalPence,
      status: newStatus,
    },
  });

  await createAuditEventTx(
    tx,
    {
      action: "PAYMENT_REFUNDED",
      entityType: "PAYMENT",
      entityId: payment.id,
      metadata: {
        refundId: refund.id,
        refundAmountPence: refund.amountPence,
        reason: refund.reason,
        status: refund.status,
        refundedTotalPence: updatedPayment.refundedTotalPence,
      },
    },
    auditActor,
  );

  return {
    refund,
    payment: updatedPayment,
    idempotent: false,
  };
};

const getDepositPaymentForJobTx = async (tx: SerializableTx, workshopJobId: string) => {
  return tx.payment.findFirst({
    where: {
      workshopJobId,
      purpose: "DEPOSIT",
      amountPence: { gt: 0 },
    },
    orderBy: { createdAt: "asc" },
    include: {
      refunds: true,
    },
  });
};

const getCancellationResponseFromRecordTx = async (
  tx: SerializableTx,
  workshopCancellation: {
    id: string;
    workshopJobId: string;
    outcome: CancellationOutcome;
    notes: string | null;
    cancelledAt: Date;
    paymentRefundId: string | null;
    creditAccountId: string | null;
    creditLedgerEntryId: string | null;
  },
  idempotent: boolean,
) => {
  const paymentRefund = workshopCancellation.paymentRefundId
    ? await tx.paymentRefund.findUnique({
        where: { id: workshopCancellation.paymentRefundId },
      })
    : null;
  const creditEntry = workshopCancellation.creditLedgerEntryId
    ? await tx.creditLedgerEntry.findUnique({
        where: { id: workshopCancellation.creditLedgerEntryId },
      })
    : null;

  const balancePence =
    workshopCancellation.creditAccountId !== null
      ? await getCreditAccountBalanceTx(tx, workshopCancellation.creditAccountId)
      : null;

  return {
    cancellation: {
      id: workshopCancellation.id,
      workshopJobId: workshopCancellation.workshopJobId,
      outcome: workshopCancellation.outcome,
      notes: workshopCancellation.notes,
      cancelledAt: workshopCancellation.cancelledAt,
    },
    refund: paymentRefund
      ? {
          id: paymentRefund.id,
          paymentId: paymentRefund.paymentId,
          amountPence: paymentRefund.amountPence,
          reason: paymentRefund.reason,
          status: paymentRefund.status,
          processorRefundId: paymentRefund.processorRefundId,
          createdAt: paymentRefund.createdAt,
        }
      : null,
    credit: creditEntry
      ? {
          accountId: workshopCancellation.creditAccountId,
          entryId: creditEntry.id,
          amountPence: creditEntry.amountPence,
          sourceType: creditEntry.sourceType,
          sourceRef: creditEntry.sourceRef,
          balancePence,
        }
      : null,
    idempotent,
  };
};

const cancelWorkshopJobTx = async (
  tx: SerializableTx,
  workshopJob: {
    id: string;
    status: string;
    source: string;
    depositStatus: string;
    depositRequiredPence: number;
    customerId: string | null;
    customer: {
      email: string | null;
      phone: string | null;
    } | null;
  },
  input: CancelWorkshopInput,
  auditActor?: AuditActor,
) => {
  const existingCancellation = await tx.workshopCancellation.findUnique({
    where: { workshopJobId: workshopJob.id },
  });
  if (existingCancellation) {
    return getCancellationResponseFromRecordTx(tx, existingCancellation, true);
  }

  if (workshopJob.status === "COMPLETED") {
    throw new HttpError(
      409,
      "Completed workshop jobs cannot be cancelled",
      "WORKSHOP_JOB_NOT_CANCELLABLE",
    );
  }

  const depositPayment = await getDepositPaymentForJobTx(tx, workshopJob.id);
  const hasPaidDeposit = workshopJob.depositStatus === "PAID" && !!depositPayment;

  let outcome: CancellationOutcome;
  if (!hasPaidDeposit) {
    outcome = "NO_DEPOSIT";
  } else {
    outcome = input.outcome ?? "REFUND_DEPOSIT";
    if (outcome === "NO_DEPOSIT") {
      throw new HttpError(
        409,
        "NO_DEPOSIT outcome is only valid when no deposit was paid",
        "INVALID_CANCELLATION_OUTCOME",
      );
    }
  }

  let paymentRefundId: string | null = null;
  let creditAccountId: string | null = null;
  let creditLedgerEntryId: string | null = null;

  if (outcome === "REFUND_DEPOSIT") {
    if (!depositPayment) {
      throw new HttpError(409, "No deposit payment to refund", "NO_DEPOSIT_PAYMENT");
    }

    const alreadyRefunded = depositPayment.refunds
      .filter((refund) => refund.status !== "PROCESSOR_FAILED")
      .reduce((sum, refund) => sum + refund.amountPence, 0);
    const refundablePence = Math.max(0, depositPayment.amountPence - alreadyRefunded);

    if (refundablePence > 0) {
      const refundResult = await createRefundTx(tx, depositPayment.id, {
        amountPence: refundablePence,
        reason: normalizeText(input.refundReason) ?? "Workshop cancellation",
        status: "RECORDED",
        idempotencyKey: normalizeText(input.idempotencyKey) ?? `cancellation-refund:${workshopJob.id}`,
      }, auditActor);
      paymentRefundId = refundResult.refund.id;
    }
  }

  if (outcome === "CONVERT_TO_CREDIT") {
    if (!depositPayment) {
      throw new HttpError(409, "No deposit payment to convert", "NO_DEPOSIT_PAYMENT");
    }

    const alreadyRefunded = depositPayment.refunds
      .filter((refund) => refund.status !== "PROCESSOR_FAILED")
      .reduce((sum, refund) => sum + refund.amountPence, 0);
    const creditAmountPence = Math.max(0, depositPayment.amountPence - alreadyRefunded);

    if (creditAmountPence > 0) {
      const creditAccount = await getOrCreateCreditAccountTx(tx, {
        customerId: workshopJob.customerId ?? undefined,
        email: workshopJob.customer?.email ?? undefined,
        phone: workshopJob.customer?.phone ?? undefined,
      });
      creditAccountId = creditAccount.id;

      const creditIssuePayment = await tx.payment.create({
        data: {
          workshopJobId: workshopJob.id,
          method: "OTHER",
          purpose: "CREDIT_ISSUED",
          status: "COMPLETED",
          amountPence: creditAmountPence,
          providerRef: "WORKSHOP_CANCELLATION_CREDIT",
        },
      });

      const creditEntry = await tx.creditLedgerEntry.create({
        data: {
          creditAccountId: creditAccount.id,
          paymentId: creditIssuePayment.id,
          amountPence: creditAmountPence,
          sourceType: "WORKSHOP_CANCELLATION",
          sourceRef: workshopJob.id,
          idempotencyKey:
            normalizeText(input.idempotencyKey) ?? `cancellation-credit:${workshopJob.id}`,
          notes: normalizeText(input.notes),
        },
      });
      creditLedgerEntryId = creditEntry.id;
    }
  }

  await tx.workshopJob.update({
    where: { id: workshopJob.id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
    },
  });

  try {
    const cancellation = await tx.workshopCancellation.create({
      data: {
        workshopJobId: workshopJob.id,
        outcome,
        notes: normalizeText(input.notes),
        paymentRefundId,
        creditAccountId,
        creditLedgerEntryId,
      },
    });

    await createAuditEventTx(
      tx,
      {
        action: "WORKSHOP_CANCELLED",
        entityType: "WORKSHOP_JOB",
        entityId: workshopJob.id,
        metadata: {
          cancellationId: cancellation.id,
          outcome,
          paymentRefundId,
          creditAccountId,
          creditLedgerEntryId,
        },
      },
      auditActor,
    );

    return getCancellationResponseFromRecordTx(tx, cancellation, false);
  } catch (error) {
    const prismaError = error as { code?: string };
    if (prismaError.code === "P2002") {
      const raced = await tx.workshopCancellation.findUnique({
        where: { workshopJobId: workshopJob.id },
      });
      if (raced) {
        return getCancellationResponseFromRecordTx(tx, raced, true);
      }
    }
    throw error;
  }
};

const resolveSaleForCreditApplyTx = async (
  tx: SerializableTx,
  saleId: string | undefined,
  workshopJobId: string | undefined,
) => {
  if (!saleId && !workshopJobId) {
    throw new HttpError(
      400,
      "saleId or workshopJobId is required",
      "MISSING_CREDIT_APPLICATION_TARGET",
    );
  }

  if (saleId && !isUuid(saleId)) {
    throw new HttpError(400, "Invalid sale id", "INVALID_SALE_ID");
  }

  if (workshopJobId && !isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  const sale = saleId
    ? await tx.sale.findUnique({
        where: { id: saleId },
        include: { customer: true },
      })
    : await tx.sale.findUnique({
        where: { workshopJobId },
        include: { customer: true },
      });

  if (!sale) {
    throw new HttpError(404, "Sale not found", "SALE_NOT_FOUND");
  }

  return sale;
};

const getSaleOutstandingPenceTx = async (tx: SerializableTx, saleId: string, totalPence: number) => {
  const payments = await tx.payment.findMany({
    where: { saleId },
  });

  const paidNetPence = payments.reduce((sum, payment) => {
    const net = Math.max(0, payment.amountPence - payment.refundedTotalPence);
    return sum + net;
  }, 0);

  return Math.max(0, totalPence - paidNetPence);
};

export const cancelWorkshopBookingByManageToken = async (
  token: string,
  input: CancelWorkshopInput,
  auditActor?: AuditActor,
) => {
  const normalizedToken = normalizeText(token);
  if (!normalizedToken) {
    throw new HttpError(404, "Booking not found", "BOOKING_NOT_FOUND");
  }

  return withSerializableTransaction(async (tx) => {
    const booking = await tx.workshopJob.findUnique({
      where: { manageToken: normalizedToken },
      include: {
        customer: true,
      },
    });

    if (!booking || !booking.manageTokenExpiresAt || booking.manageTokenExpiresAt <= new Date()) {
      throw new HttpError(404, "Booking not found", "BOOKING_NOT_FOUND");
    }

    return cancelWorkshopJobTx(tx, booking, input, auditActor);
  });
};

export const cancelWorkshopJobById = async (
  workshopJobId: string,
  input: CancelWorkshopInput,
  auditActor?: AuditActor,
) => {
  toUuidOrThrow(workshopJobId, "workshop job id", "INVALID_WORKSHOP_JOB_ID");

  return withSerializableTransaction(async (tx) => {
    const workshopJob = await tx.workshopJob.findUnique({
      where: { id: workshopJobId },
      include: {
        customer: true,
      },
    });

    if (!workshopJob) {
      throw new HttpError(404, "Workshop job not found", "WORKSHOP_JOB_NOT_FOUND");
    }

    return cancelWorkshopJobTx(tx, workshopJob, input, auditActor);
  });
};

export const refundPaymentById = async (
  paymentId: string,
  input: RefundPaymentInput,
  auditActor?: AuditActor,
) => {
  toUuidOrThrow(paymentId, "payment id", "INVALID_PAYMENT_ID");

  const amountPence = toPositiveIntOrThrow(input.amountPence, "amountPence");
  const reason = normalizeText(input.reason);
  if (!reason) {
    throw new HttpError(400, "reason is required", "MISSING_REFUND_REASON");
  }

  return withSerializableTransaction(async (tx) => {
    const refundResult = await createRefundTx(tx, paymentId, {
      amountPence,
      reason,
      status: input.status,
      processorRefundId: normalizeText(input.processorRefundId),
      idempotencyKey: normalizeText(input.idempotencyKey),
    }, auditActor);

    return {
      refund: {
        id: refundResult.refund.id,
        paymentId: refundResult.refund.paymentId,
        amountPence: refundResult.refund.amountPence,
        reason: refundResult.refund.reason,
        status: refundResult.refund.status,
        processorRefundId: refundResult.refund.processorRefundId,
        idempotencyKey: refundResult.refund.idempotencyKey,
        createdAt: refundResult.refund.createdAt,
      },
      payment: {
        id: refundResult.payment.id,
        amountPence: refundResult.payment.amountPence,
        refundedTotalPence: refundResult.payment.refundedTotalPence,
        status: refundResult.payment.status,
      },
      idempotent: refundResult.idempotent,
    };
  });
};

export const getPaymentById = async (paymentId: string) => {
  toUuidOrThrow(paymentId, "payment id", "INVALID_PAYMENT_ID");

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      refunds: {
        orderBy: { createdAt: "asc" },
      },
      sale: {
        select: {
          id: true,
          basketId: true,
          workshopJobId: true,
          customerId: true,
          totalPence: true,
          createdAt: true,
        },
      },
      workshopJob: {
        select: {
          id: true,
          status: true,
          source: true,
          scheduledDate: true,
          depositStatus: true,
          depositRequiredPence: true,
          customerId: true,
        },
      },
    },
  });

  if (!payment) {
    throw new HttpError(404, "Payment not found", "PAYMENT_NOT_FOUND");
  }

  return {
    payment: {
      id: payment.id,
      saleId: payment.saleId,
      workshopJobId: payment.workshopJobId,
      method: payment.method,
      purpose: payment.purpose,
      status: payment.status,
      amountPence: payment.amountPence,
      refundedTotalPence: payment.refundedTotalPence,
      providerRef: payment.providerRef,
      createdAt: payment.createdAt,
    },
    refunds: payment.refunds.map((refund) => ({
      id: refund.id,
      paymentId: refund.paymentId,
      amountPence: refund.amountPence,
      reason: refund.reason,
      status: refund.status,
      processorRefundId: refund.processorRefundId,
      idempotencyKey: refund.idempotencyKey,
      createdAt: refund.createdAt,
    })),
    links: {
      sale: payment.sale,
      workshopBooking: payment.workshopJob,
    },
  };
};

export const getCreditBalance = async (identity: CreditIdentityInput) => {
  const customerId = identity.customerId ?? undefined;
  if (customerId && !isUuid(customerId)) {
    throw new HttpError(400, "Invalid customerId", "INVALID_CUSTOMER_ID");
  }

  const email = optionalLowercase(identity.email);
  const phone = normalizeText(identity.phone);
  if (!customerId && !email && !phone) {
    throw new HttpError(
      400,
      "customerId or email or phone is required",
      "MISSING_CREDIT_IDENTITY",
    );
  }

  return withSerializableTransaction(async (tx) => {
    const account = await findCreditAccountTx(tx, { customerId, email, phone });
    if (!account) {
      return {
        account: null,
        balancePence: 0,
      };
    }

    const balancePence = await getCreditAccountBalanceTx(tx, account.id);
    return {
      account: {
        id: account.id,
        customerId: account.customerId,
        email: account.email,
        phone: account.phone,
      },
      balancePence,
    };
  });
};

export const issueCredit = async (input: IssueCreditInput, auditActor?: AuditActor) => {
  const amountPence = toPositiveIntOrThrow(input.amountPence, "amountPence");
  const idempotencyKey = normalizeText(input.idempotencyKey);
  if (!idempotencyKey) {
    throw new HttpError(400, "idempotencyKey is required", "MISSING_IDEMPOTENCY_KEY");
  }

  return withSerializableTransaction(async (tx) => {
    const creditAccount = await getOrCreateCreditAccountTx(tx, {
      customerId: input.customerId ?? undefined,
      email: input.email ?? undefined,
      phone: input.phone ?? undefined,
    });

    const existingEntry = await tx.creditLedgerEntry.findUnique({
      where: {
        creditAccountId_idempotencyKey: {
          creditAccountId: creditAccount.id,
          idempotencyKey,
        },
      },
      include: { payment: true },
    });

    if (existingEntry) {
      const balancePence = await getCreditAccountBalanceTx(tx, creditAccount.id);
      return {
        creditAccount: {
          id: creditAccount.id,
          customerId: creditAccount.customerId,
          email: creditAccount.email,
          phone: creditAccount.phone,
        },
        entry: {
          id: existingEntry.id,
          amountPence: existingEntry.amountPence,
          sourceType: existingEntry.sourceType,
          sourceRef: existingEntry.sourceRef,
          createdAt: existingEntry.createdAt,
        },
        payment: existingEntry.payment
          ? {
              id: existingEntry.payment.id,
              amountPence: existingEntry.payment.amountPence,
              purpose: existingEntry.payment.purpose,
              method: existingEntry.payment.method,
            }
          : null,
        balancePence,
        idempotent: true,
      };
    }

    const issuePayment = await tx.payment.create({
      data: {
        method: "OTHER",
        purpose: "CREDIT_ISSUED",
        status: "COMPLETED",
        amountPence,
        providerRef: "MANUAL_CREDIT_ISSUE",
      },
    });

    let entry;
    try {
      entry = await tx.creditLedgerEntry.create({
        data: {
          creditAccountId: creditAccount.id,
          paymentId: issuePayment.id,
          amountPence,
          sourceType: "MANUAL_ISSUE",
          sourceRef: normalizeText(input.sourceRef) ?? issuePayment.id,
          idempotencyKey,
          notes: normalizeText(input.notes),
        },
      });
    } catch (error) {
      const prismaError = error as { code?: string };
      if (prismaError.code === "P2002") {
        throw new HttpError(
          409,
          "A credit entry with this source reference and amount already exists",
          "CREDIT_DUPLICATE_SOURCE",
        );
      }
      throw error;
    }

    const balancePence = await getCreditAccountBalanceTx(tx, creditAccount.id);

    await createAuditEventTx(
      tx,
      {
        action: "CREDIT_ISSUED",
        entityType: "CREDIT_ACCOUNT",
        entityId: creditAccount.id,
        metadata: {
          entryId: entry.id,
          paymentId: issuePayment.id,
          amountPence: entry.amountPence,
          sourceType: entry.sourceType,
          sourceRef: entry.sourceRef,
        },
      },
      auditActor,
    );

    return {
      creditAccount: {
        id: creditAccount.id,
        customerId: creditAccount.customerId,
        email: creditAccount.email,
        phone: creditAccount.phone,
      },
      entry: {
        id: entry.id,
        amountPence: entry.amountPence,
        sourceType: entry.sourceType,
        sourceRef: entry.sourceRef,
        createdAt: entry.createdAt,
      },
      payment: {
        id: issuePayment.id,
        amountPence: issuePayment.amountPence,
        purpose: issuePayment.purpose,
        method: issuePayment.method,
      },
      balancePence,
      idempotent: false,
    };
  });
};

export const applyCredit = async (input: ApplyCreditInput, auditActor?: AuditActor) => {
  const idempotencyKey = normalizeText(input.idempotencyKey);
  if (!idempotencyKey) {
    throw new HttpError(400, "idempotencyKey is required", "MISSING_IDEMPOTENCY_KEY");
  }

  return withSerializableTransaction(async (tx) => {
    const sale = await resolveSaleForCreditApplyTx(
      tx,
      normalizeText(input.saleId),
      normalizeText(input.workshopJobId),
    );

    const creditAccount = await getOrCreateCreditAccountTx(tx, {
      customerId: input.customerId ?? sale.customerId ?? undefined,
      email: input.email ?? sale.customer?.email ?? undefined,
      phone: input.phone ?? sale.customer?.phone ?? undefined,
    });

    const existingEntry = await tx.creditLedgerEntry.findUnique({
      where: {
        creditAccountId_idempotencyKey: {
          creditAccountId: creditAccount.id,
          idempotencyKey,
        },
      },
      include: { payment: true },
    });

    if (existingEntry && existingEntry.sourceType === "CREDIT_APPLIED") {
      const balancePence = await getCreditAccountBalanceTx(tx, creditAccount.id);
      const outstandingPence = await getSaleOutstandingPenceTx(tx, sale.id, sale.totalPence);
      return {
        saleId: sale.id,
        creditAccountId: creditAccount.id,
        appliedPence: Math.abs(existingEntry.amountPence),
        outstandingPence,
        balancePence,
        payment: existingEntry.payment
          ? {
              id: existingEntry.payment.id,
              amountPence: existingEntry.payment.amountPence,
              purpose: existingEntry.payment.purpose,
              method: existingEntry.payment.method,
            }
          : null,
        entry: {
          id: existingEntry.id,
          amountPence: existingEntry.amountPence,
          sourceType: existingEntry.sourceType,
          sourceRef: existingEntry.sourceRef,
          createdAt: existingEntry.createdAt,
        },
        idempotent: true,
      };
    }

    const outstandingBeforePence = await getSaleOutstandingPenceTx(tx, sale.id, sale.totalPence);
    if (outstandingBeforePence <= 0) {
      throw new HttpError(409, "Sale is already fully paid", "SALE_ALREADY_PAID");
    }

    const balanceBeforePence = await getCreditAccountBalanceTx(tx, creditAccount.id);
    if (balanceBeforePence <= 0) {
      throw new HttpError(409, "Insufficient credit balance", "CREDIT_INSUFFICIENT");
    }

    const requestedPence =
      input.amountPence !== undefined
        ? toPositiveIntOrThrow(input.amountPence, "amountPence")
        : outstandingBeforePence;
    const appliedPence = Math.min(requestedPence, outstandingBeforePence, balanceBeforePence);

    if (appliedPence <= 0) {
      throw new HttpError(409, "Insufficient credit balance", "CREDIT_INSUFFICIENT");
    }

    const payment = await tx.payment.create({
      data: {
        saleId: sale.id,
        workshopJobId: sale.workshopJobId,
        method: "OTHER",
        purpose: "CREDIT_APPLIED",
        status: "COMPLETED",
        amountPence: appliedPence,
        providerRef: "CREDIT_APPLIED",
      },
    });

    let entry;
    try {
      entry = await tx.creditLedgerEntry.create({
        data: {
          creditAccountId: creditAccount.id,
          paymentId: payment.id,
          amountPence: -appliedPence,
          sourceType: "CREDIT_APPLIED",
          sourceRef: sale.id,
          idempotencyKey,
          notes: normalizeText(input.notes),
        },
      });
    } catch (error) {
      const prismaError = error as { code?: string };
      if (prismaError.code === "P2002") {
        throw new HttpError(
          409,
          "A credit application with the same target and amount already exists",
          "CREDIT_APPLICATION_CONFLICT",
        );
      }
      throw error;
    }

    const balanceAfterPence = await getCreditAccountBalanceTx(tx, creditAccount.id);
    if (balanceAfterPence < 0) {
      throw new HttpError(
        409,
        "Credit balance would become negative",
        "CREDIT_BALANCE_NEGATIVE",
      );
    }

    const outstandingAfterPence = await getSaleOutstandingPenceTx(tx, sale.id, sale.totalPence);

    await createAuditEventTx(
      tx,
      {
        action: "CREDIT_APPLIED",
        entityType: "SALE",
        entityId: sale.id,
        metadata: {
          creditAccountId: creditAccount.id,
          entryId: entry.id,
          paymentId: payment.id,
          appliedPence,
          outstandingPence: outstandingAfterPence,
          balancePence: balanceAfterPence,
        },
      },
      auditActor,
    );

    return {
      saleId: sale.id,
      creditAccountId: creditAccount.id,
      appliedPence,
      outstandingPence: outstandingAfterPence,
      balancePence: balanceAfterPence,
      payment: {
        id: payment.id,
        amountPence: payment.amountPence,
        purpose: payment.purpose,
        method: payment.method,
      },
      entry: {
        id: entry.id,
        amountPence: entry.amountPence,
        sourceType: entry.sourceType,
        sourceRef: entry.sourceRef,
        createdAt: entry.createdAt,
      },
      idempotent: false,
    };
  });
};
