import type {
  ShippingLabelGenerationInput,
  ShippingLabelProvider,
  ShippingLabelProviderExecutionContext,
  ShippingLabelProviderResult,
  ShippingProviderShipmentLifecycleInput,
  ShippingProviderShipmentLifecycleResult,
} from "./contracts";

const zplSafe = (value: string) =>
  value
    .replace(/[\^~]/g, " ")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const truncateText = (value: string, maxLength: number) => {
  const safe = zplSafe(value);
  if (safe.length <= maxLength) {
    return safe;
  }

  return `${safe.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
};

const wrapText = (value: string, maxCharsPerLine: number, maxLines: number) => {
  const safe = zplSafe(value);
  if (!safe) {
    return [];
  }

  const rawLines: string[] = [];
  let currentLine = "";

  for (const token of safe.split(" ")) {
    if (!token) {
      continue;
    }

    if (token.length > maxCharsPerLine) {
      if (currentLine) {
        rawLines.push(currentLine);
        currentLine = "";
      }

      let remaining = token;
      while (remaining.length > maxCharsPerLine) {
        rawLines.push(remaining.slice(0, maxCharsPerLine));
        remaining = remaining.slice(maxCharsPerLine);
      }
      currentLine = remaining;
      continue;
    }

    const candidate = currentLine ? `${currentLine} ${token}` : token;
    if (candidate.length <= maxCharsPerLine) {
      currentLine = candidate;
      continue;
    }

    rawLines.push(currentLine);
    currentLine = token;
  }

  if (currentLine) {
    rawLines.push(currentLine);
  }

  if (rawLines.length <= maxLines) {
    return rawLines;
  }

  return [
    ...rawLines.slice(0, maxLines - 1),
    truncateText(rawLines.slice(maxLines - 1).join(" "), maxCharsPerLine),
  ];
};

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
  const visibleItems = input.order.items
    .slice(0, 3)
    .map((item) => {
      const descriptor = item.variantName ? `${item.productName} ${item.variantName}` : item.productName;
      return `${item.quantity}x ${descriptor}`;
    })
    .join(", ");
  const remainingCount = Math.max(0, input.order.items.length - 3);
  const summary = remainingCount > 0 ? `${visibleItems}, +${remainingCount} more items` : visibleItems;

  return zplSafe(summary || "Order contents recorded in CorePOS");
};

const humanizeToken = (value: string) =>
  value
    .toLowerCase()
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");

const isDomesticUkDestination = (country: string) => {
  const normalized = zplSafe(country).toUpperCase();
  return [
    "UK",
    "GB",
    "UNITED KINGDOM",
    "GREAT BRITAIN",
    "ENGLAND",
    "SCOTLAND",
    "WALES",
    "NORTHERN IRELAND",
  ].includes(normalized);
};

const buildRecipientLocalityLine = (recipient: ShippingLabelGenerationInput["order"]["shippingRecipient"]) => {
  if (isDomesticUkDestination(recipient.country)) {
    return truncateText(`${zplSafe(recipient.postcode).toUpperCase()}  ${zplSafe(recipient.city).toUpperCase()}`, 26);
  }

  return truncateText(
    [recipient.city, recipient.region, recipient.postcode]
      .filter((part) => typeof part === "string" && part.trim().length > 0)
      .map((part) => zplSafe(String(part)).toUpperCase())
      .join("  "),
    30,
  );
};

const buildDocument = (input: ShippingLabelGenerationInput, trackingNumber: string) => {
  const recipient = input.order.shippingRecipient;
  const sender = input.shipFrom;
  const orderLabel = truncateText(input.order.orderNumber, 22);
  const shipmentLabel = `Shipment ${String(input.shipment.shipmentNumber).padStart(2, "0")}`;
  const channelLabel = truncateText(humanizeToken(input.order.sourceChannel), 20).toUpperCase();
  const serviceLabel = truncateText(input.shipment.serviceName, 22);
  const providerLabel = truncateText(
    input.shipment.providerKey === "INTERNAL_MOCK_ZPL" ? "CorePOS Shipping" : input.shipment.providerDisplayName,
    20,
  );
  const senderName = truncateText(sender.name, 24);
  const senderLine = truncateText(formatAddressLine(sender.city, sender.postcode), 28);
  const recipientNameLines = wrapText(recipient.name, 24, 2);
  const recipientStreetLines = wrapText(formatAddressLine(recipient.addressLine1, recipient.addressLine2), 34, 2);
  const recipientLocalityLine = buildRecipientLocalityLine(recipient);
  const recipientCountryLine = isDomesticUkDestination(recipient.country)
    ? null
    : truncateText(recipient.country, 28).toUpperCase();
  const itemSummaryLines = wrapText(buildItemSummary(input), 52, 2);
  const labelLines = [
    "^XA",
    "^CI28",
    "^PW812",
    "^LL1218",
    "^LH0,0",
    "^FO36,32^A0N,22,22^FDDISPATCH FROM^FS",
    `^FO36,62^A0N,28,28^FD${senderName}^FS`,
    `^FO36,96^A0N,22,22^FD${senderLine}^FS`,
    "^FO432,32^A0N,22,22^FDORDER NO^FS",
    `^FO432,60^A0N,32,32^FD${orderLabel}^FS`,
    "^FO432,102^A0N,22,22^FDSHIPMENT^FS",
    `^FO432,130^A0N,26,26^FD${truncateText(`${channelLabel} / ${shipmentLabel}`, 24)}^FS`,
    "^FO36,158^GB740,0,2^FS",
    "^FO36,188^A0N,26,26^FDSHIP TO^FS",
  ];

  let recipientY = 226;
  for (const line of recipientNameLines) {
    labelLines.push(`^FO36,${recipientY}^A0N,50,50^FD${line}^FS`);
    recipientY += 56;
  }

  recipientY += 14;
  for (const line of recipientStreetLines) {
    labelLines.push(`^FO36,${recipientY}^A0N,36,36^FD${line}^FS`);
    recipientY += 44;
  }

  labelLines.push(`^FO36,${recipientY + 12}^A0N,54,54^FD${recipientLocalityLine}^FS`);
  recipientY += 82;

  if (recipientCountryLine) {
    labelLines.push(`^FO36,${recipientY}^A0N,26,26^FD${recipientCountryLine}^FS`);
  }

  labelLines.push(
    "^FO36,584^GB740,0,2^FS",
    "^FO36,614^A0N,22,22^FDTRACKING NUMBER^FS",
    `^FO36,646^A0N,38,38^FD${trackingNumber}^FS`,
    "^BY3,3,156",
    `^FO110,708^BCN,156,N,N,N^FD${trackingNumber}^FS`,
    `^FO96,892^FB620,1,0,C,0^A0N,34,34^FD${trackingNumber}^FS`,
    "^FO36,952^GB740,0,2^FS",
    "^FO36,980^A0N,22,22^FDSERVICE^FS",
    `^FO36,1010^A0N,28,28^FD${serviceLabel}^FS`,
    "^FO420,980^A0N,22,22^FDPROVIDER^FS",
    `^FO420,1010^A0N,28,28^FD${providerLabel}^FS`,
    "^FO390,972^GB0,78,2^FS",
    "^FO36,1066^A0N,22,22^FDREFERENCE^FS",
    `^FO36,1096^A0N,28,28^FD${truncateText(`${orderLabel} / ${shipmentLabel}`, 44)}^FS`,
    "^FO36,1136^A0N,22,22^FDCONTENTS^FS",
  );

  let itemSummaryY = 1164;
  for (const line of itemSummaryLines) {
    labelLines.push(`^FO36,${itemSummaryY}^A0N,24,24^FD${line}^FS`);
    itemSummaryY += 28;
  }

  labelLines.push("^XZ");
  return labelLines.join("\n");
};

export class InternalMockShippingLabelProvider implements ShippingLabelProvider {
  readonly providerKey = "INTERNAL_MOCK_ZPL";
  readonly providerDisplayName = "Internal Mock ZPL";
  readonly mode = "mock" as const;
  readonly implementationState = "mock" as const;
  readonly requiresConfiguration = false;
  readonly supportsShipmentRefresh = true;
  readonly supportsShipmentVoid = true;
  readonly supportsWebhookEvents = false;

  async createLabel(
    input: ShippingLabelGenerationInput,
    _context: ShippingLabelProviderExecutionContext,
  ): Promise<ShippingLabelProviderResult> {
    const trackingNumber = buildTrackingNumber(input);
    const safeOrderToken = upperSlug(input.order.orderNumber).slice(-12);

    return {
      trackingNumber,
      providerReference: `mock-ref-${safeOrderToken}-${input.shipment.shipmentNumber}`,
      providerShipmentReference: `mock-shipment-${safeOrderToken}-${input.shipment.shipmentNumber}`,
      providerTrackingReference: trackingNumber,
      providerLabelReference: `mock-label-${trackingNumber}`,
      providerStatus: "LABEL_CREATED",
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

  async syncShipment(
    input: ShippingProviderShipmentLifecycleInput,
    _context: ShippingLabelProviderExecutionContext,
  ): Promise<ShippingProviderShipmentLifecycleResult> {
    return {
      trackingNumber: input.shipment.trackingNumber,
      providerReference: input.shipment.providerReference ?? input.shipment.providerShipmentReference ?? null,
      providerShipmentReference: input.shipment.providerShipmentReference ?? null,
      providerTrackingReference: input.shipment.providerTrackingReference ?? input.shipment.trackingNumber,
      providerLabelReference: input.shipment.providerLabelReference ?? null,
      providerStatus: input.shipment.providerRefundStatus === "REFUNDED" ? "CANCELLED" : "LABEL_CREATED",
      providerRefundStatus: input.shipment.providerRefundStatus ?? "NOT_APPLICABLE",
      providerMetadata: {
        ...(input.shipment.providerMetadata ?? {}),
        generatedBy: this.providerKey,
        lastLifecycleOperation: "SYNC",
      },
    };
  }

  async voidShipment(
    input: ShippingProviderShipmentLifecycleInput,
    _context: ShippingLabelProviderExecutionContext,
  ): Promise<ShippingProviderShipmentLifecycleResult> {
    return {
      trackingNumber: input.shipment.trackingNumber,
      providerReference: input.shipment.providerReference ?? input.shipment.providerShipmentReference ?? null,
      providerShipmentReference: input.shipment.providerShipmentReference ?? null,
      providerTrackingReference: input.shipment.providerTrackingReference ?? input.shipment.trackingNumber,
      providerLabelReference: input.shipment.providerLabelReference ?? null,
      providerStatus: "CANCELLED",
      providerRefundStatus: "REFUNDED",
      providerMetadata: {
        ...(input.shipment.providerMetadata ?? {}),
        generatedBy: this.providerKey,
        lastLifecycleOperation: "VOID",
      },
    };
  }
}
