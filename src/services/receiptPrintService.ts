import type { DetailedReceipt } from "./receiptService";
import { getReceiptByNumber, issueReceipt } from "./receiptService";
import {
  ESC_POS_80MM_MODEL_HINT,
  RECEIPT_DOCUMENT_FORMAT,
  RECEIPT_PRINT_INTENT,
  RECEIPT_PRINT_REQUEST_VERSION,
  THERMAL_RECEIPT_PRINTER_FAMILY,
  WINDOWS_LOCAL_AGENT_TRANSPORT,
  type ReceiptPrintRequest,
} from "../../shared/receiptPrintContract";
import {
  MANAGED_PRINT_QUEUE_PAYLOAD_VERSION,
  type ManagedPrintJobSummary,
} from "../../shared/managedPrintJobContract";
import { logOperationalEvent } from "../lib/operationalLogger";
import { HttpError } from "../utils/http";
import { renderReceiptEscPosDocument } from "./receiptEscPosDocument";
import {
  listRegisteredPrinters,
  resolveReceiptPrinterSelection,
  type RegisteredPrinterResponse,
  type ResolveReceiptPrinterSelectionInput,
  type ResolvedReceiptPrinter,
} from "./printerService";
import {
  listReceiptPrintStations,
  resolveReceiptPrintWorkstation,
  type ReceiptPrintWorkstation,
} from "./receiptPrintStationService";
import { type AuditActor } from "./auditService";
import { buildManagedPrintQueuePayload } from "./managedPrintDispatchService";
import { enqueueManagedPrintJob } from "./managedPrintQueueService";

const MAX_RECEIPT_COPIES = 5;
const PRINTER_RESOLUTION_ERROR_CODES = new Set([
  "DEFAULT_RECEIPT_PRINTER_NOT_CONFIGURED",
  "PRINTER_NOT_FOUND",
  "PRINTER_INACTIVE",
  "PRINTER_NOT_RECEIPT_CAPABLE",
  "PRINTER_FAMILY_NOT_SUPPORTED",
  "PRINTER_MODEL_NOT_SUPPORTED",
  "PRINTER_TRANSPORT_NOT_SUPPORTED",
  "PRINTER_TARGET_MISCONFIGURED",
]);

export type ReceiptPrintPreparationInput = ResolveReceiptPrinterSelectionInput & {
  copies?: number | null;
};

export type ReceiptPrintPreparationResponse = {
  receipt: DetailedReceipt;
  printer: ResolvedReceiptPrinter | null;
  availablePrinters: RegisteredPrinterResponse[];
  workstations: ReceiptPrintWorkstation[];
  currentWorkstation: ReceiptPrintWorkstation | null;
  browserPrintPath: string;
  copies: number;
  resolutionError: {
    code: string;
    message: string;
  } | null;
};

export type ReceiptQueuedPrintResponse = {
  receipt: DetailedReceipt;
  printer: ResolvedReceiptPrinter;
  job: ManagedPrintJobSummary;
  browserPrintPath: string;
  copies: number;
};

const normalizeCopies = (value: unknown) => {
  if (value === undefined || value === null) {
    return 1;
  }
  if (!Number.isInteger(value) || Number(value) <= 0 || Number(value) > MAX_RECEIPT_COPIES) {
    throw new HttpError(
      400,
      `copies must be an integer between 1 and ${MAX_RECEIPT_COPIES}`,
      "INVALID_RECEIPT_PRINT",
    );
  }
  return Number(value);
};

const isPrinterResolutionError = (error: unknown): error is HttpError =>
  error instanceof HttpError && PRINTER_RESOLUTION_ERROR_CODES.has(error.code);

const loadDetailedSaleReceipt = async (
  saleId: string,
  issuedByStaffId?: string,
) => {
  const issued = await issueReceipt({ saleId, issuedByStaffId });
  return getReceiptByNumber(issued.receipt.receiptNumber);
};

const buildReceiptPrintRequest = (
  saleId: string,
  receipt: DetailedReceipt,
  printer: ResolvedReceiptPrinter,
  currentWorkstation: ReceiptPrintWorkstation | null,
  copies: number,
): ReceiptPrintRequest => {
  const renderedDocument = renderReceiptEscPosDocument(receipt);

  return {
    version: RECEIPT_PRINT_REQUEST_VERSION,
    intentType: RECEIPT_PRINT_INTENT,
    saleId,
    receiptNumber: receipt.receiptNumber,
    printer: {
      transport: WINDOWS_LOCAL_AGENT_TRANSPORT,
      printerId: printer.id,
      printerKey: printer.key,
      printerFamily: THERMAL_RECEIPT_PRINTER_FAMILY,
      printerModelHint: ESC_POS_80MM_MODEL_HINT,
      printerName: printer.name,
      transportMode: printer.transportMode,
      windowsPrinterName: printer.windowsPrinterName,
      rawTcpHost: printer.rawTcpHost,
      rawTcpPort: printer.rawTcpPort,
      copies,
    },
    document: {
      format: RECEIPT_DOCUMENT_FORMAT,
      mimeType: renderedDocument.mimeType,
      fileName: renderedDocument.fileName,
      bytesBase64: renderedDocument.bytesBase64,
    },
    metadata: {
      source: "COREPOS_MANAGED_RECEIPT_PRINT",
      sourceLabel: receipt.receiptNumber,
      workstationKey: currentWorkstation?.key ?? null,
      workstationLabel: currentWorkstation?.label ?? null,
    },
  };
};

export const prepareSaleReceiptPrint = async (
  saleId: string,
  input: ReceiptPrintPreparationInput = {},
): Promise<ReceiptPrintPreparationResponse> => {
  const copies = normalizeCopies(input.copies);
  const [receipt, printerList, workstations, currentWorkstation] = await Promise.all([
    loadDetailedSaleReceipt(saleId),
    listRegisteredPrinters({ activeOnly: true, receiptOnly: true }),
    listReceiptPrintStations(),
    resolveReceiptPrintWorkstation(input.workstationKey),
  ]);

  try {
    const printer = await resolveReceiptPrinterSelection(input);
    return {
      receipt,
      printer,
      availablePrinters: printerList.printers,
      workstations: workstations.workstations,
      currentWorkstation,
      browserPrintPath: `/sales/${encodeURIComponent(saleId)}/receipt/print`,
      copies,
      resolutionError: null,
    };
  } catch (error) {
    if (!isPrinterResolutionError(error)) {
      throw error;
    }

    return {
      receipt,
      printer: null,
      availablePrinters: printerList.printers,
      workstations: workstations.workstations,
      currentWorkstation,
      browserPrintPath: `/sales/${encodeURIComponent(saleId)}/receipt/print`,
      copies,
      resolutionError: {
        code: error.code,
        message: error.message,
      },
    };
  }
};

export const queueSaleReceiptPrint = async (
  saleId: string,
  input: ReceiptPrintPreparationInput = {},
  issuedByStaffId?: string,
  auditActor?: AuditActor,
): Promise<ReceiptQueuedPrintResponse> => {
  const copies = normalizeCopies(input.copies);
  const [receipt, printer, currentWorkstation] = await Promise.all([
    loadDetailedSaleReceipt(saleId, issuedByStaffId),
    resolveReceiptPrinterSelection(input),
    resolveReceiptPrintWorkstation(input.workstationKey),
  ]);

  const printRequest = buildReceiptPrintRequest(saleId, receipt, printer, currentWorkstation, copies);

  try {
    const queued = await enqueueManagedPrintJob(
      {
        workflowType: "RECEIPT_PRINT",
        printerId: printer.id,
        payload: buildManagedPrintQueuePayload({
          version: MANAGED_PRINT_QUEUE_PAYLOAD_VERSION,
          workflowType: "RECEIPT_PRINT",
          printRequest,
        }),
        documentLabel: receipt.receiptNumber,
        sourceEntityType: "SALE_RECEIPT",
        sourceEntityId: saleId,
        createdByStaffId: issuedByStaffId ?? null,
      },
      auditActor,
    );

    logOperationalEvent("receipt.print_job.enqueued", {
      entityId: receipt.receiptNumber,
      receiptNumber: receipt.receiptNumber,
      saleId,
      printJobId: queued.job.id,
      printerId: printer.id,
      printerKey: printer.key,
      transportMode: printer.transportMode,
      resolutionSource: printer.resolutionSource,
      workstationKey: currentWorkstation?.key ?? null,
      copies,
    });

    return {
      receipt,
      printer,
      job: queued.job,
      browserPrintPath: `/sales/${encodeURIComponent(saleId)}/receipt/print`,
      copies,
    };
  } catch (error) {
    logOperationalEvent("receipt.print_job.enqueue_failed", {
      entityId: receipt.receiptNumber,
      receiptNumber: receipt.receiptNumber,
      saleId,
      printerId: printer.id,
      printerKey: printer.key,
      transportMode: printer.transportMode,
      resolutionSource: printer.resolutionSource,
      workstationKey: currentWorkstation?.key ?? null,
      errorCode: error instanceof HttpError ? error.code : undefined,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};
