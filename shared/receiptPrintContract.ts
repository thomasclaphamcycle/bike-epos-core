import {
  expectIsoDateString,
  expectNullableString,
  expectPositiveInteger,
  expectRecord,
  expectString,
} from "./printContractUtils";

export const RECEIPT_DOCUMENT_FORMAT = "ESC_POS" as const;
export const RECEIPT_DOCUMENT_MIME_TYPE = "application/octet-stream" as const;
export const RECEIPT_PRINT_REQUEST_VERSION = 1 as const;
export const RECEIPT_PRINT_INTENT = "RECEIPT_PRINT" as const;
export const WINDOWS_LOCAL_AGENT_TRANSPORT = "WINDOWS_LOCAL_AGENT" as const;
export const THERMAL_RECEIPT_PRINTER_FAMILY = "THERMAL_RECEIPT" as const;
export const ESC_POS_80MM_MODEL_HINT = "ESC_POS_80MM_OR_COMPATIBLE" as const;

export type ReceiptPrintTransportMode = "DRY_RUN" | "RAW_TCP" | "WINDOWS_PRINTER";

export type ReceiptPrintDocument = {
  format: typeof RECEIPT_DOCUMENT_FORMAT;
  mimeType: typeof RECEIPT_DOCUMENT_MIME_TYPE;
  fileName: string;
  bytesBase64: string;
};

export type ReceiptPrintRequest = {
  version: typeof RECEIPT_PRINT_REQUEST_VERSION;
  intentType: typeof RECEIPT_PRINT_INTENT;
  saleId: string;
  receiptNumber: string;
  printer: {
    transport: typeof WINDOWS_LOCAL_AGENT_TRANSPORT;
    printerId: string;
    printerKey: string;
    printerFamily: typeof THERMAL_RECEIPT_PRINTER_FAMILY;
    printerModelHint: typeof ESC_POS_80MM_MODEL_HINT;
    printerName: string;
    transportMode: ReceiptPrintTransportMode;
    windowsPrinterName: string | null;
    rawTcpHost: string | null;
    rawTcpPort: number | null;
    copies: number;
  };
  document: ReceiptPrintDocument;
  metadata: {
    source: string;
    sourceLabel: string;
    workstationKey: string | null;
    workstationLabel: string | null;
  };
};

export type ReceiptPrintAgentJob = {
  jobId: string;
  acceptedAt: string;
  completedAt: string;
  transportMode: ReceiptPrintTransportMode;
  printerId: string;
  printerKey: string;
  printerName: string;
  printerTarget: string;
  copies: number;
  documentFormat: typeof RECEIPT_DOCUMENT_FORMAT;
  bytesSent: number;
  simulated: boolean;
  outputPath: string | null;
};

export type ReceiptPrintAgentSubmitRequest = {
  printRequest: ReceiptPrintRequest;
};

export type ReceiptPrintAgentSubmitResponse = {
  ok: true;
  job: ReceiptPrintAgentJob;
};

export const validateReceiptPrintDocument = (value: unknown): ReceiptPrintDocument => {
  const record = expectRecord(value, "document");
  const format = expectString(record.format, "document.format");
  const mimeType = expectString(record.mimeType, "document.mimeType");
  const bytesBase64 = expectString(record.bytesBase64, "document.bytesBase64");

  if (format !== RECEIPT_DOCUMENT_FORMAT) {
    throw new Error(`document.format must be ${RECEIPT_DOCUMENT_FORMAT}`);
  }
  if (mimeType !== RECEIPT_DOCUMENT_MIME_TYPE) {
    throw new Error(`document.mimeType must be ${RECEIPT_DOCUMENT_MIME_TYPE}`);
  }

  const bytes = Buffer.from(bytesBase64, "base64");
  if (bytes.length === 0) {
    throw new Error("document.bytesBase64 must decode to non-empty receipt bytes");
  }

  return {
    format,
    mimeType,
    fileName: expectString(record.fileName, "document.fileName"),
    bytesBase64,
  };
};

export const validateReceiptPrintRequest = (value: unknown): ReceiptPrintRequest => {
  const record = expectRecord(value, "printRequest");
  const version = Number(record.version);
  const intentType = expectString(record.intentType, "printRequest.intentType");
  if (version !== RECEIPT_PRINT_REQUEST_VERSION) {
    throw new Error(`printRequest.version must be ${RECEIPT_PRINT_REQUEST_VERSION}`);
  }
  if (intentType !== RECEIPT_PRINT_INTENT) {
    throw new Error(`printRequest.intentType must be ${RECEIPT_PRINT_INTENT}`);
  }

  const printerRecord = expectRecord(record.printer, "printRequest.printer");
  const transport = expectString(printerRecord.transport, "printRequest.printer.transport");
  const printerFamily = expectString(printerRecord.printerFamily, "printRequest.printer.printerFamily");
  const printerModelHint = expectString(printerRecord.printerModelHint, "printRequest.printer.printerModelHint");

  if (transport !== WINDOWS_LOCAL_AGENT_TRANSPORT) {
    throw new Error(`printRequest.printer.transport must be ${WINDOWS_LOCAL_AGENT_TRANSPORT}`);
  }
  if (printerFamily !== THERMAL_RECEIPT_PRINTER_FAMILY) {
    throw new Error(`printRequest.printer.printerFamily must be ${THERMAL_RECEIPT_PRINTER_FAMILY}`);
  }
  if (printerModelHint !== ESC_POS_80MM_MODEL_HINT) {
    throw new Error(`printRequest.printer.printerModelHint must be ${ESC_POS_80MM_MODEL_HINT}`);
  }

  const printerTransportMode = expectString(
    printerRecord.transportMode,
    "printRequest.printer.transportMode",
  );
  if (printerTransportMode !== "DRY_RUN" && printerTransportMode !== "RAW_TCP" && printerTransportMode !== "WINDOWS_PRINTER") {
    throw new Error("printRequest.printer.transportMode must be DRY_RUN, RAW_TCP, or WINDOWS_PRINTER");
  }

  const windowsPrinterName = expectNullableString(
    printerRecord.windowsPrinterName,
    "printRequest.printer.windowsPrinterName",
  );
  const rawTcpHost = expectNullableString(printerRecord.rawTcpHost, "printRequest.printer.rawTcpHost");
  const rawTcpPort =
    printerRecord.rawTcpPort === null
      ? null
      : expectPositiveInteger(printerRecord.rawTcpPort, "printRequest.printer.rawTcpPort");

  if (printerTransportMode === "RAW_TCP" && (!rawTcpHost || !rawTcpPort)) {
    throw new Error("RAW_TCP print requests must include rawTcpHost and rawTcpPort");
  }
  if (printerTransportMode === "WINDOWS_PRINTER" && !windowsPrinterName) {
    throw new Error("WINDOWS_PRINTER print requests must include windowsPrinterName");
  }

  const metadataRecord = expectRecord(record.metadata, "printRequest.metadata");

  return {
    version: RECEIPT_PRINT_REQUEST_VERSION,
    intentType: RECEIPT_PRINT_INTENT,
    saleId: expectString(record.saleId, "printRequest.saleId"),
    receiptNumber: expectString(record.receiptNumber, "printRequest.receiptNumber"),
    printer: {
      transport: WINDOWS_LOCAL_AGENT_TRANSPORT,
      printerId: expectString(printerRecord.printerId, "printRequest.printer.printerId"),
      printerKey: expectString(printerRecord.printerKey, "printRequest.printer.printerKey"),
      printerFamily: THERMAL_RECEIPT_PRINTER_FAMILY,
      printerModelHint: ESC_POS_80MM_MODEL_HINT,
      printerName: expectString(printerRecord.printerName, "printRequest.printer.printerName"),
      transportMode: printerTransportMode,
      windowsPrinterName,
      rawTcpHost,
      rawTcpPort,
      copies: expectPositiveInteger(printerRecord.copies, "printRequest.printer.copies"),
    },
    document: validateReceiptPrintDocument(record.document),
    metadata: {
      source: expectString(metadataRecord.source, "printRequest.metadata.source"),
      sourceLabel: expectString(metadataRecord.sourceLabel, "printRequest.metadata.sourceLabel"),
      workstationKey:
        metadataRecord.workstationKey === null
          ? null
          : expectString(metadataRecord.workstationKey, "printRequest.metadata.workstationKey"),
      workstationLabel:
        metadataRecord.workstationLabel === null
          ? null
          : expectString(metadataRecord.workstationLabel, "printRequest.metadata.workstationLabel"),
    },
  };
};

export const validateReceiptPrintAgentSubmitRequest = (value: unknown): ReceiptPrintAgentSubmitRequest => {
  const record = expectRecord(value, "body");
  return {
    printRequest: validateReceiptPrintRequest(record.printRequest),
  };
};

export const validateReceiptPrintAgentJob = (value: unknown): ReceiptPrintAgentJob => {
  const record = expectRecord(value, "job");
  const transportMode = expectString(record.transportMode, "job.transportMode");
  const documentFormat = expectString(record.documentFormat, "job.documentFormat");

  if (transportMode !== "DRY_RUN" && transportMode !== "RAW_TCP" && transportMode !== "WINDOWS_PRINTER") {
    throw new Error("job.transportMode must be DRY_RUN, RAW_TCP, or WINDOWS_PRINTER");
  }
  if (documentFormat !== RECEIPT_DOCUMENT_FORMAT) {
    throw new Error(`job.documentFormat must be ${RECEIPT_DOCUMENT_FORMAT}`);
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

export const validateReceiptPrintAgentSubmitResponse = (value: unknown): ReceiptPrintAgentSubmitResponse => {
  const record = expectRecord(value, "response");
  if (record.ok !== true) {
    throw new Error("response.ok must be true");
  }

  return {
    ok: true,
    job: validateReceiptPrintAgentJob(record.job),
  };
};
