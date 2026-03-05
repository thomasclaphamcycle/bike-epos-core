import { NextFunction, Request, Response } from "express";
import { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
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
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
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
