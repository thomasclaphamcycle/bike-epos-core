import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet, apiGetBlob } from "../api/client";
import { useToasts } from "../components/ToastProvider";
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

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

  useEffect(() => {
    if (!variantId) {
      return undefined;
    }

    let active = true;
    let objectUrl: string | null = null;

    const loadPreview = async () => {
      setPreviewLoading(true);
      try {
        const blob = await apiGetBlob(`/api/variants/${encodeURIComponent(variantId)}/product-label/document`);
        if (!active) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      } catch (loadError) {
        if (active) {
          setPreviewUrl(null);
          error(loadError instanceof Error ? loadError.message : "Failed to load product label preview");
        }
      } finally {
        if (active) {
          setPreviewLoading(false);
        }
      }
    };

    void loadPreview();

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [error, variantId]);

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
          This preview now uses the same rendered label document as the Dymo direct-print path. Browser print stays available as a fallback when you need a paper preview or troubleshooting path.
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
        {previewUrl ? (
          <img
            className="product-label-print-page__image-preview"
            src={previewUrl}
            alt={variant ? `${variant.product?.name || variant.sku} label preview` : "Product label preview"}
          />
        ) : loading || previewLoading ? (
          <div className="card">Loading label…</div>
        ) : (
          <div className="card">Product label is not available.</div>
        )}
      </div>
    </div>
  );
};
