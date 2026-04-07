import {
  expectIsoDateString,
  expectNullableString,
  expectPositiveInteger,
  expectRecord,
  expectString,
} from "./printContractUtils";

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

export const BIKE_TAG_PRINT_REQUEST_VERSION = 1 as const;
export const BIKE_TAG_PRINT_INTENT = "BIKE_TAG_PRINT" as const;
export const BIKE_TAG_WINDOWS_LOCAL_AGENT_TRANSPORT = "WINDOWS_LOCAL_AGENT" as const;
export const OFFICE_DOCUMENT_PRINTER_FAMILY = "OFFICE_DOCUMENT" as const;
export const OFFICE_A5_DOCUMENT_MODEL_HINT = "A5_LANDSCAPE_2UP_OR_COMPATIBLE" as const;
export const BIKE_TAG_RENDER_FORMAT = "BIKE_TAG_SHEET" as const;
export const BIKE_TAG_DOCUMENT_FORMAT = "PNG" as const;
export const BIKE_TAG_DOCUMENT_MIME_TYPE = "image/png" as const;

export type BikeTagPrintTransportMode = "DRY_RUN" | "WINDOWS_PRINTER";

export type BikeTagDocument = {
  format: typeof BIKE_TAG_DOCUMENT_FORMAT;
  mimeType: typeof BIKE_TAG_DOCUMENT_MIME_TYPE;
  fileName: string;
  bytesBase64: string;
  widthPx: number;
  heightPx: number;
};

export type BikeTagPrintRequest = {
  version: typeof BIKE_TAG_PRINT_REQUEST_VERSION;
  intentType: typeof BIKE_TAG_PRINT_INTENT;
  variantId: string;
  printer: {
    transport: typeof BIKE_TAG_WINDOWS_LOCAL_AGENT_TRANSPORT;
    printerId: string;
    printerKey: string;
    printerFamily: typeof OFFICE_DOCUMENT_PRINTER_FAMILY;
    printerModelHint: typeof OFFICE_A5_DOCUMENT_MODEL_HINT;
    printerName: string;
    transportMode: BikeTagPrintTransportMode;
    windowsPrinterName: string | null;
    copies: number;
  };
  document: BikeTagDocument;
  metadata: {
    source: string;
    sourceLabel: string;
    paperSize: "A5";
    orientation: "LANDSCAPE";
    tagsPerSheet: 2;
  };
};

export type BikeTagPrintAgentJob = {
  jobId: string;
  acceptedAt: string;
  completedAt: string;
  transportMode: BikeTagPrintTransportMode;
  printerId: string;
  printerKey: string;
  printerName: string;
  printerTarget: string;
  copies: number;
  documentFormat: typeof BIKE_TAG_RENDER_FORMAT;
  bytesSent: number;
  simulated: boolean;
  outputPath: string | null;
};

export type BikeTagPrintAgentSubmitRequest = {
  printRequest: BikeTagPrintRequest;
};

export type BikeTagPrintAgentSubmitResponse = {
  ok: true;
  job: BikeTagPrintAgentJob;
};

export const validateBikeTagPrintDocument = (value: unknown): BikeTagDocument => {
  const record = expectRecord(value, "document");
  const format = expectString(record.format, "document.format");
  const mimeType = expectString(record.mimeType, "document.mimeType");

  if (format !== BIKE_TAG_DOCUMENT_FORMAT) {
    throw new Error(`document.format must be ${BIKE_TAG_DOCUMENT_FORMAT}`);
  }
  if (mimeType !== BIKE_TAG_DOCUMENT_MIME_TYPE) {
    throw new Error(`document.mimeType must be ${BIKE_TAG_DOCUMENT_MIME_TYPE}`);
  }

  return {
    format: BIKE_TAG_DOCUMENT_FORMAT,
    mimeType: BIKE_TAG_DOCUMENT_MIME_TYPE,
    fileName: expectString(record.fileName, "document.fileName"),
    bytesBase64: expectNonEmptyBase64String(record.bytesBase64, "document.bytesBase64"),
    widthPx: expectPositiveInteger(record.widthPx, "document.widthPx"),
    heightPx: expectPositiveInteger(record.heightPx, "document.heightPx"),
  };
};

export const validateBikeTagPrintRequest = (value: unknown): BikeTagPrintRequest => {
  const record = expectRecord(value, "printRequest");
  const version = Number(record.version);
  const intentType = expectString(record.intentType, "printRequest.intentType");
  if (version !== BIKE_TAG_PRINT_REQUEST_VERSION) {
    throw new Error(`printRequest.version must be ${BIKE_TAG_PRINT_REQUEST_VERSION}`);
  }
  if (intentType !== BIKE_TAG_PRINT_INTENT) {
    throw new Error(`printRequest.intentType must be ${BIKE_TAG_PRINT_INTENT}`);
  }

  const printerRecord = expectRecord(record.printer, "printRequest.printer");
  const transport = expectString(printerRecord.transport, "printRequest.printer.transport");
  const printerFamily = expectString(printerRecord.printerFamily, "printRequest.printer.printerFamily");
  const printerModelHint = expectString(printerRecord.printerModelHint, "printRequest.printer.printerModelHint");

  if (transport !== BIKE_TAG_WINDOWS_LOCAL_AGENT_TRANSPORT) {
    throw new Error(
      `printRequest.printer.transport must be ${BIKE_TAG_WINDOWS_LOCAL_AGENT_TRANSPORT}`,
    );
  }
  if (printerFamily !== OFFICE_DOCUMENT_PRINTER_FAMILY) {
    throw new Error(`printRequest.printer.printerFamily must be ${OFFICE_DOCUMENT_PRINTER_FAMILY}`);
  }
  if (printerModelHint !== OFFICE_A5_DOCUMENT_MODEL_HINT) {
    throw new Error(`printRequest.printer.printerModelHint must be ${OFFICE_A5_DOCUMENT_MODEL_HINT}`);
  }

  const transportMode = expectString(printerRecord.transportMode, "printRequest.printer.transportMode");
  if (transportMode !== "DRY_RUN" && transportMode !== "WINDOWS_PRINTER") {
    throw new Error("printRequest.printer.transportMode must be DRY_RUN or WINDOWS_PRINTER");
  }

  const windowsPrinterName = expectNullableString(
    printerRecord.windowsPrinterName,
    "printRequest.printer.windowsPrinterName",
  );
  if (transportMode === "WINDOWS_PRINTER" && !windowsPrinterName) {
    throw new Error("WINDOWS_PRINTER print requests must include windowsPrinterName");
  }

  const metadataRecord = expectRecord(record.metadata, "printRequest.metadata");
  const paperSize = expectString(metadataRecord.paperSize, "printRequest.metadata.paperSize");
  const orientation = expectString(metadataRecord.orientation, "printRequest.metadata.orientation");
  const tagsPerSheet = expectPositiveInteger(metadataRecord.tagsPerSheet, "printRequest.metadata.tagsPerSheet");
  if (paperSize !== "A5") {
    throw new Error("printRequest.metadata.paperSize must be A5");
  }
  if (orientation !== "LANDSCAPE") {
    throw new Error("printRequest.metadata.orientation must be LANDSCAPE");
  }
  if (tagsPerSheet !== 2) {
    throw new Error("printRequest.metadata.tagsPerSheet must be 2");
  }

  return {
    version: BIKE_TAG_PRINT_REQUEST_VERSION,
    intentType: BIKE_TAG_PRINT_INTENT,
    variantId: expectString(record.variantId, "printRequest.variantId"),
    printer: {
      transport: BIKE_TAG_WINDOWS_LOCAL_AGENT_TRANSPORT,
      printerId: expectString(printerRecord.printerId, "printRequest.printer.printerId"),
      printerKey: expectString(printerRecord.printerKey, "printRequest.printer.printerKey"),
      printerFamily: OFFICE_DOCUMENT_PRINTER_FAMILY,
      printerModelHint: OFFICE_A5_DOCUMENT_MODEL_HINT,
      printerName: expectString(printerRecord.printerName, "printRequest.printer.printerName"),
      transportMode,
      windowsPrinterName,
      copies: expectPositiveInteger(printerRecord.copies, "printRequest.printer.copies"),
    },
    document: validateBikeTagPrintDocument(record.document),
    metadata: {
      source: expectString(metadataRecord.source, "printRequest.metadata.source"),
      sourceLabel: expectString(metadataRecord.sourceLabel, "printRequest.metadata.sourceLabel"),
      paperSize: "A5",
      orientation: "LANDSCAPE",
      tagsPerSheet: 2,
    },
  };
};

export const validateBikeTagPrintAgentSubmitRequest = (
  value: unknown,
): BikeTagPrintAgentSubmitRequest => {
  const record = expectRecord(value, "body");
  const requestCandidate =
    record.printRequest !== undefined && record.printRequest !== null
      ? record.printRequest
      : record;

  return {
    printRequest: validateBikeTagPrintRequest(requestCandidate),
  };
};

export const validateBikeTagPrintAgentJob = (value: unknown): BikeTagPrintAgentJob => {
  const record = expectRecord(value, "job");
  const transportMode = expectString(record.transportMode, "job.transportMode");
  const documentFormat = expectString(record.documentFormat, "job.documentFormat");

  if (transportMode !== "DRY_RUN" && transportMode !== "WINDOWS_PRINTER") {
    throw new Error("job.transportMode must be DRY_RUN or WINDOWS_PRINTER");
  }
  if (documentFormat !== BIKE_TAG_RENDER_FORMAT) {
    throw new Error(`job.documentFormat must be ${BIKE_TAG_RENDER_FORMAT}`);
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

export const validateBikeTagPrintAgentSubmitResponse = (
  value: unknown,
): BikeTagPrintAgentSubmitResponse => {
  const record = expectRecord(value, "response");
  if (record.ok !== true) {
    throw new Error("response.ok must be true");
  }

  return {
    ok: true,
    job: validateBikeTagPrintAgentJob(record.job),
  };
};
