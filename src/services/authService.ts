import { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";
import { createAuditEventTx, type AuditActor } from "./auditService";
import {
  hashPin,
  normalizePinOrThrow,
  verifyPassword,
  verifyPin,
} from "./passwordService";
import {
  createUserAccountTx,
  findUserByEmail,
  normalizeEmailOrThrow,
  normalizeNameOrThrow,
  toPublicUser,
  type PublicUser,
} from "./userAccountService";

const normalizePasswordOrThrow = (password: string | undefined, code: string) => {
  if (typeof password !== "string" || password.trim().length < 8) {
    throw new HttpError(400, "password must be at least 8 characters", code);
  }
  return password;
};

export type ActiveLoginUser = {
  id: string;
  displayName: string;
  role: UserRole;
  hasPin: boolean;
};

const ACTIVE_LOGIN_ROLE_PRIORITY: Record<UserRole, number> = {
  STAFF: 1,
  MANAGER: 2,
  ADMIN: 3,
};

export const authenticateWithEmailPassword = async (
  email: string | undefined,
  password: string | undefined,
) => {
  const normalizedEmail = normalizeEmailOrThrow(email, "INVALID_LOGIN");
  const normalizedPassword = normalizePasswordOrThrow(password, "INVALID_LOGIN");

  const user = await findUserByEmail(normalizedEmail);
  if (!user || !user.isActive) {
    throw new HttpError(401, "Invalid email or password", "INVALID_CREDENTIALS");
  }

  const valid = await verifyPassword(normalizedPassword, user.passwordHash);
  if (!valid) {
    throw new HttpError(401, "Invalid email or password", "INVALID_CREDENTIALS");
  }

  return toPublicUser(user);
};

export const getPublicUserById = async (userId: string): Promise<PublicUser | null> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });
  if (!user) {
    return null;
  }
  return toPublicUser(user);
};

export const listActiveLoginUsers = async (): Promise<ActiveLoginUser[]> => {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: {
      id: true,
      username: true,
      name: true,
      role: true,
      pinHash: true,
    },
  });

  return users
    .map((user) => ({
      id: user.id,
      displayName: user.name?.trim() || user.username,
      role: user.role,
      hasPin: Boolean(user.pinHash),
    }))
    .sort((left, right) => {
      const roleOrder = ACTIVE_LOGIN_ROLE_PRIORITY[left.role] - ACTIVE_LOGIN_ROLE_PRIORITY[right.role];
      if (roleOrder !== 0) {
        return roleOrder;
      }
      return left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" });
    });
};

export const authenticateWithPin = async (
  userId: string | undefined,
  pin: string | undefined,
) => {
  const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
  if (!normalizedUserId) {
    throw new HttpError(400, "userId is required", "INVALID_PIN_LOGIN");
  }
  const normalizedPin = normalizePinOrThrow(pin, "INVALID_PIN_LOGIN");

  const user = await prisma.user.findUnique({
    where: { id: normalizedUserId },
  });
  if (!user || !user.isActive || !user.pinHash) {
    throw new HttpError(401, "Invalid login", "INVALID_CREDENTIALS");
  }

  const valid = await verifyPin(normalizedPin, user.pinHash);
  if (!valid) {
    throw new HttpError(401, "Invalid login", "INVALID_CREDENTIALS");
  }

  return toPublicUser(user);
};

export const getPinStatus = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, pinHash: true, isActive: true },
  });
  if (!user || !user.isActive) {
    throw new HttpError(404, "User not found", "USER_NOT_FOUND");
  }
  return { hasPin: Boolean(user.pinHash) };
};

export const setCurrentUserPin = async (
  userId: string,
  pin: string | undefined,
  auditActor?: AuditActor,
) => {
  const normalizedPin = normalizePinOrThrow(pin, "INVALID_PIN");

  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, pinHash: true, isActive: true },
    });
    if (!existing || !existing.isActive) {
      throw new HttpError(404, "User not found", "USER_NOT_FOUND");
    }
    if (existing.pinHash) {
      throw new HttpError(409, "PIN already exists", "PIN_ALREADY_SET");
    }

    const pinHash = await hashPin(normalizedPin);
    await tx.user.update({
      where: { id: userId },
      data: { pinHash },
    });

    await createAuditEventTx(
      tx,
      {
        action: "AUTH_PIN_SET",
        entityType: "USER",
        entityId: userId,
      },
      auditActor,
    );

    return { hasPin: true };
  });
};

export const changeCurrentUserPin = async (
  userId: string,
  currentPin: string | undefined,
  nextPin: string | undefined,
  auditActor?: AuditActor,
) => {
  const normalizedCurrentPin = normalizePinOrThrow(currentPin, "INVALID_PIN");
  const normalizedNextPin = normalizePinOrThrow(nextPin, "INVALID_PIN");

  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, pinHash: true, isActive: true },
    });
    if (!existing || !existing.isActive) {
      throw new HttpError(404, "User not found", "USER_NOT_FOUND");
    }
    if (!existing.pinHash) {
      throw new HttpError(409, "No PIN set yet", "PIN_NOT_SET");
    }

    const valid = await verifyPin(normalizedCurrentPin, existing.pinHash);
    if (!valid) {
      throw new HttpError(401, "Current PIN is incorrect", "INVALID_CREDENTIALS");
    }

    const pinHash = await hashPin(normalizedNextPin);
    await tx.user.update({
      where: { id: userId },
      data: { pinHash },
    });

    await createAuditEventTx(
      tx,
      {
        action: "AUTH_PIN_CHANGED",
        entityType: "USER",
        entityId: userId,
      },
      auditActor,
    );

    return { hasPin: true };
  });
};

export const bootstrapInitialAdmin = async (input: {
  name?: string;
  email?: string;
  password?: string;
}) => {
  const name = normalizeNameOrThrow(input.name, "INVALID_BOOTSTRAP_INPUT");
  const email = normalizeEmailOrThrow(input.email, "INVALID_BOOTSTRAP_INPUT");
  const password = normalizePasswordOrThrow(input.password, "INVALID_BOOTSTRAP_INPUT");

  return prisma.$transaction(async (tx) => {
    const userCount = await tx.user.count();
    if (userCount > 0) {
      throw new HttpError(403, "Bootstrap disabled (users already exist)", "BOOTSTRAP_DISABLED");
    }

    const user = await createUserAccountTx(tx, {
      name,
      email,
      password,
      role: UserRole.ADMIN,
      isActive: true,
    });

    return toPublicUser(user);
  });
};
