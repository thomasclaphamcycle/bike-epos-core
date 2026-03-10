import * as bcrypt from "bcryptjs";
import { HttpError } from "../utils/http";

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

const PIN_REGEX = /^\d{4}$/;

export const normalizePinOrThrow = (pin: string | undefined, code: string) => {
  const normalized = typeof pin === "string" ? pin.trim() : "";
  if (!PIN_REGEX.test(normalized)) {
    throw new HttpError(400, "PIN must be exactly 4 digits", code);
  }
  return normalized;
};

export const hashPin = async (plainPin: string) => bcrypt.hash(plainPin, BCRYPT_ROUNDS);

export const verifyPin = async (plainPin: string, pinHash: string) => bcrypt.compare(plainPin, pinHash);
