import { HttpError } from "../../utils/http";
import type {
  ShippingLabelGenerationInput,
  ShippingLabelProvider,
  ShippingLabelProviderExecutionContext,
  ShippingLabelProviderResult,
  ShippingProviderEnvironment,
} from "./contracts";

const DEFAULT_TIMEOUT_MS = 8000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const expectRecord = (value: unknown, field: string) => {
  if (!isRecord(value)) {
    throw new Error(`${field} must be an object`);
  }

  return value;
};

const expectOptionalRecord = (value: unknown, field: string) => {
  if (value === undefined || value === null) {
    return null;
  }

  return expectRecord(value, field);
};

const expectString = (value: unknown, field: string) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }

  return value.trim();
};

const expectOptionalString = (value: unknown, field: string) => {
  if (value === undefined || value === null) {
    return null;
  }

  return expectString(value, field);
};

const expectEnvironment = (value: unknown): ShippingProviderEnvironment => {
  if (value !== "SANDBOX" && value !== "LIVE") {
    throw new HttpError(
      500,
      "Generic HTTP courier provider requires environment SANDBOX or LIVE",
      "INVALID_SHIPPING_PROVIDER_CONFIG",
    );
  }

  return value;
};

const parseJsonResponse = async (response: Response) => {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Provider response was not valid JSON");
  }
};

const extractProviderErrorMessage = (status: number, payload: unknown) => {
  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload;
  }

  if (isRecord(payload)) {
    const errorValue = payload.error;
    if (typeof errorValue === "string" && errorValue.trim().length > 0) {
      return errorValue;
    }
    if (isRecord(errorValue) && typeof errorValue.message === "string" && errorValue.message.trim().length > 0) {
      return errorValue.message;
    }
    if (typeof payload.message === "string" && payload.message.trim().length > 0) {
      return payload.message;
    }
  }

  return `Courier provider rejected the shipment request (${status})`;
};

const validateResponse = (value: unknown): ShippingLabelProviderResult => {
  const record = expectRecord(value, "response");
  if (record.ok !== true) {
    throw new Error("response.ok must be true");
  }

  const shipmentRecord = expectRecord(record.shipment, "response.shipment");
  const documentRecord = expectRecord(record.document, "response.document");
  const metadataRecord = expectOptionalRecord(record.metadata, "response.metadata");

  const documentFormat = expectString(documentRecord.format, "response.document.format");
  const mimeType = expectString(documentRecord.mimeType, "response.document.mimeType");
  if (documentFormat !== "ZPL") {
    throw new Error("response.document.format must be ZPL");
  }
  if (mimeType !== "application/zpl") {
    throw new Error("response.document.mimeType must be application/zpl");
  }

  return {
    trackingNumber: expectString(shipmentRecord.trackingNumber, "response.shipment.trackingNumber"),
    normalizedServiceCode: expectOptionalString(shipmentRecord.serviceCode, "response.shipment.serviceCode"),
    normalizedServiceName: expectOptionalString(shipmentRecord.serviceName, "response.shipment.serviceName"),
    providerReference:
      expectOptionalString(shipmentRecord.providerReference, "response.shipment.providerReference")
      ?? expectOptionalString(shipmentRecord.providerShipmentReference, "response.shipment.providerShipmentReference"),
    providerShipmentReference: expectOptionalString(
      shipmentRecord.providerShipmentReference,
      "response.shipment.providerShipmentReference",
    ),
    providerTrackingReference: expectOptionalString(
      shipmentRecord.providerTrackingReference,
      "response.shipment.providerTrackingReference",
    ),
    providerLabelReference: expectOptionalString(
      shipmentRecord.providerLabelReference,
      "response.shipment.providerLabelReference",
    ),
    providerStatus: expectOptionalString(shipmentRecord.providerStatus, "response.shipment.providerStatus"),
    providerMetadata: metadataRecord,
    document: {
      format: "ZPL",
      mimeType: "application/zpl",
      fileName: expectString(documentRecord.fileName, "response.document.fileName"),
      content: expectString(documentRecord.content, "response.document.content"),
    },
  };
};

const resolveRuntimeConfig = (context: ShippingLabelProviderExecutionContext) => {
  const runtimeConfig = context.runtimeConfig;
  if (!runtimeConfig) {
    throw new HttpError(
      503,
      "Generic HTTP courier provider is not configured",
      "SHIPPING_PROVIDER_NOT_CONFIGURED",
    );
  }

  const endpointBaseUrl = expectString(runtimeConfig.endpointBaseUrl, "runtimeConfig.endpointBaseUrl");
  const apiKey = expectString(runtimeConfig.apiKey, "runtimeConfig.apiKey");
  const environment = expectEnvironment(runtimeConfig.environment);

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(endpointBaseUrl);
  } catch {
    throw new HttpError(
      500,
      "Generic HTTP courier endpointBaseUrl must be a valid URL",
      "INVALID_SHIPPING_PROVIDER_CONFIG",
    );
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new HttpError(
      500,
      "Generic HTTP courier endpointBaseUrl must start with http:// or https://",
      "INVALID_SHIPPING_PROVIDER_CONFIG",
    );
  }

  return {
    endpointBaseUrl: parsedUrl.toString().replace(/\/$/, ""),
    apiKey,
    environment,
    accountId: runtimeConfig.accountId?.trim() || null,
  };
};

const buildProviderRequest = (
  input: ShippingLabelGenerationInput,
  environment: ShippingProviderEnvironment,
  accountId: string | null,
) => ({
  requestVersion: 1,
  environment,
  accountId,
  shipment: {
    internalShipmentId: input.shipment.shipmentId,
    shipmentNumber: input.shipment.shipmentNumber,
    orderId: input.order.id,
    orderNumber: input.order.orderNumber,
    sourceChannel: input.order.sourceChannel,
    placedAt: input.order.placedAt.toISOString(),
    providerKey: input.shipment.providerKey,
    serviceCode: input.shipment.serviceCode,
    serviceName: input.shipment.serviceName,
  },
  recipient: {
    name: input.order.shippingRecipient.name,
    addressLine1: input.order.shippingRecipient.addressLine1,
    addressLine2: input.order.shippingRecipient.addressLine2 ?? null,
    city: input.order.shippingRecipient.city,
    region: input.order.shippingRecipient.region ?? null,
    postcode: input.order.shippingRecipient.postcode,
    country: input.order.shippingRecipient.country,
  },
  sender: {
    name: input.shipFrom.name,
    addressLine1: input.shipFrom.addressLine1,
    addressLine2: input.shipFrom.addressLine2 ?? null,
    city: input.shipFrom.city,
    region: input.shipFrom.region ?? null,
    postcode: input.shipFrom.postcode,
    country: input.shipFrom.country,
  },
  parcels: input.order.items.map((item) => ({
    sku: item.sku,
    description: item.variantName ?? item.productName,
    quantity: item.quantity,
  })),
  requestedLabel: {
    format: "ZPL",
    mimeType: "application/zpl",
    stock: "4x6",
  },
});

export class GenericHttpZplShippingProvider implements ShippingLabelProvider {
  readonly providerKey = "GENERIC_HTTP_ZPL";
  readonly providerDisplayName = "Generic HTTP ZPL Scaffold";
  readonly mode = "integration" as const;
  readonly implementationState = "scaffold" as const;
  readonly requiresConfiguration = true;
  readonly supportsShipmentRefresh = false;
  readonly supportsShipmentVoid = false;

  async createLabel(
    input: ShippingLabelGenerationInput,
    context: ShippingLabelProviderExecutionContext,
  ): Promise<ShippingLabelProviderResult> {
    const config = resolveRuntimeConfig(context);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(`${config.endpointBaseUrl}/shipments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
          "X-CorePOS-Shipping-Environment": config.environment,
          ...(config.accountId ? { "X-CorePOS-Shipping-Account": config.accountId } : {}),
        },
        body: JSON.stringify(buildProviderRequest(input, config.environment, config.accountId)),
        signal: controller.signal,
      });

      const payload = await parseJsonResponse(response);
      if (!response.ok) {
        throw new HttpError(
          502,
          extractProviderErrorMessage(response.status, payload),
          "SHIPPING_PROVIDER_REJECTED",
        );
      }

      try {
        const result = validateResponse(payload);
        return {
          ...result,
          providerMetadata: {
            adapterKey: this.providerKey,
            environment: config.environment,
            accountId: config.accountId,
            ...(result.providerMetadata ?? {}),
          },
        };
      } catch (error) {
        throw new HttpError(
          502,
          error instanceof Error ? error.message : "Courier provider response was invalid",
          "SHIPPING_PROVIDER_INVALID_RESPONSE",
        );
      }
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }

      if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
        throw new HttpError(
          504,
          `Courier provider timed out after ${DEFAULT_TIMEOUT_MS}ms`,
          "SHIPPING_PROVIDER_TIMEOUT",
        );
      }

      throw new HttpError(
        503,
        error instanceof Error ? `Courier provider could not be reached: ${error.message}` : "Courier provider could not be reached",
        "SHIPPING_PROVIDER_UNREACHABLE",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
