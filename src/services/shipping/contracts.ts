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

export type ShippingProviderRuntimeConfig = {
  providerKey: string;
  environment?: ShippingProviderEnvironment | null;
  displayName?: string | null;
  endpointBaseUrl?: string | null;
  apiBaseUrl?: string | null;
  apiKey?: string | null;
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

export interface ShippingLabelProvider {
  readonly providerKey: string;
  readonly providerDisplayName: string;
  readonly mode: ShippingProviderMode;
  readonly implementationState: ShippingProviderImplementationState;
  readonly requiresConfiguration: boolean;
  createLabel(
    input: ShippingLabelGenerationInput,
    context: ShippingLabelProviderExecutionContext,
  ): Promise<ShippingLabelProviderResult>;
}

export type ShippingPrintPreparationInput = {
  printerId?: string | null;
  printerKey?: string | null;
  copies?: number;
};
