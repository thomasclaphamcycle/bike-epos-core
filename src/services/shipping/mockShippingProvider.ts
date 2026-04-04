import type {
  ShippingLabelGenerationInput,
  ShippingLabelProvider,
  ShippingLabelProviderResult,
} from "./contracts";

const zplSafe = (value: string) =>
  value
    .replace(/[\^~]/g, " ")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const upperSlug = (value: string) => {
  const collapsed = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return collapsed.length > 0 ? collapsed : "WEBORDER";
};

const buildTrackingNumber = (input: ShippingLabelGenerationInput) => {
  const orderToken = upperSlug(input.order.orderNumber).slice(-10);
  return `MOCK${orderToken}${String(input.shipment.shipmentNumber).padStart(2, "0")}`;
};

const formatAddressLine = (...parts: Array<string | null | undefined>) =>
  zplSafe(parts.filter((part) => typeof part === "string" && part.trim().length > 0).join(", "));

const buildItemSummary = (input: ShippingLabelGenerationInput) => {
  const summary = input.order.items
    .slice(0, 3)
    .map((item) => `${item.quantity}x ${item.variantName ?? item.productName}`)
    .join(" | ");

  return zplSafe(summary || "Order items attached in CorePOS");
};

const buildDocument = (input: ShippingLabelGenerationInput, trackingNumber: string) => {
  const recipient = input.order.shippingRecipient;
  const sender = input.shipFrom;
  const orderLabel = zplSafe(input.order.orderNumber);
  const serviceLabel = zplSafe(input.shipment.serviceName);
  const providerLabel = zplSafe(input.shipment.providerDisplayName);
  const recipientName = zplSafe(recipient.name);
  const recipientLine1 = formatAddressLine(recipient.addressLine1, recipient.addressLine2);
  const recipientLine2 = formatAddressLine(recipient.city, recipient.region, recipient.postcode);
  const recipientLine3 = zplSafe(recipient.country);
  const senderName = zplSafe(sender.name);
  const senderLine = formatAddressLine(sender.addressLine1, sender.city, sender.postcode);
  const itemSummary = buildItemSummary(input);

  return [
    "^XA",
    "^CI28",
    "^PW812",
    "^LL1218",
    "^LH0,0",
    "^FO36,36^A0N,36,36^FDCOREPOS DEV SHIPMENT LABEL^FS",
    `^FO36,86^A0N,28,28^FDProvider: ${providerLabel}^FS`,
    `^FO36,122^A0N,28,28^FDService: ${serviceLabel}^FS`,
    `^FO36,158^A0N,28,28^FDOrder: ${orderLabel}^FS`,
    `^FO36,194^A0N,28,28^FDTracking: ${trackingNumber}^FS`,
    "^FO36,246^GB740,0,2^FS",
    "^FO36,270^A0N,30,30^FDSHIP TO^FS",
    `^FO36,316^A0N,42,42^FD${recipientName}^FS`,
    `^FO36,370^A0N,34,34^FD${recipientLine1}^FS`,
    `^FO36,414^A0N,34,34^FD${recipientLine2}^FS`,
    `^FO36,458^A0N,34,34^FD${recipientLine3}^FS`,
    "^FO36,522^A0N,26,26^FDDispatch summary^FS",
    `^FO36,556^A0N,26,26^FD${itemSummary}^FS`,
    "^BY3,3,120",
    `^FO36,644^BCN,120,Y,N,N^FD${trackingNumber}^FS`,
    "^FO36,820^GB740,0,2^FS",
    `^FO36,846^A0N,26,26^FDFROM: ${senderName}^FS`,
    `^FO36,880^A0N,24,24^FD${senderLine}^FS`,
    "^FO36,934^A0N,24,24^FDMock/internal provider for CorePOS development only.^FS",
    "^FO36,968^A0N,24,24^FDDesigned for later Windows local-agent handoff to Zebra GK420d.^FS",
    "^XZ",
  ].join("\n");
};

export class InternalMockShippingLabelProvider implements ShippingLabelProvider {
  readonly providerKey = "INTERNAL_MOCK_ZPL";
  readonly providerDisplayName = "Internal Mock ZPL";
  readonly mode = "mock" as const;

  async createLabel(input: ShippingLabelGenerationInput): Promise<ShippingLabelProviderResult> {
    const trackingNumber = buildTrackingNumber(input);
    const safeOrderToken = upperSlug(input.order.orderNumber).slice(-12);

    return {
      trackingNumber,
      providerReference: `mock-ref-${safeOrderToken}-${input.shipment.shipmentNumber}`,
      providerMetadata: {
        generatedBy: this.providerKey,
        intendedPrinterLanguage: "ZPL",
      },
      document: {
        format: "ZPL",
        mimeType: "application/zpl",
        fileName: `shipment-${safeOrderToken}-${trackingNumber}.zpl`,
        content: buildDocument(input, trackingNumber),
      },
    };
  }
}
