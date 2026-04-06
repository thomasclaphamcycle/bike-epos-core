import type { AppConfig } from "../../config/appConfig";
import CorePosLogo from "../../components/branding/CorePosLogo";
import { BarcodeGraphic } from "./BarcodeGraphic";

export type BikeTagVariant = {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  manufacturerBarcode: string | null;
  internalBarcode: string | null;
  name: string | null;
  option: string | null;
  retailPricePence: number;
  product?: {
    id: string;
    name: string;
    category: string | null;
    brand: string | null;
  };
};

export type BikeTagProduct = {
  id: string;
  name: string;
  category: string | null;
  brand: string | null;
  description: string | null;
};

type BikeTagDocumentProps = {
  variant: BikeTagVariant;
  product: BikeTagProduct | null;
  appConfig: AppConfig;
};

const moneyFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

const normalizeText = (value: string | null | undefined) => value?.trim() ?? "";

const buildProductName = (variant: BikeTagVariant, product: BikeTagProduct | null) =>
  normalizeText(product?.name) || normalizeText(variant.product?.name) || normalizeText(variant.name) || variant.sku;

const buildVariantLabel = (variant: BikeTagVariant) => {
  const parts = [normalizeText(variant.name), normalizeText(variant.option)].filter(Boolean);
  const unique = Array.from(new Set(parts));
  if (unique.length === 0) {
    return "";
  }
  return unique.join(" / ");
};

const buildBarcodeValue = (variant: BikeTagVariant) =>
  normalizeText(variant.barcode) || normalizeText(variant.manufacturerBarcode) || normalizeText(variant.internalBarcode);

const buildSpecLines = (variant: BikeTagVariant, product: BikeTagProduct | null) => {
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
  push(buildVariantLabel(variant));

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

export const BikeTagDocument = ({ variant, product, appConfig }: BikeTagDocumentProps) => {
  const shopName = normalizeText(appConfig.store.businessName) || normalizeText(appConfig.store.name) || "CorePOS";
  const logoUrl = normalizeText(appConfig.store.preferredLogoUrl);
  const productName = buildProductName(variant, product);
  const variantLabel = buildVariantLabel(variant);
  const barcodeValue = buildBarcodeValue(variant);
  const specLines = buildSpecLines(variant, product);
  const priceLabel = moneyFormatter.format(variant.retailPricePence / 100);
  const supportLine = [normalizeText(product?.brand || variant.product?.brand), normalizeText(product?.category || variant.product?.category)]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="bike-tag-document" data-testid="bike-tag-document">
      <section className="bike-tag-document__panel bike-tag-document__panel--front">
        <div className="bike-tag-document__brand-strip">
          <div className="bike-tag-document__brand-lockup">
            {logoUrl ? (
              <img className="bike-tag-document__store-logo" src={logoUrl} alt={`${shopName} logo`} />
            ) : (
              <CorePosLogo variant="full" size={44} className="bike-tag-document__fallback-logo" />
            )}
            <div className="bike-tag-document__brand-copy">
              <span className="bike-tag-document__brand-name">{shopName}</span>
              <span className="bike-tag-document__brand-subtitle">Folded bike tag</span>
            </div>
          </div>
          {supportLine ? (
            <span className="bike-tag-document__front-note">{supportLine}</span>
          ) : null}
        </div>

        <div className="bike-tag-document__price-block">
          <div className="bike-tag-document__price-eyebrow">Retail price</div>
          <div className="bike-tag-document__price-value">{priceLabel}</div>
          <div className="bike-tag-document__price-support">
            Ready for the shop floor. Print on A5 portrait and fold once to A6.
          </div>
        </div>
      </section>

      <section className="bike-tag-document__panel bike-tag-document__panel--back">
        <div className="bike-tag-document__back-copy">
          <div className="bike-tag-document__eyebrow">Bike details</div>
          <h1>{productName}</h1>
          {variantLabel ? <p className="bike-tag-document__variant-line">{variantLabel}</p> : null}
          <ul className="bike-tag-document__spec-list">
            {specLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>

        <div className="bike-tag-document__barcode-panel">
          {barcodeValue ? (
            <>
              <BarcodeGraphic value={barcodeValue} className="bike-tag-document__barcode-art" />
              <div className="bike-tag-document__barcode-value mono-text">{barcodeValue}</div>
            </>
          ) : (
            <div className="bike-tag-document__barcode-fallback">
              <strong>No barcode stored</strong>
              <span className="mono-text">SKU {variant.sku}</span>
            </div>
          )}
        </div>
      </section>
    </article>
  );
};
