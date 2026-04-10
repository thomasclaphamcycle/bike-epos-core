import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { getCustomerDisplayName, normalizeNamePart } from "../utils/customerName";
import { createAuditEvent, createAuditEventTx, type AuditActor } from "./auditService";

const CUSTOMER_CAPTURE_SESSION_TTL_MINUTES = 15;

type CaptureSessionStatus = "ACTIVE" | "COMPLETED" | "EXPIRED";
type CustomerMatchType = "email" | "phone" | "created";

type SubmitSaleCustomerCaptureInput = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  emailMarketingConsent?: boolean;
  smsMarketingConsent?: boolean;
};

type CaptureSessionRecord = {
  id: string;
  saleId: string;
  token: string;
  status: CaptureSessionStatus;
  matchType?: CustomerMatchType | "EMAIL" | "PHONE" | "CREATED" | null;
  expiresAt: Date;
  createdAt: Date;
  completedAt?: Date | null;
  customer?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
  } | null;
};

const normalizeOptionalText = (value: string | undefined | null) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeEmail = (value: string | undefined | null) => {
  const normalized = normalizeOptionalText(value);
  return normalized ? normalized.toLowerCase() : undefined;
};

const normalizePhone = (value: string | undefined | null) => {
  const normalized = normalizeOptionalText(value);
  return normalized ? normalized.replace(/\s+/g, " ") : undefined;
};

const createSecureToken = () => crypto.randomBytes(24).toString("base64url");

const toPublicPath = (token: string) => `/customer-capture/${encodeURIComponent(token)}`;

const toApiMatchType = (matchType: "EMAIL" | "PHONE" | "CREATED" | CustomerMatchType | null | undefined) => {
  if (!matchType) {
    return null;
  }

  switch (matchType) {
    case "EMAIL":
    case "email":
      return "email";
    case "PHONE":
    case "phone":
      return "phone";
    case "CREATED":
    case "created":
      return "created";
    default:
      return null;
  }
};

const toCustomerPayload = (customer: {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
}) => ({
  id: customer.id,
  name: getCustomerDisplayName(customer),
  firstName: customer.firstName,
  lastName: customer.lastName,
  email: customer.email,
  phone: customer.phone,
});

const toSessionOutcomePayload = (session: CaptureSessionRecord) => {
  const matchType = toApiMatchType(session.matchType);
  if (!matchType || !session.customer) {
    return null;
  }

  return {
    matchType,
    customer: toCustomerPayload(session.customer),
  };
};

const toSessionPayload = (session: CaptureSessionRecord) => ({
  id: session.id,
  saleId: session.saleId,
  token: session.token,
  status: session.status,
  expiresAt: session.expiresAt,
  createdAt: session.createdAt,
  completedAt: session.completedAt ?? null,
  publicPath: toPublicPath(session.token),
  outcome: toSessionOutcomePayload(session),
});

const toSessionState = (session: {
  status: CaptureSessionStatus;
  expiresAt: Date;
  createdAt: Date;
  completedAt: Date | null;
  isReplaced?: boolean;
}) => ({
  session: {
    status: session.status,
    expiresAt: session.expiresAt,
    createdAt: session.createdAt,
    completedAt: session.completedAt,
    isReplaced: Boolean(session.isReplaced),
  },
});

const expireSessionIfNeededTx = async (
  tx: Prisma.TransactionClient,
  session: {
    id: string;
    status: CaptureSessionStatus;
    expiresAt: Date;
    completedAt: Date | null;
  },
) => {
  if (session.status !== "ACTIVE" || session.expiresAt > new Date()) {
    return session;
  }

  return tx.saleCustomerCaptureSession.update({
    where: { id: session.id },
    data: { status: "EXPIRED" },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      completedAt: true,
    },
  });
};

const getSessionByTokenOrThrowTx = async (tx: Prisma.TransactionClient, token: string) => {
  const session = await tx.saleCustomerCaptureSession.findUnique({
    where: { token },
    select: {
      id: true,
      saleId: true,
      token: true,
      status: true,
      matchType: true,
      expiresAt: true,
      createdAt: true,
      completedAt: true,
      customerId: true,
      customer: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
      sale: {
        select: {
          id: true,
          completedAt: true,
        },
      },
    },
  });

  if (!session) {
    throw new HttpError(404, "Customer capture session not found", "CUSTOMER_CAPTURE_NOT_FOUND");
  }

  const normalizedSession = await expireSessionIfNeededTx(tx, session);

  return {
    ...session,
    status: normalizedSession.status,
    expiresAt: normalizedSession.expiresAt,
    completedAt: normalizedSession.completedAt,
  };
};

const writeCaptureAuditTx = async (
  tx: Prisma.TransactionClient,
  input: {
    sessionId: string;
    action: string;
    metadata?: Record<string, unknown>;
  },
  actor?: AuditActor,
) => {
  await createAuditEventTx(
    tx,
    {
      action: input.action,
      entityType: "SALE_CUSTOMER_CAPTURE_SESSION",
      entityId: input.sessionId,
      ...(input.metadata ? { metadata: input.metadata } : {}),
    },
    actor,
  );
};

const writeCaptureAudit = async (input: {
  sessionId: string;
  action: string;
  metadata?: Record<string, unknown>;
}) => {
  await createAuditEvent({
    action: input.action,
    entityType: "SALE_CUSTOMER_CAPTURE_SESSION",
    entityId: input.sessionId,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });
};

const findNewerSessionTx = async (
  tx: Prisma.TransactionClient,
  input: {
    saleId: string;
    createdAt: Date;
    excludeSessionId: string;
  },
) =>
  tx.saleCustomerCaptureSession.findFirst({
    where: {
      saleId: input.saleId,
      id: { not: input.excludeSessionId },
      createdAt: { gt: input.createdAt },
    },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      status: true,
      createdAt: true,
      expiresAt: true,
      completedAt: true,
    },
  });

const assertSubmittableSessionOrAuditTx = async (
  tx: Prisma.TransactionClient,
  session: {
    id: string;
    saleId: string;
    status: CaptureSessionStatus;
    createdAt: Date;
    sale: { completedAt: Date | null };
  },
) => {
  if (session.status === "COMPLETED") {
    await writeCaptureAudit({
      sessionId: session.id,
      action: "customer_capture.submit_rejected",
      metadata: {
        saleId: session.saleId,
        reason: "already_completed",
      },
    });
    throw new HttpError(
      409,
      "This customer capture link has already been used",
      "CUSTOMER_CAPTURE_COMPLETED",
    );
  }

  if (session.status === "EXPIRED") {
    const newerSession = await findNewerSessionTx(tx, {
      saleId: session.saleId,
      createdAt: session.createdAt,
      excludeSessionId: session.id,
    });

    await writeCaptureAudit({
      sessionId: session.id,
      action: "customer_capture.submit_rejected",
      metadata: {
        saleId: session.saleId,
        reason: newerSession ? "replaced" : "expired",
        ...(newerSession ? { replacementSessionId: newerSession.id } : {}),
      },
    });

    if (newerSession) {
      throw new HttpError(
        409,
        "This customer capture link has been replaced",
        "CUSTOMER_CAPTURE_REPLACED",
      );
    }

    throw new HttpError(
      410,
      "This customer capture link has expired",
      "CUSTOMER_CAPTURE_EXPIRED",
    );
  }

  if (session.sale.completedAt) {
    await writeCaptureAudit({
      sessionId: session.id,
      action: "customer_capture.submit_rejected",
      metadata: {
        saleId: session.saleId,
        reason: "sale_completed",
      },
    });
    throw new HttpError(
      409,
      "This sale has already been completed",
      "SALE_ALREADY_COMPLETED",
    );
  }
};

const findMatchingCustomerTx = async (
  tx: Prisma.TransactionClient,
  input: {
    email?: string;
    phone?: string;
  },
) => {
  if (input.email) {
    const emailMatch = await tx.customer.findUnique({
      where: { email: input.email },
    });
    if (emailMatch) {
      return { customer: emailMatch, matchType: "email" as const };
    }
  }

  if (input.phone) {
    const phoneMatch = await tx.customer.findFirst({
      where: { phone: input.phone },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    });
    if (phoneMatch) {
      return { customer: phoneMatch, matchType: "phone" as const };
    }
  }

  return null;
};

const findOrCreateCustomerTx = async (
  tx: Prisma.TransactionClient,
  input: {
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
  },
) => {
  const existing = await findMatchingCustomerTx(tx, input);
  if (existing) {
    return existing;
  }

  try {
    const customer = await tx.customer.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email ?? null,
        phone: input.phone ?? null,
      },
    });

    return { customer, matchType: "created" as const };
  } catch (error) {
    const prismaError = error as { code?: string };
    if (prismaError.code === "P2002" && input.email) {
      const customer = await tx.customer.findUnique({
        where: { email: input.email },
      });
      if (customer) {
        return { customer, matchType: "email" as const };
      }
    }
    throw error;
  }
};

export const getCurrentSaleCustomerCaptureSession = async (saleId: string) => {
  if (!isUuid(saleId)) {
    throw new HttpError(400, "Invalid sale id", "INVALID_SALE_ID");
  }

  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findUnique({
      where: { id: saleId },
      select: { id: true },
    });

    if (!sale) {
      throw new HttpError(404, "Sale not found", "SALE_NOT_FOUND");
    }

    const session = await tx.saleCustomerCaptureSession.findFirst({
      where: { saleId },
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        saleId: true,
        token: true,
        status: true,
        matchType: true,
        expiresAt: true,
        createdAt: true,
        completedAt: true,
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    if (!session) {
      return { session: null };
    }

    const normalizedSession = await expireSessionIfNeededTx(tx, session);

    return {
      session: toSessionPayload({
        ...session,
        status: normalizedSession.status,
        expiresAt: normalizedSession.expiresAt,
        completedAt: normalizedSession.completedAt,
      }),
    };
  });
};

export const createSaleCustomerCaptureSession = async (saleId: string, auditActor?: AuditActor) => {
  if (!isUuid(saleId)) {
    throw new HttpError(400, "Invalid sale id", "INVALID_SALE_ID");
  }

  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findUnique({
      where: { id: saleId },
      select: {
        id: true,
        completedAt: true,
        customerId: true,
      },
    });

    if (!sale) {
      throw new HttpError(404, "Sale not found", "SALE_NOT_FOUND");
    }

    if (sale.completedAt) {
      throw new HttpError(
        409,
        "Customer capture sessions can only be created for active sales",
        "SALE_ALREADY_COMPLETED",
      );
    }

    if (sale.customerId) {
      throw new HttpError(
        409,
        "This sale already has a customer attached",
        "SALE_CUSTOMER_ALREADY_ATTACHED",
      );
    }

    const expiredActiveSessions = await tx.saleCustomerCaptureSession.updateMany({
      where: {
        saleId,
        status: "ACTIVE",
      },
      data: {
        status: "EXPIRED",
      },
    });

    const created = await tx.saleCustomerCaptureSession.create({
      data: {
        saleId,
        token: createSecureToken(),
        expiresAt: new Date(Date.now() + CUSTOMER_CAPTURE_SESSION_TTL_MINUTES * 60 * 1000),
      },
      select: {
        id: true,
        saleId: true,
        token: true,
        status: true,
        matchType: true,
        expiresAt: true,
        createdAt: true,
        completedAt: true,
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    await writeCaptureAuditTx(
      tx,
      {
        sessionId: created.id,
        action: "customer_capture.session_created",
        metadata: {
          saleId,
          expiresAt: created.expiresAt.toISOString(),
        },
      },
      auditActor,
    );

    if (expiredActiveSessions.count > 0) {
      await writeCaptureAuditTx(
        tx,
        {
          sessionId: created.id,
          action: "customer_capture.session_replaced",
          metadata: {
            saleId,
            replacedActiveSessionCount: expiredActiveSessions.count,
          },
        },
        auditActor,
      );
    }

    return {
      session: toSessionPayload(created),
      replacedActiveSessionCount: expiredActiveSessions.count,
    };
  });
};

export const getPublicSaleCustomerCaptureSession = async (token: string) =>
  prisma.$transaction(async (tx) => {
    const session = await getSessionByTokenOrThrowTx(tx, token);
    const newerSession = session.status === "EXPIRED"
      ? await findNewerSessionTx(tx, {
          saleId: session.saleId,
          createdAt: session.createdAt,
          excludeSessionId: session.id,
        })
      : null;

    return toSessionState({
      status: session.status,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
      completedAt: session.completedAt,
      isReplaced: Boolean(newerSession),
    });
  });

export const submitPublicSaleCustomerCapture = async (
  token: string,
  input: SubmitSaleCustomerCaptureInput,
) => {
  const firstName = normalizeOptionalText(normalizeNamePart(input.firstName));
  const lastName = normalizeOptionalText(normalizeNamePart(input.lastName));
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);

  if (!firstName) {
    throw new HttpError(400, "firstName is required", "INVALID_CUSTOMER_CAPTURE");
  }

  if (!lastName) {
    throw new HttpError(400, "lastName is required", "INVALID_CUSTOMER_CAPTURE");
  }

  if (!email && !phone) {
    throw new HttpError(
      400,
      "At least one contact method is required",
      "INVALID_CUSTOMER_CAPTURE",
    );
  }

  return prisma.$transaction(async (tx) => {
    const session = await getSessionByTokenOrThrowTx(tx, token);
    await assertSubmittableSessionOrAuditTx(tx, session);

    const { customer, matchType } = await findOrCreateCustomerTx(tx, {
      firstName,
      lastName,
      email,
      phone,
    });

    await tx.sale.update({
      where: { id: session.saleId },
      data: {
        customerId: customer.id,
      },
    });

    const completedAt = new Date();
    const updatedSession = await tx.saleCustomerCaptureSession.update({
      where: { id: session.id },
      data: {
        status: "COMPLETED",
        matchType: matchType.toUpperCase() as "EMAIL" | "PHONE" | "CREATED",
        completedAt,
        submittedFirstName: firstName,
        submittedLastName: lastName,
        submittedEmail: email ?? null,
        submittedPhone: phone ?? null,
        emailMarketingConsent: input.emailMarketingConsent ?? false,
        smsMarketingConsent: input.smsMarketingConsent ?? false,
        customerId: customer.id,
      },
      select: {
        status: true,
        expiresAt: true,
        completedAt: true,
      },
    });

    await writeCaptureAuditTx(tx, {
      sessionId: session.id,
      action: "customer_capture.submit_completed",
      metadata: {
        saleId: session.saleId,
        customerId: customer.id,
        matchType,
        emailProvided: Boolean(email),
        phoneProvided: Boolean(phone),
      },
    });

    return {
      ...toSessionState(updatedSession),
      customer: {
        id: customer.id,
        name: getCustomerDisplayName(customer),
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        phone: customer.phone,
      },
      sale: {
        id: session.saleId,
      },
      matchType,
    };
  });
};
