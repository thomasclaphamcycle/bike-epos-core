import { isBikeCategory } from "./bikeCategory";

export type BikeTagVariantLike = {
  sku: string;
  barcode: string | null;
  manufacturerBarcode: string | null;
  internalBarcode: string | null;
  name: string | null;
  option: string | null;
  retailPricePence: number;
  product?: {
    name: string;
    category: string | null;
    brand: string | null;
    keySellingPoints?: string | null;
  };
};

export type BikeTagProductLike = {
  name: string;
  category: string | null;
  brand: string | null;
  description: string | null;
  keySellingPoints?: string | null;
};

export type BikeTagRenderData = {
  productName: string;
  variantLabel: string;
  barcodeValue: string;
  priceLabel: string;
  supportLine: string;
  specLines: string[];
};

const moneyFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

const normalizeText = (value: string | null | undefined) => value?.trim() ?? "";
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MAX_SPEC_LINES = 4;
const GENERIC_DESCRIPTION_PATTERNS = [
  /\bgreat bike\b/i,
  /\bperfect for\b/i,
  /\bideal for\b/i,
  /\bask in store\b/i,
  /\bfull build\b/i,
  /\bcomplete bike\b/i,
];
const GENERIC_VARIANT_PATTERNS = [
  /^default$/i,
  /^\d{2,3}\s?cm$/i,
  /^(xs|s|sm|small|m|md|medium|l|lg|large|xl|xxl)$/i,
  /^(black|white|grey|gray|silver|blue|red|green|orange|yellow|pink|purple|brown)$/i,
];
const COLOUR_WORDS = new Set([
  "black",
  "white",
  "grey",
  "gray",
  "silver",
  "blue",
  "red",
  "green",
  "orange",
  "yellow",
  "pink",
  "purple",
  "brown",
  "navy",
  "slate",
  "graphite",
  "sage",
  "olive",
  "teal",
  "cream",
  "bronze",
  "gold",
  "gloss",
  "matte",
]);

const parseManualSellingPoints = (value: string | null | undefined) => {
  const seen = new Set<string>();
  const lines: string[] = [];

  normalizeText(value)
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .forEach((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      lines.push(line);
    });

  return lines;
};

const normalizeGeneratedLineKey = (value: string) =>
  value.toLowerCase().replace(/[^\w\s/-]+/g, "").replace(/\s+/g, " ").trim();

const looksGenericDescription = (value: string) =>
  GENERIC_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(value));

const normalizeCategorySellingPoint = (value: string | null | undefined) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  const compact = normalized
    .replace(/\bcategory\b/gi, "")
    .replace(/\bbikes\b/gi, "bike")
    .replace(/\sebikes\b/gi, " e-bike")
    .replace(/\s+/g, " ")
    .trim();

  return compact;
};

const cleanVariantSellingPoint = (value: string | null | undefined) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  const meaningfulParts = normalized
    .split(/[\/,]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !GENERIC_VARIANT_PATTERNS.some((pattern) => pattern.test(part)));

  const compact = meaningfulParts.join(" / ").replace(/^[-/,\s]+|[-/,\s]+$/g, "").trim();
  if (!compact) {
    return "";
  }

  const compactWords = compact.toLowerCase().split(/\s+/).filter(Boolean);
  if (compactWords.length > 0 && compactWords.every((word) => COLOUR_WORDS.has(word))) {
    return "";
  }

  return compact;
};

const buildDescriptionSellingPointCandidates = (description: string | null | undefined) =>
  normalizeText(description)
    .split(/\n+|•|;|(?<=\.)\s+|,\s+/)
    .map((chunk) => chunk.replace(/\.$/, "").trim())
    .filter((chunk) => chunk.length >= 4 && chunk.length <= 80)
    .filter((chunk) => !looksGenericDescription(chunk))
    .sort((left, right) => left.length - right.length);

export const buildBikeTagProductName = (
  variant: BikeTagVariantLike,
  product: BikeTagProductLike | null,
) => normalizeText(product?.name)
  || normalizeText(variant.product?.name)
  || normalizeText(variant.name)
  || variant.sku;

export const buildBikeTagVariantLabel = (
  variant: BikeTagVariantLike,
  product: BikeTagProductLike | null,
) => {
  const productName = buildBikeTagProductName(variant, product);
  const productPattern = productName ? new RegExp(escapeRegExp(productName), "ig") : null;
  const parts = [normalizeText(variant.name), normalizeText(variant.option)]
    .map((part) => {
      let next = part;
      if (productPattern) {
        next = next.replace(productPattern, "").trim();
      }
      next = next.replace(/\bdefault\b/gi, "").replace(/^[-/,\s]+|[-/,\s]+$/g, "").trim();
      return next;
    })
    .filter(Boolean);
  const unique = Array.from(new Set(parts.map((part) => part.toLowerCase()))).map((key) =>
    parts.find((part) => part.toLowerCase() === key) || "",
  ).filter(Boolean);
  if (unique.length === 0) {
    return "";
  }
  return unique.join(" / ");
};

export const buildBikeTagBarcodeValue = (variant: BikeTagVariantLike) =>
  normalizeText(variant.barcode)
  || normalizeText(variant.manufacturerBarcode)
  || normalizeText(variant.internalBarcode);

export const buildBikeTagFallbackSpecLines = (
  variant: BikeTagVariantLike,
  product: BikeTagProductLike | null,
) => {
  const lines: string[] = [];
  const seen = new Set<string>();
  const productName = normalizeGeneratedLineKey(buildBikeTagProductName(variant, product));
  const variantLabel = normalizeGeneratedLineKey(buildBikeTagVariantLabel(variant, product));

  const push = (value: string | null | undefined) => {
    const normalized = normalizeText(value);
    if (!normalized) {
      return;
    }

    const key = normalizeGeneratedLineKey(normalized);
    if (productName && (key === productName || productName.includes(key) || key.includes(productName))) {
      return;
    }
    if (variantLabel && (key === variantLabel || variantLabel.includes(key) || key.includes(variantLabel))) {
      return;
    }
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    lines.push(normalized);
  };

  buildDescriptionSellingPointCandidates(product?.description).forEach((chunk) => push(chunk));

  if (lines.length < 3) {
    push(normalizeCategorySellingPoint(product?.category || variant.product?.category || null));
  }

  if (lines.length < 3) {
    push(product?.brand || variant.product?.brand || null);
  }

  if (lines.length < 3) {
    push(cleanVariantSellingPoint(buildBikeTagVariantLabel(variant, product)));
  }

  if (lines.length === 0) {
    push("Ask in store for full build, sizing, and fit advice.");
  }

  return lines.slice(0, MAX_SPEC_LINES);
};

export const buildBikeTagGeneratedSpecLines = (
  variant: BikeTagVariantLike,
  product: BikeTagProductLike | null,
) => {
  const category = product?.category ?? variant.product?.category ?? null;
  if (!isBikeCategory(category)) {
    return buildBikeTagFallbackSpecLines(variant, product);
  }

  const lines: string[] = [];
  const seen = new Set<string>();
  const push = (value: string | null | undefined) => {
    const normalized = normalizeText(value);
    if (!normalized) {
      return;
    }

    const key = normalizeGeneratedLineKey(normalized);
    if (!key || seen.has(key)) {
      return;
    }

    seen.add(key);
    lines.push(normalized);
  };

  push(product?.brand || variant.product?.brand || null);
  push(normalizeCategorySellingPoint(category));
  push(cleanVariantSellingPoint(buildBikeTagVariantLabel(variant, product)));
  buildDescriptionSellingPointCandidates(product?.description).forEach((chunk) => push(chunk));

  if (lines.length < 3) {
    buildBikeTagFallbackSpecLines(variant, product).forEach((line) => push(line));
  }

  return lines.slice(0, MAX_SPEC_LINES);
};

export const buildBikeTagSpecLines = (
  variant: BikeTagVariantLike,
  product: BikeTagProductLike | null,
) => {
  const category = product?.category ?? variant.product?.category ?? null;
  const manualSellingPoints = isBikeCategory(category)
    ? parseManualSellingPoints(product?.keySellingPoints ?? variant.product?.keySellingPoints)
    : [];

  if (manualSellingPoints.length > 0) {
    return manualSellingPoints.slice(0, MAX_SPEC_LINES);
  }

  return buildBikeTagGeneratedSpecLines(variant, product);
};

export const buildBikeTagSupportLine = (
  variant: BikeTagVariantLike,
  product: BikeTagProductLike | null,
) => {
  const parts = [
    normalizeText(product?.brand || variant.product?.brand),
    normalizeText(product?.category || variant.product?.category),
  ].filter(Boolean);
  const unique = Array.from(new Set(parts.map((part) => part.toLowerCase()))).map((key) =>
    parts.find((part) => part.toLowerCase() === key) || "",
  ).filter(Boolean);
  if (unique.length < 2) {
    return "";
  }
  return unique.join(" · ");
};

export const buildBikeTagRenderData = (
  variant: BikeTagVariantLike,
  product: BikeTagProductLike | null,
): BikeTagRenderData => {
  const productName = buildBikeTagProductName(variant, product);
  const variantLabel = buildBikeTagVariantLabel(variant, product);
  const specLines = buildBikeTagSpecLines(variant, product);
  const supportLine = buildBikeTagSupportLine(variant, product);
  const normalizedSpecLines = specLines.map((line) => line.toLowerCase());
  const supportParts = supportLine
    .split("·")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const shouldSuppressSupportLine = supportParts.length > 0
    && supportParts.every((part) => normalizedSpecLines.some((line) => line === part));

  return {
    productName,
    variantLabel,
    barcodeValue: buildBikeTagBarcodeValue(variant),
    priceLabel: moneyFormatter.format(variant.retailPricePence / 100),
    supportLine: shouldSuppressSupportLine ? "" : supportLine,
    specLines,
  };
};
