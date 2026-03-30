import CorePosLogo from "../../components/branding/CorePosLogo";

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

export const ProductLabel = ({
  shopName = "CorePOS",
  productName,
  variantName,
  brand,
  sku,
  pricePence,
  barcode,
}: ProductLabelProps) => {
  const title = [productName, variantName].filter(Boolean).join(" · ") || productName;
  const secondaryLine = brand || sku || "Preferred operational barcode";
  const barcodeText = barcode || "Barcode pending";

  return (
    <article className="product-label" data-testid="product-label">
      <div className="product-label__header">
        <div className="product-label__brand-block">
          <CorePosLogo variant="icon" size={26} className="product-label__logo" />
          <div className="product-label__brand-copy">
            <span className="product-label__brand-name">{shopName}</span>
            <span className="product-label__brand-subtitle">Product label</span>
          </div>
        </div>
        <div className="product-label__price">{formatMoney(pricePence)}</div>
      </div>

      <div className="product-label__body">
        <p className="product-label__secondary">{secondaryLine}</p>
        <h1 className="product-label__title">{title}</h1>
      </div>

      <div className="product-label__barcode">
        <div className="product-label__barcode-art" aria-hidden="true">
          {barcodeText}
        </div>
        <div className="product-label__barcode-number mono-text">{barcodeText}</div>
      </div>
    </article>
  );
};
