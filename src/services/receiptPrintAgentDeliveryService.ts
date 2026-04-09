import {
  validateReceiptPrintAgentSubmitResponse,
  type ReceiptPrintAgentSubmitResponse,
  type ReceiptPrintRequest,
} from "../../shared/receiptPrintContract";
import { HttpError } from "../utils/http";
import { resolveReceiptPrintAgentRuntimeConfig } from "./receiptPrintAgentConfigService";

const extractRemoteErrorDetails = (status: number, payload: unknown) => {
  if (payload && typeof payload === "object") {
    const maybeError = (payload as { error?: unknown }).error;
    if (typeof maybeError === "string" && maybeError.trim().length > 0) {
      return {
        code: null,
        message: maybeError,
      };
    }
    if (maybeError && typeof maybeError === "object") {
      const maybeCode = (maybeError as { code?: unknown }).code;
      const maybeMessage = (maybeError as { message?: unknown }).message;
      if (
        (typeof maybeCode === "string" && maybeCode.trim().length > 0)
        || (typeof maybeMessage === "string" && maybeMessage.trim().length > 0)
      ) {
        return {
          code: typeof maybeCode === "string" && maybeCode.trim().length > 0 ? maybeCode : null,
          message:
            typeof maybeMessage === "string" && maybeMessage.trim().length > 0
              ? maybeMessage
              : `Receipt print agent request failed (${status})`,
        };
      }
    }
  }

  return {
    code: null,
    message: `Receipt print agent request failed (${status})`,
  };
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

export const deliverReceiptPrintRequestToAgent = async (
  printRequest: ReceiptPrintRequest,
): Promise<ReceiptPrintAgentSubmitResponse> => {
  const config = await resolveReceiptPrintAgentRuntimeConfig();
  if (!config?.url) {
    throw new HttpError(
      503,
      "Receipt print helper is not configured. Save the Receipt Print Helper URL in Settings, or set COREPOS_RECEIPT_PRINT_AGENT_URL as a legacy fallback.",
      "RECEIPT_PRINT_AGENT_NOT_CONFIGURED",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const helperJobUrl = new URL("/jobs/receipt", config.url).toString();

  try {
    const headers = new Headers({
      "Content-Type": "application/json",
    });
    if (config.sharedSecret) {
      headers.set("X-CorePOS-Print-Agent-Secret", config.sharedSecret);
    }

    const response = await fetch(helperJobUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ printRequest }),
      signal: controller.signal,
    });

    const payload = await parseResponseBody(response);
    if (!response.ok) {
      const remoteError = extractRemoteErrorDetails(response.status, payload);
      if (response.status === 400) {
        throw new HttpError(
          502,
          remoteError.message,
          remoteError.code === "PRINT_AGENT_REQUEST_INVALID"
            ? "RECEIPT_PRINT_AGENT_REQUEST_INVALID"
            : "RECEIPT_PRINT_AGENT_REJECTED",
        );
      }

      throw new HttpError(502, remoteError.message, "RECEIPT_PRINT_AGENT_REJECTED");
    }

    try {
      return validateReceiptPrintAgentSubmitResponse(payload);
    } catch (error) {
      throw new HttpError(
        502,
        error instanceof Error ? error.message : "Receipt print agent response was invalid",
        "RECEIPT_PRINT_AGENT_INVALID_RESPONSE",
      );
    }
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
      throw new HttpError(
        504,
        `Receipt print agent timed out after ${config.timeoutMs}ms`,
        "RECEIPT_PRINT_AGENT_TIMEOUT",
      );
    }

    throw new HttpError(
      503,
      error instanceof Error ? `Receipt print agent could not be reached: ${error.message}` : "Receipt print agent could not be reached",
      "RECEIPT_PRINT_AGENT_UNREACHABLE",
    );
  } finally {
    clearTimeout(timeout);
  }
};
