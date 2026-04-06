import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { useAppConfig } from "../config/appConfig";
import {
  BikeTagDocument,
  type BikeTagProduct,
  type BikeTagVariant,
} from "../features/labels/BikeTagDocument";

export const BikeTagPrintPage = () => {
  const { variantId } = useParams<{ variantId: string }>();
  const appConfig = useAppConfig();
  const { error } = useToasts();
  const [variant, setVariant] = useState<BikeTagVariant | null>(null);
  const [product, setProduct] = useState<BikeTagProduct | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!variantId) {
      return;
    }

    let active = true;
    const loadData = async () => {
      setLoading(true);
      try {
        const variantPayload = await apiGet<BikeTagVariant>(`/api/variants/${encodeURIComponent(variantId)}`);
        if (!active) {
          return;
        }

        setVariant(variantPayload);

        if (variantPayload.product?.id || variantPayload.productId) {
          const productId = variantPayload.product?.id || variantPayload.productId;
          const productPayload = await apiGet<BikeTagProduct>(`/api/products/${encodeURIComponent(productId)}`);
          if (active) {
            setProduct(productPayload);
          }
        } else if (active) {
          setProduct(null);
        }
      } catch (loadError) {
        if (active) {
          setVariant(null);
          setProduct(null);
          error(loadError instanceof Error ? loadError.message : "Failed to load bike tag");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadData();
    return () => {
      active = false;
    };
  }, [error, variantId]);

  useEffect(() => {
    if (!variant) {
      return undefined;
    }

    const previousTitle = document.title;
    document.title = `Bike tag · ${variant.product?.name || variant.sku}`;
    return () => {
      document.title = previousTitle;
    };
  }, [variant]);

  const printPageStyle = useMemo(() => (
    `@media print {
      @page {
        size: A5 landscape;
        margin: 6mm;
      }
    }`
  ), []);

  if (!variantId) {
    return <div className="page-shell"><p>Missing bike tag id.</p></div>;
  }

  return (
    <div className="bike-tag-print-page">
      <style media="print">{printPageStyle}</style>

      <div className="bike-tag-print-page__actions">
        <div className="actions-inline">
          <Link to={`/inventory/${variantId}`}>Back to inventory detail</Link>
          <Link to={`/inventory/${variantId}/label`}>Open product label</Link>
        </div>
        <button type="button" className="primary" onClick={() => window.print()} disabled={!variant || loading}>
          {loading ? "Loading..." : "Print 2-up bike tags"}
        </button>
      </div>

      <div className="bike-tag-print-page__copy">
        <h1>Bike Tag</h1>
        <p className="muted-text">
          A5 landscape browser print layout with 2 identical A6 bike tags side by side, ready to print and cut. Use the print dialog to choose the Xerox or other office printer.
        </p>
      </div>

      <div className="bike-tag-print-page__sheet">
        {variant ? (
          <BikeTagDocument variant={variant} product={product} appConfig={appConfig} />
        ) : loading ? (
          <div className="card bike-tag-print-page__state-card">Loading bike tag…</div>
        ) : (
          <div className="card bike-tag-print-page__state-card">Bike tag is not available.</div>
        )}
      </div>
    </div>
  );
};
