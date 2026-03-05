import { NextFunction, Request, Response } from "express";
import { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";
import type { AuditActor } from "../services/auditService";

export type StaffRole = "STAFF" | "MANAGER" | "ADMIN";

const STAFF_ROLE_HEADER = "x-staff-role";
const STAFF_ID_HEADER = "x-staff-id";
const INTERNAL_AUTH_HEADER = "x-internal-auth";

type AuthMode = "header" | "real";

const parseAuthModeOrThrow = (): AuthMode => {
  const raw = (process.env.AUTH_MODE ?? "header").trim().toLowerCase();
  if (raw === "header") {
    return "header";
  }
  if (raw === "real" || raw === "disabled") {
    return "real";
  }
  throw new Error(`Invalid AUTH_MODE "${process.env.AUTH_MODE}". Expected "header" or "real".`);
};

const AUTH_MODE: AuthMode = parseAuthModeOrThrow();
const INTERNAL_AUTH_SHARED_SECRET = process.env.INTERNAL_AUTH_SHARED_SECRET?.trim() || undefined;

if (AUTH_MODE === "header" && process.env.NODE_ENV === "production") {
  throw new Error("AUTH_MODE=header is not allowed when NODE_ENV=production");
}

const roleRank: Record<StaffRole, number> = {
  STAFF: 1,
  MANAGER: 2,
  ADMIN: 3,
};

const isStaffRole = (value: string): value is StaffRole =>
  value === "STAFF" || value === "MANAGER" || value === "ADMIN";

const hasHeader = (req: Request, headerName: string) =>
  req.header(headerName) !== undefined;

const hasStaffHeaderAuthInput = (req: Request) =>
  hasHeader(req, STAFF_ROLE_HEADER) ||
  hasHeader(req, STAFF_ID_HEADER) ||
  hasHeader(req, INTERNAL_AUTH_HEADER);

const rejectHeaderAuthInputWhenDisabled = (req: Request) => {
  if (AUTH_MODE === "header") {
    return;
  }
  if (hasStaffHeaderAuthInput(req)) {
    throw new HttpError(
      400,
      "Header-based auth is disabled for this deployment",
      "HEADER_AUTH_DISABLED",
    );
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

const assertHeaderAuthModeForProtectedRoute = (req: Request) => {
  if (AUTH_MODE !== "header") {
    rejectHeaderAuthInputWhenDisabled(req);
    throw new HttpError(
      503,
      "Staff auth is unavailable in this AUTH_MODE",
      "AUTH_MODE_NOT_IMPLEMENTED",
    );
  }
  assertHeaderAuthSecretIfConfigured(req);
};

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

const toPersistedUserRole = (role: StaffRole): UserRole => {
  switch (role) {
    case "STAFF":
      return "STAFF";
    case "MANAGER":
      // UserRole does not have MANAGER; persist as least-privileged role.
      return "STAFF";
    case "ADMIN":
      return "ADMIN";
  }
};

const toHeaderUserName = (actorId: string): string =>
  `header_${Buffer.from(actorId, "utf8").toString("hex")}`;

const ensureHeaderActorExists = async (
  actorId: string,
  role: StaffRole,
) => {
  const persistedRole = toPersistedUserRole(role);
  await prisma.user.upsert({
    where: { id: actorId },
    create: {
      id: actorId,
      username: toHeaderUserName(actorId),
      name: actorId,
      passwordHash: "__header_actor__",
      role: persistedRole,
    },
    // Never mutate an existing user from request headers.
    update: {},
  });
};

export const getRequestStaffRole = (req: Request): StaffRole =>
  AUTH_MODE === "header"
    ? parseRoleHeaderOrThrow(req.header(STAFF_ROLE_HEADER) ?? undefined)
    : (() => {
        rejectHeaderAuthInputWhenDisabled(req);
        throw new HttpError(
          503,
          "Staff auth is unavailable in this AUTH_MODE",
          "AUTH_MODE_NOT_IMPLEMENTED",
        );
      })();

export const getRequestStaffActorId = (req: Request): string | undefined => {
  if (AUTH_MODE !== "header") {
    rejectHeaderAuthInputWhenDisabled(req);
    return undefined;
  }

  const raw = req.header(STAFF_ID_HEADER);
  if (!raw) {
    return undefined;
  }

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const getRequestAuditActor = (req: Request): AuditActor => {
  if (AUTH_MODE !== "header") {
    rejectHeaderAuthInputWhenDisabled(req);
    return {};
  }

  assertHeaderAuthSecretIfConfigured(req);
  const actorId = getRequestStaffActorId(req);
  return {
    role: getRequestStaffRole(req),
    ...(actorId ? { actorId } : {}),
  };
};

export const assertRoleAtLeast = (req: Request, minimumRole: StaffRole) => {
  const actual = getRequestStaffRole(req);
  if (roleRank[actual] < roleRank[minimumRole]) {
    throw new HttpError(
      403,
      `${minimumRole} role required`,
      "INSUFFICIENT_ROLE",
    );
  }
  return actual;
};

export const requireRoleAtLeast = (minimumRole: StaffRole) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      assertHeaderAuthModeForProtectedRoute(req);
      // TODO(auth): Replace temporary header role guard with real authenticated user roles.
      const role = assertRoleAtLeast(req, minimumRole);
      const actorId = getRequestStaffActorId(req);
      if (actorId) {
        await ensureHeaderActorExists(actorId, role);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
};

export const enforceAuthMode = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    if (AUTH_MODE !== "header") {
      rejectHeaderAuthInputWhenDisabled(req);
      return next();
    }

    if (hasStaffHeaderAuthInput(req)) {
      assertHeaderAuthSecretIfConfigured(req);
    }
    next();
  } catch (error) {
    next(error);
  }
};
