import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { getCustomerDisplayName, normalizeNamePart } from "../utils/customerName";

const CUSTOMER_CAPTURE_SESSION_TTL_MINUTES = 15;

type CaptureSessionStatus = "ACTIVE" | "COMPLETED" | "EXPIRED";
type CustomerMatchType = "email" | "phone" | "created";

type CreateSaleCustomerCaptureSessionResult = {
  session: {
    id: string;
    saleId: string;
    token: string;
    status: CaptureSessionStatus;
    expiresAt: Date;
    createdAt: Date;
    publicPath: string;
  };
};

type PublicSaleCustomerCaptureSessionState = {
  session: {
    status: CaptureSessionStatus;
    expiresAt: Date;
    completedAt: Date | null;
  };
};

type SubmitSaleCustomerCaptureInput = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  emailMarketingConsent?: boolean;
  smsMarketingConsent?: boolean;
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

const createSecureToken = () => crypto.randomBytes(24).toString("base64url");

const toPublicSessionState = (session: {
  status: CaptureSessionStatus;
  expiresAt: Date;
  completedAt: Date | null;
}): PublicSaleCustomerCaptureSessionState => ({
  session: {
    status: session.status,
    expiresAt: session.expiresAt,
    completedAt: session.completedAt,
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

const getSessionByTokenOrThrowTx = async (
  tx: Prisma.TransactionClient,
  token: string,
) => {
  const session = await tx.saleCustomerCaptureSession.findUnique({
    where: { token },
    select: {
      id: true,
      saleId: true,
      token: true,
      status: true,
      expiresAt: true,
      completedAt: true,
      customerId: true,
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

const assertSubmittableSession = (session: {
  status: CaptureSessionStatus;
  sale: { completedAt: Date | null };
}) => {
  if (session.status === "COMPLETED") {
    throw new HttpError(
      409,
      "This customer capture link has already been used",
      "CUSTOMER_CAPTURE_COMPLETED",
    );
  }

  if (session.status === "EXPIRED") {
    throw new HttpError(
      410,
      "This customer capture link has expired",
      "CUSTOMER_CAPTURE_EXPIRED",
    );
  }

  if (session.sale.completedAt) {
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
      return emailMatch;
    }
  }

  if (input.phone) {
    const phoneMatch = await tx.customer.findFirst({
      where: { phone: input.phone },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    });
    if (phoneMatch) {
      return phoneMatch;
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
    const matchType: CustomerMatchType =
      input.email && existing.email === input.email ? "email" : "phone";
    return { customer: existing, matchType };
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

export const createSaleCustomerCaptureSession = async (
  saleId: string,
): Promise<CreateSaleCustomerCaptureSessionResult> => {
  if (!isUuid(saleId)) {
    throw new HttpError(400, "Invalid sale id", "INVALID_SALE_ID");
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
      throw new HttpError(
        409,
        "Customer capture sessions can only be created for active sales",
        "SALE_ALREADY_COMPLETED",
      );
    }

    await tx.saleCustomerCaptureSession.updateMany({
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
        expiresAt: true,
        createdAt: true,
      },
    });

    return {
      session: {
        ...created,
        publicPath: `/customer-capture/${encodeURIComponent(created.token)}`,
      },
    };
  });
};

export const getPublicSaleCustomerCaptureSession = async (
  token: string,
): Promise<PublicSaleCustomerCaptureSessionState> =>
  prisma.$transaction(async (tx) => {
    const session = await getSessionByTokenOrThrowTx(tx, token);
    return toPublicSessionState(session);
  });

export const submitPublicSaleCustomerCapture = async (
  token: string,
  input: SubmitSaleCustomerCaptureInput,
) => {
  const firstName = normalizeOptionalText(normalizeNamePart(input.firstName));
  const lastName = normalizeOptionalText(normalizeNamePart(input.lastName));
  const email = normalizeEmail(input.email);
  const phone = normalizeOptionalText(input.phone);

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
    assertSubmittableSession(session);

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

    return {
      session: {
        status: updatedSession.status,
        expiresAt: updatedSession.expiresAt,
        completedAt: updatedSession.completedAt,
      },
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
