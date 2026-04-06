import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logOperationalEvent } from "../../lib/operationalLogger";
import { HttpError } from "../../utils/http";
import { createAuditEventTx, type AuditActor } from "../auditService";

type ShippingPrintAgentConfigClient = Prisma.TransactionClient | typeof prisma;

type StoredShippingPrintAgentConfig = {
  url: string | null;
  sharedSecret: string | null;
  updatedAt: string;
};

export type ShippingPrintAgentSettingsResponse = {
  url: string | null;
  hasSharedSecret: boolean;
  sharedSecretHint: string | null;
  updatedAt: string | null;
  effectiveUrl: string | null;
  effectiveSource: "settings" | "environment" | "unconfigured";
  envFallbackUrl: string | null;
  envFallbackHasSharedSecret: boolean;
};

export type ShippingPrintAgentSettingsInput = {
  url?: string | null;
  sharedSecret?: string | null;
  clearSharedSecret?: boolean;
};

export type ResolvedShippingPrintAgentRuntimeConfig = {
  url: string;
  sharedSecret: string | null;
  timeoutMs: number;
  source: "settings" | "environment";
};

const SHIPPING_PRINT_AGENT_CONFIG_KEY = "dispatch.shippingPrintAgent";
const DEFAULT_TIMEOUT_MS = 7000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readOptionalEnv = (...keys: string[]) => {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }

  return "";
};

const parsePositiveInteger = (value: string | undefined, fallback: number, field: string) => {
  if (!value || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(500, `${field} must be a positive integer`, "INVALID_SHIPPING_PRINT_AGENT_CONFIG");
  }

  return parsed;
};

const normalizeOptionalUrl = (value: unknown, field: string) => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, `${field} must be a string`, "INVALID_SHIPPING_PRINT_AGENT_SETTINGS");
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new HttpError(400, `${field} must be a valid URL`, "INVALID_SHIPPING_PRINT_AGENT_SETTINGS");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(400, `${field} must start with http:// or https://`, "INVALID_SHIPPING_PRINT_AGENT_SETTINGS");
  }

  return parsed.toString().replace(/\/$/, "");
};

const normalizeSecretInput = (value: unknown, field: string) => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, `${field} must be a string`, "INVALID_SHIPPING_PRINT_AGENT_SETTINGS");
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new HttpError(
      400,
      `${field} cannot be empty. Omit it to preserve the current value or use clearSharedSecret to remove it.`,
      "INVALID_SHIPPING_PRINT_AGENT_SETTINGS",
    );
  }
  if (trimmed.length > 512) {
    throw new HttpError(400, `${field} must be 512 characters or fewer`, "INVALID_SHIPPING_PRINT_AGENT_SETTINGS");
  }

  return trimmed;
};

const maskSecret = (value: string | null) => {
  if (!value) {
    return null;
  }

  return `••••${value.slice(-4)}`;
};

const parseStoredConfig = (value: Prisma.JsonValue | null): StoredShippingPrintAgentConfig | null => {
  if (!isRecord(value)) {
    return null;
  }

  return {
    url: typeof value.url === "string" && value.url.trim().length > 0 ? value.url.trim() : null,
    sharedSecret:
      typeof value.sharedSecret === "string" && value.sharedSecret.trim().length > 0
        ? value.sharedSecret.trim()
        : null,
    updatedAt:
      typeof value.updatedAt === "string" && value.updatedAt.trim().length > 0 ? value.updatedAt : new Date(0).toISOString(),
  };
};

const getStoredShippingPrintAgentConfig = async (
  db: ShippingPrintAgentConfigClient = prisma,
): Promise<StoredShippingPrintAgentConfig | null> => {
  const row = await db.appConfig.findUnique({
    where: { key: SHIPPING_PRINT_AGENT_CONFIG_KEY },
    select: { value: true },
  });

  return parseStoredConfig(row?.value ?? null);
};

const getEnvFallbackConfig = () => {
  const url = readOptionalEnv("COREPOS_SHIPPING_PRINT_AGENT_URL") || null;
  const sharedSecret = readOptionalEnv("COREPOS_SHIPPING_PRINT_AGENT_SHARED_SECRET") || null;
  const timeoutMs = parsePositiveInteger(
    readOptionalEnv("COREPOS_SHIPPING_PRINT_AGENT_TIMEOUT_MS") || undefined,
    DEFAULT_TIMEOUT_MS,
    "COREPOS_SHIPPING_PRINT_AGENT_TIMEOUT_MS",
  );

  return {
    url,
    sharedSecret,
    timeoutMs,
  };
};

const toSettingsResponse = (
  stored: StoredShippingPrintAgentConfig | null,
  envFallback = getEnvFallbackConfig(),
): ShippingPrintAgentSettingsResponse => {
  const effectiveSource = stored?.url ? "settings" : envFallback.url ? "environment" : "unconfigured";
  const effectiveUrl = stored?.url ?? envFallback.url ?? null;

  return {
    url: stored?.url ?? null,
    hasSharedSecret: Boolean(stored?.sharedSecret),
    sharedSecretHint: maskSecret(stored?.sharedSecret ?? null),
    updatedAt: stored?.updatedAt ?? null,
    effectiveUrl,
    effectiveSource,
    envFallbackUrl: envFallback.url,
    envFallbackHasSharedSecret: Boolean(envFallback.sharedSecret),
  };
};

export const listShippingPrintAgentSettings = async (): Promise<ShippingPrintAgentSettingsResponse> => {
  const stored = await getStoredShippingPrintAgentConfig();
  return toSettingsResponse(stored);
};

export const resolveShippingPrintAgentRuntimeConfig = async (): Promise<ResolvedShippingPrintAgentRuntimeConfig | null> => {
  const stored = await getStoredShippingPrintAgentConfig();
  const envFallback = getEnvFallbackConfig();

  if (stored?.url) {
    return {
      url: stored.url,
      sharedSecret: stored.sharedSecret,
      timeoutMs: envFallback.timeoutMs,
      source: "settings",
    };
  }

  if (envFallback.url) {
    return {
      url: envFallback.url,
      sharedSecret: envFallback.sharedSecret,
      timeoutMs: envFallback.timeoutMs,
      source: "environment",
    };
  }

  return null;
};

export const updateShippingPrintAgentSettings = async (
  input: ShippingPrintAgentSettingsInput,
  actor?: AuditActor,
): Promise<ShippingPrintAgentSettingsResponse> => {
  if (input.clearSharedSecret && input.sharedSecret !== undefined && input.sharedSecret !== null) {
    throw new HttpError(
      400,
      "Provide a new sharedSecret or set clearSharedSecret, not both",
      "INVALID_SHIPPING_PRINT_AGENT_SETTINGS",
    );
  }

  const normalizedUrl = normalizeOptionalUrl(input.url, "url");
  const normalizedSharedSecret = normalizeSecretInput(input.sharedSecret, "sharedSecret");

  const response = await prisma.$transaction(async (tx) => {
    const existing = await getStoredShippingPrintAgentConfig(tx);
    const nextUrl = normalizedUrl !== undefined ? normalizedUrl : existing?.url ?? null;
    const nextSharedSecret = input.clearSharedSecret
      ? null
      : normalizedSharedSecret !== undefined
        ? normalizedSharedSecret
        : existing?.sharedSecret ?? null;

    if (!nextUrl && !nextSharedSecret) {
      await tx.appConfig.deleteMany({ where: { key: SHIPPING_PRINT_AGENT_CONFIG_KEY } });
    } else {
      const nextConfig = {
        url: nextUrl,
        sharedSecret: nextSharedSecret,
        updatedAt: new Date().toISOString(),
      } satisfies StoredShippingPrintAgentConfig;

      await tx.appConfig.upsert({
        where: { key: SHIPPING_PRINT_AGENT_CONFIG_KEY },
        create: {
          key: SHIPPING_PRINT_AGENT_CONFIG_KEY,
          value: nextConfig as unknown as Prisma.InputJsonValue,
        },
        update: {
          value: nextConfig as unknown as Prisma.InputJsonValue,
        },
      });
    }

    await createAuditEventTx(
      tx,
      {
        action: "SETTINGS_SHIPPING_PRINT_AGENT_UPDATED",
        entityType: "APP_CONFIG",
        entityId: SHIPPING_PRINT_AGENT_CONFIG_KEY,
        metadata: {
          hasUrl: Boolean(nextUrl),
          hasSharedSecret: Boolean(nextSharedSecret),
          urlChanged: normalizedUrl !== undefined,
          sharedSecretUpdated: normalizedSharedSecret !== undefined,
          sharedSecretCleared: input.clearSharedSecret === true,
        },
      },
      actor,
    );

    return toSettingsResponse(await getStoredShippingPrintAgentConfig(tx));
  });

  logOperationalEvent("shipping.print_agent.settings_updated", {
    configSource: response.effectiveSource,
    hasStoredUrl: Boolean(response.url),
    hasStoredSharedSecret: response.hasSharedSecret,
    usesEnvFallback: response.effectiveSource === "environment",
  });

  return response;
};
