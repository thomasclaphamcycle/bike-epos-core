import { Request, Response } from "express";
import { logOperationalEvent } from "../lib/operationalLogger";
import { HttpError } from "../utils/http";
import {
  authenticateWithPin,
  authenticateWithEmailPassword,
  bootstrapInitialAdmin,
  changeCurrentUserPin,
  getPublicUserById,
  getPinStatus,
  listActiveLoginUsers,
  setCurrentUserPin,
} from "../services/authService";
import {
  AUTH_COOKIE_NAME,
  getAuthCookieMaxAgeMs,
  issueAuthToken,
} from "../services/authTokenService";
import { getRequestAuditActor, getRequestStaffActorId } from "../middleware/staffRole";
import {
  clearPinLoginFailures,
  getPinLoginClientKey,
  recordPinLoginFailure,
} from "../middleware/pinLoginRateLimit";

const authCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: getAuthCookieMaxAgeMs(),
});

const clearAuthCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
});

const assertBootstrapAllowed = () => {
  if (
    process.env.NODE_ENV === "production"
    && process.env.ALLOW_INITIAL_ADMIN_BOOTSTRAP !== "1"
  ) {
    throw new HttpError(
      403,
      "Bootstrap disabled in production unless ALLOW_INITIAL_ADMIN_BOOTSTRAP=1",
      "BOOTSTRAP_DISABLED",
    );
  }
};

export const loginHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { email?: unknown; password?: unknown };

  if (body.email !== undefined && typeof body.email !== "string") {
    throw new HttpError(400, "email must be a string", "INVALID_LOGIN");
  }
  if (body.password !== undefined && typeof body.password !== "string") {
    throw new HttpError(400, "password must be a string", "INVALID_LOGIN");
  }

  const user = await authenticateWithEmailPassword(body.email, body.password);
  const token = issueAuthToken({
    userId: user.id,
    role: user.role,
  });

  res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions());
  res.status(200).json({
    user,
  });
};

export const pinLoginHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { userId?: unknown; pin?: unknown };

  if (body.userId !== undefined && typeof body.userId !== "string") {
    throw new HttpError(400, "userId must be a string", "INVALID_PIN_LOGIN");
  }
  if (body.pin !== undefined && typeof body.pin !== "string") {
    throw new HttpError(400, "pin must be a string", "INVALID_PIN_LOGIN");
  }

  const clientKey = getPinLoginClientKey(req, body.userId);

  try {
    const user = await authenticateWithPin(body.userId, body.pin);
    clearPinLoginFailures(clientKey);

    const token = issueAuthToken({
      userId: user.id,
      role: user.role,
    });

    res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions());
    res.status(200).json({ user });
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      recordPinLoginFailure(clientKey);
      throw new HttpError(401, "Invalid login", "INVALID_CREDENTIALS");
    }
    throw error;
  }
};

export const activeUsersHandler = async (_req: Request, res: Response) => {
  const users = await listActiveLoginUsers();
  res.json({ users });
};

export const logoutHandler = async (_req: Request, res: Response) => {
  const actorId = getRequestStaffActorId(_req);
  logOperationalEvent("auth.logout", {
    entityId: actorId ?? null,
    resultStatus: "succeeded",
    userId: actorId ?? null,
  });
  res.clearCookie(AUTH_COOKIE_NAME, clearAuthCookieOptions());
  res.status(204).send();
};

export const meHandler = async (req: Request, res: Response) => {
  const actorId = getRequestStaffActorId(req);
  if (!actorId) {
    throw new HttpError(401, "Authentication required", "UNAUTHORIZED");
  }

  const user = await getPublicUserById(actorId);
  if (!user || !user.isActive) {
    throw new HttpError(401, "Authentication required", "UNAUTHORIZED");
  }

  res.json({ user });
};

export const pinStatusHandler = async (req: Request, res: Response) => {
  const actorId = getRequestStaffActorId(req);
  if (!actorId) {
    throw new HttpError(401, "Authentication required", "UNAUTHORIZED");
  }

  const result = await getPinStatus(actorId);
  res.json(result);
};

export const setPinHandler = async (req: Request, res: Response) => {
  const actorId = getRequestStaffActorId(req);
  if (!actorId) {
    throw new HttpError(401, "Authentication required", "UNAUTHORIZED");
  }

  const body = (req.body ?? {}) as { pin?: unknown };
  if (body.pin !== undefined && typeof body.pin !== "string") {
    throw new HttpError(400, "pin must be a string", "INVALID_PIN");
  }

  const result = await setCurrentUserPin(actorId, body.pin, getRequestAuditActor(req));
  res.status(201).json(result);
};

export const changePinHandler = async (req: Request, res: Response) => {
  const actorId = getRequestStaffActorId(req);
  if (!actorId) {
    throw new HttpError(401, "Authentication required", "UNAUTHORIZED");
  }

  const body = (req.body ?? {}) as { currentPin?: unknown; nextPin?: unknown };
  if (body.currentPin !== undefined && typeof body.currentPin !== "string") {
    throw new HttpError(400, "currentPin must be a string", "INVALID_PIN");
  }
  if (body.nextPin !== undefined && typeof body.nextPin !== "string") {
    throw new HttpError(400, "nextPin must be a string", "INVALID_PIN");
  }

  const result = await changeCurrentUserPin(
    actorId,
    body.currentPin,
    body.nextPin,
    getRequestAuditActor(req),
  );
  res.json(result);
};

export const bootstrapHandler = async (req: Request, res: Response) => {
  assertBootstrapAllowed();

  const body = (req.body ?? {}) as {
    name?: unknown;
    email?: unknown;
    password?: unknown;
    username?: unknown;
  };

  if (body.name !== undefined && typeof body.name !== "string") {
    throw new HttpError(400, "name must be a string", "INVALID_BOOTSTRAP_INPUT");
  }
  if (body.email !== undefined && typeof body.email !== "string") {
    throw new HttpError(400, "email must be a string", "INVALID_BOOTSTRAP_INPUT");
  }
  if (body.password !== undefined && typeof body.password !== "string") {
    throw new HttpError(400, "password must be a string", "INVALID_BOOTSTRAP_INPUT");
  }
  if (body.username !== undefined && typeof body.username !== "string") {
    throw new HttpError(400, "username must be a string", "INVALID_BOOTSTRAP_INPUT");
  }

  const fallbackName =
    typeof body.username === "string" ? body.username : typeof body.email === "string" ? body.email : "";
  const fallbackEmail =
    typeof body.email === "string"
      ? body.email
      : typeof body.username === "string"
        ? `${body.username.toLowerCase()}@local.invalid`
        : undefined;

  const created = await bootstrapInitialAdmin({
    name: typeof body.name === "string" ? body.name : fallbackName,
    email: fallbackEmail,
    password: typeof body.password === "string" ? body.password : undefined,
  });

  res.status(201).json(created);
};
