const normalizeOptionalText = (value: string | undefined | null) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeNameWord = (value: string) =>
  value
    .split("-")
    .map((segment) => {
      if (!segment) {
        return segment;
      }

      const lower = segment.toLowerCase();
      return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join("-");

export const normalizeNamePart = (value: string | undefined | null) => {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return "";
  }

  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeNameWord)
    .join(" ");
};

export const parseCombinedCustomerName = (value: string) => {
  const normalized = normalizeOptionalText(value) ?? "";
  const tokens = normalized.split(/\s+/).filter(Boolean);

  return {
    firstName: normalizeNamePart(tokens[0] ?? ""),
    lastName: normalizeNamePart(tokens.slice(1).join(" ")),
  };
};

export const getCustomerDisplayName = (
  customer: {
    firstName?: string | null;
    lastName?: string | null;
    name?: string | null;
  },
  fallback = "Unknown customer",
) => {
  const explicitName = normalizeOptionalText(customer.name);
  if (explicitName) {
    return explicitName;
  }

  const combined = [normalizeOptionalText(customer.firstName), normalizeOptionalText(customer.lastName)]
    .filter(Boolean)
    .join(" ")
    .trim();

  return combined || fallback;
};
