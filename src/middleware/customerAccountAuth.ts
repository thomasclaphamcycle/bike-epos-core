import { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { parseCookieHeader } from "../utils/cookies";
import { HttpError } from "../utils/http";
import {
  CUSTOMER_AUTH_COOKIE_NAME,
  verifyCustomerAuthToken,
} from "../services/customerAuthTokenService";
import type { AuthenticatedCustomerAccount } from "../types/auth";

const toAuthenticatedCustomerAccount = (account: {
  id: string;
  email: string;
  status: "ACTIVE" | "DISABLED";
  lastLoginAt: Date | null;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string | null;
  };
}): AuthenticatedCustomerAccount => ({
  id: account.id,
  customerId: account.customer.id,
  email: account.email,
  firstName: account.customer.firstName,
  lastName: account.customer.lastName,
  phone: account.customer.phone,
  status: account.status,
  lastLoginAt: account.lastLoginAt,
  authSource: "session",
});

export const resolveAuthenticatedCustomerAccount = async (
  req: Request,
): Promise<AuthenticatedCustomerAccount | null> => {
  if (req.customerAccount) {
    return req.customerAccount;
  }

  const cookies = parseCookieHeader(req.header("cookie"));
  const token = cookies[CUSTOMER_AUTH_COOKIE_NAME];
  if (!token) {
    return null;
  }

  const claims = verifyCustomerAuthToken(token);
  if (!claims) {
    return null;
  }

  const account = await prisma.customerAccount.findUnique({
    where: { id: claims.sub },
    select: {
      id: true,
      email: true,
      status: true,
      lastLoginAt: true,
      customer: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
        },
      },
    },
  });

  if (!account || account.status !== "ACTIVE" || account.customer.id !== claims.customerId) {
    return null;
  }

  req.customerAccount = toAuthenticatedCustomerAccount(account);
  return req.customerAccount;
};

export const attachCustomerAccountIfPresent = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    await resolveAuthenticatedCustomerAccount(req);
    next();
  } catch (error) {
    next(error);
  }
};

export const requireCustomerAccountAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    const account = await resolveAuthenticatedCustomerAccount(req);
    if (!account) {
      throw new HttpError(401, "Customer authentication required", "CUSTOMER_AUTH_REQUIRED");
    }
    if (account.status !== "ACTIVE") {
      throw new HttpError(403, "Customer account is disabled", "CUSTOMER_ACCOUNT_DISABLED");
    }
    next();
  } catch (error) {
    next(error);
  }
};

export const getRequestCustomerAccountId = (req: Request) => req.customerAccount?.id;

export const getRequestCustomerId = (req: Request) => req.customerAccount?.customerId;
