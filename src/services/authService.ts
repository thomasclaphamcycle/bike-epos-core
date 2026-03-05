import { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http";
import { verifyPassword } from "./passwordService";
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
