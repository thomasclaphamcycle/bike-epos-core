import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet, apiGetBlob } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import {
  getBikeTagDirectPrintErrorMessage,
  getBikeTagDirectPrintSuccessMessage,
  printBikeTagDirect,
  type BikeTagDirectPrintResponse,
} from "../features/labels/bikeTagPrinting";

type BikeTagVariantDetail = {
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

export const BikeTagPrintPage = () => {
  const { variantId } = useParams<{ variantId: string }>();
  const { error, success } = useToasts();
  const [variant, setVariant] = useState<BikeTagVariantDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [directPrinting, setDirectPrinting] = useState(false);
  const [lastDirectPrint, setLastDirectPrint] = useState<BikeTagDirectPrintResponse | null>(null);

  useEffect(() => {
    if (!variantId) {
      return;
    }

    let active = true;
    const loadVariant = async () => {
      setLoading(true);
      try {
        const payload = await apiGet<BikeTagVariantDetail>(`/api/variants/${encodeURIComponent(variantId)}`);
        if (active) {
          setVariant(payload);
        }
      } catch (loadError) {
        if (active) {
          error(loadError instanceof Error ? loadError.message : "Failed to load bike tag");
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
    document.title = `Bike tag · ${variant.product?.name || variant.sku}`;
    return () => {
      document.title = previousTitle;
    };
  }, [variant]);

  useEffect(() => {
    if (!variantId) {
      return undefined;
    }

    let active = true;
    let objectUrl: string | null = null;

    const loadPreview = async () => {
      setPreviewLoading(true);
      try {
        const blob = await apiGetBlob(`/api/variants/${encodeURIComponent(variantId)}/bike-tag/document`);
        if (!active) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      } catch (loadError) {
        if (active) {
          setPreviewUrl(null);
          error(loadError instanceof Error ? loadError.message : "Failed to load bike tag preview");
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

  const handleDirectPrint = async () => {
    if (!variantId || !variant || directPrinting) {
      return;
    }

    setDirectPrinting(true);
    try {
      const payload = await printBikeTagDirect(variantId);
      setLastDirectPrint(payload);
      success(getBikeTagDirectPrintSuccessMessage(payload));
    } catch (printError) {
      error(getBikeTagDirectPrintErrorMessage(printError));
    } finally {
      setDirectPrinting(false);
    }
  };

  return (
    <div className="bike-tag-print-page">
      <style media="print">{printPageStyle}</style>

      <div className="bike-tag-print-page__actions">
        <div className="actions-inline">
          <Link className="button-link" to={`/inventory/${variantId}`}>Close preview</Link>
          <Link className="button-link" to={`/inventory/${variantId}/label`}>Open product label</Link>
        </div>
        <button type="button" className="primary" onClick={() => window.print()} disabled={!variant || loading}>
          {loading ? "Loading..." : "Print bike tag sheet"}
        </button>
      </div>

      <div className="bike-tag-print-page__copy">
        <h1>Bike Tag Preview</h1>
        <p className="muted-text">
          Exact A5 landscape bike-tag sheet preview. This is the same rendered 2-up A6 image CorePOS sends to direct print.
        </p>
        <p className="muted-text">
          Two identical A6 bike tags sit side by side on one A5 landscape sheet, ready to print and cut. Use Print to open the browser dialog if you need the fallback path.
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
            Job {lastDirectPrint.printJob.jobId} · {lastDirectPrint.printJob.copies} sheet{lastDirectPrint.printJob.copies === 1 ? "" : "s"} · target {lastDirectPrint.printJob.printerTarget}
            {lastDirectPrint.printJob.outputPath ? ` · ${lastDirectPrint.printJob.outputPath}` : ""}
          </p>
        </div>
      ) : null}

      <div className="bike-tag-print-page__sheet">
        {previewUrl ? (
          <div className="bike-tag-print-page__preview-stage">
            <img
              className="bike-tag-print-page__image-preview"
              data-testid="bike-tag-preview-image"
              src={previewUrl}
              alt={variant ? `${variant.product?.name || variant.sku} bike tag preview` : "Bike tag preview"}
            />
          </div>
        ) : loading || previewLoading ? (
          <div className="card bike-tag-print-page__state-card">Loading bike tag…</div>
        ) : (
          <div className="card bike-tag-print-page__state-card">Bike tag is not available.</div>
        )}
      </div>
    </div>
  );
};
