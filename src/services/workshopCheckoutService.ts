import { PaymentMethod, PosSaleSource, Prisma } from "@prisma/client";
import { logCorePosError, logCorePosEvent, logOperationalEvent } from "../lib/operationalLogger";
import { prisma } from "../lib/prisma";
import { emitEvent } from "../utils/domainEvent";
import { HttpError, isUuid } from "../utils/http";
import { createAuditEventTx, type AuditActor } from "./auditService";
import { getWorkshopJobUsedPartsTotalPenceTx } from "./workshopPartService";
import { recordCashSaleMovementForPaymentTx } from "./tillService";

export type WorkshopCheckoutInput = {
  saleTotalPence?: number;
  paymentMethod?: PaymentMethod;
  amountPence?: number;
  providerRef?: string;
  allowUnpaidDepositOverride?: boolean;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const WORKSHOP_CHECKOUT_TRANSACTION_RETRIES = 4;
const WORKSHOP_CHECKOUT_TRANSACTION_MAX_WAIT_MS = 15_000;
const WORKSHOP_CHECKOUT_TRANSACTION_TIMEOUT_MS = 15_000;
const WORKSHOP_CHECKOUT_RECOVERY_MAX_WAIT_MS = 30_000;
const WORKSHOP_CHECKOUT_RECOVERY_TIMEOUT_MS = 30_000;

type WorkshopCheckoutResult = {
  sale: {
    id: string;
    workshopJobId: string | null;
    customerId: string | null;
    bikeId: string | null;
    totalPence: number;
    createdAt: Date;
  };
  serviceTotalPence: number;
  partsTotalPence: number;
  saleTotalPence: number;
  depositPaidPence: number;
  creditPence: number;
  outstandingPence: number;
  payment: {
    id: string;
    method: PaymentMethod;
    amountPence: number;
    providerRef: string | null;
    createdAt: Date;
  } | null;
  idempotent: boolean;
  emittedWorkshopCompletion: boolean;
  workshopJobStatus: string;
  workshopCompletedAt: Date;
};

const workshopCheckoutOutcomeSelect = Prisma.validator<Prisma.WorkshopCheckoutOutcomeSelect>()({
  workshopJobId: true,
  saleId: true,
  customerId: true,
  bikeId: true,
  saleCreatedAt: true,
  serviceTotalPence: true,
  partsTotalPence: true,
  saleTotalPence: true,
  depositPaidPence: true,
  creditPence: true,
  outstandingPence: true,
  finalPaymentId: true,
  finalPaymentMethod: true,
  finalPaymentAmountPence: true,
  finalPaymentProviderRef: true,
  finalPaymentCreatedAt: true,
  workshopJobStatus: true,
  workshopCompletedAt: true,
});

type WorkshopCheckoutOutcomeRecord = Prisma.WorkshopCheckoutOutcomeGetPayload<{
  select: typeof workshopCheckoutOutcomeSelect;
}>;

const isRecoverableWorkshopCheckoutRace = (error: unknown) => {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2034" || error.code === "P2028" || error.code === "P2024")
  ) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("write conflict") ||
    message.includes("deadlock") ||
    message.includes("could not serialize") ||
    message.includes("lock timeout") ||
    message.includes("could not obtain lock") ||
    message.includes("canceling statement due to lock timeout") ||
    message.includes("expired transaction") ||
    message.includes("timeout for this transaction was") ||
    message.includes("unable to start a transaction in the given time") ||
    message.includes("timed out fetching a new connection from the connection pool") ||
    message.includes("transaction already closed") ||
    message.includes("a query cannot be executed on an expired transaction") ||
    message.includes("transaction is no longer valid") ||
    message.includes("transaction api error") ||
    (message.includes("duplicate key value") && message.includes("workshopjobid")) ||
    (message.includes("unique constraint") && message.includes("workshopjobid"))
  );
};

const withWorkshopCheckoutTransaction = <T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
) =>
  prisma.$transaction(fn, {
    maxWait: WORKSHOP_CHECKOUT_TRANSACTION_MAX_WAIT_MS,
    timeout: WORKSHOP_CHECKOUT_TRANSACTION_TIMEOUT_MS,
  });

const withWorkshopCheckoutRecoveryTransaction = <T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
) =>
  prisma.$transaction(fn, {
    maxWait: WORKSHOP_CHECKOUT_RECOVERY_MAX_WAIT_MS,
    timeout: WORKSHOP_CHECKOUT_RECOVERY_TIMEOUT_MS,
  });

const lockWorkshopJobForCheckoutTx = async (
  tx: Prisma.TransactionClient,
  workshopJobId: string,
) => {
  const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "WorkshopJob" WHERE id = ${workshopJobId} FOR UPDATE
  `;

  if (lockedRows.length === 0) {
    throw new HttpError(404, "Workshop job not found", "WORKSHOP_JOB_NOT_FOUND");
  }

  const workshopJob = await tx.workshopJob.findUnique({
    where: { id: workshopJobId },
    select: {
      id: true,
      customerId: true,
      bikeId: true,
      locationId: true,
      source: true,
      depositStatus: true,
      depositRequiredPence: true,
      status: true,
      completedAt: true,
    },
  });

  if (!workshopJob) {
    throw new HttpError(404, "Workshop job not found", "WORKSHOP_JOB_NOT_FOUND");
  }

  return workshopJob;
};

const listWorkshopDepositPaymentsTx = async (
  tx: Prisma.TransactionClient,
  workshopJobId: string,
) =>
  tx.payment.findMany({
    where: {
      workshopJobId,
      purpose: "DEPOSIT",
      amountPence: {
        gt: 0,
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      amountPence: true,
      saleId: true,
    },
  });

const toWorkshopCheckoutResultFromOutcome = (
  outcome: WorkshopCheckoutOutcomeRecord,
  {
    idempotent,
    emittedWorkshopCompletion,
  }: {
    idempotent: boolean;
    emittedWorkshopCompletion: boolean;
  },
): WorkshopCheckoutResult => {
  let payment: WorkshopCheckoutResult["payment"] = null;

  if (outcome.finalPaymentId) {
    if (
      !outcome.finalPaymentMethod ||
      outcome.finalPaymentAmountPence === null ||
      outcome.finalPaymentCreatedAt === null
    ) {
      throw new Error(
        `Workshop checkout outcome ${outcome.workshopJobId} is missing persisted final payment details`,
      );
    }

    payment = {
      id: outcome.finalPaymentId,
      method: outcome.finalPaymentMethod,
      amountPence: outcome.finalPaymentAmountPence,
      providerRef: outcome.finalPaymentProviderRef,
      createdAt: outcome.finalPaymentCreatedAt,
    };
  }

  return {
    sale: {
      id: outcome.saleId,
      workshopJobId: outcome.workshopJobId,
      customerId: outcome.customerId,
      bikeId: outcome.bikeId,
      totalPence: outcome.saleTotalPence,
      createdAt: outcome.saleCreatedAt,
    },
    serviceTotalPence: outcome.serviceTotalPence,
    partsTotalPence: outcome.partsTotalPence,
    saleTotalPence: outcome.saleTotalPence,
    depositPaidPence: outcome.depositPaidPence,
    creditPence: outcome.creditPence,
    outstandingPence: outcome.outstandingPence,
    payment,
    idempotent,
    emittedWorkshopCompletion,
    workshopJobStatus: outcome.workshopJobStatus,
    workshopCompletedAt: outcome.workshopCompletedAt,
  };
};

const loadAuthoritativeWorkshopCheckoutResultTx = async (
  tx: Prisma.TransactionClient,
  workshopJobId: string,
): Promise<WorkshopCheckoutResult | null> => {
  const outcome = await tx.workshopCheckoutOutcome.findUnique({
    where: { workshopJobId },
    select: workshopCheckoutOutcomeSelect,
  });

  if (!outcome) {
    return null;
  }

  return toWorkshopCheckoutResultFromOutcome(outcome, {
    idempotent: true,
    emittedWorkshopCompletion: false,
  });
};

const assertNoLegacyWorkshopSaleWithoutOutcomeTx = async (
  tx: Prisma.TransactionClient,
  workshopJobId: string,
) => {
  const existingSale = await tx.sale.findUnique({
    where: { workshopJobId },
    select: { id: true },
  });

  if (!existingSale) {
    return;
  }

  throw new Error(
    `Workshop checkout outcome missing for workshop job ${workshopJobId} with existing sale ${existingSale.id}`,
  );
};

const recoverWorkshopCheckoutFromAuthoritativeOutcome = async (
  workshopJobId: string,
) => {
  try {
    return await withWorkshopCheckoutRecoveryTransaction(async (tx) => {
      await lockWorkshopJobForCheckoutTx(tx, workshopJobId);
      return loadAuthoritativeWorkshopCheckoutResultTx(tx, workshopJobId);
    });
  } catch (error) {
    if (!isRecoverableWorkshopCheckoutRace(error)) {
      throw error;
    }

    return null;
  }
};

const toWorkshopCheckoutResponse = (
  workshopJobId: string,
  result: WorkshopCheckoutResult,
) => {
  if (result.emittedWorkshopCompletion) {
    emitEvent("workshop.job.completed", {
      id: workshopJobId,
      type: "workshop.job.completed",
      timestamp: new Date().toISOString(),
      workshopJobId,
      status: result.workshopJobStatus,
      completedAt: result.workshopCompletedAt.toISOString(),
      saleId: result.sale.id,
      customerId: result.sale.customerId,
      bikeId: result.sale.bikeId,
    });
  }

  return {
    sale: result.sale,
    serviceTotalPence: result.serviceTotalPence,
    partsTotalPence: result.partsTotalPence,
    saleTotalPence: result.saleTotalPence,
    depositPaidPence: result.depositPaidPence,
    creditPence: result.creditPence,
    outstandingPence: result.outstandingPence,
    payment: result.payment,
    idempotent: result.idempotent,
  };
};

const logWorkshopCheckoutResult = (
  workshopJobId: string,
  result: WorkshopCheckoutResult,
  paymentMethod: PaymentMethod | null,
) => {
  logOperationalEvent("workshop.checkout.completed", {
    entityId: result.sale.id,
    workshopJobId,
    saleId: result.sale.id,
    customerId: result.sale.customerId,
    saleTotalPence: result.saleTotalPence,
    outstandingPence: result.outstandingPence,
    creditPence: result.creditPence,
    depositPaidPence: result.depositPaidPence,
    paymentMethod,
    idempotent: result.idempotent,
    resultStatus: result.idempotent ? "reused" : "succeeded",
  });
};

export const checkoutWorkshopJobToSale = async (
  workshopJobId: string,
  input: WorkshopCheckoutInput,
  auditActor?: AuditActor,
) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  if (!Number.isInteger(input.saleTotalPence) || (input.saleTotalPence ?? -1) < 0) {
    throw new HttpError(400, "saleTotalPence must be a non-negative integer", "INVALID_SALE_TOTAL");
  }

  const hasPaymentMethod = input.paymentMethod !== undefined;
  const hasPaymentAmount = input.amountPence !== undefined;

  if (hasPaymentMethod !== hasPaymentAmount) {
    throw new HttpError(
      400,
      "paymentMethod and amountPence are both required when payment is provided",
      "INVALID_PAYMENT",
    );
  }

  if (hasPaymentAmount && (!Number.isInteger(input.amountPence) || (input.amountPence ?? -1) < 0)) {
    throw new HttpError(400, "amountPence must be a non-negative integer", "INVALID_PAYMENT");
  }

  let result: WorkshopCheckoutResult | undefined;
  let lastRecoverableError: unknown;

  for (let attempt = 0; attempt < WORKSHOP_CHECKOUT_TRANSACTION_RETRIES; attempt += 1) {
    try {
      const transactionResult = await withWorkshopCheckoutTransaction(async (tx) => {
        const workshopJob = await lockWorkshopJobForCheckoutTx(tx, workshopJobId);
        const existingCheckout = await loadAuthoritativeWorkshopCheckoutResultTx(tx, workshopJobId);

        if (existingCheckout) {
          return existingCheckout;
        }

        await assertNoLegacyWorkshopSaleWithoutOutcomeTx(tx, workshopJobId);

        if (workshopJob.status === "CANCELLED") {
          throw new HttpError(
            409,
            "Cancelled workshop jobs cannot be checked out",
            "WORKSHOP_JOB_NOT_CHECKOUTABLE",
          );
        }

        if (
          workshopJob.source === "ONLINE" &&
          workshopJob.depositStatus === "REQUIRED" &&
          !input.allowUnpaidDepositOverride
        ) {
          throw new HttpError(
            409,
            "Deposit must be paid before checkout",
            "DEPOSIT_REQUIRED",
          );
        }

        const partsTotalPence = await getWorkshopJobUsedPartsTotalPenceTx(tx, workshopJobId);
        const serviceTotalPence = input.saleTotalPence;
        const saleTotalPence = serviceTotalPence + partsTotalPence;

        const depositPayments = await listWorkshopDepositPaymentsTx(tx, workshopJobId);

        const depositPaidPence = depositPayments.reduce((sum, p) => sum + p.amountPence, 0);
        const creditPence = Math.max(0, depositPaidPence - saleTotalPence);
        // Outstanding is clamped to 0 so invoices never show negative due amounts.
        const outstandingPence = Math.max(0, saleTotalPence - depositPaidPence);

        if (hasPaymentAmount && input.amountPence !== outstandingPence) {
          throw new HttpError(
            400,
            "Payment amount must equal outstanding amount",
            "PAYMENT_MISMATCH",
          );
        }

        const sale = await tx.sale.create({
          data: {
            workshopJobId,
            customerId: workshopJob.customerId,
            locationId: workshopJob.locationId,
            source: PosSaleSource.WORKSHOP,
            sourceRef: workshopJobId,
            subtotalPence: saleTotalPence,
            taxPence: 0,
            totalPence: saleTotalPence,
            createdByStaffId: auditActor?.actorId ?? null,
          },
        });

        if (!sale) {
          throw new HttpError(500, "Could not create sale", "SALE_CREATE_FAILED");
        }

        if (depositPayments.length > 0) {
          await tx.payment.updateMany({
            where: {
              id: {
                in: depositPayments.map((p) => p.id),
              },
            },
            data: {
              saleId: sale.id,
            },
          });
        }

        let payment: {
          id: string;
          method: PaymentMethod;
          amountPence: number;
          providerRef: string | null;
          createdAt: Date;
        } | null = null;

        if (hasPaymentAmount && outstandingPence > 0) {
          const createdPayment = await tx.payment.create({
            data: {
              saleId: sale.id,
              workshopJobId,
              method: input.paymentMethod,
              purpose: "FINAL",
              status: "COMPLETED",
              amountPence: outstandingPence,
              providerRef: input.providerRef,
            },
          });

          await recordCashSaleMovementForPaymentTx(tx, {
            paymentId: createdPayment.id,
            paymentMethod: createdPayment.method,
            amountPence: createdPayment.amountPence,
            saleId: sale.id,
            createdByStaffId: auditActor?.actorId,
          });

          payment = {
            id: createdPayment.id,
            method: createdPayment.method,
            amountPence: createdPayment.amountPence,
            providerRef: createdPayment.providerRef,
            createdAt: createdPayment.createdAt,
          };
        }

        const emittedWorkshopCompletion = workshopJob.status !== "COMPLETED";
        const workshopCompletedAt = workshopJob.completedAt ?? new Date();

        if (emittedWorkshopCompletion) {
          const data: { status: "COMPLETED"; completedAt?: Date } = {
            status: "COMPLETED",
          };
          if (!workshopJob.completedAt) {
            data.completedAt = workshopCompletedAt;
          }

          await tx.workshopJob.update({
            where: { id: workshopJob.id },
            data,
          });
        }

        await createAuditEventTx(
          tx,
          {
            action: "WORKSHOP_CHECKOUT_COMPLETED",
            entityType: "WORKSHOP_JOB",
            entityId: workshopJob.id,
            metadata: {
              saleId: sale.id,
              serviceTotalPence,
              partsTotalPence,
              saleTotalPence,
              depositPaidPence,
              creditPence,
              outstandingPence,
              paymentId: payment?.id ?? null,
              paymentAmountPence: payment?.amountPence ?? null,
            },
          },
          auditActor,
        );

        const outcome = await tx.workshopCheckoutOutcome.create({
          data: {
            workshopJobId,
            saleId: sale.id,
            customerId: sale.customerId,
            bikeId: workshopJob.bikeId,
            saleCreatedAt: sale.createdAt,
            serviceTotalPence,
            partsTotalPence,
            saleTotalPence,
            depositPaidPence,
            creditPence,
            outstandingPence,
            finalPaymentId: payment?.id ?? null,
            finalPaymentMethod: payment?.method ?? null,
            finalPaymentAmountPence: payment?.amountPence ?? null,
            finalPaymentProviderRef: payment?.providerRef ?? null,
            finalPaymentCreatedAt: payment?.createdAt ?? null,
            workshopJobStatus: "COMPLETED",
            workshopCompletedAt,
          },
          select: workshopCheckoutOutcomeSelect,
        });

        return toWorkshopCheckoutResultFromOutcome(outcome, {
          idempotent: false,
          emittedWorkshopCompletion,
        });
      });

      if (transactionResult.idempotent) {
        logCorePosEvent("workshop.checkout.reused_existing_sale_after_lock", {
          resultStatus: "reused",
          workshopJobId,
          attempt: attempt + 1,
          saleId: transactionResult.sale.id,
        });
      }

      result = transactionResult;
      lastRecoverableError = undefined;
      break;
    } catch (error) {
      const recovered =
        error instanceof HttpError ? null : await recoverWorkshopCheckoutFromAuthoritativeOutcome(workshopJobId);
      if (recovered) {
        logCorePosEvent("workshop.checkout.recovered_from_authoritative_outcome", {
          resultStatus: "recovered",
          workshopJobId,
          attempt: attempt + 1,
          saleId: recovered.sale.id,
        });
        result = recovered;
        lastRecoverableError = undefined;
        break;
      }

      if (!isRecoverableWorkshopCheckoutRace(error)) {
        logCorePosError(
          "workshop.checkout.failed",
          error,
          {
            resultStatus: "failed",
            workshopJobId,
            attempt: attempt + 1,
          },
          error instanceof HttpError && error.status < 500 ? "warn" : "error",
        );
        throw error;
      }

      logCorePosError(
        "workshop.checkout.recoverable_race",
        error,
        {
          resultStatus: "retrying",
          workshopJobId,
          attempt: attempt + 1,
          maxAttempts: WORKSHOP_CHECKOUT_TRANSACTION_RETRIES,
        },
        "warn",
      );
      lastRecoverableError = error;
      if (attempt === WORKSHOP_CHECKOUT_TRANSACTION_RETRIES - 1) {
        logCorePosError(
          "workshop.checkout.recovery_exhausted",
          error,
          {
            resultStatus: "failed",
            workshopJobId,
            attempt: attempt + 1,
            maxAttempts: WORKSHOP_CHECKOUT_TRANSACTION_RETRIES,
          },
          "error",
        );
        throw error;
      }

      await sleep(50 * (attempt + 1));
    }
  }

  if (!result) {
    const recovered = await recoverWorkshopCheckoutFromAuthoritativeOutcome(workshopJobId);
    if (recovered) {
      logCorePosEvent("workshop.checkout.recovered_from_authoritative_outcome_after_retry_exhaustion", {
        resultStatus: "recovered",
        workshopJobId,
        saleId: recovered.sale.id,
      });
      result = recovered;
    }
  }

  if (!result) {
    logCorePosEvent("workshop.checkout.missing_result", {
      resultStatus: "failed",
      workshopJobId,
    }, "error");
    throw lastRecoverableError ?? new Error("Workshop checkout transaction did not produce a result");
  }

  logWorkshopCheckoutResult(workshopJobId, result, result.payment?.method ?? null);
  return toWorkshopCheckoutResponse(workshopJobId, result);
};
