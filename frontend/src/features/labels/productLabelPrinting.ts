import { ApiError, apiPost } from "../../api/client";

type ProductLabelPrintTransportMode = "DRY_RUN" | "WINDOWS_PRINTER";

type ProductLabelDirectPrintErrorCode =
  | "DEFAULT_PRODUCT_LABEL_PRINTER_NOT_CONFIGURED"
  | "PRODUCT_LABEL_PRINT_AGENT_NOT_CONFIGURED"
  | "PRODUCT_LABEL_PRINT_AGENT_UNREACHABLE"
  | "PRODUCT_LABEL_PRINT_AGENT_TIMEOUT"
  | "PRODUCT_LABEL_PRINT_AGENT_REJECTED"
  | "PRODUCT_LABEL_PRINT_AGENT_INVALID_RESPONSE"
  | "PRINTER_INACTIVE"
  | "PRINTER_NOT_PRODUCT_LABEL_CAPABLE"
  | "PRINTER_FAMILY_NOT_SUPPORTED"
  | "PRINTER_MODEL_NOT_SUPPORTED"
  | "PRINTER_TRANSPORT_NOT_SUPPORTED"
  | "PRINTER_TARGET_MISCONFIGURED"
  | "INVALID_PRODUCT_LABEL_PRINT";

export type ProductLabelDirectPrintResponse = {
  printer: {
    id: string;
    key: string;
    name: string;
    transportMode: ProductLabelPrintTransportMode;
    resolutionSource: "selected" | "default";
  };
  printJob: {
    jobId: string;
    printerTarget: string;
    simulated: boolean;
    outputPath: string | null;
    copies: number;
  };
};

const getApiErrorCode = (error: unknown): ProductLabelDirectPrintErrorCode | null => {
  if (!(error instanceof ApiError) || !error.payload || typeof error.payload !== "object") {
    return null;
  }

  const payload = error.payload as { error?: unknown };
  if (!payload.error || typeof payload.error !== "object") {
    return null;
  }

  const code = (payload.error as { code?: unknown }).code;
  return typeof code === "string" ? code as ProductLabelDirectPrintErrorCode : null;
};

export const printProductLabelDirect = async (
  variantId: string,
  options: { copies?: number } = {},
): Promise<ProductLabelDirectPrintResponse> => {
  return apiPost<ProductLabelDirectPrintResponse>(
    `/api/variants/${encodeURIComponent(variantId)}/product-label/print`,
    options.copies === undefined ? {} : { copies: options.copies },
  );
};

export const getProductLabelDirectPrintSuccessMessage = (
  response: ProductLabelDirectPrintResponse,
) => {
  const copyLabel = `${response.printJob.copies} cop${response.printJob.copies === 1 ? "y" : "ies"}`;
  if (response.printJob.simulated) {
    return `Dry-run label rendered for ${response.printer.name} (${copyLabel}).`;
  }
  return `Label sent to ${response.printer.name} (${copyLabel}).`;
};

export const getProductLabelDirectPrintErrorMessage = (error: unknown) => {
  const code = getApiErrorCode(error);

  switch (code) {
    case "DEFAULT_PRODUCT_LABEL_PRINTER_NOT_CONFIGURED":
    case "PRODUCT_LABEL_PRINT_AGENT_NOT_CONFIGURED":
      return "Direct label print is not set up here. Use Browser print fallback or ask a manager to check the Dymo setup.";
    case "PRODUCT_LABEL_PRINT_AGENT_UNREACHABLE":
    case "PRODUCT_LABEL_PRINT_AGENT_TIMEOUT":
      return "Label print helper unavailable. Check the Windows Dymo helper, then try again. Use Browser print fallback if needed.";
    case "PRODUCT_LABEL_PRINT_AGENT_REJECTED":
    case "PRODUCT_LABEL_PRINT_AGENT_INVALID_RESPONSE":
      return "Label printer unavailable. Check the Windows Dymo helper and printer connection, then try again.";
    case "PRINTER_INACTIVE":
    case "PRINTER_NOT_PRODUCT_LABEL_CAPABLE":
    case "PRINTER_FAMILY_NOT_SUPPORTED":
    case "PRINTER_MODEL_NOT_SUPPORTED":
    case "PRINTER_TRANSPORT_NOT_SUPPORTED":
    case "PRINTER_TARGET_MISCONFIGURED":
      return "Label printer route needs attention. Ask a manager to check the default Dymo printer in Settings, or use Browser print fallback.";
    case "INVALID_PRODUCT_LABEL_PRINT":
      return "Choose a valid label quantity and try again.";
    default:
      return error instanceof Error ? error.message : "Direct label print failed. Use Browser print fallback if needed.";
  }
};
