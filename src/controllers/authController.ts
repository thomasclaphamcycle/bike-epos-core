import { Request, Response } from "express";
import { HttpError } from "../utils/http";
import {
  authenticateWithEmailPassword,
  bootstrapInitialAdmin,
  getPublicUserById,
} from "../services/authService";
import {
  AUTH_COOKIE_NAME,
  getAuthCookieMaxAgeMs,
  issueAuthToken,
} from "../services/authTokenService";
import { getRequestStaffActorId } from "../middleware/staffRole";

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

export const logoutHandler = async (_req: Request, res: Response) => {
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

export const bootstrapHandler = async (req: Request, res: Response) => {
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
