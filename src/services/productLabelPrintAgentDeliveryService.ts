import {
  validateProductLabelPrintAgentSubmitResponse,
  type ProductLabelPrintAgentSubmitResponse,
  type ProductLabelPrintRequest,
} from "../../shared/productLabelPrintContract";
import { HttpError } from "../utils/http";

const DEFAULT_TIMEOUT_MS = 7000;

const parsePositiveInteger = (value: string | undefined, fallback: number, field: string) => {
  if (!value || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(500, `${field} must be a positive integer`, "INVALID_PRODUCT_LABEL_PRINT_AGENT_CONFIG");
  }

  return parsed;
};

const readOptionalEnv = (...keys: string[]) => {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }

  return "";
};

const getPrintAgentConfig = () => {
  const url = readOptionalEnv("COREPOS_PRODUCT_LABEL_PRINT_AGENT_URL", "COREPOS_SHIPPING_PRINT_AGENT_URL");
  const timeoutMs = parsePositiveInteger(
    readOptionalEnv("COREPOS_PRODUCT_LABEL_PRINT_AGENT_TIMEOUT_MS", "COREPOS_SHIPPING_PRINT_AGENT_TIMEOUT_MS") || undefined,
    DEFAULT_TIMEOUT_MS,
    "COREPOS_PRODUCT_LABEL_PRINT_AGENT_TIMEOUT_MS",
  );
  const sharedSecret = readOptionalEnv(
    "COREPOS_PRODUCT_LABEL_PRINT_AGENT_SHARED_SECRET",
    "COREPOS_SHIPPING_PRINT_AGENT_SHARED_SECRET",
  ) || null;

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

  return `Product label print agent request failed (${status})`;
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

export const deliverProductLabelPrintRequestToAgent = async (
  printRequest: ProductLabelPrintRequest,
): Promise<ProductLabelPrintAgentSubmitResponse> => {
  const config = getPrintAgentConfig();
  if (!config.url) {
    throw new HttpError(
      503,
      "Product-label print agent is not configured. Set COREPOS_PRODUCT_LABEL_PRINT_AGENT_URL to the standalone Windows Dymo helper (or another compatible local agent URL) to enable direct Dymo printing.",
      "PRODUCT_LABEL_PRINT_AGENT_NOT_CONFIGURED",
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

    const response = await fetch(new URL("/jobs/product-label", config.url).toString(), {
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
        "PRODUCT_LABEL_PRINT_AGENT_REJECTED",
      );
    }

    try {
      return validateProductLabelPrintAgentSubmitResponse(payload);
    } catch (error) {
      throw new HttpError(
        502,
        error instanceof Error ? error.message : "Product label print agent response was invalid",
        "PRODUCT_LABEL_PRINT_AGENT_INVALID_RESPONSE",
      );
    }
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
      throw new HttpError(
        504,
        `Product-label print agent timed out after ${config.timeoutMs}ms`,
        "PRODUCT_LABEL_PRINT_AGENT_TIMEOUT",
      );
    }

    throw new HttpError(
      503,
      error instanceof Error
        ? `Product-label print agent could not be reached: ${error.message}`
        : "Product-label print agent could not be reached",
      "PRODUCT_LABEL_PRINT_AGENT_UNREACHABLE",
    );
  } finally {
    clearTimeout(timeout);
  }
};
