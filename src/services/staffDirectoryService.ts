import { Prisma, UserOperationalRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";
import { createAuditEventTx, type AuditActor } from "./auditService";
import { toPublicUser } from "./userAccountService";

type StaffDirectoryClient = Prisma.TransactionClient | typeof prisma;

type StaffDirectoryProfileInput = {
  operationalRole?: string | null;
  isTechnician?: boolean;
};

const parseOperationalRoleOrThrow = (
  value: string | null | undefined,
  code: string,
): UserOperationalRole | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  if (
    normalized !== "WORKSHOP"
    && normalized !== "SALES"
    && normalized !== "ADMIN"
    && normalized !== "MIXED"
  ) {
    throw new HttpError(
      400,
      "operationalRole must be WORKSHOP, SALES, ADMIN, MIXED, or null",
      code,
    );
  }

  return normalized;
};

export const listStaffDirectory = async (db: StaffDirectoryClient = prisma) => {
  const users = await db.user.findMany({
    orderBy: [
      { isActive: "desc" },
      { role: "asc" },
      { createdAt: "asc" },
    ],
  });

  return {
    users: users.map((user) => toPublicUser(user)),
  };
};

export const updateUserOperationalRole = async (
  userId: string,
  operationalRole: string | null | undefined,
  auditActor?: AuditActor,
  db: StaffDirectoryClient = prisma,
) => {
  const parsedOperationalRole = parseOperationalRoleOrThrow(
    operationalRole,
    "INVALID_OPERATIONAL_ROLE",
  );

  return db.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { id: userId },
    });

    if (!existing) {
      throw new HttpError(404, "User not found", "USER_NOT_FOUND");
    }

    const updated = await tx.user.update({
      where: { id: userId },
      data: {
        operationalRole: parsedOperationalRole,
      },
    });

    await createAuditEventTx(
      tx,
      {
        action: "USER_OPERATIONAL_ROLE_UPDATED",
        entityType: "USER",
        entityId: updated.id,
        metadata: {
          role: updated.role,
          operationalRole: updated.operationalRole,
          email: updated.email,
        },
      },
      auditActor,
    );

    return toPublicUser(updated);
  });
};

export const updateStaffDirectoryProfile = async (
  userId: string,
  input: StaffDirectoryProfileInput,
  auditActor?: AuditActor,
  db: StaffDirectoryClient = prisma,
) => {
  const hasOperationalRole = Object.prototype.hasOwnProperty.call(input, "operationalRole");
  const hasIsTechnician = Object.prototype.hasOwnProperty.call(input, "isTechnician");
  if (!hasOperationalRole && !hasIsTechnician) {
    throw new HttpError(400, "No staff directory fields provided", "INVALID_STAFF_DIRECTORY_UPDATE");
  }

  const parsedOperationalRole = hasOperationalRole
    ? parseOperationalRoleOrThrow(input.operationalRole, "INVALID_STAFF_DIRECTORY_UPDATE")
    : undefined;

  if (hasIsTechnician && typeof input.isTechnician !== "boolean") {
    throw new HttpError(400, "isTechnician must be a boolean", "INVALID_STAFF_DIRECTORY_UPDATE");
  }

  return db.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { id: userId },
    });

    if (!existing) {
      throw new HttpError(404, "User not found", "USER_NOT_FOUND");
    }

    const updated = await tx.user.update({
      where: { id: userId },
      data: {
        ...(hasOperationalRole ? { operationalRole: parsedOperationalRole } : {}),
        ...(hasIsTechnician ? { isTechnician: input.isTechnician } : {}),
      },
    });

    await createAuditEventTx(
      tx,
      {
        action: "USER_STAFF_DIRECTORY_UPDATED",
        entityType: "USER",
        entityId: updated.id,
        metadata: {
          role: updated.role,
          operationalRole: updated.operationalRole,
          isTechnician: updated.isTechnician,
          email: updated.email,
        },
      },
      auditActor,
    );

    return toPublicUser(updated);
  });
};
