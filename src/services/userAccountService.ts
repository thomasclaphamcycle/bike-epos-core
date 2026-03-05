import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";
import { hashPassword } from "./passwordService";

const normalizeText = (value: string | undefined | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const normalizeEmailOrThrow = (email: string | undefined, code: string) => {
  const normalized = normalizeText(email)?.toLowerCase();
  if (!normalized) {
    throw new HttpError(400, "email is required", code);
  }
  if (!normalized.includes("@") || normalized.length < 5) {
    throw new HttpError(400, "email must be a valid email address", code);
  }
  return normalized;
};

export const normalizeNameOrThrow = (name: string | undefined, code: string) => {
  const normalized = normalizeText(name);
  if (!normalized) {
    throw new HttpError(400, "name is required", code);
  }
  return normalized;
};

const toBaseUsername = (email: string) => email.toLowerCase();

const reserveAvailableUsernameTx = async (
  tx: Prisma.TransactionClient,
  baseUsername: string,
) => {
  const root = baseUsername.slice(0, 80);
  for (let attempt = 0; attempt < 1000; attempt++) {
    const candidate = attempt === 0 ? root : `${root}-${attempt}`;
    const existing = await tx.user.findUnique({
      where: { username: candidate },
      select: { id: true },
    });
    if (!existing) {
      return candidate;
    }
  }
  throw new HttpError(409, "Could not allocate unique username", "USERNAME_CONFLICT");
};

export type PublicUser = {
  id: string;
  username: string;
  email: string | null;
  name: string | null;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export const toPublicUser = (user: {
  id: string;
  username: string;
  email: string | null;
  name: string | null;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): PublicUser => ({
  id: user.id,
  username: user.username,
  email: user.email,
  name: user.name,
  role: user.role,
  isActive: user.isActive,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

export const findUserByEmail = async (email: string) =>
  prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

export const createUserAccountTx = async (
  tx: Prisma.TransactionClient,
  input: {
    name: string;
    email: string;
    password: string;
    role: UserRole;
    isActive?: boolean;
  },
) => {
  const normalizedName = normalizeNameOrThrow(input.name, "INVALID_USER");
  const normalizedEmail = normalizeEmailOrThrow(input.email, "INVALID_USER");
  const password = normalizeText(input.password);
  if (!password || password.length < 8) {
    throw new HttpError(400, "password must be at least 8 characters", "INVALID_USER");
  }

  const username = await reserveAvailableUsernameTx(tx, toBaseUsername(normalizedEmail));
  const passwordHash = await hashPassword(password);

  try {
    return await tx.user.create({
      data: {
        username,
        email: normalizedEmail,
        name: normalizedName,
        passwordHash,
        role: input.role,
        isActive: input.isActive ?? true,
      },
    });
  } catch (error) {
    const prismaError = error as { code?: string };
    if (prismaError.code === "P2002") {
      throw new HttpError(409, "A user with that email already exists", "EMAIL_EXISTS");
    }
    throw error;
  }
};
