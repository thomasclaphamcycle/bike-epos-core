const DEFAULT_CURRENCY = "GBP";

const normalizeCurrencyCode = (value: string | undefined) => {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z]{3}$/.test(normalized) ? normalized : DEFAULT_CURRENCY;
};

export const formatCurrencyFromPence = (
  valuePence: number,
  currency = DEFAULT_CURRENCY,
  {
    maximumFractionDigits = 2,
  }: {
    maximumFractionDigits?: number;
  } = {},
) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: normalizeCurrencyCode(currency),
    maximumFractionDigits,
  }).format(valuePence / 100);
