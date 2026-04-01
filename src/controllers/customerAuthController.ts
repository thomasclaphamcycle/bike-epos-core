import { Request, Response } from "express";
import { getRequestCustomerAccountId, resolveAuthenticatedCustomerAccount } from "../middleware/customerAccountAuth";
import {
  getCustomerAuthCookieMaxAgeMs,
  issueCustomerAuthToken,
  CUSTOMER_AUTH_COOKIE_NAME,
} from "../services/customerAuthTokenService";
import {
  consumeCustomerAccessLink,
  getCustomerAccountDashboard,
  getCustomerAccountSession,
  requestCustomerAccessLink,
} from "../services/customerAccountService";

const authCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: getCustomerAuthCookieMaxAgeMs(),
});

const clearAuthCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
});

export const requestCustomerAccessLinkHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    email?: unknown;
    returnTo?: unknown;
  };

  const result = await requestCustomerAccessLink(body);
  res.status(200).json(result);
};

export const consumeCustomerAccessLinkHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    token?: unknown;
  };

  const result = await consumeCustomerAccessLink(body.token);
  const token = issueCustomerAuthToken({
    customerAccountId: result.account.id,
    customerId: result.account.customerId,
    email: result.account.email,
  });

  res.cookie(CUSTOMER_AUTH_COOKIE_NAME, token, authCookieOptions());
  res.status(200).json({
    authenticated: true,
    redirectPath: result.redirectPath,
  });
};

export const customerSessionHandler = async (req: Request, res: Response) => {
  const account = await resolveAuthenticatedCustomerAccount(req);
  if (!account) {
    res.json({ authenticated: false });
    return;
  }

  const session = await getCustomerAccountSession(account.id);
  res.json(session);
};

export const customerLogoutHandler = async (_req: Request, res: Response) => {
  res.clearCookie(CUSTOMER_AUTH_COOKIE_NAME, clearAuthCookieOptions());
  res.status(204).send();
};

export const customerDashboardHandler = async (req: Request, res: Response) => {
  const accountId = getRequestCustomerAccountId(req);
  if (!accountId) {
    res.status(401).json({
      error: {
        code: "CUSTOMER_AUTH_REQUIRED",
        message: "Customer authentication required",
      },
    });
    return;
  }

  const dashboard = await getCustomerAccountDashboard(accountId);
  res.json(dashboard);
};
