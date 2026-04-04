import type { ShippingLabelDocument, ShipmentPrintRequest } from "../../../shared/shippingPrintContract";

export type { ShippingLabelDocument, ShipmentPrintRequest };

export type ShippingPartyAddress = {
  name: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  region?: string | null;
  postcode: string;
  country: string;
};

export type ShippingShipmentContext = {
  shipmentId: string;
  shipmentNumber: number;
  providerKey: string;
  providerDisplayName: string;
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
  providerReference?: string | null;
  providerMetadata?: Record<string, unknown> | null;
  document: ShippingLabelDocument;
};

export interface ShippingLabelProvider {
  readonly providerKey: string;
  readonly providerDisplayName: string;
  readonly mode: "mock" | "integration";
  createLabel(input: ShippingLabelGenerationInput): Promise<ShippingLabelProviderResult>;
}

export type ShippingPrintPreparationInput = {
  printerId?: string | null;
  printerKey?: string | null;
  copies?: number;
};
