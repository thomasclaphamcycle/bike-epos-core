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
  terminalRoutes: DojoTerminalRouteConfig[];
  currencyCode: string;
  requestTimeoutMs: number;
};

export type DojoTerminalRouteId = "TERMINAL_A" | "TERMINAL_B";
export type PosTillPointId = "TILL_1" | "TILL_2" | "TILL_3";

export type DojoTerminalRouteConfig = {
  routeId: DojoTerminalRouteId;
  label: string;
  terminalId?: string;
};

export type PublicDojoTerminalRouteConfig = {
  routeId: DojoTerminalRouteId;
  label: string;
  terminalId: string | null;
};

export type PublicDojoWorkstationHint = {
  remoteAddress: string | null;
  suggestedTillPointId: PosTillPointId | null;
};

export type PublicDojoTerminalIntegrationConfig = {
  provider: "DOJO";
  enabled: boolean;
  configured: boolean;
  mockMode: boolean;
  defaultTerminalId: string | null;
  terminalRoutes: PublicDojoTerminalRouteConfig[];
  workstationHint: PublicDojoWorkstationHint;
  currencyCode: string;
};

const DEFAULT_DOJO_API_BASE_URL = "https://api.dojo.tech";
const DEFAULT_DOJO_API_VERSION = "2026-02-27";
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const POS_TILL_POINT_IDS: PosTillPointId[] = ["TILL_1", "TILL_2", "TILL_3"];

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

const normalizeRemoteAddress = (value: string | undefined | null) => {
  const normalized = normalizeOptionalText(value ?? undefined);
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("::ffff:")) {
    return normalized.slice("::ffff:".length);
  }
  if (normalized === "::1") {
    return "127.0.0.1";
  }
  return normalized;
};

const buildTerminalRoutes = (defaultTerminalId?: string): DojoTerminalRouteConfig[] => {
  const terminalAId = normalizeOptionalText(process.env.DOJO_TERMINAL_A_ID) ?? defaultTerminalId;
  const terminalBId = normalizeOptionalText(process.env.DOJO_TERMINAL_B_ID);

  return [
    {
      routeId: "TERMINAL_A",
      label: "Terminal A",
      ...(terminalAId ? { terminalId: terminalAId } : {}),
    },
    {
      routeId: "TERMINAL_B",
      label: "Terminal B",
      ...(terminalBId ? { terminalId: terminalBId } : {}),
    },
  ];
};

const parseTillPointIpHints = (value: string | undefined) => {
  const raw = normalizeOptionalText(value);
  if (!raw) {
    return [];
  }

  return raw.split(";").flatMap((group) => {
    const [rawTillPointId, rawPatterns] = group.split("=");
    const tillPointId = normalizeOptionalText(rawTillPointId);
    if (!tillPointId || !POS_TILL_POINT_IDS.includes(tillPointId as PosTillPointId) || !rawPatterns) {
      return [];
    }

    return rawPatterns
      .split(",")
      .map((pattern) => normalizeOptionalText(pattern))
      .filter((pattern): pattern is string => Boolean(pattern))
      .map((pattern) => ({
        tillPointId: tillPointId as PosTillPointId,
        pattern,
      }));
  });
};

const addressMatchesPattern = (remoteAddress: string, pattern: string) => {
  const normalizedPattern = normalizeRemoteAddress(pattern.replace(/\*$/, ""));
  if (!normalizedPattern) {
    return false;
  }

  return pattern.trim().endsWith("*")
    ? remoteAddress.startsWith(normalizedPattern)
    : remoteAddress === normalizedPattern;
};

export const getDojoWorkstationHint = (
  remoteAddress: string | undefined | null,
): PublicDojoWorkstationHint => {
  const normalizedRemoteAddress = normalizeRemoteAddress(remoteAddress);
  if (!normalizedRemoteAddress) {
    return {
      remoteAddress: null,
      suggestedTillPointId: null,
    };
  }

  const matchedHint = parseTillPointIpHints(process.env.COREPOS_TILL_POINT_IP_HINTS)
    .find((hint) => addressMatchesPattern(normalizedRemoteAddress, hint.pattern));

  return {
    remoteAddress: normalizedRemoteAddress,
    suggestedTillPointId: matchedHint?.tillPointId ?? null,
  };
};

export const getDojoTerminalIntegrationConfig = (): DojoTerminalIntegrationConfig => {
  const mockMode = parseBooleanFlag(process.env.DOJO_MOCK_MODE);
  const apiKey = normalizeOptionalText(process.env.DOJO_API_KEY);
  const softwareHouseId = normalizeOptionalText(process.env.DOJO_SOFTWARE_HOUSE_ID);
  const resellerId = normalizeOptionalText(process.env.DOJO_RESELLER_ID);
  const defaultTerminalId = normalizeOptionalText(process.env.DOJO_DEFAULT_TERMINAL_ID);
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
    ...(defaultTerminalId ? { defaultTerminalId } : {}),
    terminalRoutes: buildTerminalRoutes(defaultTerminalId),
    currencyCode: normalizeOptionalText(process.env.DOJO_CURRENCY_CODE) ?? "GBP",
    requestTimeoutMs: parseTimeoutMs(process.env.DOJO_REQUEST_TIMEOUT_MS),
  };
};

export const toPublicDojoTerminalIntegrationConfig = (
  config: DojoTerminalIntegrationConfig = getDojoTerminalIntegrationConfig(),
  workstationHint: PublicDojoWorkstationHint = getDojoWorkstationHint(null),
): PublicDojoTerminalIntegrationConfig => ({
  provider: "DOJO",
  enabled: config.enabled,
  configured: config.configured,
  mockMode: config.mockMode,
  defaultTerminalId: config.defaultTerminalId ?? null,
  terminalRoutes: config.terminalRoutes.map((route) => ({
    routeId: route.routeId,
    label: route.label,
    terminalId: route.terminalId ?? null,
  })),
  workstationHint,
  currencyCode: config.currencyCode,
});
