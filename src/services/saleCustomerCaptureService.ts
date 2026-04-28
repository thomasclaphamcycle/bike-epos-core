import crypto from "node:crypto";
import { BasketStatus, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { getCustomerDisplayName, normalizeNamePart } from "../utils/customerName";
import { createAuditEvent, createAuditEventTx, type AuditActor } from "./auditService";
import {
  normalizeReceiptWorkstationKey,
  toReceiptWorkstationSlug,
} from "./receiptPrintStationService";

const CUSTOMER_CAPTURE_SESSION_TTL_MINUTES = 15;

type CaptureSessionStatus = "ACTIVE" | "COMPLETED" | "EXPIRED";
type CustomerMatchType = "email" | "phone" | "created";
type CaptureOwnerType = "sale" | "basket";

type SubmitSaleCustomerCaptureInput = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  emailMarketingConsent?: boolean;
  smsMarketingConsent?: boolean;
};

type PreviewSaleCustomerCaptureMatchInput = {
  email?: string;
  phone?: string;
};

type CaptureSessionRecord = {
  id: string;
  saleId: string | null;
  basketId: string | null;
  stationKey?: string | null;
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

type SessionOwnerWhereInput = {
  saleId?: string | null;
  basketId?: string | null;
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

const toPublicEntryPath = (stationKey: string) => (
  `/customer-capture/entry/${encodeURIComponent(toReceiptWorkstationSlug(stationKey) ?? stationKey)}`
);

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

const getOwnerType = (owner: SessionOwnerWhereInput): CaptureOwnerType => (
  owner.saleId ? "sale" : "basket"
);

const getOwnerMetadata = (owner: SessionOwnerWhereInput) => (
  owner.saleId ? { saleId: owner.saleId } : { basketId: owner.basketId }
);

const buildOwnerWhere = (owner: SessionOwnerWhereInput) => {
  if (owner.saleId) {
    return { saleId: owner.saleId };
  }
  if (owner.basketId) {
    return { basketId: owner.basketId };
  }

  throw new HttpError(500, "Customer capture session owner is missing", "INVALID_CUSTOMER_CAPTURE_OWNER");
};

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

const toStationPayload = (stationKey: string | null | undefined) => {
  const normalizedStationKey = normalizeReceiptWorkstationKey(stationKey);
  if (!normalizedStationKey) {
    return null;
  }

  return {
    key: normalizedStationKey,
    entryPath: toPublicEntryPath(normalizedStationKey),
  };
};

const toSessionPayload = (session: CaptureSessionRecord) => ({
  id: session.id,
  saleId: session.saleId ?? null,
  basketId: session.basketId ?? null,
  station: toStationPayload(session.stationKey),
  ownerType: getOwnerType(session),
  token: session.token,
  status: session.status,
  expiresAt: session.expiresAt,
  createdAt: session.createdAt,
  completedAt: session.completedAt ?? null,
  publicPath: toPublicPath(session.token),
  outcome: toSessionOutcomePayload(session),
});

const toStationEntrySessionPayload = (session: CaptureSessionRecord) => ({
  token: session.token,
  ownerType: getOwnerType(session),
  publicPath: toPublicPath(session.token),
  expiresAt: session.expiresAt,
  createdAt: session.createdAt,
});

const toSessionState = (session: {
  saleId?: string | null;
  basketId?: string | null;
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
    ownerType: getOwnerType(session),
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
      basketId: true,
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
      basket: {
        select: {
          id: true,
          status: true,
          sale: {
            select: {
              id: true,
              completedAt: true,
            },
          },
        },
      },
    },
  });

  if (!session) {
    throw new HttpError(404, "Customer capture session not found", "CUSTOMER_CAPTURE_NOT_FOUND");
  }

  if (!session.saleId && !session.basketId) {
    throw new HttpError(500, "Customer capture session owner is missing", "INVALID_CUSTOMER_CAPTURE_OWNER");
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
  input: SessionOwnerWhereInput & {
    createdAt: Date;
    excludeSessionId: string;
  },
) =>
  tx.saleCustomerCaptureSession.findFirst({
    where: {
      ...buildOwnerWhere(input),
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
    saleId: string | null;
    basketId: string | null;
    status: CaptureSessionStatus;
    createdAt: Date;
    sale: { completedAt: Date | null } | null;
    basket: {
      status: BasketStatus;
      sale: { id: string; completedAt: Date | null } | null;
    } | null;
  },
) => {
  const ownerMetadata = getOwnerMetadata(session);

  if (session.status === "COMPLETED") {
    await writeCaptureAudit({
      sessionId: session.id,
      action: "customer_capture.submit_rejected",
      metadata: {
        ...ownerMetadata,
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
      basketId: session.basketId,
      createdAt: session.createdAt,
      excludeSessionId: session.id,
    });

    await writeCaptureAudit({
      sessionId: session.id,
      action: "customer_capture.submit_rejected",
      metadata: {
        ...ownerMetadata,
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

  if (session.sale?.completedAt || session.basket?.sale?.completedAt) {
    await writeCaptureAudit({
      sessionId: session.id,
      action: "customer_capture.submit_rejected",
      metadata: {
        ...ownerMetadata,
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
  const matches = await findExistingCustomerMatchesTx(tx, input);
  if (matches.emailMatch) {
    return { customer: matches.emailMatch, matchType: "email" as const };
  }

  if (matches.phoneMatch) {
    return { customer: matches.phoneMatch, matchType: "phone" as const };
  }

  return null;
};

const findExistingCustomerMatchesTx = async (
  tx: Prisma.TransactionClient,
  input: {
    email?: string;
    phone?: string;
  },
) => {
  const [emailMatch, phoneMatch] = await Promise.all([
    input.email
      ? tx.customer.findUnique({
          where: { email: input.email },
        })
      : Promise.resolve(null),
    input.phone
      ? tx.customer.findFirst({
          where: { phone: input.phone },
          orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        })
      : Promise.resolve(null),
  ]);

  return {
    emailMatch,
    phoneMatch,
  };
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

const selectSessionForPayload = {
  id: true,
  saleId: true,
  basketId: true,
  stationKey: true,
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
} as const;

const getCurrentCaptureSessionByOwner = async (
  owner: SessionOwnerWhereInput,
  validate: (tx: Prisma.TransactionClient) => Promise<void>,
) =>
  prisma.$transaction(async (tx) => {
    await validate(tx);

    const session = await tx.saleCustomerCaptureSession.findFirst({
      where: buildOwnerWhere(owner),
      orderBy: [{ createdAt: "desc" }],
      select: selectSessionForPayload,
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

const createCaptureSessionByOwner = async (
  owner: SessionOwnerWhereInput,
  validate: (tx: Prisma.TransactionClient) => Promise<void>,
  stationKey?: string | null,
  auditActor?: AuditActor,
) =>
  prisma.$transaction(async (tx) => {
    await validate(tx);
    const normalizedStationKey = stationKey === undefined
      ? null
      : normalizeReceiptWorkstationKey(stationKey);
    if (stationKey !== undefined && !normalizedStationKey) {
      throw new HttpError(
        400,
        "Choose a valid customer capture station",
        "INVALID_CUSTOMER_CAPTURE_STATION",
      );
    }

    const expiredActiveSessions = await tx.saleCustomerCaptureSession.updateMany({
      where: {
        ...buildOwnerWhere(owner),
        status: "ACTIVE",
      },
      data: {
        status: "EXPIRED",
      },
    });

    const created = await tx.saleCustomerCaptureSession.create({
      data: {
        ...(owner.saleId ? { saleId: owner.saleId } : {}),
        ...(owner.basketId ? { basketId: owner.basketId } : {}),
        stationKey: normalizedStationKey,
        token: createSecureToken(),
        expiresAt: new Date(Date.now() + CUSTOMER_CAPTURE_SESSION_TTL_MINUTES * 60 * 1000),
      },
      select: selectSessionForPayload,
    });

    await writeCaptureAuditTx(
      tx,
      {
        sessionId: created.id,
        action: "customer_capture.session_created",
        metadata: {
          ...getOwnerMetadata(owner),
          expiresAt: created.expiresAt.toISOString(),
          ...(normalizedStationKey ? { stationKey: normalizedStationKey } : {}),
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
            ...getOwnerMetadata(owner),
            replacedActiveSessionCount: expiredActiveSessions.count,
            ...(normalizedStationKey ? { stationKey: normalizedStationKey } : {}),
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

export const getCurrentSaleCustomerCaptureSession = async (saleId: string) => {
  if (!isUuid(saleId)) {
    throw new HttpError(400, "Invalid sale id", "INVALID_SALE_ID");
  }

  return getCurrentCaptureSessionByOwner({ saleId }, async (tx) => {
    const sale = await tx.sale.findUnique({
      where: { id: saleId },
      select: { id: true },
    });

    if (!sale) {
      throw new HttpError(404, "Sale not found", "SALE_NOT_FOUND");
    }
  });
};

export const createSaleCustomerCaptureSession = async (
  saleId: string,
  stationKey?: string | null,
  auditActor?: AuditActor,
) => {
  if (!isUuid(saleId)) {
    throw new HttpError(400, "Invalid sale id", "INVALID_SALE_ID");
  }

  return createCaptureSessionByOwner({ saleId }, async (tx) => {
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
  }, stationKey, auditActor);
};

export const getCurrentBasketCustomerCaptureSession = async (basketId: string) => {
  if (!isUuid(basketId)) {
    throw new HttpError(400, "Invalid basket id", "INVALID_BASKET_ID");
  }

  return getCurrentCaptureSessionByOwner({ basketId }, async (tx) => {
    const basket = await tx.basket.findUnique({
      where: { id: basketId },
      select: { id: true },
    });

    if (!basket) {
      throw new HttpError(404, "Basket not found", "BASKET_NOT_FOUND");
    }
  });
};

export const createBasketCustomerCaptureSession = async (
  basketId: string,
  stationKey?: string | null,
  auditActor?: AuditActor,
) => {
  if (!isUuid(basketId)) {
    throw new HttpError(400, "Invalid basket id", "INVALID_BASKET_ID");
  }

  return createCaptureSessionByOwner({ basketId }, async (tx) => {
    const basket = await tx.basket.findUnique({
      where: { id: basketId },
      select: {
        id: true,
        status: true,
        customerId: true,
      },
    });

    if (!basket) {
      throw new HttpError(404, "Basket not found", "BASKET_NOT_FOUND");
    }

    if (basket.status !== BasketStatus.OPEN) {
      throw new HttpError(
        409,
        "Customer capture sessions can only be created for open baskets",
        "BASKET_NOT_OPEN",
      );
    }

    if (basket.customerId) {
      throw new HttpError(
        409,
        "This basket already has a customer attached",
        "BASKET_CUSTOMER_ALREADY_ATTACHED",
      );
    }
  }, stationKey, auditActor);
};

export const getPublicCustomerCaptureStationEntry = async (station: string) =>
  prisma.$transaction(async (tx) => {
    const normalizedStationKey = normalizeReceiptWorkstationKey(station);
    if (!normalizedStationKey) {
      throw new HttpError(
        404,
        "This customer tap point is not configured",
        "CUSTOMER_CAPTURE_STATION_NOT_FOUND",
      );
    }

    const session = await tx.saleCustomerCaptureSession.findFirst({
      where: {
        stationKey: normalizedStationKey,
      },
      orderBy: [{ createdAt: "desc" }],
      select: selectSessionForPayload,
    });

    if (!session) {
      return {
        station: toStationPayload(normalizedStationKey),
        session: null,
      };
    }

    const normalizedSession = await expireSessionIfNeededTx(tx, session);
    if (normalizedSession.status !== "ACTIVE") {
      return {
        station: toStationPayload(normalizedStationKey),
        session: null,
      };
    }

    return {
      station: toStationPayload(normalizedStationKey),
      session: toStationEntrySessionPayload({
        ...session,
        status: normalizedSession.status,
        expiresAt: normalizedSession.expiresAt,
        completedAt: normalizedSession.completedAt,
      }),
    };
  });

export const getPublicSaleCustomerCaptureSession = async (token: string) =>
  prisma.$transaction(async (tx) => {
    const session = await getSessionByTokenOrThrowTx(tx, token);
    const newerSession = session.status === "EXPIRED"
      ? await findNewerSessionTx(tx, {
          saleId: session.saleId,
          basketId: session.basketId,
          createdAt: session.createdAt,
          excludeSessionId: session.id,
        })
      : null;

    return toSessionState({
      saleId: session.saleId,
      basketId: session.basketId,
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

    if (session.saleId) {
      await tx.sale.update({
        where: { id: session.saleId },
        data: {
          customerId: customer.id,
        },
      });
    }

    if (session.basketId) {
      await tx.basket.update({
        where: { id: session.basketId },
        data: {
          customerId: customer.id,
        },
      });

      if (session.basket?.sale?.id && !session.basket.sale.completedAt) {
        await tx.sale.update({
          where: { id: session.basket.sale.id },
          data: {
            customerId: customer.id,
          },
        });
      }
    }

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
        saleId: true,
        basketId: true,
        status: true,
        expiresAt: true,
        completedAt: true,
      },
    });

    await writeCaptureAuditTx(tx, {
      sessionId: session.id,
      action: "customer_capture.submit_completed",
      metadata: {
        ...getOwnerMetadata(session),
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
      sale: updatedSession.saleId
        ? {
            id: updatedSession.saleId,
          }
        : null,
      basket: updatedSession.basketId
        ? {
            id: updatedSession.basketId,
          }
        : null,
      matchType,
    };
  });
};

export const previewPublicSaleCustomerCaptureMatch = async (
  token: string,
  input: PreviewSaleCustomerCaptureMatchInput,
) => {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);

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

    const matches = await findExistingCustomerMatchesTx(tx, {
      email,
      phone,
    });
    const emailMatched = Boolean(matches.emailMatch);
    const phoneMatched = Boolean(matches.phoneMatch);
    const conflictingMatch = Boolean(
      matches.emailMatch
      && matches.phoneMatch
      && matches.emailMatch.id !== matches.phoneMatch.id,
    );

    const matchType: CustomerMatchType = emailMatched
      ? "email"
      : phoneMatched
        ? "phone"
        : "created";

    return {
      preview: {
        matchType,
        willUseExistingCustomer: matchType !== "created",
        existingDetailsRetained: matchType !== "created",
        emailProvided: Boolean(email),
        phoneProvided: Boolean(phone),
        emailMatched,
        phoneMatched,
        conflictingMatch,
        precedence: ["email", "phone"] as const,
      },
    };
  });
};
