import { createCanvas } from "canvas";
import JsBarcode from "jsbarcode";
import {
  PRODUCT_LABEL_DOCUMENT_FORMAT,
  PRODUCT_LABEL_DOCUMENT_MIME_TYPE,
  PRODUCT_LABEL_RENDER_FORMAT,
  type ProductLabelPayload,
} from "./productLabelPrintContract";

const LABEL_WIDTH_MM = 57;
const LABEL_HEIGHT_MM = 32;
const LABEL_DPI = 300;
const PADDING_X = 20;
const PADDING_Y = 14;
const META_FONT = "600 11px Arial";
const TITLE_FONT = "bold 31px Arial";
const VARIANT_FONT = "600 15px Arial";
const BARCODE_TEXT_FONT = "600 13px monospace";
const PRODUCT_NAME_MAX_LINES = 2;
const PRODUCT_LINE_HEIGHT = 28;
const PRICE_FONT_FAMILY = "Arial";
const PRICE_FONT_START_SIZE = 46;
const PRICE_FONT_MIN_SIZE = 34;

const mmToPx = (value: number) => Math.round((value / 25.4) * LABEL_DPI);

export const PRODUCT_LABEL_WIDTH_PX = mmToPx(LABEL_WIDTH_MM);
export const PRODUCT_LABEL_HEIGHT_PX = mmToPx(LABEL_HEIGHT_MM);

const BARCODE_REGION_HEIGHT = 102;
const BARCODE_TEXT_HEIGHT = 16;
const BARCODE_REGION_TOP = PRODUCT_LABEL_HEIGHT_PX - PADDING_Y - BARCODE_REGION_HEIGHT - BARCODE_TEXT_HEIGHT;

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const sanitizeBarcode = (value: string | null) => value?.trim() ?? "";
const sanitizeLine = (value: string | null | undefined) => value?.trim() ?? "";

const normalizeShopLine = (value: string) => {
  const trimmed = sanitizeLine(value);
  if (!trimmed) {
    return "";
  }
  if (/^corepos(?: demo store ltd)?$/i.test(trimmed)) {
    return "";
  }
  return trimmed;
};

const normalizeMetaLine = (brand: string | null | undefined, shopName: string) => {
  const trimmedBrand = sanitizeLine(brand);
  if (trimmedBrand) {
    return trimmedBrand;
  }
  return normalizeShopLine(shopName);
};

const normalizeVariantLine = (productName: string, variantName: string | null) => {
  const trimmedVariant = sanitizeLine(variantName);
  if (!trimmedVariant) {
    return "";
  }

  if (trimmedVariant.localeCompare(productName.trim(), undefined, { sensitivity: "accent" }) === 0) {
    return "";
  }

  return trimmedVariant;
};

const getBarcodeLineWidth = (value: string) => {
  if (value.length >= 24) {
    return 1.15;
  }
  if (value.length >= 18) {
    return 1.3;
  }
  if (value.length >= 12) {
    return 1.45;
  }
  return 1.6;
};

const getBarcodeHeight = (value: string) => (value.length >= 20 ? 86 : 92);

const setFittedPriceFont = (
  ctx: ReturnType<typeof createCanvas>["getContext"],
  text: string,
  maxWidth: number,
) => {
  for (let size = PRICE_FONT_START_SIZE; size >= PRICE_FONT_MIN_SIZE; size -= 2) {
    ctx.font = `bold ${size}px ${PRICE_FONT_FAMILY}`;
    if (ctx.measureText(text).width <= maxWidth) {
      return;
    }
  }

  ctx.font = `bold ${PRICE_FONT_MIN_SIZE}px ${PRICE_FONT_FAMILY}`;
};

const fitText = (
  ctx: ReturnType<typeof createCanvas>["getContext"],
  text: string,
  maxWidth: number,
) => {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }

  let candidate = text;
  while (candidate.length > 1) {
    candidate = candidate.slice(0, -1).trimEnd();
    const withEllipsis = `${candidate}…`;
    if (ctx.measureText(withEllipsis).width <= maxWidth) {
      return withEllipsis;
    }
  }

  return "…";
};

const wrapTextLines = (
  ctx: ReturnType<typeof createCanvas>["getContext"],
  text: string,
  maxWidth: number,
  maxLines: number,
) => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      currentLine = candidate;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      lines.push(fitText(ctx, word, maxWidth));
      currentLine = "";
    }

    if (lines.length === maxLines) {
      break;
    }
  }

  if (lines.length < maxLines && currentLine) {
    lines.push(currentLine);
  }

  const finalLines = lines.slice(0, maxLines);
  if (finalLines.length === maxLines && words.length > finalLines.join(" ").split(/\s+/).length) {
    finalLines[maxLines - 1] = fitText(ctx, finalLines[maxLines - 1], maxWidth);
  }

  return finalLines.map((line) => fitText(ctx, line, maxWidth));
};

const drawBarcode = (
  ctx: ReturnType<typeof createCanvas>["getContext"],
  barcodeValue: string,
  x: number,
  y: number,
  width: number,
) => {
  const barcodeCanvas = createCanvas(width, BARCODE_REGION_HEIGHT);

  JsBarcode(barcodeCanvas, barcodeValue, {
    format: "CODE128",
    displayValue: false,
    margin: 0,
    background: "#ffffff",
    lineColor: "#111111",
    width: getBarcodeLineWidth(barcodeValue),
    height: getBarcodeHeight(barcodeValue),
  });

  ctx.drawImage(barcodeCanvas, x, y, width, BARCODE_REGION_HEIGHT);
};

export type RenderedProductLabelDocument = {
  buffer: Buffer;
  widthPx: number;
  heightPx: number;
  documentFormat: typeof PRODUCT_LABEL_RENDER_FORMAT;
  imageFormat: typeof PRODUCT_LABEL_DOCUMENT_FORMAT;
  mimeType: typeof PRODUCT_LABEL_DOCUMENT_MIME_TYPE;
  extension: "png";
};

export const renderProductLabelDocument = (label: ProductLabelPayload): RenderedProductLabelDocument => {
  const canvas = createCanvas(PRODUCT_LABEL_WIDTH_PX, PRODUCT_LABEL_HEIGHT_PX);
  const ctx = canvas.getContext("2d");
  const barcodeValue = sanitizeBarcode(label.barcode);
  const productName = sanitizeLine(label.productName) || "Unnamed product";
  const variantLine = normalizeVariantLine(productName, label.variantName);
  const metaLine = normalizeMetaLine(label.brand, label.shopName);
  const skuLine = sanitizeLine(label.sku);
  const contentWidth = PRODUCT_LABEL_WIDTH_PX - PADDING_X * 2;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PRODUCT_LABEL_WIDTH_PX, PRODUCT_LABEL_HEIGHT_PX);
  ctx.textBaseline = "top";
  ctx.fillStyle = "#111111";

  let cursorY = PADDING_Y;

  if (metaLine) {
    ctx.font = META_FONT;
    ctx.fillStyle = "#6b7280";
    ctx.fillText(fitText(ctx, metaLine.toUpperCase(), contentWidth), PADDING_X, cursorY);
    cursorY += 24;
  }

  ctx.font = TITLE_FONT;
  ctx.fillStyle = "#111111";
  const productLines = wrapTextLines(ctx, productName, contentWidth, PRODUCT_NAME_MAX_LINES);
  productLines.forEach((line, index) => {
    ctx.fillText(line, PADDING_X, cursorY + index * PRODUCT_LINE_HEIGHT);
  });
  cursorY += productLines.length * PRODUCT_LINE_HEIGHT;

  if (variantLine) {
    ctx.font = VARIANT_FONT;
    ctx.fillStyle = "#6b7280";
    cursorY += 8;
    ctx.fillText(fitText(ctx, variantLine, contentWidth), PADDING_X, cursorY);
    cursorY += 22;
  } else {
    cursorY += 12;
  }

  const priceText = formatMoney(label.pricePence);
  setFittedPriceFont(ctx, priceText, contentWidth);
  ctx.fillStyle = "#111111";
  const priceWidth = ctx.measureText(priceText).width;
  ctx.fillText(priceText, PADDING_X + Math.max(0, (contentWidth - priceWidth) / 2), cursorY);

  if (barcodeValue) {
    drawBarcode(ctx, barcodeValue, PADDING_X, BARCODE_REGION_TOP, contentWidth);
    ctx.font = BARCODE_TEXT_FONT;
    ctx.fillStyle = "#4b5563";
    const barcodeText = fitText(ctx, skuLine || barcodeValue, contentWidth);
    const barcodeTextWidth = ctx.measureText(barcodeText).width;
    ctx.fillText(
      barcodeText,
      Math.max(PADDING_X, (PRODUCT_LABEL_WIDTH_PX - barcodeTextWidth) / 2),
      PRODUCT_LABEL_HEIGHT_PX - PADDING_Y - BARCODE_TEXT_HEIGHT + 1,
    );
  } else {
    ctx.font = "bold 18px Arial";
    ctx.fillStyle = "#6b7280";
    const fallbackText = "BARCODE PENDING";
    const fallbackWidth = ctx.measureText(fallbackText).width;
    ctx.fillText(fallbackText, PADDING_X + Math.max(0, (contentWidth - fallbackWidth) / 2), BARCODE_REGION_TOP + 34);
    if (skuLine) {
      ctx.font = BARCODE_TEXT_FONT;
      const fallbackSku = fitText(ctx, skuLine, contentWidth);
      const fallbackSkuWidth = ctx.measureText(fallbackSku).width;
      ctx.fillText(
        fallbackSku,
        PADDING_X + Math.max(0, (contentWidth - fallbackSkuWidth) / 2),
        PRODUCT_LABEL_HEIGHT_PX - PADDING_Y - BARCODE_TEXT_HEIGHT + 1,
      );
    }
  }

  return {
    buffer: canvas.toBuffer("image/png"),
    widthPx: PRODUCT_LABEL_WIDTH_PX,
    heightPx: PRODUCT_LABEL_HEIGHT_PX,
    documentFormat: PRODUCT_LABEL_RENDER_FORMAT,
    imageFormat: PRODUCT_LABEL_DOCUMENT_FORMAT,
    mimeType: PRODUCT_LABEL_DOCUMENT_MIME_TYPE,
    extension: "png",
  };
};
