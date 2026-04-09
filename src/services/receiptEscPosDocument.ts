import {
  RECEIPT_DOCUMENT_FORMAT,
  RECEIPT_DOCUMENT_MIME_TYPE,
  type ReceiptPrintDocument,
} from "../../shared/receiptPrintContract";
import type { DetailedReceipt } from "./receiptService";

const ESC = 0x1b;
const GS = 0x1d;
const LINE_WIDTH = 42;
const MAX_FILE_NAME_LENGTH = 64;
const WINDOWS_1252_CODEPAGE = 16;

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "receipt";

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const sanitizeText = (value: string) =>
  value
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...")
    .replace(/–|—/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/[^\x20-\x7e£\n]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();

const toPrintableBuffer = (value: string) => Buffer.from(sanitizeText(value), "latin1");

const wrapText = (value: string, width: number) => {
  const normalized = sanitizeText(value);
  if (!normalized) {
    return [];
  }

  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!word) {
      continue;
    }

    if (!current) {
      current = word;
      continue;
    }

    const next = `${current} ${word}`;
    if (next.length <= width) {
      current = next;
      continue;
    }

    lines.push(current);
    current = word.length > width ? `${word.slice(0, width - 1)}-` : word;
  }

  if (current) {
    lines.push(current);
  }

  return lines;
};

const splitAddressLines = (value: string) =>
  sanitizeText(value)
    .split(/\s*,\s*/)
    .flatMap((chunk) => wrapText(chunk, LINE_WIDTH))
    .filter(Boolean);

const padRight = (value: string, width: number) => {
  if (value.length >= width) {
    return value.slice(0, width);
  }
  return `${value}${" ".repeat(width - value.length)}`;
};

const padLeft = (value: string, width: number) => {
  if (value.length >= width) {
    return value.slice(value.length - width);
  }
  return `${" ".repeat(width - value.length)}${value}`;
};

const formatTwoColumn = (left: string, right: string) => {
  const leftWidth = Math.max(1, LINE_WIDTH - right.length - 1);
  return `${padRight(left, leftWidth)} ${right}`;
};

const formatItemLines = (item: DetailedReceipt["items"][number]) => {
  const nameLines = wrapText(item.name, LINE_WIDTH);
  const amountLabel = formatMoney(item.lineTotalPence);
  const qtyLine = `${item.qty} x ${formatMoney(item.unitPricePence)}`;

  const lines = [...nameLines];
  lines.push(formatTwoColumn(qtyLine, amountLabel));
  if (item.sku) {
    lines.push(`SKU ${sanitizeText(item.sku)}`);
  }
  return lines;
};

const formatTenderLines = (receipt: DetailedReceipt) => {
  if (receipt.tenders.length > 0) {
    return receipt.tenders.map((tender) => formatTwoColumn(tender.method, formatMoney(tender.amountPence)));
  }

  if (receipt.payments.length > 0) {
    return receipt.payments.map((payment) => formatTwoColumn(payment.method, formatMoney(payment.amountPence)));
  }

  return [];
};

const buildFileName = (receipt: DetailedReceipt) => {
  const receiptSlug = slugify(receipt.receiptNumber);
  const saleOrRefundSlug = slugify(receipt.saleId ?? receipt.refundId ?? receipt.type.toLowerCase());
  const base = `${receiptSlug}-${saleOrRefundSlug}`.slice(0, MAX_FILE_NAME_LENGTH);
  return `${base || "receipt"}.escpos`;
};

const encodeLines = (lines: string[]) => Buffer.concat(lines.map((line) => Buffer.concat([toPrintableBuffer(line), Buffer.from("\n", "latin1")])));

export const renderReceiptEscPosDocument = (receipt: DetailedReceipt): ReceiptPrintDocument & {
  buffer: Buffer;
  lineWidth: number;
} => {
  const parts: Buffer[] = [];
  const append = (buffer: Buffer) => {
    parts.push(buffer);
  };
  const appendLine = (line = "") => {
    append(toPrintableBuffer(line));
    append(Buffer.from("\n", "latin1"));
  };
  const appendWrapped = (value: string, width = LINE_WIDTH) => {
    const lines = wrapText(value, width);
    for (const line of lines) {
      appendLine(line);
    }
  };
  const appendSeparator = () => appendLine("-".repeat(LINE_WIDTH));
  const setAlign = (alignment: 0 | 1 | 2) => append(Buffer.from([ESC, 0x61, alignment]));
  const setBold = (enabled: boolean) => append(Buffer.from([ESC, 0x45, enabled ? 1 : 0]));
  const setDoubleSize = (enabled: boolean) => append(Buffer.from([GS, 0x21, enabled ? 0x11 : 0x00]));

  append(Buffer.from([ESC, 0x40]));
  append(Buffer.from([ESC, 0x74, WINDOWS_1252_CODEPAGE]));

  setAlign(1);
  setBold(true);
  setDoubleSize(true);
  appendWrapped(receipt.shop.name.toUpperCase(), 21);
  setDoubleSize(false);
  setBold(false);

  const addressLines = splitAddressLines(receipt.shop.address);
  for (const line of addressLines) {
    appendLine(line);
  }
  if (receipt.shop.vatNumber) {
    appendLine(`VAT ${sanitizeText(receipt.shop.vatNumber)}`);
  }
  appendLine();

  setAlign(0);
  appendLine(`${receipt.type === "REFUND" ? "REFUND" : "RECEIPT"} ${sanitizeText(receipt.receiptNumber)}`);
  appendLine(`Issued ${receipt.issuedAt.toLocaleString("en-GB", { hour12: false })}`);
  if (receipt.saleId) {
    appendLine(`Sale ${sanitizeText(receipt.saleId.slice(0, 8))}`);
  }
  if (receipt.refundId) {
    appendLine(`Refund ${sanitizeText(receipt.refundId.slice(0, 8))}`);
  }
  if (receipt.staff.name) {
    appendLine(`Staff ${sanitizeText(receipt.staff.name)}`);
  }
  if (receipt.customer) {
    appendLine(`Customer ${sanitizeText(receipt.customer.name)}`);
    if (receipt.customer.phone) {
      appendLine(`Phone ${sanitizeText(receipt.customer.phone)}`);
    }
  }

  appendSeparator();
  for (const item of receipt.items) {
    append(encodeLines(formatItemLines(item)));
    appendLine();
  }
  appendSeparator();

  appendLine(formatTwoColumn("Subtotal", formatMoney(receipt.totals.subtotalPence)));
  if (receipt.totals.taxPence > 0) {
    appendLine(formatTwoColumn("VAT", formatMoney(receipt.totals.taxPence)));
  }

  setBold(true);
  appendLine(formatTwoColumn("Total", formatMoney(receipt.totals.totalPence)));
  setBold(false);

  if (receipt.totals.changeDuePence > 0) {
    appendLine(formatTwoColumn("Change", formatMoney(receipt.totals.changeDuePence)));
  }

  const tenderLines = formatTenderLines(receipt);
  if (tenderLines.length > 0) {
    appendSeparator();
    for (const line of tenderLines) {
      appendLine(line);
    }
  }

  if (receipt.refund) {
    appendSeparator();
    appendLine(`Refund ${sanitizeText(receipt.refund.kind === "SALE_REFUND" ? "sale" : "payment")}`);
    appendLine(formatTwoColumn("Amount", formatMoney(receipt.refund.amountPence)));
    if (receipt.refund.method) {
      appendLine(`Method ${sanitizeText(receipt.refund.method)}`);
    }
    if (receipt.refund.reason) {
      appendWrapped(`Reason ${receipt.refund.reason}`);
    }
  }

  setAlign(1);
  appendLine();
  if (receipt.shop.footerText) {
    for (const line of wrapText(receipt.shop.footerText, LINE_WIDTH)) {
      appendLine(line);
    }
  } else {
    appendLine("Thank you for shopping with us.");
  }
  appendLine();
  appendLine();
  appendLine();
  append(Buffer.from([GS, 0x56, 0x00]));

  const buffer = Buffer.concat(parts);
  return {
    format: RECEIPT_DOCUMENT_FORMAT,
    mimeType: RECEIPT_DOCUMENT_MIME_TYPE,
    fileName: buildFileName(receipt),
    bytesBase64: buffer.toString("base64"),
    buffer,
    lineWidth: LINE_WIDTH,
  };
};
