import {
  expectIsoDateString,
  expectNullableString,
  expectPositiveInteger,
  expectRecord,
  expectString,
} from "./printContractUtils";

const expectNonNegativeInteger = (value: unknown, field: string) => {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }

  return Number(value);
};

const expectNonEmptyBase64String = (value: unknown, field: string) => {
  const text = expectString(value, field).trim();
  if (text.length === 0) {
    throw new Error(`${field} must be a non-empty base64 string`);
  }

  let bytes;
  try {
    bytes = Buffer.from(text, "base64");
  } catch {
    throw new Error(`${field} must be valid base64`);
  }

  if (bytes.length === 0) {
    throw new Error(`${field} must decode to non-empty content`);
  }

  return text;
};

export const PRODUCT_LABEL_PRINT_REQUEST_VERSION = 1 as const;
export const PRODUCT_LABEL_PRINT_INTENT = "PRODUCT_LABEL_PRINT" as const;
export const PRODUCT_LABEL_WINDOWS_LOCAL_AGENT_TRANSPORT = "WINDOWS_LOCAL_AGENT" as const;
export const DYMO_LABEL_PRINTER_FAMILY = "DYMO_LABEL" as const;
export const DYMO_57X32_MODEL_HINT = "LABELWRITER_57X32_OR_COMPATIBLE" as const;
export const PRODUCT_LABEL_RENDER_FORMAT = "DYMO_PRODUCT_LABEL" as const;
export const PRODUCT_LABEL_DOCUMENT_FORMAT = "PNG" as const;
export const PRODUCT_LABEL_DOCUMENT_MIME_TYPE = "image/png" as const;

export type ProductLabelPrintTransportMode = "DRY_RUN" | "WINDOWS_PRINTER";

export type ProductLabelPayload = {
  shopName: string;
  productName: string;
  variantName: string | null;
  brand: string | null;
  sku: string | null;
  pricePence: number;
  barcode: string | null;
};

export type ProductLabelPrintDocument = {
  format: typeof PRODUCT_LABEL_DOCUMENT_FORMAT;
  mimeType: typeof PRODUCT_LABEL_DOCUMENT_MIME_TYPE;
  fileName: string;
  bytesBase64: string;
  widthPx: number;
  heightPx: number;
};

export type ProductLabelPrintRequest = {
  version: typeof PRODUCT_LABEL_PRINT_REQUEST_VERSION;
  intentType: typeof PRODUCT_LABEL_PRINT_INTENT;
  variantId: string;
  printer: {
    transport: typeof PRODUCT_LABEL_WINDOWS_LOCAL_AGENT_TRANSPORT;
    printerId: string;
    printerKey: string;
    printerFamily: typeof DYMO_LABEL_PRINTER_FAMILY;
    printerModelHint: typeof DYMO_57X32_MODEL_HINT;
    printerName: string;
    transportMode: ProductLabelPrintTransportMode;
    windowsPrinterName: string | null;
    copies: number;
  };
  label: ProductLabelPayload;
  document: ProductLabelPrintDocument;
  metadata: {
    source: string;
    sourceLabel: string;
  };
};

export type ProductLabelPrintAgentJob = {
  jobId: string;
  acceptedAt: string;
  completedAt: string;
  transportMode: ProductLabelPrintTransportMode;
  printerId: string;
  printerKey: string;
  printerName: string;
  printerTarget: string;
  copies: number;
  documentFormat: typeof PRODUCT_LABEL_RENDER_FORMAT;
  bytesSent: number;
  simulated: boolean;
  outputPath: string | null;
};

export type ProductLabelPrintAgentSubmitRequest = {
  printRequest: ProductLabelPrintRequest;
};

export type ProductLabelPrintAgentSubmitResponse = {
  ok: true;
  job: ProductLabelPrintAgentJob;
};

const validateProductLabelPayload = (value: unknown): ProductLabelPayload => {
  const record = expectRecord(value, "label");

  return {
    shopName: expectString(record.shopName, "label.shopName"),
    productName: expectString(record.productName, "label.productName"),
    variantName: expectNullableString(record.variantName, "label.variantName"),
    brand: expectNullableString(record.brand, "label.brand"),
    sku: expectNullableString(record.sku, "label.sku"),
    pricePence: expectNonNegativeInteger(record.pricePence, "label.pricePence"),
    barcode: expectNullableString(record.barcode, "label.barcode"),
  };
};

export const validateProductLabelPrintDocument = (value: unknown): ProductLabelPrintDocument => {
  const record = expectRecord(value, "document");
  const format = expectString(record.format, "document.format");
  const mimeType = expectString(record.mimeType, "document.mimeType");

  if (format !== PRODUCT_LABEL_DOCUMENT_FORMAT) {
    throw new Error(`document.format must be ${PRODUCT_LABEL_DOCUMENT_FORMAT}`);
  }
  if (mimeType !== PRODUCT_LABEL_DOCUMENT_MIME_TYPE) {
    throw new Error(`document.mimeType must be ${PRODUCT_LABEL_DOCUMENT_MIME_TYPE}`);
  }

  return {
    format: PRODUCT_LABEL_DOCUMENT_FORMAT,
    mimeType: PRODUCT_LABEL_DOCUMENT_MIME_TYPE,
    fileName: expectString(record.fileName, "document.fileName"),
    bytesBase64: expectNonEmptyBase64String(record.bytesBase64, "document.bytesBase64"),
    widthPx: expectPositiveInteger(record.widthPx, "document.widthPx"),
    heightPx: expectPositiveInteger(record.heightPx, "document.heightPx"),
  };
};

export const validateProductLabelPrintRequest = (value: unknown): ProductLabelPrintRequest => {
  const record = expectRecord(value, "printRequest");
  const version = Number(record.version);
  const intentType = expectString(record.intentType, "printRequest.intentType");
  if (version !== PRODUCT_LABEL_PRINT_REQUEST_VERSION) {
    throw new Error(`printRequest.version must be ${PRODUCT_LABEL_PRINT_REQUEST_VERSION}`);
  }
  if (intentType !== PRODUCT_LABEL_PRINT_INTENT) {
    throw new Error(`printRequest.intentType must be ${PRODUCT_LABEL_PRINT_INTENT}`);
  }

  const printerRecord = expectRecord(record.printer, "printRequest.printer");
  const transport = expectString(printerRecord.transport, "printRequest.printer.transport");
  const printerFamily = expectString(printerRecord.printerFamily, "printRequest.printer.printerFamily");
  const printerModelHint = expectString(
    printerRecord.printerModelHint,
    "printRequest.printer.printerModelHint",
  );
  if (transport !== PRODUCT_LABEL_WINDOWS_LOCAL_AGENT_TRANSPORT) {
    throw new Error(
      `printRequest.printer.transport must be ${PRODUCT_LABEL_WINDOWS_LOCAL_AGENT_TRANSPORT}`,
    );
  }
  if (printerFamily !== DYMO_LABEL_PRINTER_FAMILY) {
    throw new Error(`printRequest.printer.printerFamily must be ${DYMO_LABEL_PRINTER_FAMILY}`);
  }
  if (printerModelHint !== DYMO_57X32_MODEL_HINT) {
    throw new Error(`printRequest.printer.printerModelHint must be ${DYMO_57X32_MODEL_HINT}`);
  }
  const transportMode = expectString(printerRecord.transportMode, "printRequest.printer.transportMode");
  if (transportMode !== "DRY_RUN" && transportMode !== "WINDOWS_PRINTER") {
    throw new Error("printRequest.printer.transportMode must be DRY_RUN or WINDOWS_PRINTER");
  }

  const metadataRecord = expectRecord(record.metadata, "printRequest.metadata");

  return {
    version: PRODUCT_LABEL_PRINT_REQUEST_VERSION,
    intentType: PRODUCT_LABEL_PRINT_INTENT,
    variantId: expectString(record.variantId, "printRequest.variantId"),
    printer: {
      transport: PRODUCT_LABEL_WINDOWS_LOCAL_AGENT_TRANSPORT,
      printerId: expectString(printerRecord.printerId, "printRequest.printer.printerId"),
      printerKey: expectString(printerRecord.printerKey, "printRequest.printer.printerKey"),
      printerFamily: DYMO_LABEL_PRINTER_FAMILY,
      printerModelHint: DYMO_57X32_MODEL_HINT,
      printerName: expectString(printerRecord.printerName, "printRequest.printer.printerName"),
      transportMode,
      windowsPrinterName: expectNullableString(
        printerRecord.windowsPrinterName,
        "printRequest.printer.windowsPrinterName",
      ),
      copies: expectPositiveInteger(printerRecord.copies, "printRequest.printer.copies"),
    },
    label: validateProductLabelPayload(record.label),
    document: validateProductLabelPrintDocument(record.document),
    metadata: {
      source: expectString(metadataRecord.source, "printRequest.metadata.source"),
      sourceLabel: expectString(metadataRecord.sourceLabel, "printRequest.metadata.sourceLabel"),
    },
  };
};

export const validateProductLabelPrintAgentSubmitRequest = (
  value: unknown,
): ProductLabelPrintAgentSubmitRequest => {
  const record = expectRecord(value, "body");

  return {
    printRequest: validateProductLabelPrintRequest(record.printRequest),
  };
};

export const validateProductLabelPrintAgentJob = (value: unknown): ProductLabelPrintAgentJob => {
  const record = expectRecord(value, "job");
  const transportMode = expectString(record.transportMode, "job.transportMode");
  const documentFormat = expectString(record.documentFormat, "job.documentFormat");

  if (transportMode !== "DRY_RUN" && transportMode !== "WINDOWS_PRINTER") {
    throw new Error("job.transportMode must be DRY_RUN or WINDOWS_PRINTER");
  }
  if (documentFormat !== PRODUCT_LABEL_RENDER_FORMAT) {
    throw new Error(`job.documentFormat must be ${PRODUCT_LABEL_RENDER_FORMAT}`);
  }

  return {
    jobId: expectString(record.jobId, "job.jobId"),
    acceptedAt: expectIsoDateString(record.acceptedAt, "job.acceptedAt"),
    completedAt: expectIsoDateString(record.completedAt, "job.completedAt"),
    transportMode,
    printerId: expectString(record.printerId, "job.printerId"),
    printerKey: expectString(record.printerKey, "job.printerKey"),
    printerName: expectString(record.printerName, "job.printerName"),
    printerTarget: expectString(record.printerTarget, "job.printerTarget"),
    copies: expectPositiveInteger(record.copies, "job.copies"),
    documentFormat,
    bytesSent: expectPositiveInteger(record.bytesSent, "job.bytesSent"),
    simulated: Boolean(record.simulated),
    outputPath: record.outputPath === null ? null : expectString(record.outputPath, "job.outputPath"),
  };
};

export const validateProductLabelPrintAgentSubmitResponse = (
  value: unknown,
): ProductLabelPrintAgentSubmitResponse => {
  const record = expectRecord(value, "response");
  if (record.ok !== true) {
    throw new Error("response.ok must be true");
  }

  return {
    ok: true,
    job: validateProductLabelPrintAgentJob(record.job),
  };
};
