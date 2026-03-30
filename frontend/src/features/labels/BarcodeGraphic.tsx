import { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";

type BarcodeGraphicProps = {
  value: string | null;
  className?: string;
};

const getBarcodeLineWidth = (value: string) => {
  if (value.length >= 24) {
    return 0.92;
  }
  if (value.length >= 18) {
    return 1.02;
  }
  if (value.length >= 12) {
    return 1.12;
  }
  return 1.22;
};

const getBarcodeHeight = (value: string) => (value.length >= 20 ? 22 : 24);

export const BarcodeGraphic = ({ value, className }: BarcodeGraphicProps) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [renderError, setRenderError] = useState(false);
  const barcodeValue = value?.trim() ?? "";

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) {
      return;
    }

    if (!barcodeValue) {
      svg.innerHTML = "";
      setRenderError(false);
      return;
    }

    try {
      JsBarcode(svg, barcodeValue, {
        format: "CODE128",
        displayValue: false,
        margin: 0,
        background: "#ffffff",
        lineColor: "#0f1720",
        width: getBarcodeLineWidth(barcodeValue),
        height: getBarcodeHeight(barcodeValue),
      });
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      svg.setAttribute("preserveAspectRatio", "none");
      setRenderError(false);
    } catch {
      svg.innerHTML = "";
      setRenderError(true);
    }
  }, [barcodeValue]);

  if (!barcodeValue) {
    return (
      <div className={`barcode-graphic barcode-graphic--empty ${className ?? ""}`.trim()}>
        Barcode pending
      </div>
    );
  }

  if (renderError) {
    return (
      <div className={`barcode-graphic barcode-graphic--fallback ${className ?? ""}`.trim()}>
        Barcode unavailable
      </div>
    );
  }

  return (
    <div className={`barcode-graphic ${className ?? ""}`.trim()} data-testid="barcode-graphic">
      <svg ref={svgRef} role="img" aria-label={`Barcode ${barcodeValue}`} />
    </div>
  );
};
