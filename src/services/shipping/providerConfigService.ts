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

type ProviderConfigBase = {
  enabled: boolean;
  environment: ShippingProviderEnvironment;
  displayName: string | null;
  apiKey: string | null;
  updatedAt: string;
};

type GenericHttpZplProviderConfig = ProviderConfigBase & {
  endpointBaseUrl: string | null;
  accountId: string | null;
};

type EasyPostProviderConfig = ProviderConfigBase & {
  apiBaseUrl: string | null;
  carrierAccountId: string | null;
  defaultServiceCode: string | null;
  defaultServiceName: string | null;
  parcelWeightOz: number | null;
  parcelLengthIn: number | null;
  parcelWidthIn: number | null;
  parcelHeightIn: number | null;
  webhookSecret: string | null;
};

const DEFAULT_PROVIDER_KEY_CONFIG_KEY = "shipping.defaultProviderKey";
const GENERIC_HTTP_ZPL_CONFIG_KEY = "shipping.provider.genericHttpZpl";
const EASYPOST_CONFIG_KEY = "shipping.provider.easyPost";

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

const normalizeOptionalUrl = (value: unknown, field: string) => {
  const normalized = normalizeOptionalText(value, field, { maxLength: 240 });
  if (!normalized) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new HttpError(400, `${field} must be a valid URL`, "INVALID_SHIPPING_PROVIDER_SETTINGS");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(
      400,
      `${field} must start with http:// or https://`,
      "INVALID_SHIPPING_PROVIDER_SETTINGS",
    );
  }

  return parsed.toString().replace(/\/$/, "");
};

const normalizeSecretInput = (
  value: unknown,
  field: "apiKey" | "webhookSecret",
  { maxLength = 400 }: { maxLength?: number } = {},
) => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, `${field} must be a string`, "INVALID_SHIPPING_PROVIDER_SETTINGS");
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new HttpError(
      400,
      `${field} cannot be empty. Omit ${field} to preserve the existing value or use clear${field === "apiKey" ? "ApiKey" : "WebhookSecret"} to remove it.`,
      "INVALID_SHIPPING_PROVIDER_SETTINGS",
    );
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

const normalizeApiKeyInput = (value: unknown) => normalizeSecretInput(value, "apiKey");
const normalizeWebhookSecretInput = (value: unknown) => normalizeSecretInput(value, "webhookSecret", { maxLength: 512 });

const normalizeOptionalPositiveNumber = (value: unknown, field: string) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new HttpError(400, `${field} must be a positive number`, "INVALID_SHIPPING_PROVIDER_SETTINGS");
  }
  return Number(value);
};

const maskSecret = (value: string | null) => {
  if (!value) {
    return null;
  }

  const visible = value.slice(-4);
  return `••••${visible}`;
};

const parseStoredBaseConfig = (value: Prisma.JsonValue | null): ProviderConfigBase | null => {
  if (!isRecord(value)) {
    return null;
  }

  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : false,
    environment: value.environment === "LIVE" ? "LIVE" : "SANDBOX",
    displayName: typeof value.displayName === "string" && value.displayName.trim().length > 0
      ? value.displayName.trim()
      : null,
    apiKey: typeof value.apiKey === "string" && value.apiKey.trim().length > 0
      ? value.apiKey.trim()
      : null,
    updatedAt: typeof value.updatedAt === "string" && value.updatedAt.trim().length > 0
      ? value.updatedAt
      : new Date(0).toISOString(),
  };
};

const parseStoredGenericHttpZplConfig = (value: Prisma.JsonValue | null): GenericHttpZplProviderConfig | null => {
  const base = parseStoredBaseConfig(value);
  if (!base || !isRecord(value)) {
    return null;
  }

  return {
    ...base,
    endpointBaseUrl: typeof value.endpointBaseUrl === "string" && value.endpointBaseUrl.trim().length > 0
      ? value.endpointBaseUrl.trim()
      : null,
    accountId: typeof value.accountId === "string" && value.accountId.trim().length > 0
      ? value.accountId.trim()
      : null,
  };
};

const parseStoredEasyPostConfig = (value: Prisma.JsonValue | null): EasyPostProviderConfig | null => {
  const base = parseStoredBaseConfig(value);
  if (!base || !isRecord(value)) {
    return null;
  }

  const parsePositiveNumber = (candidate: unknown) =>
    typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0 ? Number(candidate) : null;

  return {
    ...base,
    apiBaseUrl: typeof value.apiBaseUrl === "string" && value.apiBaseUrl.trim().length > 0
      ? value.apiBaseUrl.trim()
      : null,
    carrierAccountId: typeof value.carrierAccountId === "string" && value.carrierAccountId.trim().length > 0
      ? value.carrierAccountId.trim()
      : null,
    defaultServiceCode: typeof value.defaultServiceCode === "string" && value.defaultServiceCode.trim().length > 0
      ? value.defaultServiceCode.trim()
      : null,
    defaultServiceName: typeof value.defaultServiceName === "string" && value.defaultServiceName.trim().length > 0
      ? value.defaultServiceName.trim()
      : null,
    parcelWeightOz: parsePositiveNumber(value.parcelWeightOz),
    parcelLengthIn: parsePositiveNumber(value.parcelLengthIn),
    parcelWidthIn: parsePositiveNumber(value.parcelWidthIn),
    parcelHeightIn: parsePositiveNumber(value.parcelHeightIn),
    webhookSecret: typeof value.webhookSecret === "string" && value.webhookSecret.trim().length > 0
      ? value.webhookSecret.trim()
      : null,
  };
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
  if (providerKey === "EASYPOST") {
    return EASYPOST_CONFIG_KEY;
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

const getStoredEasyPostConfig = async (db: ProviderConfigClient = prisma) => {
  const row = await db.appConfig.findUnique({
    where: { key: EASYPOST_CONFIG_KEY },
    select: { value: true },
  });

  return parseStoredEasyPostConfig(row?.value ?? null);
};

const isGenericHttpZplConfigReady = (config: GenericHttpZplProviderConfig | null) =>
  Boolean(config?.enabled && config.endpointBaseUrl && config.apiKey);

const isEasyPostConfigReady = (config: EasyPostProviderConfig | null) =>
  Boolean(
    config?.enabled
    && config.apiKey
    && config.carrierAccountId
    && config.defaultServiceCode
    && config.parcelWeightOz
    && config.parcelLengthIn
    && config.parcelWidthIn
    && config.parcelHeightIn,
  );

const isEasyPostLifecycleConfigReady = (config: EasyPostProviderConfig | null) =>
  Boolean(config?.apiKey);

const isEasyPostWebhookConfigReady = (config: EasyPostProviderConfig | null) =>
  Boolean(config?.webhookSecret);

const isGenericHttpZplLifecycleConfigReady = (config: GenericHttpZplProviderConfig | null) =>
  Boolean(config?.endpointBaseUrl && config.apiKey);

const buildConfigurationResponse = (
  config: GenericHttpZplProviderConfig | EasyPostProviderConfig,
) => ({
  enabled: config.enabled,
  environment: config.environment,
  displayName: config.displayName,
  endpointBaseUrl: "endpointBaseUrl" in config ? config.endpointBaseUrl : null,
  apiBaseUrl: "apiBaseUrl" in config ? config.apiBaseUrl : null,
  accountId: "accountId" in config ? config.accountId : null,
  carrierAccountId: "carrierAccountId" in config ? config.carrierAccountId : null,
  defaultServiceCode: "defaultServiceCode" in config ? config.defaultServiceCode : null,
  defaultServiceName: "defaultServiceName" in config ? config.defaultServiceName : null,
  parcelWeightOz: "parcelWeightOz" in config ? config.parcelWeightOz : null,
  parcelLengthIn: "parcelLengthIn" in config ? config.parcelLengthIn : null,
  parcelWidthIn: "parcelWidthIn" in config ? config.parcelWidthIn : null,
  parcelHeightIn: "parcelHeightIn" in config ? config.parcelHeightIn : null,
  hasWebhookSecret: "webhookSecret" in config ? Boolean(config.webhookSecret) : false,
  webhookSecretHint: "webhookSecret" in config ? maskSecret(config.webhookSecret) : null,
  hasApiKey: Boolean(config.apiKey),
  apiKeyHint: maskSecret(config.apiKey),
  updatedAt: config.updatedAt,
});

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
    if (!isGenericHttpZplConfigReady(config)) {
      throw new HttpError(
        409,
        "Configured courier provider must include endpointBaseUrl and apiKey before it can be the default",
        "SHIPPING_PROVIDER_NOT_CONFIGURED",
      );
    }
    return;
  }

  if (providerKey === "EASYPOST") {
    const config = await getStoredEasyPostConfig(db);
    if (!config?.enabled) {
      throw new HttpError(
        409,
        "EasyPost must be enabled before it can be the default shipping provider",
        "SHIPPING_PROVIDER_DISABLED",
      );
    }
    if (!isEasyPostConfigReady(config)) {
      throw new HttpError(
        409,
        "EasyPost must include apiKey, carrierAccountId, defaultServiceCode, and parcel defaults before it can be the default",
        "SHIPPING_PROVIDER_NOT_CONFIGURED",
      );
    }
  }
};

const toConfiguredProviderResponse = (
  definition: ReturnType<typeof listSupportedShippingProviders>[number],
  defaultProviderKey: string,
  genericHttpConfig: GenericHttpZplProviderConfig | null,
  easyPostConfig: EasyPostProviderConfig | null,
) => {
  if (definition.key === "GENERIC_HTTP_ZPL") {
    const configuration = genericHttpConfig ? buildConfigurationResponse(genericHttpConfig) : null;
    return {
      ...definition,
      isDefaultProvider: defaultProviderKey === definition.key,
      isAvailable: isGenericHttpZplConfigReady(genericHttpConfig),
      defaultServiceCode: definition.defaultServiceCode,
      defaultServiceName: definition.defaultServiceName,
      configuration,
    };
  }

  if (definition.key === "EASYPOST") {
    const configuration = easyPostConfig ? buildConfigurationResponse(easyPostConfig) : null;
    const defaultServiceCode = easyPostConfig?.defaultServiceCode ?? definition.defaultServiceCode;
    const defaultServiceName = easyPostConfig?.defaultServiceName ?? defaultServiceCode ?? definition.defaultServiceName;
    return {
      ...definition,
      isDefaultProvider: defaultProviderKey === definition.key,
      isAvailable: isEasyPostConfigReady(easyPostConfig),
      defaultServiceCode,
      defaultServiceName,
      configuration,
    };
  }

  return {
    ...definition,
    isDefaultProvider: defaultProviderKey === definition.key,
    isAvailable: true,
    defaultServiceCode: definition.defaultServiceCode,
    defaultServiceName: definition.defaultServiceName,
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
  apiBaseUrl?: string | null;
  accountId?: string | null;
  carrierAccountId?: string | null;
  defaultServiceCode?: string | null;
  defaultServiceName?: string | null;
  parcelWeightOz?: number | null;
  parcelLengthIn?: number | null;
  parcelWidthIn?: number | null;
  parcelHeightIn?: number | null;
  webhookSecret?: string | null;
  apiKey?: string | null;
  clearApiKey?: boolean;
  clearWebhookSecret?: boolean;
};

export type ResolvedShippingProvider = {
  provider: ShippingLabelProvider;
  providerKey: string;
  providerDisplayName: string;
  providerEnvironment: ShippingProviderEnvironment | null;
  runtimeConfig: ShippingProviderRuntimeConfig | null;
};

export const listShippingProviderSettings = async (): Promise<ShippingProviderSettingsListResponse> => {
  const [defaultProviderKey, genericHttpConfig, easyPostConfig] = await Promise.all([
    getStoredDefaultProviderKey(),
    getStoredGenericHttpZplConfig(),
    getStoredEasyPostConfig(),
  ]);

  return {
    defaultProviderKey,
    providers: listSupportedShippingProviders().map((definition) =>
      toConfiguredProviderResponse(definition, defaultProviderKey, genericHttpConfig, easyPostConfig)),
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
    if (!isGenericHttpZplConfigReady(config)) {
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

  if (requestedProviderKey === "EASYPOST") {
    const config = await getStoredEasyPostConfig();
    if (!config?.enabled) {
      throw new HttpError(409, "EasyPost is not enabled in Settings", "SHIPPING_PROVIDER_DISABLED");
    }
    if (!isEasyPostConfigReady(config)) {
      throw new HttpError(
        409,
        "EasyPost requires apiKey, carrierAccountId, defaultServiceCode, and parcel defaults before shipments can be created",
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
        apiKey: config.apiKey,
        apiBaseUrl: config.apiBaseUrl,
        carrierAccountId: config.carrierAccountId,
        defaultServiceCode: config.defaultServiceCode,
        defaultServiceName: config.defaultServiceName,
        parcelWeightOz: config.parcelWeightOz,
        parcelLengthIn: config.parcelLengthIn,
        parcelWidthIn: config.parcelWidthIn,
        parcelHeightIn: config.parcelHeightIn,
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

export const resolveShippingProviderForShipmentLifecycle = async (
  providerKey: string,
): Promise<ResolvedShippingProvider> => {
  const requestedProviderKey = providerKey.trim();
  const provider = getShippingLabelProviderOrThrow(requestedProviderKey);

  if (requestedProviderKey === "GENERIC_HTTP_ZPL") {
    const config = await getStoredGenericHttpZplConfig();
    if (!isGenericHttpZplLifecycleConfigReady(config)) {
      throw new HttpError(
        409,
        "Generic HTTP courier lifecycle actions require endpointBaseUrl and apiKey in Settings",
        "SHIPPING_PROVIDER_NOT_CONFIGURED",
      );
    }

    return {
      provider,
      providerKey: requestedProviderKey,
      providerDisplayName: config?.displayName ?? provider.providerDisplayName,
      providerEnvironment: config?.environment ?? "SANDBOX",
      runtimeConfig: {
        providerKey: requestedProviderKey,
        environment: config?.environment ?? "SANDBOX",
        displayName: config?.displayName ?? null,
        endpointBaseUrl: config?.endpointBaseUrl ?? null,
        accountId: config?.accountId ?? null,
        apiKey: config?.apiKey ?? null,
      },
    };
  }

  if (requestedProviderKey === "EASYPOST") {
    const config = await getStoredEasyPostConfig();
    if (!isEasyPostLifecycleConfigReady(config)) {
      throw new HttpError(
        409,
        "EasyPost lifecycle actions require an API key in Settings",
        "SHIPPING_PROVIDER_NOT_CONFIGURED",
      );
    }

    return {
      provider,
      providerKey: requestedProviderKey,
      providerDisplayName: config?.displayName ?? provider.providerDisplayName,
      providerEnvironment: config?.environment ?? "SANDBOX",
      runtimeConfig: {
        providerKey: requestedProviderKey,
        environment: config?.environment ?? "SANDBOX",
        displayName: config?.displayName ?? null,
        apiKey: config?.apiKey ?? null,
        apiBaseUrl: config?.apiBaseUrl ?? null,
        carrierAccountId: config?.carrierAccountId ?? null,
        defaultServiceCode: config?.defaultServiceCode ?? null,
        defaultServiceName: config?.defaultServiceName ?? null,
        parcelWeightOz: config?.parcelWeightOz ?? null,
        parcelLengthIn: config?.parcelLengthIn ?? null,
        parcelWidthIn: config?.parcelWidthIn ?? null,
        parcelHeightIn: config?.parcelHeightIn ?? null,
        webhookSecret: config?.webhookSecret ?? null,
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

export const resolveShippingProviderForInboundSync = async (
  providerKey: string,
): Promise<ResolvedShippingProvider> => {
  const requestedProviderKey = providerKey.trim();
  const provider = getShippingLabelProviderOrThrow(requestedProviderKey);
  if (!provider.supportsWebhookEvents || !provider.parseWebhookEvent) {
    throw new HttpError(
      409,
      `${provider.providerDisplayName} does not support inbound provider sync in CorePOS yet`,
      "SHIPPING_PROVIDER_WEBHOOK_UNSUPPORTED",
    );
  }

  if (requestedProviderKey === "EASYPOST") {
    const config = await getStoredEasyPostConfig();
    if (!isEasyPostWebhookConfigReady(config)) {
      throw new HttpError(
        409,
        "EasyPost webhook sync requires webhookSecret in Settings",
        "SHIPPING_PROVIDER_NOT_CONFIGURED",
      );
    }

    return {
      provider,
      providerKey: requestedProviderKey,
      providerDisplayName: config?.displayName ?? provider.providerDisplayName,
      providerEnvironment: config?.environment ?? "SANDBOX",
      runtimeConfig: {
        providerKey: requestedProviderKey,
        environment: config?.environment ?? "SANDBOX",
        displayName: config?.displayName ?? null,
        apiKey: config?.apiKey ?? null,
        apiBaseUrl: config?.apiBaseUrl ?? null,
        carrierAccountId: config?.carrierAccountId ?? null,
        defaultServiceCode: config?.defaultServiceCode ?? null,
        defaultServiceName: config?.defaultServiceName ?? null,
        parcelWeightOz: config?.parcelWeightOz ?? null,
        parcelLengthIn: config?.parcelLengthIn ?? null,
        parcelWidthIn: config?.parcelWidthIn ?? null,
        parcelHeightIn: config?.parcelHeightIn ?? null,
        webhookSecret: config?.webhookSecret ?? null,
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
    const clearApiKey = normalizeBoolean(input.clearApiKey, "clearApiKey", false);
    const clearWebhookSecret = normalizeBoolean(input.clearWebhookSecret, "clearWebhookSecret", false);

    if (providerKey === "GENERIC_HTTP_ZPL") {
      const existing = await getStoredGenericHttpZplConfig(tx);
      const nextConfig: GenericHttpZplProviderConfig = {
        enabled: normalizeBoolean(input.enabled, "enabled", existing?.enabled ?? false),
        environment: normalizeEnvironment(input.environment, existing?.environment ?? "SANDBOX"),
        displayName:
          input.displayName !== undefined
            ? normalizeOptionalText(input.displayName, "displayName", { maxLength: 120 })
            : (existing?.displayName ?? null),
        endpointBaseUrl:
          input.endpointBaseUrl !== undefined
            ? normalizeOptionalUrl(input.endpointBaseUrl, "endpointBaseUrl")
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

      if (nextConfig.enabled && !isGenericHttpZplConfigReady(nextConfig)) {
        throw new HttpError(
          409,
          "Enabled courier providers must include endpointBaseUrl and apiKey",
          "SHIPPING_PROVIDER_NOT_CONFIGURED",
        );
      }

      await tx.appConfig.upsert({
        where: { key: configKey },
        create: { key: configKey, value: nextConfig as Prisma.InputJsonValue },
        update: { value: nextConfig as Prisma.InputJsonValue },
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
    }

    const existing = await getStoredEasyPostConfig(tx);
    const nextDefaultServiceCode =
      input.defaultServiceCode !== undefined
        ? normalizeOptionalText(input.defaultServiceCode, "defaultServiceCode", { maxLength: 80 })
        : (existing?.defaultServiceCode ?? null);
    const nextDefaultServiceName =
      input.defaultServiceName !== undefined
        ? normalizeOptionalText(input.defaultServiceName, "defaultServiceName", { maxLength: 120 })
        : (existing?.defaultServiceName ?? null);

    const nextConfig: EasyPostProviderConfig = {
      enabled: normalizeBoolean(input.enabled, "enabled", existing?.enabled ?? false),
      environment: normalizeEnvironment(input.environment, existing?.environment ?? "SANDBOX"),
      displayName:
        input.displayName !== undefined
          ? normalizeOptionalText(input.displayName, "displayName", { maxLength: 120 })
          : (existing?.displayName ?? null),
      apiBaseUrl:
        input.apiBaseUrl !== undefined
          ? normalizeOptionalUrl(input.apiBaseUrl, "apiBaseUrl")
          : (existing?.apiBaseUrl ?? null),
      carrierAccountId:
        input.carrierAccountId !== undefined
          ? normalizeOptionalText(input.carrierAccountId, "carrierAccountId", { maxLength: 120 })
          : (existing?.carrierAccountId ?? null),
      defaultServiceCode: nextDefaultServiceCode,
      defaultServiceName: nextDefaultServiceName ?? nextDefaultServiceCode,
      parcelWeightOz:
        input.parcelWeightOz !== undefined
          ? normalizeOptionalPositiveNumber(input.parcelWeightOz, "parcelWeightOz")
          : (existing?.parcelWeightOz ?? null),
      parcelLengthIn:
        input.parcelLengthIn !== undefined
          ? normalizeOptionalPositiveNumber(input.parcelLengthIn, "parcelLengthIn")
          : (existing?.parcelLengthIn ?? null),
      parcelWidthIn:
        input.parcelWidthIn !== undefined
          ? normalizeOptionalPositiveNumber(input.parcelWidthIn, "parcelWidthIn")
          : (existing?.parcelWidthIn ?? null),
      parcelHeightIn:
        input.parcelHeightIn !== undefined
          ? normalizeOptionalPositiveNumber(input.parcelHeightIn, "parcelHeightIn")
          : (existing?.parcelHeightIn ?? null),
      webhookSecret: clearWebhookSecret
        ? null
        : (() => {
            const nextWebhookSecret = normalizeWebhookSecretInput(input.webhookSecret);
            if (nextWebhookSecret !== undefined) {
              return nextWebhookSecret;
            }
            return existing?.webhookSecret ?? null;
          })(),
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

    if (nextConfig.enabled && !isEasyPostConfigReady(nextConfig)) {
      throw new HttpError(
        409,
        "Enabled EasyPost integration must include apiKey, carrierAccountId, defaultServiceCode, and parcel defaults",
        "SHIPPING_PROVIDER_NOT_CONFIGURED",
      );
    }

    await tx.appConfig.upsert({
      where: { key: configKey },
      create: { key: configKey, value: nextConfig as Prisma.InputJsonValue },
      update: { value: nextConfig as Prisma.InputJsonValue },
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
          carrierAccountId: nextConfig.carrierAccountId,
          defaultServiceCode: nextConfig.defaultServiceCode,
          parcelWeightOz: nextConfig.parcelWeightOz,
          parcelLengthIn: nextConfig.parcelLengthIn,
          parcelWidthIn: nextConfig.parcelWidthIn,
          parcelHeightIn: nextConfig.parcelHeightIn,
          hasWebhookSecret: Boolean(nextConfig.webhookSecret),
          hasApiKey: Boolean(nextConfig.apiKey),
          apiBaseUrl: nextConfig.apiBaseUrl,
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

  const [defaultProviderKey, genericHttpConfig, easyPostConfig] = await Promise.all([
    getStoredDefaultProviderKey(),
    getStoredGenericHttpZplConfig(),
    getStoredEasyPostConfig(),
  ]);

  return {
    provider: toConfiguredProviderResponse(definition, defaultProviderKey, genericHttpConfig, easyPostConfig),
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
