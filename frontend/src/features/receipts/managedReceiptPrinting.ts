import { ApiError, apiPost } from "../../api/client";
import type { ManagedPrintJobSummary } from "../printing/managedPrintJobs";
import type { SalesReceiptData } from "./SalesReceipt";

type ReceiptPrintTransportMode = "DRY_RUN" | "RAW_TCP" | "WINDOWS_PRINTER";
type ReceiptPrintResolutionSource = "selected" | "workstation" | "default";

type ReceiptPrinterErrorCode =
  | "DEFAULT_RECEIPT_PRINTER_NOT_CONFIGURED"
  | "RECEIPT_PRINT_AGENT_NOT_CONFIGURED"
  | "RECEIPT_PRINT_AGENT_UNREACHABLE"
  | "RECEIPT_PRINT_AGENT_TIMEOUT"
  | "RECEIPT_PRINT_AGENT_TRANSPORT_FAILED"
  | "RECEIPT_PRINT_AGENT_REQUEST_INVALID"
  | "RECEIPT_PRINT_AGENT_REJECTED"
  | "RECEIPT_PRINT_AGENT_INVALID_RESPONSE"
  | "PRINTER_NOT_FOUND"
  | "PRINTER_INACTIVE"
  | "PRINTER_NOT_RECEIPT_CAPABLE"
  | "PRINTER_FAMILY_NOT_SUPPORTED"
  | "PRINTER_MODEL_NOT_SUPPORTED"
  | "PRINTER_TRANSPORT_NOT_SUPPORTED"
  | "PRINTER_TARGET_MISCONFIGURED"
  | "INVALID_RECEIPT_PRINT";

export type ReceiptPrintWorkstation = {
  key: string;
  label: string;
  description: string;
  defaultPrinterId: string | null;
};

export type ReceiptPrintResolvedPrinter = {
  id: string;
  key: string;
  name: string;
  transportMode: ReceiptPrintTransportMode;
  resolutionSource: ReceiptPrintResolutionSource;
};

export type ReceiptPrintPreparationResponse = {
  receipt: SalesReceiptData;
  printer: ReceiptPrintResolvedPrinter | null;
  availablePrinters: Array<{
    id: string;
    key: string;
    name: string;
    transportMode: ReceiptPrintTransportMode;
    location: string | null;
    notes: string | null;
    isDefaultReceiptPrinter: boolean;
  }>;
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
  receipt: SalesReceiptData;
  printer: ReceiptPrintResolvedPrinter;
  job: ManagedPrintJobSummary;
  browserPrintPath: string;
  copies: number;
};

type ReceiptPrintRequestOptions = {
  printerId?: string | null;
  printerKey?: string | null;
  workstationKey?: string | null;
  copies?: number;
};

const getApiErrorCode = (error: unknown): ReceiptPrinterErrorCode | null => {
  if (!(error instanceof ApiError) || !error.payload || typeof error.payload !== "object") {
    return null;
  }

  const payload = error.payload as { error?: unknown };
  if (!payload.error || typeof payload.error !== "object") {
    return null;
  }

  const code = (payload.error as { code?: unknown }).code;
  return typeof code === "string" ? (code as ReceiptPrinterErrorCode) : null;
};

const buildRequestBody = (options: ReceiptPrintRequestOptions) => ({
  ...(options.printerId ? { printerId: options.printerId } : {}),
  ...(options.printerKey ? { printerKey: options.printerKey } : {}),
  ...(options.workstationKey ? { workstationKey: options.workstationKey } : {}),
  ...(options.copies === undefined ? {} : { copies: options.copies }),
});

export const prepareManagedReceiptPrint = async (
  saleId: string,
  options: ReceiptPrintRequestOptions = {},
) =>
  apiPost<ReceiptPrintPreparationResponse>(
    `/api/sales/${encodeURIComponent(saleId)}/receipt/prepare-print`,
    buildRequestBody(options),
  );

export const printManagedReceipt = async (
  saleId: string,
  options: ReceiptPrintRequestOptions = {},
) =>
  apiPost<ReceiptQueuedPrintResponse>(
    `/api/sales/${encodeURIComponent(saleId)}/receipt/print`,
    buildRequestBody(options),
  );

export const getManagedReceiptPrintSuccessMessage = (response: ReceiptQueuedPrintResponse) =>
  `Receipt queued for ${response.printer.name}.`;

export const getManagedReceiptPrintErrorMessage = (error: unknown) => {
  const code = getApiErrorCode(error);

  switch (code) {
    case "DEFAULT_RECEIPT_PRINTER_NOT_CONFIGURED":
      return "No managed receipt printer is configured for this workstation. Ask a manager to set the receipt printer in Settings, or use browser print fallback.";
    case "RECEIPT_PRINT_AGENT_NOT_CONFIGURED":
      return "Receipt print helper is not configured. Ask a manager to check the Receipt Print Helper in Settings, or use browser print fallback.";
    case "RECEIPT_PRINT_AGENT_UNREACHABLE":
    case "RECEIPT_PRINT_AGENT_TIMEOUT":
      return "Receipt print helper unavailable. Check the managed print host and try again, or use browser print fallback.";
    case "RECEIPT_PRINT_AGENT_TRANSPORT_FAILED":
      return "Receipt printer is not accepting jobs right now. Check the printer or network route, then try again.";
    case "RECEIPT_PRINT_AGENT_REQUEST_INVALID":
      return "Receipt print helper rejected this job. Ask a manager to check the helper version and receipt settings.";
    case "RECEIPT_PRINT_AGENT_REJECTED":
    case "RECEIPT_PRINT_AGENT_INVALID_RESPONSE":
      return "Receipt printer route needs attention. Check the helper and target printer, then try again.";
    case "PRINTER_NOT_FOUND":
    case "PRINTER_INACTIVE":
    case "PRINTER_NOT_RECEIPT_CAPABLE":
    case "PRINTER_FAMILY_NOT_SUPPORTED":
    case "PRINTER_MODEL_NOT_SUPPORTED":
    case "PRINTER_TRANSPORT_NOT_SUPPORTED":
    case "PRINTER_TARGET_MISCONFIGURED":
      return "Receipt printer route needs attention. Ask a manager to check the registered receipt printer settings.";
    case "INVALID_RECEIPT_PRINT":
      return "Choose a valid receipt print option and try again.";
    default:
      return error instanceof Error ? error.message : "Managed receipt printing failed. Use browser print fallback if needed.";
  }
};
