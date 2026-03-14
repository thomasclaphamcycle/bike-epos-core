import { Prisma, UserOperationalRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";
import { createAuditEventTx, type AuditActor } from "./auditService";
import { toPublicUser } from "./userAccountService";

type StaffDirectoryClient = Prisma.TransactionClient | typeof prisma;

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
