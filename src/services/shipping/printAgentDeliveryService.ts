import {
  validateShipmentPrintAgentSubmitResponse,
  type ShipmentPrintAgentSubmitResponse,
  type ShipmentPrintRequest,
} from "../../../shared/shippingPrintContract";
import { HttpError } from "../../utils/http";

const DEFAULT_TIMEOUT_MS = 7000;

const parsePositiveInteger = (value: string | undefined, fallback: number) => {
  if (!value || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(
      500,
      "COREPOS_SHIPPING_PRINT_AGENT_TIMEOUT_MS must be a positive integer",
      "INVALID_SHIPPING_PRINT_AGENT_CONFIG",
    );
  }

  return parsed;
};

const getPrintAgentConfig = () => {
  const url = process.env.COREPOS_SHIPPING_PRINT_AGENT_URL?.trim() ?? "";
  const timeoutMs = parsePositiveInteger(process.env.COREPOS_SHIPPING_PRINT_AGENT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const sharedSecret = process.env.COREPOS_SHIPPING_PRINT_AGENT_SHARED_SECRET?.trim() || null;

  return {
    url,
    timeoutMs,
    sharedSecret,
  };
};

const extractRemoteErrorMessage = (status: number, payload: unknown) => {
  if (payload && typeof payload === "object") {
    const maybeError = (payload as { error?: unknown }).error;
    if (typeof maybeError === "string" && maybeError.trim().length > 0) {
      return maybeError;
    }
    if (maybeError && typeof maybeError === "object") {
      const maybeMessage = (maybeError as { message?: unknown }).message;
      if (typeof maybeMessage === "string" && maybeMessage.trim().length > 0) {
        return maybeMessage;
      }
    }
  }

  return `Print agent request failed (${status})`;
};

const parseResponseBody = async (response: Response) => {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

export const deliverShipmentPrintRequestToAgent = async (
  printRequest: ShipmentPrintRequest,
): Promise<ShipmentPrintAgentSubmitResponse> => {
  const config = getPrintAgentConfig();
  if (!config.url) {
    throw new HttpError(
      503,
      "Shipping print agent is not configured. Set COREPOS_SHIPPING_PRINT_AGENT_URL to enable shipment printing.",
      "SHIPPING_PRINT_AGENT_NOT_CONFIGURED",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const headers = new Headers({
      "Content-Type": "application/json",
    });
    if (config.sharedSecret) {
      headers.set("X-CorePOS-Print-Agent-Secret", config.sharedSecret);
    }

    const response = await fetch(new URL("/jobs/shipment-label", config.url).toString(), {
      method: "POST",
      headers,
      body: JSON.stringify({ printRequest }),
      signal: controller.signal,
    });

    const payload = await parseResponseBody(response);
    if (!response.ok) {
      throw new HttpError(
        502,
        extractRemoteErrorMessage(response.status, payload),
        "SHIPPING_PRINT_AGENT_REJECTED",
      );
    }

    try {
      return validateShipmentPrintAgentSubmitResponse(payload);
    } catch (error) {
      throw new HttpError(
        502,
        error instanceof Error ? error.message : "Print agent response was invalid",
        "SHIPPING_PRINT_AGENT_INVALID_RESPONSE",
      );
    }
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
      throw new HttpError(
        504,
        `Shipping print agent timed out after ${config.timeoutMs}ms`,
        "SHIPPING_PRINT_AGENT_TIMEOUT",
      );
    }

    throw new HttpError(
      503,
      error instanceof Error ? `Shipping print agent could not be reached: ${error.message}` : "Shipping print agent could not be reached",
      "SHIPPING_PRINT_AGENT_UNREACHABLE",
    );
  } finally {
    clearTimeout(timeout);
  }
};
