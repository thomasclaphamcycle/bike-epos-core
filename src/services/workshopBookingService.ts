import { PaymentMethod, Prisma } from "@prisma/client";
import { randomBytes } from "crypto";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { createAuditEventTx, type AuditActor } from "./auditService";
import { assertDateIsBookable } from "./workshopAvailabilityService";
import { getWorkshopJobUsedPartsTotalPenceTx } from "./workshopPartService";
import { getBookingSettings } from "./workshopSettingsService";

type CreateOnlineWorkshopBookingInput = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  scheduledDate?: string;
  notes?: string;
};

type ManageWorkshopBookingPatchInput = {
  scheduledDate?: string;
  notes?: string;
  status?: string;
};

type PayDepositInput = {
  method?: PaymentMethod;
  providerRef?: string;
};

type WorkshopCheckoutInput = {
  saleTotalPence?: number;
  paymentMethod?: PaymentMethod;
  amountPence?: number;
  providerRef?: string;
  allowUnpaidDepositOverride?: boolean;
};

const DEFAULT_MANAGE_TOKEN_TTL_DAYS = 30;

const normalizeText = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const resolveManageTokenExpiryDate = (): Date => {
  const envValue = process.env.WORKSHOP_MANAGE_TOKEN_DAYS;
  const parsed = envValue ? Number(envValue) : NaN;
  const ttlDays =
    Number.isFinite(parsed) && parsed > 0
      ? Math.floor(parsed)
      : DEFAULT_MANAGE_TOKEN_TTL_DAYS;

  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + ttlDays);
  return expiresAt;
};

const generateManageToken = (): string => randomBytes(32).toString("hex");

const toManageBookingResponse = (job: {
  id: string;
  status: string;
  scheduledDate: Date | null;
  notes: string | null;
  source: string;
  depositRequiredPence: number;
  depositStatus: string;
  customer: {
    firstName: string;
    lastName: string;
    phone: string | null;
    email: string | null;
  } | null;
}) => {
  return {
    id: job.id,
    status: job.status,
    scheduledDate: job.scheduledDate,
    notes: job.notes,
    source: job.source,
    depositRequiredPence: job.depositRequiredPence,
    depositStatus: job.depositStatus,
    customer: job.customer
      ? {
          firstName: job.customer.firstName,
          lastName: job.customer.lastName,
          phone: job.customer.phone,
          email: job.customer.email,
        }
      : null,
  };
};

const getManageableWorkshopJobOrThrow = async (
  tx: Prisma.TransactionClient | typeof prisma,
  token: string,
) => {
  const booking = await tx.workshopJob.findUnique({
    where: { manageToken: token },
    include: {
      customer: true,
    },
  });

  if (!booking || !booking.manageTokenExpiresAt || booking.manageTokenExpiresAt <= new Date()) {
    throw new HttpError(404, "Booking not found", "BOOKING_NOT_FOUND");
  }

  return booking;
};

const getOrCreateCustomerForOnlineBooking = async (
  tx: Prisma.TransactionClient,
  input: {
    firstName: string;
    lastName: string;
    email?: string;
    phone: string;
    notes?: string;
  },
) => {
  if (input.email) {
    const existingByEmail = await tx.customer.findUnique({
      where: { email: input.email },
    });
    if (existingByEmail) {
      return existingByEmail;
    }

    try {
      return await tx.customer.create({
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phone: input.phone,
          notes: input.notes,
        },
      });
    } catch (error) {
      const prismaError = error as { code?: string };
      if (prismaError.code === "P2002") {
        const retryByEmail = await tx.customer.findUnique({
          where: { email: input.email },
        });
        if (retryByEmail) {
          return retryByEmail;
        }
      }
      throw error;
    }
  }

  const existingByPhone = await tx.customer.findFirst({
    where: { phone: input.phone },
    orderBy: { createdAt: "asc" },
  });
  if (existingByPhone) {
    return existingByPhone;
  }

  return tx.customer.create({
    data: {
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      notes: input.notes,
    },
  });
};

export const createOnlineWorkshopBooking = async (
  input: CreateOnlineWorkshopBookingInput,
) => {
  const firstName = normalizeText(input.firstName);
  const lastName = normalizeText(input.lastName);
  const phone = normalizeText(input.phone);
  const email = normalizeText(input.email)?.toLowerCase();
  const notes = normalizeText(input.notes);
  const scheduledDate = normalizeText(input.scheduledDate);

  if (!firstName || !lastName || !phone || !scheduledDate) {
    throw new HttpError(
      400,
      "firstName, lastName, phone and scheduledDate are required",
      "INVALID_BOOKING",
    );
  }

  return prisma.$transaction(async (tx) => {
    const availability = await assertDateIsBookable(tx, scheduledDate);
    const settings = await getBookingSettings(tx);

    const customer = await getOrCreateCustomerForOnlineBooking(tx, {
      firstName,
      lastName,
      email,
      phone,
      notes,
    });

    const manageTokenExpiresAt = resolveManageTokenExpiryDate();
    let workshopJob:
      | Awaited<ReturnType<typeof tx.workshopJob.create>>
      | undefined;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        workshopJob = await tx.workshopJob.create({
          data: {
            customerId: customer.id,
            status: "BOOKING_MADE",
            scheduledDate: availability.date,
            source: "ONLINE",
            depositRequiredPence: settings.defaultDepositPence,
            depositStatus: "REQUIRED",
            manageToken: generateManageToken(),
            manageTokenExpiresAt,
            notes,
          },
        });
        break;
      } catch (error) {
        const prismaError = error as { code?: string };
        if (prismaError.code === "P2002") {
          continue;
        }
        throw error;
      }
    }

    if (!workshopJob) {
      throw new HttpError(500, "Could not create workshop booking token", "TOKEN_CREATE_FAILED");
    }

    return {
      id: workshopJob.id,
      status: workshopJob.status,
      source: workshopJob.source,
      scheduledDate: workshopJob.scheduledDate,
      manageToken: workshopJob.manageToken,
      manageTokenExpiresAt: workshopJob.manageTokenExpiresAt,
      depositRequiredPence: workshopJob.depositRequiredPence,
      depositStatus: workshopJob.depositStatus,
      notes: workshopJob.notes,
      customer: {
        id: customer.id,
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        phone: customer.phone,
      },
      createdAt: workshopJob.createdAt,
      updatedAt: workshopJob.updatedAt,
    };
  });
};

export const payWorkshopBookingDepositByManageToken = async (
  token: string,
  input: PayDepositInput,
  auditActor?: AuditActor,
) => {
  const normalizedToken = normalizeText(token);
  if (!normalizedToken) {
    throw new HttpError(404, "Booking not found", "BOOKING_NOT_FOUND");
  }

  return prisma.$transaction(async (tx) => {
    const booking = await getManageableWorkshopJobOrThrow(tx, normalizedToken);
    const configuredDepositAmount =
      booking.depositRequiredPence > 0
        ? booking.depositRequiredPence
        : (await getBookingSettings(tx)).defaultDepositPence;
    const existingDepositPayment = await tx.payment.findFirst({
      where: {
        workshopJobId: booking.id,
        purpose: "DEPOSIT",
        amountPence: configuredDepositAmount,
      },
      orderBy: { createdAt: "asc" },
    });

    if (booking.depositStatus === "PAID") {
      if (!existingDepositPayment) {
        throw new HttpError(
          500,
          "Deposit is marked as paid but no deposit payment exists",
          "DEPOSIT_STATE_INVALID",
        );
      }

      return {
        workshopJobId: booking.id,
        depositStatus: booking.depositStatus,
        payment: {
          id: existingDepositPayment.id,
          amountPence: existingDepositPayment.amountPence,
          method: existingDepositPayment.method,
          providerRef: existingDepositPayment.providerRef,
          createdAt: existingDepositPayment.createdAt,
        },
        idempotent: true,
      };
    }

    if (existingDepositPayment) {
      await tx.workshopJob.update({
        where: { id: booking.id },
        data: {
          depositRequiredPence: configuredDepositAmount,
          depositStatus: "PAID",
        },
      });

      return {
        workshopJobId: booking.id,
        depositStatus: "PAID",
        payment: {
          id: existingDepositPayment.id,
          amountPence: existingDepositPayment.amountPence,
          method: existingDepositPayment.method,
          providerRef: existingDepositPayment.providerRef,
          createdAt: existingDepositPayment.createdAt,
        },
        idempotent: true,
      };
    }

    const payment = await tx.payment.create({
      data: {
        workshopJobId: booking.id,
        method: input.method ?? "CARD",
        purpose: "DEPOSIT",
        status: "COMPLETED",
        amountPence: configuredDepositAmount,
        providerRef: input.providerRef,
      },
    });

    await createAuditEventTx(
      tx,
      {
        action: "WORKSHOP_DEPOSIT_PAID",
        entityType: "WORKSHOP_JOB",
        entityId: booking.id,
        metadata: {
          paymentId: payment.id,
          amountPence: payment.amountPence,
          method: payment.method,
          purpose: payment.purpose,
          providerRef: payment.providerRef,
        },
      },
      auditActor,
    );

    await tx.workshopJob.update({
      where: { id: booking.id },
      data: {
        depositRequiredPence: configuredDepositAmount,
        depositStatus: "PAID",
      },
    });

    return {
      workshopJobId: booking.id,
      depositStatus: "PAID",
      payment: {
        id: payment.id,
        amountPence: payment.amountPence,
        method: payment.method,
        providerRef: payment.providerRef,
        createdAt: payment.createdAt,
      },
      idempotent: false,
    };
  });
};

export const getWorkshopBookingByManageToken = async (token: string) => {
  const normalizedToken = normalizeText(token);
  if (!normalizedToken) {
    throw new HttpError(404, "Booking not found", "BOOKING_NOT_FOUND");
  }

  const booking = await getManageableWorkshopJobOrThrow(prisma, normalizedToken);
  return toManageBookingResponse(booking);
};

export const updateWorkshopBookingByManageToken = async (
  token: string,
  input: ManageWorkshopBookingPatchInput,
) => {
  const normalizedToken = normalizeText(token);
  if (!normalizedToken) {
    throw new HttpError(404, "Booking not found", "BOOKING_NOT_FOUND");
  }

  const hasScheduledDate = Object.prototype.hasOwnProperty.call(input, "scheduledDate");
  const hasNotes = Object.prototype.hasOwnProperty.call(input, "notes");
  const hasStatus = Object.prototype.hasOwnProperty.call(input, "status");

  if (!hasScheduledDate && !hasNotes && !hasStatus) {
    throw new HttpError(
      400,
      "At least one of scheduledDate, notes, or status must be provided",
      "INVALID_BOOKING_UPDATE",
    );
  }

  if (hasStatus && input.status !== "CANCELLED") {
    throw new HttpError(400, "status can only be set to CANCELLED", "INVALID_BOOKING_STATUS");
  }

  return prisma.$transaction(async (tx) => {
    const booking = await getManageableWorkshopJobOrThrow(tx, normalizedToken);

    if (booking.status !== "BOOKING_MADE") {
      throw new HttpError(409, "Booking can no longer be changed", "BOOKING_NOT_EDITABLE");
    }

    const data: Prisma.WorkshopJobUpdateInput = {};

    if (hasScheduledDate) {
      const dateValue = normalizeText(input.scheduledDate);
      if (!dateValue) {
        throw new HttpError(400, "scheduledDate must be YYYY-MM-DD", "INVALID_DATE");
      }
      const availability = await assertDateIsBookable(tx, dateValue, booking.id);
      data.scheduledDate = availability.date;
    }

    if (hasNotes) {
      data.notes = normalizeText(input.notes) ?? null;
    }

    if (hasStatus && input.status === "CANCELLED") {
      data.status = "CANCELLED";
      data.cancelledAt = new Date();
    }

    const updated = await tx.workshopJob.update({
      where: { id: booking.id },
      data,
      include: {
        customer: true,
      },
    });

    return toManageBookingResponse(updated);
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

  return prisma.$transaction(async (tx) => {
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
        await tx.workshopJob.update({
          where: { id: workshopJob.id },
          data: { status: "COMPLETED" },
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

    let sale:
      | {
          id: string;
          workshopJobId: string | null;
          customerId: string | null;
          totalPence: number;
          createdAt: Date;
        }
      | null = null;

    sale = await tx.sale.create({
      data: {
        workshopJobId,
        customerId: workshopJob.customerId,
        subtotalPence: saleTotalPence,
        taxPence: 0,
        totalPence: saleTotalPence,
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

      payment = {
        id: createdPayment.id,
        method: createdPayment.method,
        amountPence: createdPayment.amountPence,
        providerRef: createdPayment.providerRef,
        createdAt: createdPayment.createdAt,
      };
    }

    await tx.workshopJob.update({
      where: { id: workshopJob.id },
      data: {
        status: "COMPLETED",
      },
    });

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
    };
  });
};
