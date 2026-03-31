import { HttpError } from "./http";

const STRICT_INTEGER_PATTERN = /^-?\d+$/;

type ParseOptionalIntegerQueryOptions = {
  code: string;
  message: string;
  min?: number;
  max?: number;
};

export const parseOptionalIntegerQuery = (
  value: unknown,
  options: ParseOptionalIntegerQueryOptions,
): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new HttpError(400, options.message, options.code);
  }

  const normalized = value.trim();
  if (normalized.length === 0 || !STRICT_INTEGER_PATTERN.test(normalized)) {
    throw new HttpError(400, options.message, options.code);
  }

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new HttpError(400, options.message, options.code);
  }

  if (options.min !== undefined && parsed < options.min) {
    throw new HttpError(400, options.message, options.code);
  }

  if (options.max !== undefined && parsed > options.max) {
    throw new HttpError(400, options.message, options.code);
  }

  return parsed;
};
