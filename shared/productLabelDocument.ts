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
const PADDING_X = 18;
const PADDING_Y = 16;
const PRICE_FONT = "bold 30px Arial";
const SHOP_FONT = "bold 16px Arial";
const TITLE_FONT = "bold 26px Arial";
const SECONDARY_FONT = "16px Arial";
const BARCODE_TEXT_FONT = "18px monospace";
const TITLE_MAX_LINES = 2;
const LINE_HEIGHT = 28;

const mmToPx = (value: number) => Math.round((value / 25.4) * LABEL_DPI);

export const PRODUCT_LABEL_WIDTH_PX = mmToPx(LABEL_WIDTH_MM);
export const PRODUCT_LABEL_HEIGHT_PX = mmToPx(LABEL_HEIGHT_MM);

const BARCODE_REGION_HEIGHT = 120;
const BARCODE_TEXT_HEIGHT = 28;
const BARCODE_REGION_TOP = PRODUCT_LABEL_HEIGHT_PX - PADDING_Y - BARCODE_REGION_HEIGHT - BARCODE_TEXT_HEIGHT;

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const sanitizeBarcode = (value: string | null) => value?.trim() ?? "";

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

const drawWrappedTitle = (
  ctx: ReturnType<typeof createCanvas>["getContext"],
  text: string,
  x: number,
  y: number,
  maxWidth: number,
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

    if (lines.length === TITLE_MAX_LINES) {
      break;
    }
  }

  if (lines.length < TITLE_MAX_LINES && currentLine) {
    lines.push(currentLine);
  }

  const finalLines = lines.slice(0, TITLE_MAX_LINES);
  if (finalLines.length === TITLE_MAX_LINES && words.length > finalLines.join(" ").split(/\s+/).length) {
    finalLines[TITLE_MAX_LINES - 1] = fitText(ctx, finalLines[TITLE_MAX_LINES - 1], maxWidth);
  }

  finalLines.forEach((line, index) => {
    ctx.fillText(fitText(ctx, line, maxWidth), x, y + index * LINE_HEIGHT);
  });
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
  const rightEdge = PRODUCT_LABEL_WIDTH_PX - PADDING_X;
  const contentWidth = PRODUCT_LABEL_WIDTH_PX - PADDING_X * 2;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PRODUCT_LABEL_WIDTH_PX, PRODUCT_LABEL_HEIGHT_PX);
  ctx.textBaseline = "top";
  ctx.fillStyle = "#111111";

  ctx.font = SHOP_FONT;
  ctx.fillText(fitText(ctx, label.shopName, contentWidth - 140), PADDING_X, PADDING_Y);

  ctx.font = PRICE_FONT;
  const priceText = formatMoney(label.pricePence);
  const priceWidth = ctx.measureText(priceText).width;
  ctx.fillText(priceText, rightEdge - priceWidth, PADDING_Y - 4);

  const secondaryParts = [label.brand, label.sku].filter(Boolean);
  const secondaryLine = secondaryParts.length > 0 ? secondaryParts.join(" · ") : "Preferred operational barcode";

  ctx.font = SECONDARY_FONT;
  ctx.fillStyle = "#4b5563";
  ctx.fillText(fitText(ctx, secondaryLine, contentWidth), PADDING_X, 58);

  ctx.font = TITLE_FONT;
  ctx.fillStyle = "#111111";
  const title = label.variantName ? `${label.productName} · ${label.variantName}` : label.productName;
  drawWrappedTitle(ctx, title, PADDING_X, 84, contentWidth);

  ctx.strokeStyle = "#d1d5db";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PADDING_X, BARCODE_REGION_TOP - 8);
  ctx.lineTo(rightEdge, BARCODE_REGION_TOP - 8);
  ctx.stroke();

  if (barcodeValue) {
    drawBarcode(ctx, barcodeValue, PADDING_X, BARCODE_REGION_TOP, contentWidth);
    ctx.font = BARCODE_TEXT_FONT;
    ctx.fillStyle = "#111111";
    const barcodeText = fitText(ctx, barcodeValue, contentWidth);
    const barcodeTextWidth = ctx.measureText(barcodeText).width;
    ctx.fillText(
      barcodeText,
      Math.max(PADDING_X, (PRODUCT_LABEL_WIDTH_PX - barcodeTextWidth) / 2),
      PRODUCT_LABEL_HEIGHT_PX - PADDING_Y - BARCODE_TEXT_HEIGHT + 4,
    );
  } else {
    ctx.font = "bold 20px Arial";
    ctx.fillStyle = "#6b7280";
    ctx.fillText("BARCODE PENDING", PADDING_X, BARCODE_REGION_TOP + 26);
    ctx.font = SECONDARY_FONT;
    ctx.fillText("Add a preferred barcode before direct-printing this label.", PADDING_X, BARCODE_REGION_TOP + 62);
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
