import { useEffect, useState } from "react";
import corePosLogoLight from "../../assets/branding/corepos-logo-light.png";
import { BarcodeGraphic } from "./BarcodeGraphic";

const LOGO_WHITE_THRESHOLD = 245;
const THERMAL_LOGO_MULTIPLIER = 0.78;

type ProductLabelProps = {
  shopName?: string;
  productName: string;
  variantName?: string | null;
  brand?: string | null;
  logoUrl?: string | null;
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
  if (/^corepos(?: demo store ltd)?$/i.test(trimmed)) {
    return "";
  }
  return trimmed;
};

const normalizeMetaLine = (brand: string | null | undefined, shopName: string) => {
  const trimmedBrand = brand?.trim() ?? "";
  if (trimmedBrand) {
    return trimmedBrand;
  }
  return normalizeShopName(shopName);
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
  brand,
  logoUrl,
  sku,
  pricePence,
  barcode,
}: ProductLabelProps) => {
  const metaLine = normalizeMetaLine(brand, shopName);
  const variantLine = normalizeVariantName(productName, variantName);
  const barcodeText = barcode || sku || "Barcode pending";
  const [logoFailed, setLogoFailed] = useState(false);
  const effectiveLogoUrl = logoUrl?.trim() ? logoUrl : corePosLogoLight;
  const [croppedLogoUrl, setCroppedLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    setLogoFailed(false);
  }, [logoUrl]);

  useEffect(() => {
    let cancelled = false;

    if (!effectiveLogoUrl) {
      setCroppedLogoUrl(null);
      return undefined;
    }

    const image = new window.Image();
    image.decoding = "async";
    image.crossOrigin = "anonymous";

    image.onload = () => {
      if (cancelled) {
        return;
      }

      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          setCroppedLogoUrl(effectiveLogoUrl);
          return;
        }

        ctx.drawImage(image, 0, 0);
        const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);

        let minX = width;
        let minY = height;
        let maxX = -1;
        let maxY = -1;

        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const offset = (y * width + x) * 4;
            const alpha = data[offset + 3];
            const red = data[offset];
            const green = data[offset + 1];
            const blue = data[offset + 2];
            const isVisibleInk =
              alpha > 20
              && !(red >= LOGO_WHITE_THRESHOLD && green >= LOGO_WHITE_THRESHOLD && blue >= LOGO_WHITE_THRESHOLD);

            if (!isVisibleInk) {
              continue;
            }

            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }

        if (maxX < minX || maxY < minY) {
          setCroppedLogoUrl(effectiveLogoUrl);
          return;
        }

        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          if (alpha <= 20) {
            continue;
          }

          if (
            data[i] >= LOGO_WHITE_THRESHOLD
            && data[i + 1] >= LOGO_WHITE_THRESHOLD
            && data[i + 2] >= LOGO_WHITE_THRESHOLD
          ) {
            continue;
          }

          const gray = Math.max(
            0,
            Math.min(
              255,
              Math.round((data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) * THERMAL_LOGO_MULTIPLIER),
            ),
          );
          data[i] = gray;
          data[i + 1] = gray;
          data[i + 2] = gray;
        }

        ctx.putImageData(new ImageData(data, width, height), 0, 0);

        const croppedWidth = maxX - minX + 1;
        const croppedHeight = maxY - minY + 1;
        const croppedCanvas = document.createElement("canvas");
        croppedCanvas.width = croppedWidth;
        croppedCanvas.height = croppedHeight;
        const croppedCtx = croppedCanvas.getContext("2d");
        if (!croppedCtx) {
          setCroppedLogoUrl(effectiveLogoUrl);
          return;
        }

        croppedCtx.drawImage(canvas, minX, minY, croppedWidth, croppedHeight, 0, 0, croppedWidth, croppedHeight);
        setCroppedLogoUrl(croppedCanvas.toDataURL("image/png"));
      } catch {
        setCroppedLogoUrl(effectiveLogoUrl);
      }
    };

    image.onerror = () => {
      if (!cancelled) {
        setCroppedLogoUrl(effectiveLogoUrl);
      }
    };

    image.src = effectiveLogoUrl;

    return () => {
      cancelled = true;
    };
  }, [effectiveLogoUrl]);

  return (
    <article className="product-label" data-testid="product-label">
      {effectiveLogoUrl && !logoFailed ? (
        <div className="product-label__logo-wrap">
          <img
            className="product-label__logo"
            src={croppedLogoUrl || effectiveLogoUrl}
            alt={`${metaLine || shopName} logo`}
            onError={() => setLogoFailed(true)}
          />
        </div>
      ) : metaLine ? (
        <div className="product-label__meta-line">{metaLine}</div>
      ) : null}

      <div className="product-label__body">
        <h1 className="product-label__title">{productName}</h1>
        {variantLine ? <div className="product-label__detail-line"><span className="product-label__variant">{variantLine}</span></div> : null}
        <div className="product-label__price-band">
          <span className="product-label__price-inline">{formatMoney(pricePence)}</span>
        </div>
      </div>

      <div className="product-label__barcode">
        <BarcodeGraphic value={barcode} className="product-label__barcode-art" />
        <div className="product-label__barcode-number mono-text">{barcodeText}</div>
      </div>
    </article>
  );
};
