import {
  expectIsoDateString,
  expectNullableString,
  expectPositiveInteger,
  expectRecord,
  expectString,
} from "./printContractUtils";

export const SHIPMENT_LABEL_DOCUMENT_FORMAT = "ZPL" as const;
export const SHIPMENT_LABEL_MIME_TYPE = "application/zpl" as const;
export const SHIPMENT_PRINT_REQUEST_VERSION = 1 as const;
export const SHIPMENT_PRINT_INTENT = "SHIPMENT_LABEL_PRINT" as const;
export const WINDOWS_LOCAL_AGENT_TRANSPORT = "WINDOWS_LOCAL_AGENT" as const;
export const ZEBRA_LABEL_PRINTER_FAMILY = "ZEBRA_LABEL" as const;
export const ZEBRA_GK420D_MODEL_HINT = "GK420D_OR_COMPATIBLE" as const;

export type ShippingLabelDocument = {
  format: typeof SHIPMENT_LABEL_DOCUMENT_FORMAT;
  mimeType: typeof SHIPMENT_LABEL_MIME_TYPE;
  fileName: string;
  content: string;
};

export type ShipmentPrintRequest = {
  version: typeof SHIPMENT_PRINT_REQUEST_VERSION;
  intentType: typeof SHIPMENT_PRINT_INTENT;
  shipmentId: string;
  orderId: string;
  orderNumber: string;
  trackingNumber: string;
  printer: {
    transport: typeof WINDOWS_LOCAL_AGENT_TRANSPORT;
    printerId: string;
    printerKey: string;
    printerFamily: typeof ZEBRA_LABEL_PRINTER_FAMILY;
    printerModelHint: typeof ZEBRA_GK420D_MODEL_HINT;
    printerName: string;
    transportMode: PrintAgentTransportMode;
    rawTcpHost: string | null;
    rawTcpPort: number | null;
    copies: number;
  };
  document: ShippingLabelDocument;
  metadata: {
    providerKey: string;
    providerDisplayName: string;
    serviceCode: string;
    serviceName: string;
    sourceChannel: string;
  };
};

export type PrintAgentTransportMode = "DRY_RUN" | "RAW_TCP";

export type ShipmentPrintAgentJob = {
  jobId: string;
  acceptedAt: string;
  completedAt: string;
  transportMode: PrintAgentTransportMode;
  printerId: string;
  printerKey: string;
  printerName: string;
  printerTarget: string;
  copies: number;
  documentFormat: typeof SHIPMENT_LABEL_DOCUMENT_FORMAT;
  bytesSent: number;
  simulated: boolean;
  outputPath: string | null;
};

export type ShipmentPrintAgentSubmitRequest = {
  printRequest: ShipmentPrintRequest;
};

export type ShipmentPrintAgentSubmitResponse = {
  ok: true;
  job: ShipmentPrintAgentJob;
};

export const validateShippingLabelDocument = (value: unknown): ShippingLabelDocument => {
  const record = expectRecord(value, "document");
  const format = expectString(record.format, "document.format");
  const mimeType = expectString(record.mimeType, "document.mimeType");

  if (format !== SHIPMENT_LABEL_DOCUMENT_FORMAT) {
    throw new Error(`document.format must be ${SHIPMENT_LABEL_DOCUMENT_FORMAT}`);
  }
  if (mimeType !== SHIPMENT_LABEL_MIME_TYPE) {
    throw new Error(`document.mimeType must be ${SHIPMENT_LABEL_MIME_TYPE}`);
  }

  return {
    format,
    mimeType,
    fileName: expectString(record.fileName, "document.fileName"),
    content: expectString(record.content, "document.content"),
  };
};

export const validateShipmentPrintRequest = (value: unknown): ShipmentPrintRequest => {
  const record = expectRecord(value, "printRequest");
  const version = Number(record.version);
  const intentType = expectString(record.intentType, "printRequest.intentType");
  if (version !== SHIPMENT_PRINT_REQUEST_VERSION) {
    throw new Error(`printRequest.version must be ${SHIPMENT_PRINT_REQUEST_VERSION}`);
  }
  if (intentType !== SHIPMENT_PRINT_INTENT) {
    throw new Error(`printRequest.intentType must be ${SHIPMENT_PRINT_INTENT}`);
  }

  const printerRecord = expectRecord(record.printer, "printRequest.printer");
  const transport = expectString(printerRecord.transport, "printRequest.printer.transport");
  const printerFamily = expectString(printerRecord.printerFamily, "printRequest.printer.printerFamily");
  const printerModelHint = expectString(printerRecord.printerModelHint, "printRequest.printer.printerModelHint");

  if (transport !== WINDOWS_LOCAL_AGENT_TRANSPORT) {
    throw new Error(`printRequest.printer.transport must be ${WINDOWS_LOCAL_AGENT_TRANSPORT}`);
  }
  if (printerFamily !== ZEBRA_LABEL_PRINTER_FAMILY) {
    throw new Error(`printRequest.printer.printerFamily must be ${ZEBRA_LABEL_PRINTER_FAMILY}`);
  }
  if (printerModelHint !== ZEBRA_GK420D_MODEL_HINT) {
    throw new Error(`printRequest.printer.printerModelHint must be ${ZEBRA_GK420D_MODEL_HINT}`);
  }
  const printerTransportMode = expectString(
    printerRecord.transportMode,
    "printRequest.printer.transportMode",
  );
  if (printerTransportMode !== "DRY_RUN" && printerTransportMode !== "RAW_TCP") {
    throw new Error("printRequest.printer.transportMode must be DRY_RUN or RAW_TCP");
  }

  const metadataRecord = expectRecord(record.metadata, "printRequest.metadata");
  const rawTcpHost = expectNullableString(printerRecord.rawTcpHost, "printRequest.printer.rawTcpHost");
  const rawTcpPort =
    printerRecord.rawTcpPort === null
      ? null
      : expectPositiveInteger(printerRecord.rawTcpPort, "printRequest.printer.rawTcpPort");

  if (printerTransportMode === "RAW_TCP" && (!rawTcpHost || !rawTcpPort)) {
    throw new Error("RAW_TCP print requests must include rawTcpHost and rawTcpPort");
  }

  return {
    version: SHIPMENT_PRINT_REQUEST_VERSION,
    intentType: SHIPMENT_PRINT_INTENT,
    shipmentId: expectString(record.shipmentId, "printRequest.shipmentId"),
    orderId: expectString(record.orderId, "printRequest.orderId"),
    orderNumber: expectString(record.orderNumber, "printRequest.orderNumber"),
    trackingNumber: expectString(record.trackingNumber, "printRequest.trackingNumber"),
    printer: {
      transport: WINDOWS_LOCAL_AGENT_TRANSPORT,
      printerId: expectString(printerRecord.printerId, "printRequest.printer.printerId"),
      printerKey: expectString(printerRecord.printerKey, "printRequest.printer.printerKey"),
      printerFamily: ZEBRA_LABEL_PRINTER_FAMILY,
      printerModelHint: ZEBRA_GK420D_MODEL_HINT,
      printerName: expectString(printerRecord.printerName, "printRequest.printer.printerName"),
      transportMode: printerTransportMode,
      rawTcpHost,
      rawTcpPort,
      copies: expectPositiveInteger(printerRecord.copies, "printRequest.printer.copies"),
    },
    document: validateShippingLabelDocument(record.document),
    metadata: {
      providerKey: expectString(metadataRecord.providerKey, "printRequest.metadata.providerKey"),
      providerDisplayName: expectString(metadataRecord.providerDisplayName, "printRequest.metadata.providerDisplayName"),
      serviceCode: expectString(metadataRecord.serviceCode, "printRequest.metadata.serviceCode"),
      serviceName: expectString(metadataRecord.serviceName, "printRequest.metadata.serviceName"),
      sourceChannel: expectString(metadataRecord.sourceChannel, "printRequest.metadata.sourceChannel"),
    },
  };
};

export const validateShipmentPrintAgentSubmitRequest = (value: unknown): ShipmentPrintAgentSubmitRequest => {
  const record = expectRecord(value, "body");

  return {
    printRequest: validateShipmentPrintRequest(record.printRequest),
  };
};

export const validateShipmentPrintAgentJob = (value: unknown): ShipmentPrintAgentJob => {
  const record = expectRecord(value, "job");
  const transportMode = expectString(record.transportMode, "job.transportMode");
  const documentFormat = expectString(record.documentFormat, "job.documentFormat");

  if (transportMode !== "DRY_RUN" && transportMode !== "RAW_TCP") {
    throw new Error("job.transportMode must be DRY_RUN or RAW_TCP");
  }
  if (documentFormat !== SHIPMENT_LABEL_DOCUMENT_FORMAT) {
    throw new Error(`job.documentFormat must be ${SHIPMENT_LABEL_DOCUMENT_FORMAT}`);
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

export const validateShipmentPrintAgentSubmitResponse = (value: unknown): ShipmentPrintAgentSubmitResponse => {
  const record = expectRecord(value, "response");
  if (record.ok !== true) {
    throw new Error("response.ok must be true");
  }

  return {
    ok: true,
    job: validateShipmentPrintAgentJob(record.job),
  };
};
