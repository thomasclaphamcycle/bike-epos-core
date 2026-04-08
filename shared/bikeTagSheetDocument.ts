import { createCanvas, Image } from "canvas";
import JsBarcode from "jsbarcode";
import {
  BIKE_TAG_DOCUMENT_FORMAT,
  BIKE_TAG_DOCUMENT_MIME_TYPE,
  BIKE_TAG_RENDER_FORMAT,
} from "./bikeTagPrintContract";

export type BikeTagSheetRenderInput = {
  shopName: string;
  logoDataUrl?: string | null;
  productName: string;
  variantLabel: string;
  priceLabel: string;
  barcodeValue: string;
  specLines: string[];
  supportLine?: string;
  sku?: string | null;
};

const SHEET_WIDTH_MM = 210;
const SHEET_HEIGHT_MM = 148;
const SHEET_DPI = 300;
const SHEET_PADDING = 52;
const PANEL_GAP = 42;
const PANEL_PADDING_X = 44;
const PANEL_PADDING_Y = 38;
const BARCODE_BLOCK_HEIGHT = 112;
const PANEL_RADIUS = 18;
const LOGO_MAX_WIDTH = 442;
const LOGO_MAX_HEIGHT = 118;
const CUT_GUIDE_MARGIN = 96;
const LOWER_CLUSTER_SHIFT_MM = 30;

const mmToPx = (value: number) => Math.round((value / 25.4) * SHEET_DPI);

export const BIKE_TAG_SHEET_WIDTH_PX = mmToPx(SHEET_WIDTH_MM);
export const BIKE_TAG_SHEET_HEIGHT_PX = mmToPx(SHEET_HEIGHT_MM);

const moneyLikeText = (value: string) => value.trim() || "£0.00";
const safeText = (value: string | null | undefined) => value?.trim() ?? "";

const wrapTextLines = (
  ctx: ReturnType<typeof createCanvas>["getContext"],
  text: string,
  maxWidth: number,
  maxLines: number,
) => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let currentLine = "";

  const fitText = (candidate: string) => {
    if (ctx.measureText(candidate).width <= maxWidth) {
      return candidate;
    }

    let next = candidate;
    while (next.length > 1) {
      next = next.slice(0, -1).trimEnd();
      const withEllipsis = `${next}…`;
      if (ctx.measureText(withEllipsis).width <= maxWidth) {
        return withEllipsis;
      }
    }

    return "…";
  };

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
      lines.push(fitText(word));
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
    finalLines[maxLines - 1] = fitText(finalLines[maxLines - 1]);
  }

  return finalLines.map((line) => fitText(line));
};

const drawRoundedRect = (
  ctx: ReturnType<typeof createCanvas>["getContext"],
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) => {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
};

const loadLogoImage = (logoDataUrl: string | null | undefined) => {
  const normalized = safeText(logoDataUrl);
  if (!normalized) {
    return null;
  }

  try {
    const image = new Image();
    image.src = normalized;
    return image;
  } catch {
    return null;
  }
};

const cropLogoCanvas = (image: Image) => {
  const scratch = createCanvas(image.width, image.height);
  const scratchCtx = scratch.getContext("2d");
  scratchCtx.drawImage(image, 0, 0, image.width, image.height);
  const imageData = scratchCtx.getImageData(0, 0, image.width, image.height);
  const { data, width, height } = imageData;

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
      const isVisibleInk = alpha > 20 && !(red >= 250 && green >= 250 && blue >= 250);

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
    return scratch;
  }

  const cropped = createCanvas(maxX - minX + 1, maxY - minY + 1);
  const croppedCtx = cropped.getContext("2d");
  croppedCtx.drawImage(
    scratch,
    minX,
    minY,
    maxX - minX + 1,
    maxY - minY + 1,
    0,
    0,
    maxX - minX + 1,
    maxY - minY + 1,
  );
  return cropped;
};

const drawLogo = (
  ctx: ReturnType<typeof createCanvas>["getContext"],
  image: Image,
  x: number,
  bottomY: number,
) => {
  const cropped = cropLogoCanvas(image);
  const widthRatio = LOGO_MAX_WIDTH / cropped.width;
  const heightRatio = LOGO_MAX_HEIGHT / cropped.height;
  const scale = Math.min(widthRatio, heightRatio, 1);
  const drawWidth = Math.round(cropped.width * scale);
  const drawHeight = Math.round(cropped.height * scale);
  ctx.drawImage(cropped, Math.round(x), Math.round(bottomY - drawHeight), drawWidth, drawHeight);
  return drawHeight;
};

const drawBarcode = (
  ctx: ReturnType<typeof createCanvas>["getContext"],
  barcodeValue: string,
  x: number,
  y: number,
  width: number,
  height: number,
) => {
  const barcodeCanvas = createCanvas(width, height);

  JsBarcode(barcodeCanvas, barcodeValue, {
    format: "CODE128",
    displayValue: false,
    margin: 0,
    background: "#ffffff",
    lineColor: "#111111",
    width: barcodeValue.length >= 14 ? 2 : 3,
    height: barcodeValue.length >= 20 ? height - 18 : height - 8,
  });

  ctx.drawImage(barcodeCanvas, x, y, width, height);
};

const drawSingleTag = (
  ctx: ReturnType<typeof createCanvas>["getContext"],
  x: number,
  y: number,
  width: number,
  height: number,
  input: BikeTagSheetRenderInput,
) => {
  const logoImage = loadLogoImage(input.logoDataUrl);
  const innerX = x + PANEL_PADDING_X;
  const innerY = y + PANEL_PADDING_Y;
  const innerWidth = width - PANEL_PADDING_X * 2;
  const detailsWidth = Math.round(innerWidth * 0.72);
  const detailsX = x + (width - detailsWidth) / 2;
  const barcodeValue = safeText(input.barcodeValue);
  const specLines = input.specLines.slice(0, 4);
  const pricePanelHeight = 177;
  const supportLine = safeText(input.supportLine);
  const priceText = moneyLikeText(input.priceLabel);
  const contentTopAnchor = y + Math.round(height * 0.29);
  const provisionalDetailsBottomLimit = contentTopAnchor - 16;

  drawRoundedRect(ctx, x, y, width, height, PANEL_RADIUS);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = "#e9eef5";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  let cursorY = innerY + 24 + mmToPx(4);

  ctx.font = "700 68px Arial";
  ctx.fillStyle = "#111111";
  const productLines = wrapTextLines(ctx, input.productName, innerWidth, 3);
  productLines.forEach((line, index) => {
    const lineWidth = ctx.measureText(line).width;
    ctx.fillText(line, x + (width - lineWidth) / 2, cursorY + index * 52);
  });
  cursorY += productLines.length * 52 + 70;

  if (safeText(input.variantLabel)) {
    ctx.font = "600 17px Arial";
    ctx.fillStyle = "#475569";
    const variantLines = wrapTextLines(ctx, input.variantLabel, detailsWidth, 2);
    variantLines.forEach((line, index) => {
      ctx.fillText(line, detailsX, cursorY + index * 22);
    });
    cursorY += variantLines.length * 22 + 16;
  }

  ctx.font = "600 37px Arial";
  ctx.fillStyle = "#111111";
  for (const line of specLines) {
    const bulletRadius = 4;
    const bulletGap = 18;
    const bulletLineHeight = 42;
    const bulletItemGap = 10;
    const wrappedSpecLines = wrapTextLines(ctx, line, detailsWidth - 28, 2);

    if (cursorY + wrappedSpecLines.length * bulletLineHeight + bulletItemGap > provisionalDetailsBottomLimit) {
      break;
    }

    wrappedSpecLines.forEach((wrappedLine, wrappedIndex) => {
      if (wrappedIndex === 0) {
        ctx.beginPath();
        ctx.arc(detailsX + bulletRadius, cursorY - 11, bulletRadius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillText(
        wrappedLine,
        detailsX + bulletRadius * 2 + bulletGap,
        cursorY + wrappedIndex * bulletLineHeight,
      );
    });
    cursorY += wrappedSpecLines.length * bulletLineHeight + bulletItemGap;
  }

  const barcodeY = Math.max(contentTopAnchor, cursorY + 80 + mmToPx(LOWER_CLUSTER_SHIFT_MM));
  const barcodeNumberY = barcodeY + BARCODE_BLOCK_HEIGHT + 34;
  const pricePanelY = barcodeNumberY + 98;
  const footerCaptionY = pricePanelY + pricePanelHeight + 32;
  const footerLogoBottomY = y + height - 54;
  const footerLogoLeftX = x + 28;

  if (barcodeValue) {
    const barcodeWidth = Math.round(innerWidth * 0.58);
    const barcodeX = x + (width - barcodeWidth) / 2;
    drawBarcode(ctx, barcodeValue, barcodeX, barcodeY, barcodeWidth, BARCODE_BLOCK_HEIGHT);

    ctx.font = "500 36px Arial";
    ctx.fillStyle = "#111111";
    const barcodeTextWidth = ctx.measureText(barcodeValue).width;
    ctx.fillText(barcodeValue, x + (width - barcodeTextWidth) / 2, barcodeNumberY);
  } else {
    ctx.font = "700 28px Arial";
    ctx.fillStyle = "#475569";
    const emptyText = "Barcode pending";
    const emptyTextWidth = ctx.measureText(emptyText).width;
    ctx.fillText(emptyText, x + (width - emptyTextWidth) / 2, barcodeY + 82);
  }

  const skuValue = safeText(input.sku);
  if (skuValue) {
    ctx.font = "600 18px monospace";
    ctx.fillStyle = "#64748b";
    const skuText = `SKU ${skuValue}`;
    const skuWidth = ctx.measureText(skuText).width;
    ctx.fillText(skuText, x + (width - skuWidth) / 2, barcodeNumberY + 26);
  }

  ctx.font = "700 143px Arial";
  const measuredPriceWidth = ctx.measureText(priceText).width;
  const pricePanelWidth = Math.min(
    Math.max(Math.round(measuredPriceWidth + 158), Math.round(innerWidth * 0.68)),
    Math.round(innerWidth * 0.92),
  );
  const pricePanelX = x + (width - pricePanelWidth) / 2;

  drawRoundedRect(ctx, pricePanelX, pricePanelY, pricePanelWidth, pricePanelHeight, 16);
  ctx.fillStyle = "#435aa8";
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.save();
  ctx.textBaseline = "middle";
  ctx.fillText(
    priceText,
    pricePanelX + (pricePanelWidth - measuredPriceWidth) / 2,
    pricePanelY + pricePanelHeight / 2 + 2,
  );
  ctx.restore();

  if (supportLine) {
    ctx.font = "500 22px Arial";
    ctx.fillStyle = "#30343b";
    const captionWidth = ctx.measureText(supportLine).width;
    ctx.fillText(supportLine, x + (width - captionWidth) / 2, footerCaptionY);
  }

  ctx.fillStyle = "#0f172a";
  if (logoImage && logoImage.width > 0 && logoImage.height > 0) {
    drawLogo(ctx, logoImage, footerLogoLeftX, footerLogoBottomY);
  } else {
    ctx.font = "700 28px Arial";
    const fallbackShop = safeText(input.shopName) || "CorePOS";
    ctx.fillText(fallbackShop, footerLogoLeftX, y + height - 58);
  }
};

export type RenderedBikeTagSheetDocument = {
  buffer: Buffer;
  widthPx: number;
  heightPx: number;
  documentFormat: typeof BIKE_TAG_RENDER_FORMAT;
  imageFormat: typeof BIKE_TAG_DOCUMENT_FORMAT;
  mimeType: typeof BIKE_TAG_DOCUMENT_MIME_TYPE;
  extension: "png";
};

export const renderBikeTagSheetDocument = (
  input: BikeTagSheetRenderInput,
): RenderedBikeTagSheetDocument => {
  const canvas = createCanvas(BIKE_TAG_SHEET_WIDTH_PX, BIKE_TAG_SHEET_HEIGHT_PX);
  const ctx = canvas.getContext("2d");
  const panelWidth = Math.round((BIKE_TAG_SHEET_WIDTH_PX - SHEET_PADDING * 2 - PANEL_GAP) / 2);
  const panelHeight = BIKE_TAG_SHEET_HEIGHT_PX - SHEET_PADDING * 2;
  const leftX = SHEET_PADDING;
  const rightX = leftX + panelWidth + PANEL_GAP;
  const topY = SHEET_PADDING;
  const cutGuideX = leftX + panelWidth + PANEL_GAP / 2;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, BIKE_TAG_SHEET_WIDTH_PX, BIKE_TAG_SHEET_HEIGHT_PX);

  ctx.strokeStyle = "#cbd5e1";
  ctx.setLineDash([16, 12]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cutGuideX, CUT_GUIDE_MARGIN);
  ctx.lineTo(cutGuideX, BIKE_TAG_SHEET_HEIGHT_PX - CUT_GUIDE_MARGIN);
  ctx.stroke();
  ctx.setLineDash([]);

  drawSingleTag(ctx, leftX, topY, panelWidth, panelHeight, input);
  drawSingleTag(ctx, rightX, topY, panelWidth, panelHeight, input);

  return {
    buffer: canvas.toBuffer("image/png"),
    widthPx: BIKE_TAG_SHEET_WIDTH_PX,
    heightPx: BIKE_TAG_SHEET_HEIGHT_PX,
    documentFormat: BIKE_TAG_RENDER_FORMAT,
    imageFormat: BIKE_TAG_DOCUMENT_FORMAT,
    mimeType: BIKE_TAG_DOCUMENT_MIME_TYPE,
    extension: "png",
  };
};
