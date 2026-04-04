export type ShippingPartyAddress = {
  name: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  region?: string | null;
  postcode: string;
  country: string;
};

export type ShippingLabelDocument = {
  format: "ZPL";
  mimeType: "application/zpl";
  fileName: string;
  content: string;
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
  printerName?: string | null;
  copies?: number;
};

export type ShipmentPrintRequest = {
  version: 1;
  intentType: "SHIPMENT_LABEL_PRINT";
  shipmentId: string;
  orderId: string;
  orderNumber: string;
  trackingNumber: string;
  printer: {
    transport: "WINDOWS_LOCAL_AGENT";
    printerFamily: "ZEBRA_LABEL";
    printerModelHint: "GK420D_OR_COMPATIBLE";
    printerName: string | null;
    copies: number;
  };
  document: ShippingLabelDocument;
  metadata: {
    providerKey: string;
    providerDisplayName: string;
    serviceCode: string;
    serviceName: string;
    sourceChannel: string;
  };
};
