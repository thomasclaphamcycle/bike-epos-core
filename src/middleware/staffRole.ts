import { NextFunction, Request, Response } from "express";
import { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { parseCookieHeader } from "../utils/cookies";
import { HttpError } from "../utils/http";
import type { AuditActor } from "../services/auditService";
import {
  AUTH_COOKIE_NAME,
  verifyAuthToken,
} from "../services/authTokenService";
import type { AuthenticatedUser } from "../types/auth";

export type StaffRole = "STAFF" | "MANAGER" | "ADMIN";

const STAFF_ROLE_HEADER = "x-staff-role";
const STAFF_ID_HEADER = "x-staff-id";
const INTERNAL_AUTH_HEADER = "x-internal-auth";

type AuthMode = "real" | "header";

const parseAuthModeOrThrow = (): AuthMode => {
  const raw = (process.env.AUTH_MODE ?? "real").trim().toLowerCase();
  if (raw === "real" || raw === "disabled") {
    return "real";
  }
  if (raw === "header") {
    return "header";
  }
  throw new Error(`Invalid AUTH_MODE "${process.env.AUTH_MODE}". Expected "real" or "header".`);
};

const AUTH_MODE = parseAuthModeOrThrow();
const INTERNAL_AUTH_SHARED_SECRET = process.env.INTERNAL_AUTH_SHARED_SECRET?.trim() || undefined;
const HEADER_AUTH_BYPASS_ALLOWED =
  process.env.NODE_ENV === "test" || process.env.ALLOW_HEADER_AUTH === "1";

if (AUTH_MODE === "header" && process.env.NODE_ENV === "production") {
  throw new Error("Header auth mode is not allowed in production");
}

if (AUTH_MODE === "header" && !HEADER_AUTH_BYPASS_ALLOWED) {
  throw new Error(
    "AUTH_MODE=header requires NODE_ENV=test or ALLOW_HEADER_AUTH=1",
  );
}

const roleRank: Record<StaffRole, number> = {
  STAFF: 1,
  MANAGER: 2,
  ADMIN: 3,
};

const hasHeader = (req: Request, headerName: string) => req.header(headerName) !== undefined;

const hasStaffHeaderAuthInput = (req: Request) =>
  hasHeader(req, STAFF_ROLE_HEADER) ||
  hasHeader(req, STAFF_ID_HEADER) ||
  hasHeader(req, INTERNAL_AUTH_HEADER);

const isStaffRole = (value: string): value is StaffRole =>
  value === "STAFF" || value === "MANAGER" || value === "ADMIN";

const parseRoleHeaderOrThrow = (header: string | undefined): StaffRole => {
  if (!header) {
    return "STAFF";
  }

  const normalized = header.trim().toUpperCase();
  if (!isStaffRole(normalized)) {
    throw new HttpError(
      400,
      "Invalid X-Staff-Role. Expected STAFF, MANAGER, or ADMIN",
      "INVALID_STAFF_ROLE",
    );
  }

  return normalized;
};

const parseStaffIdHeader = (req: Request): string | undefined => {
  const raw = req.header(STAFF_ID_HEADER);
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toHeaderUserName = (actorId: string): string =>
  `header_${Buffer.from(actorId, "utf8").toString("hex")}`;

const toStaffRole = (role: UserRole): StaffRole => {
  switch (role) {
    case "STAFF":
      return "STAFF";
    case "MANAGER":
      return "MANAGER";
    case "ADMIN":
      return "ADMIN";
  }
};

const assertHeaderAuthSecretIfConfigured = (req: Request) => {
  if (!INTERNAL_AUTH_SHARED_SECRET) {
    return;
  }

  const provided = req.header(INTERNAL_AUTH_HEADER);
  if (provided !== INTERNAL_AUTH_SHARED_SECRET) {
    throw new HttpError(
      401,
      "Missing or invalid X-Internal-Auth header",
      "INVALID_INTERNAL_AUTH",
    );
  }
};

const toAuthenticatedUser = (
  user: {
    id: string;
    username: string;
    email: string | null;
    name: string | null;
    role: UserRole;
    isActive: boolean;
  },
  authSource: "session" | "header",
): AuthenticatedUser => ({
  id: user.id,
  username: user.username,
  email: user.email,
  name: user.name,
  role: user.role,
  isActive: user.isActive,
  authSource,
});

const resolveUserFromSession = async (req: Request): Promise<AuthenticatedUser | null> => {
  const cookies = parseCookieHeader(req.header("cookie"));
  const token = cookies[AUTH_COOKIE_NAME];
  if (!token) {
    return null;
  }

  const claims = verifyAuthToken(token);
  if (!claims) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: {
      id: true,
      username: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
    },
  });

  if (!user || !user.isActive) {
    return null;
  }

  return toAuthenticatedUser(user, "session");
};

const resolveHeaderFallbackUser = async (req: Request): Promise<AuthenticatedUser | null> => {
  if (!hasStaffHeaderAuthInput(req)) {
    return null;
  }

  if (process.env.NODE_ENV === "production") {
    throw new HttpError(
      400,
      "Header-based auth is disabled in production",
      "HEADER_AUTH_DISABLED",
    );
  }

  const modeAllowsHeader = AUTH_MODE === "header" || HEADER_AUTH_BYPASS_ALLOWED;
  if (!modeAllowsHeader) {
    return null;
  }

  assertHeaderAuthSecretIfConfigured(req);

  const requestedRole = parseRoleHeaderOrThrow(req.header(STAFF_ROLE_HEADER) ?? undefined);
  const actorId = parseStaffIdHeader(req);

  if (!actorId) {
    return {
      id: "__header_anonymous__",
      username: "header_anonymous",
      email: null,
      name: "Header Actor",
      role: requestedRole,
      isActive: true,
      authSource: "header",
    };
  }

  const user = await prisma.user.upsert({
    where: { id: actorId },
    create: {
      id: actorId,
      username: toHeaderUserName(actorId),
      name: actorId,
      passwordHash: "__header_actor__",
      role: requestedRole,
      isActive: true,
    },
    // Never mutate existing users from auth headers.
    update: {},
    select: {
      id: true,
      username: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
    },
  });

  return toAuthenticatedUser(user, "header");
};

const resolveAuthenticatedUser = async (req: Request): Promise<AuthenticatedUser | null> => {
  if (req.user) {
    return req.user;
  }

  const sessionUser = await resolveUserFromSession(req);
  if (sessionUser) {
    req.user = sessionUser;
    return sessionUser;
  }

  const headerUser = await resolveHeaderFallbackUser(req);
  if (headerUser) {
    req.user = headerUser;
    return headerUser;
  }

  return null;
};

const assertUserIsActive = (user: AuthenticatedUser) => {
  if (!user.isActive) {
    throw new HttpError(403, "User account is disabled", "USER_DISABLED");
  }
};

const maybeRedirectHtmlToLogin = (req: Request, res: Response) => {
  const accepts = req.header("accept") || "";
  const wantsHtml = accepts.includes("text/html");
  const isApiRoute = req.originalUrl.startsWith("/api/");
  if (req.method === "GET" && wantsHtml && !isApiRoute) {
    const nextPath = encodeURIComponent(req.originalUrl || "/");
    res.redirect(`/login?next=${nextPath}`);
    return true;
  }
  return false;
};

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await resolveAuthenticatedUser(req);
    if (!user) {
      if (maybeRedirectHtmlToLogin(req, res)) {
        return;
      }
      throw new HttpError(401, "Authentication required", "UNAUTHORIZED");
    }
    assertUserIsActive(user);
    next();
  } catch (error) {
    next(error);
  }
};

export const getRequestStaffRole = (req: Request): StaffRole => {
  if (!req.user) {
    throw new HttpError(401, "Authentication required", "UNAUTHORIZED");
  }
  return toStaffRole(req.user.role);
};

export const getRequestStaffActorId = (req: Request): string | undefined => {
  if (!req.user) {
    return undefined;
  }

  if (req.user.authSource === "header" && req.user.id === "__header_anonymous__") {
    return undefined;
  }

  return req.user.id;
};

export const getRequestAuditActor = (req: Request): AuditActor => {
  if (!req.user) {
    return {};
  }

  const actorId = getRequestStaffActorId(req);
  return {
    role: toStaffRole(req.user.role),
    ...(actorId ? { actorId } : {}),
  };
};

export const assertRoleAtLeast = (req: Request, minimumRole: StaffRole) => {
  if (!req.user) {
    throw new HttpError(401, "Authentication required", "UNAUTHORIZED");
  }

  const actual = toStaffRole(req.user.role);
  if (roleRank[actual] < roleRank[minimumRole]) {
    throw new HttpError(403, `${minimumRole} role required`, "INSUFFICIENT_ROLE");
  }
  return actual;
};

export const requireRoleAtLeast = (minimumRole: StaffRole) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await resolveAuthenticatedUser(req);
      if (!user) {
        if (maybeRedirectHtmlToLogin(req, res)) {
          return;
        }
        throw new HttpError(401, "Authentication required", "UNAUTHORIZED");
      }
      assertUserIsActive(user);
      assertRoleAtLeast(req, minimumRole);
      next();
    } catch (error) {
      next(error);
    }
  };
};

export const enforceAuthMode = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    // Best-effort user resolution for non-protected endpoints such as /api/auth/me.
    await resolveAuthenticatedUser(req);
    next();
  } catch (error) {
    next(error);
  }
};
