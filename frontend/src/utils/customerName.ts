const normalizeOptionalText = (value: string | undefined | null) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const parseCombinedCustomerName = (value: string) => {
  const normalized = normalizeOptionalText(value) ?? "";
  const tokens = normalized.split(/\s+/).filter(Boolean);

  return {
    firstName: tokens[0] ?? "",
    lastName: tokens.slice(1).join(" "),
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
