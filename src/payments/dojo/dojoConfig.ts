export type DojoTerminalIntegrationConfig = {
  enabled: boolean;
  configured: boolean;
  mockMode: boolean;
  baseUrl: string;
  apiVersion: string;
  apiKey?: string;
  softwareHouseId?: string;
  resellerId?: string;
  defaultTerminalId?: string;
  currencyCode: string;
  requestTimeoutMs: number;
};

export type PublicDojoTerminalIntegrationConfig = {
  provider: "DOJO";
  enabled: boolean;
  configured: boolean;
  mockMode: boolean;
  defaultTerminalId: string | null;
  currencyCode: string;
};

const DEFAULT_DOJO_API_BASE_URL = "https://api.dojo.tech";
const DEFAULT_DOJO_API_VERSION = "2026-02-27";
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

const normalizeOptionalText = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const normalizeBaseUrl = (value: string | undefined) =>
  (normalizeOptionalText(value) ?? DEFAULT_DOJO_API_BASE_URL).replace(/\/+$/, "");

const parseBooleanFlag = (value: string | undefined) => {
  const normalized = normalizeOptionalText(value)?.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const parseTimeoutMs = (value: string | undefined) => {
  const parsed = Number.parseInt(normalizeOptionalText(value) ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REQUEST_TIMEOUT_MS;
};

export const getDojoTerminalIntegrationConfig = (): DojoTerminalIntegrationConfig => {
  const mockMode = parseBooleanFlag(process.env.DOJO_MOCK_MODE);
  const apiKey = normalizeOptionalText(process.env.DOJO_API_KEY);
  const softwareHouseId = normalizeOptionalText(process.env.DOJO_SOFTWARE_HOUSE_ID);
  const resellerId = normalizeOptionalText(process.env.DOJO_RESELLER_ID);
  const enabled = mockMode || parseBooleanFlag(process.env.DOJO_PAY_AT_COUNTER_ENABLED);
  const configured = mockMode || Boolean(apiKey && softwareHouseId && resellerId);

  return {
    enabled,
    configured,
    mockMode,
    baseUrl: normalizeBaseUrl(process.env.DOJO_API_BASE_URL),
    apiVersion: normalizeOptionalText(process.env.DOJO_API_VERSION) ?? DEFAULT_DOJO_API_VERSION,
    ...(apiKey ? { apiKey } : {}),
    ...(softwareHouseId ? { softwareHouseId } : {}),
    ...(resellerId ? { resellerId } : {}),
    ...(normalizeOptionalText(process.env.DOJO_DEFAULT_TERMINAL_ID)
      ? { defaultTerminalId: normalizeOptionalText(process.env.DOJO_DEFAULT_TERMINAL_ID) }
      : {}),
    currencyCode: normalizeOptionalText(process.env.DOJO_CURRENCY_CODE) ?? "GBP",
    requestTimeoutMs: parseTimeoutMs(process.env.DOJO_REQUEST_TIMEOUT_MS),
  };
};

export const toPublicDojoTerminalIntegrationConfig = (
  config: DojoTerminalIntegrationConfig = getDojoTerminalIntegrationConfig(),
): PublicDojoTerminalIntegrationConfig => ({
  provider: "DOJO",
  enabled: config.enabled,
  configured: config.configured,
  mockMode: config.mockMode,
  defaultTerminalId: config.defaultTerminalId ?? null,
  currencyCode: config.currencyCode,
});
