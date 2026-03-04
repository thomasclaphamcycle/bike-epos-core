import { NextFunction, Request, Response } from "express";
import { HttpError } from "../utils/http";
import type { AuditActor } from "../services/auditService";

export type StaffRole = "STAFF" | "MANAGER" | "ADMIN";

const STAFF_ROLE_HEADER = "x-staff-role";
const STAFF_ID_HEADER = "x-staff-id";

const roleRank: Record<StaffRole, number> = {
  STAFF: 1,
  MANAGER: 2,
  ADMIN: 3,
};

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

export const getRequestStaffRole = (req: Request): StaffRole =>
  parseRoleHeaderOrThrow(req.header(STAFF_ROLE_HEADER) ?? undefined);

export const getRequestStaffActorId = (req: Request): string | undefined => {
  const raw = req.header(STAFF_ID_HEADER);
  if (!raw) {
    return undefined;
  }

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const getRequestAuditActor = (req: Request): AuditActor => {
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
  return (req: Request, _res: Response, next: NextFunction) => {
    // TODO(auth): Replace temporary header role guard with real authenticated user roles.
    assertRoleAtLeast(req, minimumRole);
    next();
  };
};
