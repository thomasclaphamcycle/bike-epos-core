import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";
import { createAuditEventTx, type AuditActor } from "./auditService";
import { hashPassword } from "./passwordService";
import {
  createUserAccountTx,
  normalizeEmailOrThrow,
  normalizeNameOrThrow,
  toPublicUser,
} from "./userAccountService";

type AdminCreateUserInput = {
  name?: string;
  email?: string;
  role?: string;
  tempPassword?: string;
};

type AdminUpdateUserInput = {
  name?: string;
  role?: string;
  isActive?: boolean;
};

type AdminResetPasswordInput = {
  tempPassword?: string;
};

const roleRank: Record<UserRole, number> = {
  STAFF: 1,
  MANAGER: 2,
  ADMIN: 3,
};

const parseRoleOrThrow = (value: string | undefined, code: string): UserRole => {
  const normalized = value?.trim().toUpperCase();
  if (normalized !== "STAFF" && normalized !== "MANAGER" && normalized !== "ADMIN") {
    throw new HttpError(400, "role must be STAFF, MANAGER, or ADMIN", code);
  }
  return normalized;
};

const normalizePasswordOrThrow = (value: string | undefined, code: string) => {
  if (typeof value !== "string" || value.trim().length < 8) {
    throw new HttpError(400, "tempPassword must be at least 8 characters", code);
  }
  return value;
};

const countActiveAdminsTx = async (tx: Prisma.TransactionClient) =>
  tx.user.count({
    where: {
      role: "ADMIN",
      isActive: true,
    },
  });

export const adminListUsers = async () => {
  const users = await prisma.user.findMany({
    orderBy: [{ createdAt: "asc" }],
  });

  return {
    users: users.map((user) => toPublicUser(user)),
  };
};

export const adminCreateUser = async (input: AdminCreateUserInput, auditActor?: AuditActor) => {
  const name = normalizeNameOrThrow(input.name, "INVALID_ADMIN_USER_CREATE");
  const email = normalizeEmailOrThrow(input.email, "INVALID_ADMIN_USER_CREATE");
  const role = parseRoleOrThrow(input.role, "INVALID_ADMIN_USER_CREATE");
  const tempPassword = normalizePasswordOrThrow(
    input.tempPassword,
    "INVALID_ADMIN_USER_CREATE",
  );

  return prisma.$transaction(async (tx) => {
    const created = await createUserAccountTx(tx, {
      name,
      email,
      role,
      password: tempPassword,
      isActive: true,
    });

    await createAuditEventTx(
      tx,
      {
        action: "ADMIN_USER_CREATED",
        entityType: "USER",
        entityId: created.id,
        metadata: {
          role: created.role,
          email: created.email,
          isActive: created.isActive,
        },
      },
      auditActor,
    );

    return toPublicUser(created);
  });
};

export const adminUpdateUser = async (
  userId: string,
  input: AdminUpdateUserInput,
  actorId: string | undefined,
  auditActor?: AuditActor,
) => {
  const hasAnyField =
    Object.prototype.hasOwnProperty.call(input, "name") ||
    Object.prototype.hasOwnProperty.call(input, "role") ||
    Object.prototype.hasOwnProperty.call(input, "isActive");
  if (!hasAnyField) {
    throw new HttpError(400, "No fields provided", "INVALID_ADMIN_USER_UPDATE");
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { id: userId },
    });
    if (!existing) {
      throw new HttpError(404, "User not found", "USER_NOT_FOUND");
    }

    const data: Prisma.UserUpdateInput = {};

    if (Object.prototype.hasOwnProperty.call(input, "name")) {
      const name = normalizeNameOrThrow(input.name, "INVALID_ADMIN_USER_UPDATE");
      data.name = name;
    }

    if (Object.prototype.hasOwnProperty.call(input, "role")) {
      const nextRole = parseRoleOrThrow(input.role, "INVALID_ADMIN_USER_UPDATE");
      if (existing.role === "ADMIN" && nextRole !== "ADMIN") {
        const adminCount = await countActiveAdminsTx(tx);
        if (adminCount <= 1 && existing.isActive) {
          throw new HttpError(409, "Cannot demote the last active ADMIN", "LAST_ADMIN");
        }
      }
      if (existing.id === actorId && existing.role === "ADMIN" && nextRole !== "ADMIN") {
        throw new HttpError(409, "Cannot demote your own ADMIN role", "SELF_ROLE_CHANGE_FORBIDDEN");
      }
      data.role = nextRole;
    }

    if (Object.prototype.hasOwnProperty.call(input, "isActive")) {
      if (typeof input.isActive !== "boolean") {
        throw new HttpError(400, "isActive must be a boolean", "INVALID_ADMIN_USER_UPDATE");
      }
      if (existing.id === actorId && !input.isActive) {
        throw new HttpError(409, "Cannot disable your own user", "SELF_DISABLE_FORBIDDEN");
      }
      if (existing.role === "ADMIN" && existing.isActive && !input.isActive) {
        const adminCount = await countActiveAdminsTx(tx);
        if (adminCount <= 1) {
          throw new HttpError(409, "Cannot disable the last active ADMIN", "LAST_ADMIN");
        }
      }
      data.isActive = input.isActive;
    }

    const updated = await tx.user.update({
      where: { id: existing.id },
      data,
    });

    await createAuditEventTx(
      tx,
      {
        action: "ADMIN_USER_UPDATED",
        entityType: "USER",
        entityId: updated.id,
        metadata: {
          role: updated.role,
          email: updated.email,
          isActive: updated.isActive,
        },
      },
      auditActor,
    );

    return toPublicUser(updated);
  });
};

export const adminResetUserPassword = async (
  userId: string,
  input: AdminResetPasswordInput,
  actorId: string | undefined,
  auditActor?: AuditActor,
) => {
  const tempPassword = normalizePasswordOrThrow(
    input.tempPassword,
    "INVALID_ADMIN_PASSWORD_RESET",
  );

  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { id: userId },
    });
    if (!existing) {
      throw new HttpError(404, "User not found", "USER_NOT_FOUND");
    }

    if (existing.id === actorId && existing.role === "ADMIN") {
      // Allow resetting own password, but track in audit.
    }

    const passwordHash = await hashPassword(tempPassword);
    const updated = await tx.user.update({
      where: { id: existing.id },
      data: {
        passwordHash,
      },
    });

    await createAuditEventTx(
      tx,
      {
        action: "ADMIN_USER_PASSWORD_RESET",
        entityType: "USER",
        entityId: updated.id,
        metadata: {
          email: updated.email,
          byActorId: actorId ?? null,
        },
      },
      auditActor,
    );

    return toPublicUser(updated);
  });
};

export const adminResetUserPin = async (
  userId: string,
  actorId: string | undefined,
  actorRole: UserRole,
  auditActor?: AuditActor,
) => {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { id: userId },
    });
    if (!existing) {
      throw new HttpError(404, "User not found", "USER_NOT_FOUND");
    }

    if (existing.id === actorId) {
      throw new HttpError(409, "Use self-service PIN change for your own account", "SELF_PIN_RESET_FORBIDDEN");
    }

    if (roleRank[actorRole] < roleRank[existing.role]) {
      throw new HttpError(403, "Cannot reset PIN for a higher-privileged user", "INSUFFICIENT_ROLE");
    }

    const updated = await tx.user.update({
      where: { id: existing.id },
      data: {
        pinHash: null,
      },
    });

    await createAuditEventTx(
      tx,
      {
        action: "ADMIN_USER_PIN_RESET",
        entityType: "USER",
        entityId: updated.id,
        metadata: {
          email: updated.email,
          byActorId: actorId ?? null,
        },
      },
      auditActor,
    );

    return toPublicUser(updated);
  });
};
