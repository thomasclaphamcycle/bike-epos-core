import { ApiError, apiPost } from "../../api/client";

type BikeTagPrintTransportMode = "DRY_RUN" | "WINDOWS_PRINTER";

type BikeTagDirectPrintErrorCode =
  | "DEFAULT_BIKE_TAG_PRINTER_NOT_CONFIGURED"
  | "BIKE_TAG_PRINT_AGENT_NOT_CONFIGURED"
  | "BIKE_TAG_PRINT_AGENT_UNREACHABLE"
  | "BIKE_TAG_PRINT_AGENT_TIMEOUT"
  | "BIKE_TAG_PRINT_AGENT_REJECTED"
  | "BIKE_TAG_PRINT_AGENT_INVALID_RESPONSE"
  | "PRINTER_INACTIVE"
  | "PRINTER_NOT_BIKE_TAG_CAPABLE"
  | "PRINTER_FAMILY_NOT_SUPPORTED"
  | "PRINTER_MODEL_NOT_SUPPORTED"
  | "PRINTER_TRANSPORT_NOT_SUPPORTED"
  | "PRINTER_TARGET_MISCONFIGURED"
  | "INVALID_BIKE_TAG_PRINT";

export type BikeTagDirectPrintResponse = {
  printer: {
    id: string;
    key: string;
    name: string;
    transportMode: BikeTagPrintTransportMode;
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

const getApiErrorCode = (error: unknown): BikeTagDirectPrintErrorCode | null => {
  if (!(error instanceof ApiError) || !error.payload || typeof error.payload !== "object") {
    return null;
  }

  const payload = error.payload as { error?: unknown };
  if (!payload.error || typeof payload.error !== "object") {
    return null;
  }

  const code = (payload.error as { code?: unknown }).code;
  return typeof code === "string" ? code as BikeTagDirectPrintErrorCode : null;
};

export const printBikeTagDirect = async (
  variantId: string,
  options: { copies?: number } = {},
): Promise<BikeTagDirectPrintResponse> => {
  return apiPost<BikeTagDirectPrintResponse>(
    `/api/variants/${encodeURIComponent(variantId)}/bike-tag/print`,
    options.copies === undefined ? {} : { copies: options.copies },
  );
};

export const getBikeTagDirectPrintSuccessMessage = (response: BikeTagDirectPrintResponse) => {
  const copyLabel = `${response.printJob.copies} cop${response.printJob.copies === 1 ? "y" : "ies"}`;
  if (response.printJob.simulated) {
    return `Bike tag rendered in dry-run mode for ${response.printer.name} (${copyLabel}).`;
  }
  return `Bike tag sent to ${response.printer.name} (${copyLabel}).`;
};

export const getBikeTagDirectPrintErrorMessage = (error: unknown) => {
  const code = getApiErrorCode(error);

  switch (code) {
    case "DEFAULT_BIKE_TAG_PRINTER_NOT_CONFIGURED":
    case "BIKE_TAG_PRINT_AGENT_NOT_CONFIGURED":
      return "Bike-tag direct print is not set up here. Ask a manager to check the Bike-Tag Print Helper and default bike-tag printer in Settings, or use the preview fallback.";
    case "BIKE_TAG_PRINT_AGENT_UNREACHABLE":
    case "BIKE_TAG_PRINT_AGENT_TIMEOUT":
      return "Bike-tag print helper unavailable. Check the Windows office-printer helper, then try again. Use the preview fallback if needed.";
    case "BIKE_TAG_PRINT_AGENT_REJECTED":
    case "BIKE_TAG_PRINT_AGENT_INVALID_RESPONSE":
      return "Bike-tag printer unavailable. Check the Windows helper and Xerox printer connection, then try again.";
    case "PRINTER_INACTIVE":
    case "PRINTER_NOT_BIKE_TAG_CAPABLE":
    case "PRINTER_FAMILY_NOT_SUPPORTED":
    case "PRINTER_MODEL_NOT_SUPPORTED":
    case "PRINTER_TRANSPORT_NOT_SUPPORTED":
    case "PRINTER_TARGET_MISCONFIGURED":
      return "Bike-tag printer route needs attention. Ask a manager to check the office printer and bike-tag settings, or use the preview fallback.";
    case "INVALID_BIKE_TAG_PRINT":
      return "Choose a valid bike-tag quantity and try again.";
    default:
      return error instanceof Error ? error.message : "Bike-tag direct print failed. Use the preview fallback if needed.";
  }
};
