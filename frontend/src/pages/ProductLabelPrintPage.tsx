import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { ProductLabel } from "../features/labels/ProductLabel";

type VariantLabelDetail = {
  id: string;
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
    brand: string | null;
  };
};

export const ProductLabelPrintPage = () => {
  const { variantId } = useParams<{ variantId: string }>();
  const { error } = useToasts();
  const [variant, setVariant] = useState<VariantLabelDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!variantId) {
      return;
    }

    let active = true;
    const loadVariant = async () => {
      setLoading(true);
      try {
        const payload = await apiGet<VariantLabelDetail>(`/api/variants/${encodeURIComponent(variantId)}`);
        if (active) {
          setVariant(payload);
        }
      } catch (loadError) {
        if (active) {
          error(loadError instanceof Error ? loadError.message : "Failed to load product label");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadVariant();
    return () => {
      active = false;
    };
  }, [error, variantId]);

  useEffect(() => {
    if (!variant) {
      return undefined;
    }

    const previousTitle = document.title;
    document.title = `Label · ${variant.product?.name || variant.sku}`;
    return () => {
      document.title = previousTitle;
    };
  }, [variant]);

  if (!variantId) {
    return <div className="page-shell"><p>Missing product label id.</p></div>;
  }

  return (
    <div className="product-label-print-page">
      <div className="product-label-print-page__actions">
        <Link to={`/inventory/${variantId}`}>Back to inventory detail</Link>
        <button type="button" className="primary" onClick={() => window.print()} disabled={!variant || loading}>
          {loading ? "Loading..." : "Print label"}
        </button>
      </div>

      <div className="product-label-print-page__copy">
        <h1>Product Label</h1>
        <p className="muted-text">
          Prints the preferred operational barcode. Manufacturer barcodes stay preferred when present; CorePOS internal barcodes are only used as fallback.
        </p>
      </div>

      <div className="product-label-print-page__sheet">
        {variant ? (
          <ProductLabel
            productName={variant.product?.name || variant.sku}
            variantName={variant.name || variant.option || null}
            brand={variant.product?.brand || null}
            sku={variant.sku}
            pricePence={variant.retailPricePence}
            barcode={variant.barcode}
          />
        ) : loading ? (
          <div className="card">Loading label…</div>
        ) : (
          <div className="card">Product label is not available.</div>
        )}
      </div>
    </div>
  );
};
