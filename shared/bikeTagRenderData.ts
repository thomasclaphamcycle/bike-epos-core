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

export const buildBikeTagProductName = (
  variant: BikeTagVariantLike,
  product: BikeTagProductLike | null,
) => normalizeText(product?.name)
  || normalizeText(variant.product?.name)
  || normalizeText(variant.name)
  || variant.sku;

export const buildBikeTagVariantLabel = (variant: BikeTagVariantLike) => {
  const parts = [normalizeText(variant.name), normalizeText(variant.option)].filter(Boolean);
  const unique = Array.from(new Set(parts));
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

  const push = (value: string | null | undefined) => {
    const normalized = normalizeText(value);
    if (!normalized) {
      return;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    lines.push(normalized);
  };

  push(product?.brand || variant.product?.brand || null);
  push(product?.category || variant.product?.category || null);
  push(buildBikeTagVariantLabel(variant));

  const descriptionChunks = normalizeText(product?.description)
    .split(/\n+|•|(?<=\.)\s+|,\s+/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length >= 4 && chunk.length <= 72);

  descriptionChunks.forEach((chunk) => push(chunk));

  if (lines.length === 0) {
    push("Ask in store for full build, sizing, and fit advice.");
  }

  return lines.slice(0, 4);
};

export const buildBikeTagSupportLine = (
  variant: BikeTagVariantLike,
  product: BikeTagProductLike | null,
) => [normalizeText(product?.brand || variant.product?.brand), normalizeText(product?.category || variant.product?.category)]
  .filter(Boolean)
  .join(" · ");

export const buildBikeTagRenderData = (
  variant: BikeTagVariantLike,
  product: BikeTagProductLike | null,
): BikeTagRenderData => ({
  productName: buildBikeTagProductName(variant, product),
  variantLabel: buildBikeTagVariantLabel(variant),
  barcodeValue: buildBikeTagBarcodeValue(variant),
  priceLabel: moneyFormatter.format(variant.retailPricePence / 100),
  supportLine: buildBikeTagSupportLine(variant, product),
  specLines: buildBikeTagSpecLines(variant, product),
});
