import { HttpError } from "../../utils/http";
import {
  DojoTerminalIntegrationConfig,
  getDojoTerminalIntegrationConfig,
} from "./dojoConfig";

export type DojoMoney = {
  value: number;
  currencyCode: string;
};

export type DojoTerminal = {
  id?: string | null;
  terminalId?: string | null;
  name?: string | null;
  status?: string | null;
  tid?: string | null;
  [key: string]: unknown;
};

export type DojoPaymentIntent = {
  id?: string | null;
  status?: string | null;
  amount?: DojoMoney | null;
  requestedAmount?: DojoMoney | null;
  totalAmount?: DojoMoney | null;
  paymentDetails?: unknown;
  [key: string]: unknown;
};

export type DojoTerminalSession = {
  id?: string | null;
  terminalSessionId?: string | null;
  status?: string | null;
  terminalId?: string | null;
  notificationEvents?: unknown;
  customerReceipt?: unknown;
  merchantReceipt?: unknown;
  details?: unknown;
  [key: string]: unknown;
};

type DojoRequestOptions = {
  method?: string;
  body?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const parseJsonResponse = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const extractErrorMessage = (status: number, payload: unknown) => {
  if (isRecord(payload)) {
    if (typeof payload.detail === "string" && payload.detail.trim()) {
      return payload.detail;
    }
    if (typeof payload.title === "string" && payload.title.trim()) {
      return payload.title;
    }
    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message;
    }
  }
  return `Dojo API request failed with status ${status}`;
};

export class DojoClient {
  private readonly config: DojoTerminalIntegrationConfig;

  constructor(config = getDojoTerminalIntegrationConfig()) {
    this.config = config;
  }

  private assertConfigured() {
    if (!this.config.enabled) {
      throw new HttpError(503, "Dojo Pay at Counter is not enabled", "DOJO_TERMINALS_DISABLED");
    }
    if (!this.config.configured || !this.config.apiKey || !this.config.softwareHouseId || !this.config.resellerId) {
      throw new HttpError(
        503,
        "Dojo Pay at Counter is missing API credentials or integration identifiers",
        "DOJO_TERMINALS_NOT_CONFIGURED",
      );
    }
  }

  private async request<T>(path: string, options: DojoRequestOptions = {}): Promise<T> {
    this.assertConfigured();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    const url = `${this.config.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

    try {
      const response = await fetch(url, {
        method: options.method ?? "GET",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          version: this.config.apiVersion,
          "software-house-id": this.config.softwareHouseId!,
          "reseller-id": this.config.resellerId!,
          Authorization: `Basic ${this.config.apiKey}`,
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: controller.signal,
      });
      const payload = await parseJsonResponse(response);

      if (!response.ok) {
        throw new HttpError(502, extractErrorMessage(response.status, payload), "DOJO_API_ERROR");
      }

      return payload as T;
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new HttpError(504, "Dojo API request timed out", "DOJO_API_TIMEOUT");
      }
      throw new HttpError(
        502,
        error instanceof Error ? error.message : "Dojo API request failed",
        "DOJO_API_ERROR",
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async createPaymentIntent(input: {
    saleId: string;
    amountPence: number;
    reference: string;
    description?: string;
    currencyCode?: string;
  }) {
    return this.request<DojoPaymentIntent>("/payment-intents", {
      method: "POST",
      body: {
        captureMode: "Auto",
        amount: {
          value: input.amountPence,
          currencyCode: input.currencyCode ?? this.config.currencyCode,
        },
        reference: input.reference.slice(0, 60),
        ...(input.description ? { description: input.description } : {}),
        metadata: {
          coreposSaleId: input.saleId,
        },
      },
    });
  }

  async listTerminals(statuses?: string) {
    const params = new URLSearchParams();
    if (statuses) {
      params.set("statuses", statuses);
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return this.request<DojoTerminal[] | { terminals?: DojoTerminal[] }>(`/terminals${suffix}`);
  }

  async createSaleTerminalSession(input: {
    terminalId: string;
    paymentIntentId: string;
  }) {
    return this.request<DojoTerminalSession>("/terminal-sessions", {
      method: "POST",
      body: {
        terminalId: input.terminalId,
        details: {
          sessionType: "Sale",
          sale: {
            paymentIntentId: input.paymentIntentId,
          },
        },
      },
    });
  }

  async getTerminalSession(terminalSessionId: string) {
    return this.request<DojoTerminalSession>(
      `/terminal-sessions/${encodeURIComponent(terminalSessionId)}`,
    );
  }

  async getPaymentIntent(paymentIntentId: string) {
    return this.request<DojoPaymentIntent>(`/payment-intents/${encodeURIComponent(paymentIntentId)}`);
  }

  async cancelTerminalSession(terminalSessionId: string) {
    return this.request<DojoTerminalSession>(
      `/terminal-sessions/${encodeURIComponent(terminalSessionId)}/cancel`,
      { method: "PUT" },
    );
  }

  async respondToSignatureVerification(terminalSessionId: string, accepted: boolean) {
    return this.request<DojoTerminalSession>(
      `/terminal-sessions/${encodeURIComponent(terminalSessionId)}/signature`,
      {
        method: "PUT",
        body: { accepted },
      },
    );
  }
}
