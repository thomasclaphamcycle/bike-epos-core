import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { ProductLabel } from "../features/labels/ProductLabel";
import {
  getProductLabelDirectPrintErrorMessage,
  getProductLabelDirectPrintSuccessMessage,
  printProductLabelDirect,
  type ProductLabelDirectPrintResponse,
} from "../features/labels/productLabelPrinting";

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
  const { error, success } = useToasts();
  const [variant, setVariant] = useState<VariantLabelDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [directPrintingCopies, setDirectPrintingCopies] = useState<number | null>(null);
  const [lastDirectPrint, setLastDirectPrint] = useState<ProductLabelDirectPrintResponse | null>(null);

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

  useEffect(() => {
    document.body.classList.add("product-label-print-body");

    const style = document.createElement("style");
    style.setAttribute("media", "print");
    style.dataset.productLabelPageSize = "true";
    style.textContent = "@page { size: 57mm 32mm; margin: 0; }";
    document.head.appendChild(style);

    return () => {
      document.body.classList.remove("product-label-print-body");
      style.remove();
    };
  }, []);

  if (!variantId) {
    return <div className="page-shell"><p>Missing product label id.</p></div>;
  }

  const handleDirectPrint = async (copies: number) => {
    if (!variantId || !variant) {
      return;
    }

    setDirectPrintingCopies(copies);
    try {
      const payload = await printProductLabelDirect(variantId, { copies });
      setLastDirectPrint(payload);
      success(getProductLabelDirectPrintSuccessMessage(payload));
    } catch (printError) {
      error(getProductLabelDirectPrintErrorMessage(printError));
    } finally {
      setDirectPrintingCopies(null);
    }
  };

  return (
    <div className="product-label-print-page">
      <div className="product-label-print-page__actions">
        <Link to={`/inventory/${variantId}`}>Back to inventory detail</Link>
        <div className="product-label-print-page__quantity-actions">
          {[1, 2, 3].map((copies) => (
            <button
              key={copies}
              type="button"
              className={copies === 1 ? "primary" : undefined}
              onClick={() => void handleDirectPrint(copies)}
              disabled={!variant || loading || directPrintingCopies !== null}
            >
              {directPrintingCopies === copies
                ? `Printing ${copies}...`
                : copies === 1
                  ? "Direct print 1"
                  : `Print ${copies}`}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => window.print()} disabled={!variant || loading || directPrintingCopies !== null}>
          {loading ? "Loading..." : "Browser print fallback"}
        </button>
      </div>

      <div className="product-label-print-page__copy">
        <h1>Product Label</h1>
        <p className="muted-text">
          Direct print uses the default registered Dymo product-label printer plus the configured local Dymo print helper from Settings. Browser print stays available as a fallback when you need to preview or troubleshoot layout.
        </p>
      </div>

      {lastDirectPrint ? (
        <div className="card">
          <strong>Last direct print</strong>
          <p className="muted-text">
            {lastDirectPrint.printJob.simulated
              ? `Rendered in DRY_RUN mode for ${lastDirectPrint.printer.name}.`
              : `Sent to ${lastDirectPrint.printer.name} via ${lastDirectPrint.printer.transportMode}.`}
          </p>
          <p className="muted-text">
            Job {lastDirectPrint.printJob.jobId} · {lastDirectPrint.printJob.copies} cop{lastDirectPrint.printJob.copies === 1 ? "y" : "ies"} · target {lastDirectPrint.printJob.printerTarget}
            {lastDirectPrint.printJob.outputPath ? ` · ${lastDirectPrint.printJob.outputPath}` : ""}
          </p>
        </div>
      ) : null}

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
