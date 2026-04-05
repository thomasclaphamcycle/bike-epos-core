import type { ShippingLabelDocument, ShipmentPrintRequest } from "../../../shared/shippingPrintContract";

export type { ShippingLabelDocument, ShipmentPrintRequest };

export type ShippingProviderMode = "mock" | "integration";
export type ShippingProviderImplementationState = "mock" | "scaffold" | "live";
export type ShippingProviderEnvironment = "SANDBOX" | "LIVE";

export type ShippingPartyAddress = {
  name: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  region?: string | null;
  postcode: string;
  country: string;
  phone?: string | null;
  email?: string | null;
};

export type ShippingShipmentContext = {
  shipmentId: string;
  shipmentNumber: number;
  providerKey: string;
  providerDisplayName: string;
  providerEnvironment?: ShippingProviderEnvironment | null;
  serviceCode: string;
  serviceName: string;
};

export type ShippingLabelGenerationInput = {
  order: {
    id: string;
    orderNumber: string;
    sourceChannel: string;
    placedAt: Date;
    customerName: string;
    customerEmail: string;
    shippingRecipient: ShippingPartyAddress;
    items: Array<{
      sku: string | null;
      productName: string;
      variantName: string | null;
      quantity: number;
    }>;
  };
  shipment: ShippingShipmentContext;
  shipFrom: ShippingPartyAddress;
};

export type ShippingLabelProviderResult = {
  trackingNumber: string;
  normalizedServiceCode?: string | null;
  normalizedServiceName?: string | null;
  providerReference?: string | null;
  providerShipmentReference?: string | null;
  providerTrackingReference?: string | null;
  providerLabelReference?: string | null;
  providerStatus?: string | null;
  providerMetadata?: Record<string, unknown> | null;
  document: ShippingLabelDocument;
};

export type ShippingProviderShipmentLifecycleInput = {
  order: {
    id: string;
    orderNumber: string;
    sourceChannel: string;
  };
  shipment: ShippingShipmentContext & {
    trackingNumber: string;
    providerReference?: string | null;
    providerShipmentReference?: string | null;
    providerTrackingReference?: string | null;
    providerLabelReference?: string | null;
    providerStatus?: string | null;
    providerRefundStatus?: string | null;
    providerMetadata?: Record<string, unknown> | null;
    hasStoredLabelDocument: boolean;
    labelGeneratedAt: Date;
  };
};

export type ShippingProviderShipmentLifecycleResult = {
  trackingNumber?: string | null;
  normalizedServiceCode?: string | null;
  normalizedServiceName?: string | null;
  providerReference?: string | null;
  providerShipmentReference?: string | null;
  providerTrackingReference?: string | null;
  providerLabelReference?: string | null;
  providerStatus?: string | null;
  providerRefundStatus?: string | null;
  providerMetadata?: Record<string, unknown> | null;
  document?: ShippingLabelDocument | null;
};

export type ShippingProviderRuntimeConfig = {
  providerKey: string;
  environment?: ShippingProviderEnvironment | null;
  displayName?: string | null;
  endpointBaseUrl?: string | null;
  apiBaseUrl?: string | null;
  apiKey?: string | null;
  webhookSecret?: string | null;
  accountId?: string | null;
  carrierAccountId?: string | null;
  defaultServiceCode?: string | null;
  defaultServiceName?: string | null;
  parcelWeightOz?: number | null;
  parcelLengthIn?: number | null;
  parcelWidthIn?: number | null;
  parcelHeightIn?: number | null;
};

export type ShippingLabelProviderExecutionContext = {
  runtimeConfig: ShippingProviderRuntimeConfig | null;
};

export type ShippingProviderWebhookInput = {
  headers: Record<string, string | string[] | undefined>;
  method: string;
  path: string;
  rawBody: Buffer;
  body: unknown;
};

export type ShippingProviderWebhookEvent = {
  eventId: string;
  eventType: string;
  occurredAt?: Date | null;
  providerShipmentReference?: string | null;
  providerTrackingReference?: string | null;
  trackingNumber?: string | null;
  signatureVerified: boolean;
  disposition: "APPLY_UPDATE" | "IGNORE";
  lifecycleResult?: ShippingProviderShipmentLifecycleResult | null;
  ignoreReason?: string | null;
  payload: Record<string, unknown> | null;
};

export interface ShippingLabelProvider {
  readonly providerKey: string;
  readonly providerDisplayName: string;
  readonly mode: ShippingProviderMode;
  readonly implementationState: ShippingProviderImplementationState;
  readonly requiresConfiguration: boolean;
  readonly supportsShipmentRefresh: boolean;
  readonly supportsShipmentVoid: boolean;
  readonly supportsWebhookEvents: boolean;
  createLabel(
    input: ShippingLabelGenerationInput,
    context: ShippingLabelProviderExecutionContext,
  ): Promise<ShippingLabelProviderResult>;
  syncShipment?(
    input: ShippingProviderShipmentLifecycleInput,
    context: ShippingLabelProviderExecutionContext,
  ): Promise<ShippingProviderShipmentLifecycleResult>;
  voidShipment?(
    input: ShippingProviderShipmentLifecycleInput,
    context: ShippingLabelProviderExecutionContext,
  ): Promise<ShippingProviderShipmentLifecycleResult>;
  parseWebhookEvent?(
    input: ShippingProviderWebhookInput,
    context: ShippingLabelProviderExecutionContext,
  ): Promise<ShippingProviderWebhookEvent>;
}

export type ShippingPrintPreparationInput = {
  printerId?: string | null;
  printerKey?: string | null;
  copies?: number;
};
