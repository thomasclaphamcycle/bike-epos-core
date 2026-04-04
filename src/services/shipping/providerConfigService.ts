import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logOperationalEvent } from "../../lib/operationalLogger";
import { HttpError } from "../../utils/http";
import { createAuditEventTx, type AuditActor } from "../auditService";
import type { ShippingLabelProvider, ShippingProviderEnvironment, ShippingProviderRuntimeConfig } from "./contracts";
import {
  DEFAULT_SHIPPING_PROVIDER_KEY,
  getShippingLabelProviderOrThrow,
  listSupportedShippingProviders,
} from "./providerRegistry";

type ProviderConfigClient = Prisma.TransactionClient | typeof prisma;

type GenericHttpZplProviderConfig = {
  enabled: boolean;
  environment: ShippingProviderEnvironment;
  displayName: string | null;
  endpointBaseUrl: string | null;
  accountId: string | null;
  apiKey: string | null;
  updatedAt: string;
};

const DEFAULT_PROVIDER_KEY_CONFIG_KEY = "shipping.defaultProviderKey";
const GENERIC_HTTP_ZPL_CONFIG_KEY = "shipping.provider.genericHttpZpl";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeOptionalText = (
  value: unknown,
  field: string,
  { maxLength = 255 }: { maxLength?: number } = {},
) => {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, `${field} must be a string`, "INVALID_SHIPPING_PROVIDER_SETTINGS");
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > maxLength) {
    throw new HttpError(
      400,
      `${field} must be ${maxLength} characters or fewer`,
      "INVALID_SHIPPING_PROVIDER_SETTINGS",
    );
  }

  return trimmed;
};

const normalizeBoolean = (value: unknown, field: string, fallback: boolean) => {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new HttpError(400, `${field} must be a boolean`, "INVALID_SHIPPING_PROVIDER_SETTINGS");
  }
  return value;
};

const normalizeEnvironment = (value: unknown, fallback: ShippingProviderEnvironment) => {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, "environment must be a string", "INVALID_SHIPPING_PROVIDER_SETTINGS");
  }

  const normalized = value.trim().toUpperCase();
  if (normalized !== "SANDBOX" && normalized !== "LIVE") {
    throw new HttpError(
      400,
      "environment must be SANDBOX or LIVE",
      "INVALID_SHIPPING_PROVIDER_SETTINGS",
    );
  }

  return normalized as ShippingProviderEnvironment;
};

const normalizeEndpointBaseUrl = (value: unknown) => {
  const normalized = normalizeOptionalText(value, "endpointBaseUrl", { maxLength: 240 });
  if (!normalized) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new HttpError(400, "endpointBaseUrl must be a valid URL", "INVALID_SHIPPING_PROVIDER_SETTINGS");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(
      400,
      "endpointBaseUrl must start with http:// or https://",
      "INVALID_SHIPPING_PROVIDER_SETTINGS",
    );
  }

  return parsed.toString().replace(/\/$/, "");
};

const normalizeApiKeyInput = (value: unknown) => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, "apiKey must be a string", "INVALID_SHIPPING_PROVIDER_SETTINGS");
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new HttpError(
      400,
      "apiKey cannot be empty. Omit apiKey to preserve the existing value or use clearApiKey to remove it.",
      "INVALID_SHIPPING_PROVIDER_SETTINGS",
    );
  }
  if (trimmed.length > 400) {
    throw new HttpError(400, "apiKey must be 400 characters or fewer", "INVALID_SHIPPING_PROVIDER_SETTINGS");
  }

  return trimmed;
};

const parseStoredGenericHttpZplConfig = (value: Prisma.JsonValue | null): GenericHttpZplProviderConfig | null => {
  if (!isRecord(value)) {
    return null;
  }

  const enabled = typeof value.enabled === "boolean" ? value.enabled : false;
  const environment = value.environment === "LIVE" ? "LIVE" : "SANDBOX";
  const displayName = typeof value.displayName === "string" && value.displayName.trim().length > 0
    ? value.displayName.trim()
    : null;
  const endpointBaseUrl = typeof value.endpointBaseUrl === "string" && value.endpointBaseUrl.trim().length > 0
    ? value.endpointBaseUrl.trim()
    : null;
  const accountId = typeof value.accountId === "string" && value.accountId.trim().length > 0
    ? value.accountId.trim()
    : null;
  const apiKey = typeof value.apiKey === "string" && value.apiKey.trim().length > 0
    ? value.apiKey.trim()
    : null;
  const updatedAt = typeof value.updatedAt === "string" && value.updatedAt.trim().length > 0
    ? value.updatedAt
    : new Date(0).toISOString();

  return {
    enabled,
    environment,
    displayName,
    endpointBaseUrl,
    accountId,
    apiKey,
    updatedAt,
  };
};

const maskSecret = (value: string | null) => {
  if (!value) {
    return null;
  }

  const visible = value.slice(-4);
  return `••••${visible}`;
};

const findProviderDefinition = (providerKey: string) => {
  const definition = listSupportedShippingProviders().find((provider) => provider.key === providerKey);
  if (!definition) {
    throw new HttpError(400, `Unsupported shipping provider: ${providerKey}`, "INVALID_SHIPPING_PROVIDER");
  }
  return definition;
};

const getProviderConfigKey = (providerKey: string) => {
  if (providerKey === "GENERIC_HTTP_ZPL") {
    return GENERIC_HTTP_ZPL_CONFIG_KEY;
  }
  return null;
};

const getStoredDefaultProviderKey = async (db: ProviderConfigClient = prisma) => {
  const row = await db.appConfig.findUnique({
    where: { key: DEFAULT_PROVIDER_KEY_CONFIG_KEY },
    select: { value: true },
  });

  if (typeof row?.value === "string" && row.value.trim().length > 0) {
    const stored = row.value.trim();
    return listSupportedShippingProviders().some((provider) => provider.key === stored)
      ? stored
      : DEFAULT_SHIPPING_PROVIDER_KEY;
  }

  return DEFAULT_SHIPPING_PROVIDER_KEY;
};

const writeDefaultProviderKeyTx = async (tx: Prisma.TransactionClient, providerKey: string | null) => {
  if (!providerKey || providerKey === DEFAULT_SHIPPING_PROVIDER_KEY) {
    await tx.appConfig.deleteMany({ where: { key: DEFAULT_PROVIDER_KEY_CONFIG_KEY } });
    return;
  }

  await tx.appConfig.upsert({
    where: { key: DEFAULT_PROVIDER_KEY_CONFIG_KEY },
    create: { key: DEFAULT_PROVIDER_KEY_CONFIG_KEY, value: providerKey },
    update: { value: providerKey },
  });
};

const getStoredGenericHttpZplConfig = async (db: ProviderConfigClient = prisma) => {
  const row = await db.appConfig.findUnique({
    where: { key: GENERIC_HTTP_ZPL_CONFIG_KEY },
    select: { value: true },
  });

  return parseStoredGenericHttpZplConfig(row?.value ?? null);
};

const validateDefaultProviderOrThrow = async (providerKey: string, db: ProviderConfigClient = prisma) => {
  const definition = findProviderDefinition(providerKey);
  if (!definition.requiresConfiguration) {
    return;
  }

  if (providerKey === "GENERIC_HTTP_ZPL") {
    const config = await getStoredGenericHttpZplConfig(db);
    if (!config?.enabled) {
      throw new HttpError(
        409,
        "Configured courier provider must be enabled before it can be the default",
        "SHIPPING_PROVIDER_DISABLED",
      );
    }
    if (!config.endpointBaseUrl || !config.apiKey) {
      throw new HttpError(
        409,
        "Configured courier provider must include endpointBaseUrl and apiKey before it can be the default",
        "SHIPPING_PROVIDER_NOT_CONFIGURED",
      );
    }
  }
};

const toConfiguredProviderResponse = (
  definition: ReturnType<typeof listSupportedShippingProviders>[number],
  defaultProviderKey: string,
  genericHttpConfig: GenericHttpZplProviderConfig | null,
) => {
  if (definition.key === "GENERIC_HTTP_ZPL") {
    const configuration = genericHttpConfig
      ? {
          enabled: genericHttpConfig.enabled,
          environment: genericHttpConfig.environment,
          displayName: genericHttpConfig.displayName,
          endpointBaseUrl: genericHttpConfig.endpointBaseUrl,
          accountId: genericHttpConfig.accountId,
          hasApiKey: Boolean(genericHttpConfig.apiKey),
          apiKeyHint: maskSecret(genericHttpConfig.apiKey),
          updatedAt: genericHttpConfig.updatedAt,
        }
      : null;

    return {
      ...definition,
      isDefaultProvider: defaultProviderKey === definition.key,
      isAvailable: Boolean(genericHttpConfig?.enabled && genericHttpConfig.endpointBaseUrl && genericHttpConfig.apiKey),
      configuration,
    };
  }

  return {
    ...definition,
    isDefaultProvider: defaultProviderKey === definition.key,
    isAvailable: true,
    configuration: null,
  };
};

export type ShippingProviderSettingsResponse = ReturnType<typeof toConfiguredProviderResponse>;

export type ShippingProviderSettingsListResponse = {
  defaultProviderKey: string;
  providers: ShippingProviderSettingsResponse[];
};

export type ShippingProviderSettingsInput = {
  enabled?: boolean;
  environment?: string;
  displayName?: string | null;
  endpointBaseUrl?: string | null;
  accountId?: string | null;
  apiKey?: string | null;
  clearApiKey?: boolean;
};

export type ResolvedShippingProvider = {
  provider: ShippingLabelProvider;
  providerKey: string;
  providerDisplayName: string;
  providerEnvironment: ShippingProviderEnvironment | null;
  runtimeConfig: ShippingProviderRuntimeConfig | null;
};

export const listShippingProviderSettings = async (): Promise<ShippingProviderSettingsListResponse> => {
  const [defaultProviderKey, genericHttpConfig] = await Promise.all([
    getStoredDefaultProviderKey(),
    getStoredGenericHttpZplConfig(),
  ]);

  return {
    defaultProviderKey,
    providers: listSupportedShippingProviders().map((definition) =>
      toConfiguredProviderResponse(definition, defaultProviderKey, genericHttpConfig)),
  };
};

export const resolveShippingProviderForShipment = async (
  providerKey: string | null | undefined,
): Promise<ResolvedShippingProvider> => {
  const requestedProviderKey = providerKey?.trim() || await getStoredDefaultProviderKey();
  const provider = getShippingLabelProviderOrThrow(requestedProviderKey);

  if (requestedProviderKey === "GENERIC_HTTP_ZPL") {
    const config = await getStoredGenericHttpZplConfig();
    if (!config?.enabled) {
      throw new HttpError(
        409,
        "Generic HTTP courier provider is not enabled in Settings",
        "SHIPPING_PROVIDER_DISABLED",
      );
    }
    if (!config.endpointBaseUrl || !config.apiKey) {
      throw new HttpError(
        409,
        "Generic HTTP courier provider requires endpointBaseUrl and apiKey before shipments can be created",
        "SHIPPING_PROVIDER_NOT_CONFIGURED",
      );
    }

    return {
      provider,
      providerKey: requestedProviderKey,
      providerDisplayName: config.displayName ?? provider.providerDisplayName,
      providerEnvironment: config.environment,
      runtimeConfig: {
        providerKey: requestedProviderKey,
        environment: config.environment,
        displayName: config.displayName,
        endpointBaseUrl: config.endpointBaseUrl,
        accountId: config.accountId,
        apiKey: config.apiKey,
      },
    };
  }

  return {
    provider,
    providerKey: requestedProviderKey,
    providerDisplayName: provider.providerDisplayName,
    providerEnvironment: null,
    runtimeConfig: null,
  };
};

export const updateShippingProviderSettings = async (
  providerKey: string,
  input: ShippingProviderSettingsInput,
  auditActor?: AuditActor,
) => {
  const definition = findProviderDefinition(providerKey);
  const configKey = getProviderConfigKey(providerKey);
  if (!configKey) {
    throw new HttpError(
      400,
      `${providerKey} does not use stored provider settings`,
      "INVALID_SHIPPING_PROVIDER_SETTINGS",
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const existing = await getStoredGenericHttpZplConfig(tx);
    const clearApiKey = normalizeBoolean(input.clearApiKey, "clearApiKey", false);
    const nextConfig: GenericHttpZplProviderConfig = {
      enabled: normalizeBoolean(input.enabled, "enabled", existing?.enabled ?? false),
      environment: normalizeEnvironment(input.environment, existing?.environment ?? "SANDBOX"),
      displayName:
        input.displayName !== undefined
          ? normalizeOptionalText(input.displayName, "displayName", { maxLength: 120 })
          : (existing?.displayName ?? null),
      endpointBaseUrl:
        input.endpointBaseUrl !== undefined
          ? normalizeEndpointBaseUrl(input.endpointBaseUrl)
          : (existing?.endpointBaseUrl ?? null),
      accountId:
        input.accountId !== undefined
          ? normalizeOptionalText(input.accountId, "accountId", { maxLength: 120 })
          : (existing?.accountId ?? null),
      apiKey: clearApiKey
        ? null
        : (() => {
            const nextApiKey = normalizeApiKeyInput(input.apiKey);
            if (nextApiKey !== undefined) {
              return nextApiKey;
            }
            return existing?.apiKey ?? null;
          })(),
      updatedAt: new Date().toISOString(),
    };

    if (nextConfig.enabled && (!nextConfig.endpointBaseUrl || !nextConfig.apiKey)) {
      throw new HttpError(
        409,
        "Enabled courier providers must include endpointBaseUrl and apiKey",
        "SHIPPING_PROVIDER_NOT_CONFIGURED",
      );
    }

    await tx.appConfig.upsert({
      where: { key: configKey },
      create: {
        key: configKey,
        value: nextConfig as Prisma.InputJsonValue,
      },
      update: {
        value: nextConfig as Prisma.InputJsonValue,
      },
    });

    await createAuditEventTx(
      tx,
      {
        action: "SHIPPING_PROVIDER_SETTINGS_UPDATED",
        entityType: "APP_CONFIG",
        entityId: configKey,
        metadata: {
          providerKey,
          enabled: nextConfig.enabled,
          environment: nextConfig.environment,
          endpointBaseUrl: nextConfig.endpointBaseUrl,
          accountId: nextConfig.accountId,
          hasApiKey: Boolean(nextConfig.apiKey),
        },
      },
      auditActor,
    );

    return nextConfig;
  });

  logOperationalEvent("shipping.provider.settings_updated", {
    entityId: configKey,
    providerKey,
    enabled: result.enabled,
    environment: result.environment,
  });

  return {
    provider: toConfiguredProviderResponse(
      definition,
      await getStoredDefaultProviderKey(),
      providerKey === "GENERIC_HTTP_ZPL" ? result : null,
    ),
  };
};

export const setDefaultShippingProvider = async (
  providerKey: string | null,
  auditActor?: AuditActor,
) => {
  const normalizedProviderKey = providerKey?.trim() || null;
  if (normalizedProviderKey) {
    findProviderDefinition(normalizedProviderKey);
  }

  const effectiveProviderKey = normalizedProviderKey ?? DEFAULT_SHIPPING_PROVIDER_KEY;
  if (effectiveProviderKey !== DEFAULT_SHIPPING_PROVIDER_KEY) {
    await validateDefaultProviderOrThrow(effectiveProviderKey);
  }

  await prisma.$transaction(async (tx) => {
    await writeDefaultProviderKeyTx(tx, normalizedProviderKey);
    await createAuditEventTx(
      tx,
      {
        action: "DEFAULT_SHIPPING_PROVIDER_UPDATED",
        entityType: "APP_CONFIG",
        entityId: DEFAULT_PROVIDER_KEY_CONFIG_KEY,
        metadata: {
          providerKey: effectiveProviderKey,
        },
      },
      auditActor,
    );
  });

  logOperationalEvent("shipping.provider.default_updated", {
    entityId: DEFAULT_PROVIDER_KEY_CONFIG_KEY,
    providerKey: effectiveProviderKey,
  });

  return listShippingProviderSettings();
};
