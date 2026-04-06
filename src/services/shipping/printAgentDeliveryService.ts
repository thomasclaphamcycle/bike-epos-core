import {
  validateShipmentPrintAgentSubmitResponse,
  type ShipmentPrintAgentSubmitResponse,
  type ShipmentPrintRequest,
} from "../../../shared/shippingPrintContract";
import { resolveShippingPrintAgentRuntimeConfig } from "./printAgentConfigService";
import { HttpError } from "../../utils/http";

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
  const config = await resolveShippingPrintAgentRuntimeConfig();
  if (!config?.url) {
    throw new HttpError(
      503,
      "Shipping print helper is not configured. Save the Windows Zebra helper URL in Settings, or set COREPOS_SHIPPING_PRINT_AGENT_URL as a legacy fallback.",
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
