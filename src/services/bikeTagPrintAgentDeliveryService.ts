import {
  validateBikeTagPrintAgentSubmitResponse,
  type BikeTagPrintAgentSubmitResponse,
  type BikeTagPrintRequest,
} from "../../shared/bikeTagPrintContract";
import { HttpError } from "../utils/http";
import { resolveBikeTagPrintAgentRuntimeConfig } from "./bikeTagPrintAgentConfigService";

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
              : `Bike tag print agent request failed (${status})`,
        };
      }
    }
  }

  return {
    code: null,
    message: `Bike tag print agent request failed (${status})`,
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

export const deliverBikeTagPrintRequestToAgent = async (
  printRequest: BikeTagPrintRequest,
): Promise<BikeTagPrintAgentSubmitResponse> => {
  const config = await resolveBikeTagPrintAgentRuntimeConfig();
  if (!config?.url) {
    throw new HttpError(
      503,
      "Bike-tag print helper is not configured. Save the Windows bike-tag helper URL in Settings, or set COREPOS_BIKE_TAG_PRINT_AGENT_URL as a legacy fallback.",
      "BIKE_TAG_PRINT_AGENT_NOT_CONFIGURED",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const helperJobUrl = new URL("/jobs/bike-tag", config.url).toString();

  try {
    console.info(
      `[corepos] Sending bike-tag job to helper ${helperJobUrl} via ${config.source} configuration`,
    );
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
            ? "BIKE_TAG_PRINT_AGENT_REQUEST_INVALID"
            : "BIKE_TAG_PRINT_AGENT_REJECTED",
        );
      }

      throw new HttpError(
        502,
        remoteError.message,
        "BIKE_TAG_PRINT_AGENT_REJECTED",
      );
    }

    try {
      const validated = validateBikeTagPrintAgentSubmitResponse(payload);
      console.info(`[corepos] Bike-tag helper accepted job ${validated.job.jobId}`);
      return validated;
    } catch (error) {
      throw new HttpError(
        502,
        error instanceof Error ? error.message : "Bike-tag print agent response was invalid",
        "BIKE_TAG_PRINT_AGENT_INVALID_RESPONSE",
      );
    }
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
      console.error(
        `[corepos] Bike-tag helper timeout after ${config.timeoutMs}ms for ${helperJobUrl}`,
      );
      throw new HttpError(
        504,
        `Bike-tag print agent timed out after ${config.timeoutMs}ms`,
        "BIKE_TAG_PRINT_AGENT_TIMEOUT",
      );
    }

    throw new HttpError(
      503,
      error instanceof Error ? `Bike-tag print agent could not be reached: ${error.message}` : "Bike-tag print agent could not be reached",
      "BIKE_TAG_PRINT_AGENT_UNREACHABLE",
    );
  } finally {
    clearTimeout(timeout);
  }
};
