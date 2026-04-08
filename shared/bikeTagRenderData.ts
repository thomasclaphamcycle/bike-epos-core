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
  };
};

export type BikeTagProductLike = {
  name: string;
  category: string | null;
  brand: string | null;
  description: string | null;
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

export const buildBikeTagSpecLines = (
  variant: BikeTagVariantLike,
  product: BikeTagProductLike | null,
) => {
  const lines: string[] = [];
  const seen = new Set<string>();
  const productName = buildBikeTagProductName(variant, product).toLowerCase();
  const variantLabel = buildBikeTagVariantLabel(variant, product).toLowerCase();

  const push = (value: string | null | undefined) => {
    const normalized = normalizeText(value);
    if (!normalized) {
      return;
    }

    const key = normalized.toLowerCase();
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

  const descriptionChunks = normalizeText(product?.description)
    .split(/\n+|•|(?<=\.)\s+|,\s+/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length >= 4 && chunk.length <= 72);

  descriptionChunks.forEach((chunk) => push(chunk));

  if (lines.length < 3) {
    push(product?.brand || variant.product?.brand || null);
  }

  if (lines.length < 3) {
    push(product?.category || variant.product?.category || null);
  }

  if (lines.length === 0) {
    push("Ask in store for full build, sizing, and fit advice.");
  }

  return lines.slice(0, 4);
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
