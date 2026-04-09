export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const expectRecord = (value: unknown, field: string) => {
  if (!isRecord(value)) {
    throw new Error(`${field} must be an object`);
  }

  return value;
};

export const expectString = (value: unknown, field: string) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }

  return value;
};

export const expectNullableString = (value: unknown, field: string) => {
  if (value === null) {
    return null;
  }

  return expectString(value, field);
};

export const expectPositiveInteger = (value: unknown, field: string) => {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }

  return Number(value);
};

export const expectNonNegativeInteger = (value: unknown, field: string) => {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }

  return Number(value);
};

export const expectIsoDateString = (value: unknown, field: string) => {
  const normalized = expectString(value, field);
  if (Number.isNaN(new Date(normalized).getTime())) {
    throw new Error(`${field} must be a valid ISO date string`);
  }

  return normalized;
};
