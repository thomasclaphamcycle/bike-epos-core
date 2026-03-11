import { PaymentMethod } from "@prisma/client";
import { emit } from "../core/events";
import { prisma } from "../lib/prisma";
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

  const result = await prisma.$transaction(async (tx) => {
    const workshopJob = await tx.workshopJob.findUnique({
      where: { id: workshopJobId },
      include: { customer: true },
    });

    if (!workshopJob) {
      throw new HttpError(404, "Workshop job not found", "WORKSHOP_JOB_NOT_FOUND");
    }

    // Serialize checkout attempts per workshop job to prevent unique-key races
    // on Sale(workshopJobId) and keep idempotent behavior deterministic.
    await tx.$queryRaw`SELECT id FROM "WorkshopJob" WHERE id = ${workshopJobId} FOR UPDATE`;

    const partsTotalPence = await getWorkshopJobUsedPartsTotalPenceTx(tx, workshopJobId);

    const existingSale = await tx.sale.findUnique({
      where: { workshopJobId },
    });

    if (existingSale) {
      if (workshopJob.status !== "COMPLETED" && workshopJob.status !== "CANCELLED") {
        const data: { status: "COMPLETED"; completedAt?: Date } = {
          status: "COMPLETED",
        };
        if (!workshopJob.completedAt) {
          data.completedAt = new Date();
        }

        await tx.workshopJob.update({
          where: { id: workshopJob.id },
          data,
        });
      }

      const depositPaidPence =
        workshopJob.depositStatus === "PAID"
          ? workshopJob.depositRequiredPence
          : 0;
      const creditPence = Math.max(0, depositPaidPence - existingSale.totalPence);
      const outstandingPence = Math.max(0, existingSale.totalPence - depositPaidPence);

      return {
        sale: {
          id: existingSale.id,
          workshopJobId: existingSale.workshopJobId,
          customerId: existingSale.customerId,
          totalPence: existingSale.totalPence,
          createdAt: existingSale.createdAt,
        },
        serviceTotalPence: Math.max(0, existingSale.totalPence - partsTotalPence),
        partsTotalPence,
        saleTotalPence: existingSale.totalPence,
        depositPaidPence,
        creditPence,
        outstandingPence,
        payment: null,
        idempotent: true,
        emittedWorkshopCompletion: workshopJob.status !== "COMPLETED" && workshopJob.status !== "CANCELLED",
        workshopJobStatus: workshopJob.status !== "CANCELLED" ? "COMPLETED" : workshopJob.status,
        workshopCompletedAt: workshopJob.completedAt ?? new Date(),
      };
    }

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

    const serviceTotalPence = input.saleTotalPence;
    const saleTotalPence = serviceTotalPence + partsTotalPence;

    const depositPayments = await tx.payment.findMany({
      where: {
        workshopJobId,
        purpose: "DEPOSIT",
        amountPence: {
          gt: 0,
        },
      },
      orderBy: { createdAt: "asc" },
    });

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

    if (workshopJob.status !== "COMPLETED") {
      const data: { status: "COMPLETED"; completedAt?: Date } = {
        status: "COMPLETED",
      };
      if (!workshopJob.completedAt) {
        data.completedAt = new Date();
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

    return {
      sale: {
        id: sale.id,
        workshopJobId: sale.workshopJobId,
        customerId: sale.customerId,
        totalPence: sale.totalPence,
        createdAt: sale.createdAt,
      },
      serviceTotalPence,
      partsTotalPence,
      saleTotalPence,
      depositPaidPence,
      creditPence,
      outstandingPence,
      payment,
      idempotent: false,
      emittedWorkshopCompletion: workshopJob.status !== "COMPLETED",
      workshopJobStatus: "COMPLETED",
      workshopCompletedAt: workshopJob.completedAt ?? new Date(),
    };
  });

  if (result.emittedWorkshopCompletion) {
    emit("workshop.job.completed", {
      id: workshopJobId,
      type: "workshop.job.completed",
      timestamp: new Date().toISOString(),
      workshopJobId,
      status: result.workshopJobStatus,
      completedAt: result.workshopCompletedAt.toISOString(),
      saleId: result.sale.id,
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
