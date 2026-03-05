import * as bcrypt from "bcryptjs";

const DEFAULT_BCRYPT_ROUNDS = 12;

const toBcryptRounds = () => {
  const raw = process.env.AUTH_BCRYPT_ROUNDS;
  if (!raw) {
    return DEFAULT_BCRYPT_ROUNDS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 8 || parsed > 14) {
    return DEFAULT_BCRYPT_ROUNDS;
  }
  return parsed;
};

const BCRYPT_ROUNDS = toBcryptRounds();

export const hashPassword = async (plainPassword: string) => bcrypt.hash(plainPassword, BCRYPT_ROUNDS);

export const verifyPassword = async (
  plainPassword: string,
  passwordHash: string,
) => bcrypt.compare(plainPassword, passwordHash);
