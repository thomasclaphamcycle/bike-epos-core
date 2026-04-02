import { PaymentMethod, Prisma } from "@prisma/client";
import { randomBytes } from "crypto";
import { prisma } from "../lib/prisma";
import { emitEvent } from "../utils/domainEvent";
import { HttpError, isUuid } from "../utils/http";
import { createAuditEventTx, type AuditActor } from "./auditService";
import { ensureCustomerAccountForCustomerTx } from "./customerAccountService";
import { buildCustomerBikeDisplayName } from "./customerBikeService";
import { getWorkshopSettings, listPublicShopConfig } from "./configurationService";
import { getOrCreateDefaultLocationTx } from "./locationService";
import { assertDateIsBookable } from "./workshopAvailabilityService";
import { listWorkshopServiceTemplates } from "./workshopServiceTemplateService";
import { getBookingSettings } from "./workshopSettingsService";

type CreateOnlineWorkshopBookingInput = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  scheduledDate?: string;
  bikeId?: string;
  bikeDescription?: string;
  serviceTemplateId?: string;
  preferredTime?: string;
  serviceRequest?: string;
  notes?: string;
  authenticatedCustomerId?: string;
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

const normalizeText = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeComparableText = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLowerCase();

const resolveManageTokenExpiryDate = (ttlDays: number): Date => {
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + ttlDays);
  return expiresAt;
};

const generateManageToken = (): string => randomBytes(32).toString("hex");

const CUSTOMER_BOOKING_REQUEST_HEADING = "Customer booking request";

type ParsedBookingRequestSummary = {
  serviceLabel: string | null;
  preferredTime: string | null;
  serviceRequest: string | null;
  additionalNotes: string | null;
};

const normalizeOptionalBookingText = (
  value: string | undefined,
  field: string,
  maxLength: number,
) => {
  const normalized = normalizeText(value);
  if (normalized && normalized.length > maxLength) {
    throw new HttpError(
      400,
      `${field} must be ${maxLength} characters or fewer`,
      "INVALID_BOOKING",
    );
  }
  return normalized;
};

const parsePreferredTime = (value: string | undefined) => {
  const normalized = normalizeOptionalBookingText(value, "preferredTime", 80);
  if (!normalized) {
    return undefined;
  }

  const canonical = normalized.trim().toUpperCase().replace(/\s+/g, "_");
  switch (canonical) {
    case "MORNING":
      return "Morning";
    case "AFTERNOON":
      return "Afternoon";
    case "ANYTIME":
    case "ANY_TIME":
    case "FLEXIBLE":
      return "Any time";
    default:
      return normalized;
  }
};

const buildBookingNotes = (input: {
  serviceLabel?: string;
  preferredTime?: string;
  serviceRequest?: string;
  additionalNotes?: string;
}) => {
  const lines = [CUSTOMER_BOOKING_REQUEST_HEADING];

  if (input.serviceLabel) {
    lines.push(`Service requested: ${input.serviceLabel}`);
  }
  if (input.preferredTime) {
    lines.push(`Preferred time: ${input.preferredTime}`);
  }
  if (input.serviceRequest) {
    lines.push(`Issue summary: ${input.serviceRequest}`);
  }
  if (input.additionalNotes) {
    lines.push(`Additional notes: ${input.additionalNotes}`);
  }

  if (lines.length === 1) {
    return null;
  }

  return lines.join("\n");
};

const parseBookingRequestSummary = (
  value: string | null | undefined,
): ParsedBookingRequestSummary => {
  const notes = normalizeText(value ?? undefined);
  if (!notes) {
    return {
      serviceLabel: null,
      preferredTime: null,
      serviceRequest: null,
      additionalNotes: null,
    };
  }

  const lines = notes.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines[0] !== CUSTOMER_BOOKING_REQUEST_HEADING) {
    return {
      serviceLabel: null,
      preferredTime: null,
      serviceRequest: null,
      additionalNotes: notes,
    };
  }

  const readValue = (prefix: string) =>
    lines.find((line) => line.startsWith(prefix))?.slice(prefix.length).trim() ?? null;

  return {
    serviceLabel: readValue("Service requested:"),
    preferredTime: readValue("Preferred time:"),
    serviceRequest: readValue("Issue summary:"),
    additionalNotes: readValue("Additional notes:"),
  };
};

const toManageBookingResponse = (job: {
  id: string;
  status: string;
  scheduledDate: Date | null;
  bikeDescription: string | null;
  notes: string | null;
  source: string;
  depositRequiredPence: number;
  depositStatus: string;
  createdAt: Date;
  updatedAt: Date;
  manageTokenExpiresAt: Date | null;
  customer: {
    firstName: string;
    lastName: string;
    phone: string | null;
    email: string | null;
  } | null;
}) => {
  const bookingRequest = parseBookingRequestSummary(job.notes);

  return {
    id: job.id,
    status: job.status,
    scheduledDate: job.scheduledDate,
    notes: job.notes,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    manageTokenExpiresAt: job.manageTokenExpiresAt,
    source: job.source,
    depositRequiredPence: job.depositRequiredPence,
    depositStatus: job.depositStatus,
    bookingRequest: {
      bikeDescription: job.bikeDescription,
      serviceLabel: bookingRequest.serviceLabel,
      preferredTime: bookingRequest.preferredTime,
      serviceRequest: bookingRequest.serviceRequest,
      additionalNotes: bookingRequest.additionalNotes,
      requestedDateLabel: job.scheduledDate
        ? job.scheduledDate.toLocaleDateString("en-GB", { dateStyle: "medium" })
        : null,
      timingExpectation:
        "This is a requested workshop date. The shop will confirm the final drop-off timing if a more precise slot is needed.",
    },
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

const lockWorkshopJobByManageTokenTx = async (
  tx: Prisma.TransactionClient,
  token: string,
) => {
  const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "WorkshopJob" WHERE "manageToken" = ${token} FOR UPDATE
  `;

  if (lockedRows.length === 0) {
    throw new HttpError(404, "Booking not found", "BOOKING_NOT_FOUND");
  }
};

const getExistingDepositPaymentTx = async (
  tx: Prisma.TransactionClient,
  workshopJobId: string,
) =>
  tx.payment.findFirst({
    where: {
      workshopJobId,
      purpose: "DEPOSIT",
      amountPence: {
        gt: 0,
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

const getOrCreateCustomerForOnlineBooking = async (
  tx: Prisma.TransactionClient,
  input: {
    firstName: string;
    lastName: string;
    email?: string;
    phone: string;
    notes?: string;
    authenticatedCustomerId?: string;
  },
) => {
  if (input.authenticatedCustomerId) {
    const authenticatedCustomer = await tx.customer.findUnique({
      where: { id: input.authenticatedCustomerId },
    });

    if (!authenticatedCustomer) {
      throw new HttpError(
        401,
        "Customer account session is no longer valid",
        "CUSTOMER_ACCOUNT_NOT_FOUND",
      );
    }

    return authenticatedCustomer;
  }

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

  const existingByPhone = await tx.customer.findMany({
    where: { phone: input.phone },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (existingByPhone.length > 0) {
    const requestedFirstName = normalizeComparableText(input.firstName);
    const requestedLastName = normalizeComparableText(input.lastName);
    const exactPhoneMatch = existingByPhone.find(
      (customer) =>
        normalizeComparableText(customer.firstName) === requestedFirstName
        && normalizeComparableText(customer.lastName) === requestedLastName,
    );

    if (exactPhoneMatch) {
      return exactPhoneMatch;
    }
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
  const bikeId = normalizeText(input.bikeId);
  const bikeDescription = normalizeOptionalBookingText(input.bikeDescription, "bikeDescription", 160);
  const serviceRequest = normalizeOptionalBookingText(input.serviceRequest, "serviceRequest", 1000);
  const preferredTime = parsePreferredTime(input.preferredTime);
  const additionalNotes = normalizeOptionalBookingText(input.notes, "notes", 1000);
  const scheduledDate = normalizeText(input.scheduledDate);
  const serviceTemplateId = normalizeText(input.serviceTemplateId);

  if (!firstName || !lastName || !phone || !scheduledDate) {
    throw new HttpError(
      400,
      "firstName, lastName, phone and scheduledDate are required",
      "INVALID_BOOKING",
    );
  }

  const booking = await prisma.$transaction(async (tx) => {
    const availability = await assertDateIsBookable(tx, scheduledDate);
    const settings = await getBookingSettings(tx);
    const workshopSettings = await getWorkshopSettings(tx);
    let serviceLabel: string | undefined;

    if (serviceTemplateId) {
      const template = await tx.workshopServiceTemplate.findFirst({
        where: {
          id: serviceTemplateId,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
        },
      });
      if (!template) {
        throw new HttpError(
          404,
          "Selected service was not found",
          "WORKSHOP_SERVICE_TEMPLATE_NOT_FOUND",
        );
      }
      serviceLabel = template.name;
    }

    const notes = buildBookingNotes({
      serviceLabel,
      preferredTime,
      serviceRequest,
      additionalNotes,
    });

    const customer = await getOrCreateCustomerForOnlineBooking(tx, {
      firstName,
      lastName,
      email,
      phone,
      notes: additionalNotes,
      authenticatedCustomerId: input.authenticatedCustomerId,
    });
    await ensureCustomerAccountForCustomerTx(tx, {
      customerId: customer.id,
      email: customer.email,
    });

    let selectedBike:
      | {
          id: string;
          label: string | null;
          make: string | null;
          model: string | null;
          year: number | null;
          bikeType: string | null;
          colour: string | null;
          wheelSize: string | null;
          frameSize: string | null;
          groupset: string | null;
          motorBrand: string | null;
          motorModel: string | null;
        }
      | null = null;

    if (bikeId) {
      if (!input.authenticatedCustomerId) {
        throw new HttpError(
          401,
          "Sign in to reuse a saved bike from your customer account",
          "CUSTOMER_ACCOUNT_REQUIRED",
        );
      }
      if (!isUuid(bikeId)) {
        throw new HttpError(400, "bikeId must be a valid bike id", "INVALID_BOOKING");
      }
      if (customer.id !== input.authenticatedCustomerId) {
        throw new HttpError(
          403,
          "Saved bikes can only be used when the booking stays on your own customer account",
          "CUSTOMER_BIKE_ACCOUNT_MISMATCH",
        );
      }

      selectedBike = await tx.customerBike.findFirst({
        where: {
          id: bikeId,
          customerId: input.authenticatedCustomerId,
        },
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
        },
      });

      if (!selectedBike) {
        throw new HttpError(404, "Saved bike not found", "CUSTOMER_BIKE_NOT_FOUND");
      }
    }
    const location = await getOrCreateDefaultLocationTx(tx);

    const manageTokenExpiresAt = resolveManageTokenExpiryDate(workshopSettings.manageTokenTtlDays);
    let workshopJob:
      | Awaited<ReturnType<typeof tx.workshopJob.create>>
      | undefined;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        workshopJob = await tx.workshopJob.create({
          data: {
            customerId: customer.id,
            status: "BOOKED",
            scheduledDate: availability.date,
            source: "ONLINE",
            depositRequiredPence: settings.defaultDepositPence,
            depositStatus: "REQUIRED",
            locationId: location.id,
            bikeId: selectedBike?.id ?? null,
            bikeDescription: bikeDescription ?? (selectedBike ? buildCustomerBikeDisplayName(selectedBike) : null),
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
      bookingRequest: {
        bikeDescription:
          workshopJob.bikeDescription
          ?? (selectedBike ? buildCustomerBikeDisplayName(selectedBike) : bikeDescription)
          ?? null,
        serviceLabel: serviceLabel ?? null,
        preferredTime: preferredTime ?? null,
        serviceRequest: serviceRequest ?? null,
        additionalNotes: additionalNotes ?? null,
      },
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

  emitEvent("workshop.job.created", {
    id: booking.id,
    type: "workshop.job.created",
    timestamp: new Date().toISOString(),
    workshopJobId: booking.id,
    status: booking.status,
    customerId: booking.customer.id,
    bikeDescription: booking.bookingRequest.bikeDescription,
  });

  return booking;
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
    await lockWorkshopJobByManageTokenTx(tx, normalizedToken);
    const booking = await getManageableWorkshopJobOrThrow(tx, normalizedToken);
    const configuredDepositAmount =
      booking.depositRequiredPence > 0
        ? booking.depositRequiredPence
        : (await getBookingSettings(tx)).defaultDepositPence;
    const existingDepositPayment = await getExistingDepositPaymentTx(tx, booking.id);

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

    let payment: NonNullable<Awaited<ReturnType<typeof getExistingDepositPaymentTx>>>;
    try {
      payment = await tx.payment.create({
        data: {
          workshopJobId: booking.id,
          method: input.method ?? "CARD",
          purpose: "DEPOSIT",
          status: "COMPLETED",
          amountPence: configuredDepositAmount,
          providerRef: input.providerRef,
        },
      });
    } catch (error) {
      const prismaError = error as { code?: string };
      if (prismaError.code === "P2002") {
        const recoveredPayment = await getExistingDepositPaymentTx(tx, booking.id);
        if (recoveredPayment) {
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
              id: recoveredPayment.id,
              amountPence: recoveredPayment.amountPence,
              method: recoveredPayment.method,
              providerRef: recoveredPayment.providerRef,
              createdAt: recoveredPayment.createdAt,
            },
            idempotent: true,
          };
        }
      }

      throw error;
    }

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

export const getPublicWorkshopBookingFormOptions = async () => {
  const [config, bookingSettings, workshopSettings, templates] = await Promise.all([
    listPublicShopConfig(),
    getBookingSettings(),
    getWorkshopSettings(),
    listWorkshopServiceTemplates(),
  ]);

  return {
    config,
    booking: {
      minBookableDate: bookingSettings.minBookableDate,
      maxBookingsPerDay: bookingSettings.maxBookingsPerDay,
      defaultDepositPence: bookingSettings.defaultDepositPence,
      timingMode: "REQUESTED_DATE",
      timingMessage: workshopSettings.requestTimingMessage,
    },
    serviceOptions: templates.templates.map((template) => ({
      id: template.id,
      name: template.name,
      description: template.description,
      category: template.category,
      defaultDurationMinutes: template.defaultDurationMinutes,
    })),
  };
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

    if (booking.status !== "BOOKED") {
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
