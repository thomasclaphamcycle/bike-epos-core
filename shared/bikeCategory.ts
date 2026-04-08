const BIKE_CATEGORY_KEYWORDS = [
  "bikes",
  "bike",
  "electric bikes",
  "electric bike",
  "road bikes",
  "road bike",
  "mountain bikes",
  "mountain bike",
  "hybrid bikes",
  "hybrid bike",
  "kids bikes",
  "kids bike",
  "cargo bikes",
  "cargo bike",
  "folding bikes",
  "folding bike",
  "e bikes",
  "e bike",
  "ebikes",
  "ebike",
];

const normalizeCategory = (value: string | null | undefined) =>
  value
    ?.toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim() ?? "";

export const isBikeCategory = (category: string | null | undefined) => {
  const normalized = normalizeCategory(category);
  if (!normalized) {
    return false;
  }

  return BIKE_CATEGORY_KEYWORDS.some((keyword) => normalized.includes(keyword));
};
