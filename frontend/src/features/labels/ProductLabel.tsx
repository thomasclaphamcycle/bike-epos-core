import { BarcodeGraphic } from "./BarcodeGraphic";

type ProductLabelProps = {
  shopName?: string;
  productName: string;
  variantName?: string | null;
  brand?: string | null;
  sku?: string | null;
  pricePence: number;
  barcode: string | null;
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const normalizeShopName = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^corepos demo store ltd$/i.test(trimmed)) {
    return "CorePOS";
  }
  return trimmed;
};

const normalizeVariantName = (productName: string, variantName?: string | null) => {
  const trimmed = variantName?.trim() ?? "";
  if (!trimmed) {
    return "";
  }
  if (trimmed.localeCompare(productName.trim(), undefined, { sensitivity: "accent" }) === 0) {
    return "";
  }
  return trimmed;
};

export const ProductLabel = ({
  shopName = "CorePOS",
  productName,
  variantName,
  sku,
  pricePence,
  barcode,
}: ProductLabelProps) => {
  const shopLine = normalizeShopName(shopName);
  const variantLine = normalizeVariantName(productName, variantName);
  const barcodeText = sku || barcode || "Barcode pending";

  return (
    <article className="product-label" data-testid="product-label">
      <div className="product-label__header">
        {shopLine ? <span className="product-label__brand-name">{shopLine}</span> : <span />}
        <div className="product-label__price">{formatMoney(pricePence)}</div>
      </div>

      <div className="product-label__body">
        <h1 className="product-label__title">{productName}</h1>
        {variantLine ? <p className="product-label__variant">{variantLine}</p> : null}
      </div>

      <div className="product-label__barcode">
        <BarcodeGraphic value={barcode} className="product-label__barcode-art" />
        <div className="product-label__barcode-number mono-text">{barcodeText}</div>
      </div>
    </article>
  );
};
