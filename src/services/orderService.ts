import { Prisma, WebOrderFulfillmentMethod, WebOrderShipmentStatus, WebOrderStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { logOperationalEvent } from "../lib/operationalLogger";
import type { AuditActor } from "./auditService";
import { createAuditEventTx } from "./auditService";
import { listStoreInfoSettings } from "./configurationService";
import { resolveShipmentLabelPrinterSelection, type ResolvedShipmentPrinter } from "./printerService";
import {
  DEFAULT_SHIPPING_SERVICE_CODE,
  DEFAULT_SHIPPING_SERVICE_NAME,
} from "./shipping/providerRegistry";
import {
  listShippingProviderSettings,
  resolveShippingProviderForShipment,
  resolveShippingProviderForShipmentLifecycle,
  type ShippingProviderSettingsResponse,
} from "./shipping/providerConfigService";
import { deliverShipmentPrintRequestToAgent } from "./shipping/printAgentDeliveryService";
import {
  applyShipmentLifecycleResult,
  buildShipmentLifecycleInput,
  getShipmentForProviderLifecycleOrThrow,
  normalizeProviderLifecycleToken,
  persistShipmentLifecycleFailure,
} from "./shipping/providerSyncService";
import type {
  ShipmentPrintRequest,
  ShippingLabelDocument,
  ShippingPartyAddress,
  ShippingPrintPreparationInput,
  ShippingProviderShipmentLifecycleResult,
} from "./shipping/contracts";
import { HttpError } from "../utils/http";
import type { ShipmentPrintAgentJob } from "../../shared/shippingPrintContract";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;
const ACTIVE_SHIPMENT_STATUSES: WebOrderShipmentStatus[] = ["LABEL_READY", "PRINT_PREPARED", "PRINTED", "VOID_PENDING"];
const PRINTABLE_SHIPMENT_STATUSES = new Set<WebOrderShipmentStatus>([
  "LABEL_READY",
  "PRINT_PREPARED",
  "PRINTED",
  "DISPATCHED",
]);
const CANCELLABLE_SHIPMENT_STATUSES = new Set<WebOrderShipmentStatus>([
  "LABEL_READY",
  "PRINT_PREPARED",
  "PRINTED",
]);
const SUCCESSFUL_PROVIDER_VOID_STATUSES = new Set(["SUBMITTED", "REFUNDED"]);
const FAILED_PROVIDER_VOID_STATUSES = new Set(["REJECTED", "NOT_APPLICABLE"]);

const webOrderItemSelect = Prisma.validator<Prisma.WebOrderItemSelect>()({
  id: true,
  variantId: true,
  sku: true,
  productName: true,
  variantName: true,
  quantity: true,
  unitPricePence: true,
  lineTotalPence: true,
  createdAt: true,
});

const webOrderShipmentSelect = Prisma.validator<Prisma.WebOrderShipmentSelect>()({
  id: true,
  webOrderId: true,
  shipmentNumber: true,
  status: true,
  providerKey: true,
  providerDisplayName: true,
  providerEnvironment: true,
  serviceCode: true,
  serviceName: true,
  trackingNumber: true,
  labelFormat: true,
  labelStorageKind: true,
  labelMimeType: true,
  labelFileName: true,
  providerReference: true,
  providerShipmentReference: true,
  providerTrackingReference: true,
  providerLabelReference: true,
  providerStatus: true,
  providerRefundStatus: true,
  providerMetadata: true,
  labelGeneratedAt: true,
  providerSyncedAt: true,
  providerSyncError: true,
  printPreparedAt: true,
  printedAt: true,
  dispatchedAt: true,
  voidRequestedAt: true,
  voidedAt: true,
  reprintCount: true,
  createdAt: true,
  updatedAt: true,
  createdByStaffId: true,
});

const webOrderListSelect = Prisma.validator<Prisma.WebOrderSelect>()({
  id: true,
  orderNumber: true,
  sourceChannel: true,
  externalOrderRef: true,
  status: true,
  fulfillmentMethod: true,
  customerId: true,
  customerName: true,
  customerEmail: true,
  customerPhone: true,
  shippingRecipientName: true,
  shippingPostcode: true,
  shippingCountry: true,
  subtotalPence: true,
  shippingPricePence: true,
  totalPence: true,
  placedAt: true,
  packedAt: true,
  packedByStaffId: true,
  createdAt: true,
  updatedAt: true,
  items: {
    select: {
      id: true,
      quantity: true,
      productName: true,
      variantName: true,
      sku: true,
    },
    orderBy: [{ createdAt: "asc" }],
  },
  shipments: {
    select: webOrderShipmentSelect,
    orderBy: [{ shipmentNumber: "desc" }],
    take: 1,
  },
});

const webOrderDetailSelect = Prisma.validator<Prisma.WebOrderSelect>()({
  id: true,
  orderNumber: true,
  sourceChannel: true,
  externalOrderRef: true,
  status: true,
  fulfillmentMethod: true,
  customerId: true,
  customerName: true,
  customerEmail: true,
  customerPhone: true,
  deliveryInstructions: true,
  shippingRecipientName: true,
  shippingAddressLine1: true,
  shippingAddressLine2: true,
  shippingCity: true,
  shippingRegion: true,
  shippingPostcode: true,
  shippingCountry: true,
  subtotalPence: true,
  shippingPricePence: true,
  totalPence: true,
  placedAt: true,
  packedAt: true,
  packedByStaffId: true,
  createdAt: true,
  updatedAt: true,
  items: {
    select: webOrderItemSelect,
    orderBy: [{ createdAt: "asc" }],
  },
  shipments: {
    select: webOrderShipmentSelect,
    orderBy: [{ shipmentNumber: "desc" }],
  },
});

const webOrderShipmentWithOrderAndContentSelect = Prisma.validator<Prisma.WebOrderShipmentSelect>()({
  ...webOrderShipmentSelect,
  labelContent: true,
  webOrder: {
    select: webOrderDetailSelect,
  },
});

const webOrderShipmentScanSelect = Prisma.validator<Prisma.WebOrderShipmentSelect>()({
  ...webOrderShipmentSelect,
  webOrder: {
    select: webOrderListSelect,
  },
});

type WebOrderListRecord = Prisma.WebOrderGetPayload<{ select: typeof webOrderListSelect }>;
type WebOrderDetailRecord = Prisma.WebOrderGetPayload<{ select: typeof webOrderDetailSelect }>;
type WebOrderShipmentRecord = Prisma.WebOrderShipmentGetPayload<{ select: typeof webOrderShipmentSelect }>;
type WebOrderShipmentScanRecord = Prisma.WebOrderShipmentGetPayload<{ select: typeof webOrderShipmentScanSelect }>;

export type WebOrderItemResponse = {
  id: string;
  variantId: string | null;
  sku: string | null;
  productName: string;
  variantName: string | null;
  quantity: number;
  unitPricePence: number;
  lineTotalPence: number;
  createdAt: Date;
};

export type WebOrderShipmentResponse = {
  id: string;
  shipmentNumber: number;
  status: WebOrderShipmentStatus;
  providerKey: string;
  providerDisplayName: string;
  providerEnvironment: string | null;
  serviceCode: string;
  serviceName: string;
  trackingNumber: string;
  labelFormat: "ZPL";
  labelStorageKind: "INLINE_TEXT";
  labelMimeType: string;
  labelFileName: string;
  providerReference: string | null;
  providerShipmentReference: string | null;
  providerTrackingReference: string | null;
  providerLabelReference: string | null;
  providerStatus: string | null;
  providerRefundStatus: string | null;
  providerMetadata: Prisma.JsonValue | null;
  labelGeneratedAt: Date;
  providerSyncedAt: Date | null;
  providerSyncError: string | null;
  printPreparedAt: Date | null;
  printedAt: Date | null;
  dispatchedAt: Date | null;
  voidRequestedAt: Date | null;
  voidedAt: Date | null;
  reprintCount: number;
  createdAt: Date;
  updatedAt: Date;
  createdByStaffId: string | null;
  labelPayloadPath: string;
  labelContentPath: string;
  preparePrintPath: string;
  printPath: string;
  recordPrintedPath: string;
  dispatchPath: string;
  refreshPath: string;
  cancelPath: string;
  regeneratePath: string;
};

export type WebOrderSummaryResponse = {
  id: string;
  orderNumber: string;
  sourceChannel: string;
  externalOrderRef: string | null;
  status: WebOrderStatus;
  fulfillmentMethod: WebOrderFulfillmentMethod;
  customerId: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  shippingRecipientName: string;
  shippingPostcode: string;
  shippingCountry: string;
  subtotalPence: number;
  shippingPricePence: number;
  totalPence: number;
  placedAt: Date;
  packedAt: Date | null;
  packedByStaffId: string | null;
  createdAt: Date;
  updatedAt: Date;
  itemCount: number;
  itemQuantity: number;
  latestShipment: WebOrderShipmentResponse | null;
};

export type WebOrderDetailResponse = {
  id: string;
  orderNumber: string;
  sourceChannel: string;
  externalOrderRef: string | null;
  status: WebOrderStatus;
  fulfillmentMethod: WebOrderFulfillmentMethod;
  customerId: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  deliveryInstructions: string | null;
  shippingRecipientName: string;
  shippingAddressLine1: string;
  shippingAddressLine2: string | null;
  shippingCity: string;
  shippingRegion: string | null;
  shippingPostcode: string;
  shippingCountry: string;
  subtotalPence: number;
  shippingPricePence: number;
  totalPence: number;
  placedAt: Date;
  packedAt: Date | null;
  packedByStaffId: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: WebOrderItemResponse[];
  shipments: WebOrderShipmentResponse[];
};

export type SupportedShippingProviderResponse = ShippingProviderSettingsResponse;

export type CreateWebOrderInput = {
  orderNumber?: string;
  sourceChannel?: string;
  externalOrderRef?: string;
  fulfillmentMethod?: WebOrderFulfillmentMethod;
  customerId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  deliveryInstructions?: string;
  shippingRecipientName?: string;
  shippingAddressLine1?: string;
  shippingAddressLine2?: string;
  shippingCity?: string;
  shippingRegion?: string;
  shippingPostcode?: string;
  shippingCountry?: string;
  shippingPricePence?: number;
  placedAt?: string;
  items?: Array<{
    variantId?: string;
    sku?: string;
    productName?: string;
    variantName?: string;
    quantity?: number;
    unitPricePence?: number;
  }>;
};

export type CreateShipmentLabelInput = {
  providerKey?: string;
  serviceCode?: string;
  serviceName?: string;
};

export type SetWebOrderPackedInput = {
  packed: boolean;
};

type BulkShipmentActionResult = {
  orderId: string;
  orderNumber: string;
  outcome: "SUCCEEDED" | "FAILED" | "SKIPPED";
  code: string | null;
  message: string;
  packedAt: Date | null;
  shipmentId: string | null;
  trackingNumber: string | null;
  shipmentStatus: WebOrderShipmentStatus | null;
  printedAt: Date | null;
  dispatchedAt: Date | null;
};

export type BulkShipmentOperationResponse = {
  action: "CREATE_SHIPMENTS" | "PRINT_SHIPMENTS" | "DISPATCH_SHIPMENTS";
  summary: {
    requestedCount: number;
    processedCount: number;
    succeededCount: number;
    failedCount: number;
    skippedCount: number;
  };
  results: BulkShipmentActionResult[];
};

export type DispatchScanMatchType =
  | "TRACKING_NUMBER"
  | "PROVIDER_TRACKING_REFERENCE"
  | "PROVIDER_SHIPMENT_REFERENCE"
  | "PROVIDER_REFERENCE"
  | "ORDER_NUMBER"
  | "EXTERNAL_ORDER_REFERENCE";

export type DispatchScanCandidateResponse = {
  orderId: string;
  orderNumber: string;
  shipmentId: string | null;
  trackingNumber: string | null;
  shipmentStatus: WebOrderShipmentStatus | null;
  dispatchedAt: Date | null;
  matchedBy: DispatchScanMatchType;
};

export type DispatchScanLookupResponse = {
  status: "MATCHED" | "NO_MATCH" | "AMBIGUOUS";
  scanValue: string;
  normalizedValue: string;
  matchedBy: DispatchScanMatchType | null;
  dispatchable: boolean;
  dispatchBlockedCode: string | null;
  dispatchBlockedReason: string | null;
  order: WebOrderSummaryResponse | null;
  shipment: WebOrderShipmentResponse | null;
  candidates: DispatchScanCandidateResponse[];
};

export type BulkCreateShipmentsInput = CreateShipmentLabelInput & {
  orderIds: string[];
};

export type BulkPrintShipmentsInput = ShippingPrintPreparationInput & {
  orderIds: string[];
};

export type BulkDispatchShipmentsInput = {
  orderIds: string[];
};

type RecordShipmentPrintedOptions = {
  printRequest?: ShipmentPrintRequest;
  printJob?: ShipmentPrintAgentJob;
};

type ShipmentDispatchEligibility = {
  canDispatch: boolean;
  code: string | null;
  message: string | null;
};

const normalizeOptionalText = (value: string | undefined | null) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeRequiredText = (value: string | undefined | null, field: string, maxLength = 160) => {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw new HttpError(400, `${field} is required`, "INVALID_WEB_ORDER");
  }
  if (normalized.length > maxLength) {
    throw new HttpError(400, `${field} must be ${maxLength} characters or fewer`, "INVALID_WEB_ORDER");
  }
  return normalized;
};

const normalizeEmail = (value: string | undefined | null, field: string) => {
  const normalized = normalizeRequiredText(value, field, 160).toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalized)) {
    throw new HttpError(400, `${field} must be a valid email address`, "INVALID_WEB_ORDER");
  }
  return normalized;
};

const normalizeOptionalLimitedText = (
  value: string | undefined | null,
  field: string,
  maxLength = 160,
) => {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }
  if (normalized.length > maxLength) {
    throw new HttpError(400, `${field} must be ${maxLength} characters or fewer`, "INVALID_WEB_ORDER");
  }
  return normalized;
};

const parseOptionalPence = (value: number | undefined, field: string, fallback = 0) => {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new HttpError(400, `${field} must be a non-negative integer`, "INVALID_WEB_ORDER");
  }
  return value;
};

const parsePositiveInt = (value: number | undefined, field: string) => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new HttpError(400, `${field} must be a positive integer`, "INVALID_WEB_ORDER");
  }
  return value;
};

const parseOptionalDate = (value: string | undefined, field: string) => {
  if (value === undefined) {
    return new Date();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, `${field} must be a valid ISO date string`, "INVALID_WEB_ORDER");
  }
  return parsed;
};

const parseUuidOrUndefined = (value: string | undefined, field: string) => {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return undefined;
  }
  if (!UUID_REGEX.test(normalized)) {
    throw new HttpError(400, `${field} must be a valid UUID`, "INVALID_WEB_ORDER");
  }
  return normalized;
};

const parseEntityIdOrUndefined = (value: string | undefined, field: string) => {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return undefined;
  }
  if (normalized.length > 64) {
    throw new HttpError(400, `${field} must be 64 characters or fewer`, "INVALID_WEB_ORDER");
  }
  return normalized;
};

const parseRequiredUuid = (value: string, field: string, code: string) => {
  const normalized = normalizeOptionalText(value);
  if (!normalized || !UUID_REGEX.test(normalized)) {
    throw new HttpError(400, `${field} must be a valid UUID`, code);
  }
  return normalized;
};

const parsePageSize = (value: number | undefined) => {
  if (value === undefined) {
    return DEFAULT_PAGE_SIZE;
  }
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new HttpError(400, `take must be an integer between 1 and ${MAX_PAGE_SIZE}`, "INVALID_FILTER");
  }
  return value;
};

const parseSkip = (value: number | undefined) => {
  if (value === undefined) {
    return 0;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new HttpError(400, "skip must be a non-negative integer", "INVALID_FILTER");
  }
  return value;
};

const humanizeToken = (value: string) =>
  value
    .toLowerCase()
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");

const isShipmentPrintable = (status: WebOrderShipmentStatus) => PRINTABLE_SHIPMENT_STATUSES.has(status);

const buildShipmentApiPath = (shipmentId: string) => `/api/online-store/shipments/${shipmentId}`;

const toShipmentResponse = (shipment: WebOrderShipmentRecord): WebOrderShipmentResponse => ({
  id: shipment.id,
  shipmentNumber: shipment.shipmentNumber,
  status: shipment.status,
  providerKey: shipment.providerKey,
  providerDisplayName: shipment.providerDisplayName,
  providerEnvironment: shipment.providerEnvironment ?? null,
  serviceCode: shipment.serviceCode,
  serviceName: shipment.serviceName,
  trackingNumber: shipment.trackingNumber,
  labelFormat: shipment.labelFormat,
  labelStorageKind: shipment.labelStorageKind,
  labelMimeType: shipment.labelMimeType,
  labelFileName: shipment.labelFileName,
  providerReference: shipment.providerReference ?? null,
  providerShipmentReference: shipment.providerShipmentReference ?? null,
  providerTrackingReference: shipment.providerTrackingReference ?? null,
  providerLabelReference: shipment.providerLabelReference ?? null,
  providerStatus: shipment.providerStatus ?? null,
  providerRefundStatus: shipment.providerRefundStatus ?? null,
  providerMetadata: shipment.providerMetadata ?? null,
  labelGeneratedAt: shipment.labelGeneratedAt,
  providerSyncedAt: shipment.providerSyncedAt ?? null,
  providerSyncError: shipment.providerSyncError ?? null,
  printPreparedAt: shipment.printPreparedAt ?? null,
  printedAt: shipment.printedAt ?? null,
  dispatchedAt: shipment.dispatchedAt ?? null,
  voidRequestedAt: shipment.voidRequestedAt ?? null,
  voidedAt: shipment.voidedAt ?? null,
  reprintCount: shipment.reprintCount,
  createdAt: shipment.createdAt,
  updatedAt: shipment.updatedAt,
  createdByStaffId: shipment.createdByStaffId ?? null,
  labelPayloadPath: `${buildShipmentApiPath(shipment.id)}/label`,
  labelContentPath: `${buildShipmentApiPath(shipment.id)}/label/content`,
  preparePrintPath: `${buildShipmentApiPath(shipment.id)}/prepare-print`,
  printPath: `${buildShipmentApiPath(shipment.id)}/print`,
  recordPrintedPath: `${buildShipmentApiPath(shipment.id)}/record-printed`,
  dispatchPath: `${buildShipmentApiPath(shipment.id)}/dispatch`,
  refreshPath: `${buildShipmentApiPath(shipment.id)}/refresh`,
  cancelPath: `${buildShipmentApiPath(shipment.id)}/cancel`,
  regeneratePath: `${buildShipmentApiPath(shipment.id)}/regenerate`,
});

const toItemResponse = (item: Prisma.WebOrderItemGetPayload<{ select: typeof webOrderItemSelect }>): WebOrderItemResponse => ({
  id: item.id,
  variantId: item.variantId ?? null,
  sku: item.sku ?? null,
  productName: item.productName,
  variantName: item.variantName ?? null,
  quantity: item.quantity,
  unitPricePence: item.unitPricePence,
  lineTotalPence: item.lineTotalPence,
  createdAt: item.createdAt,
});

const toOrderSummary = (order: WebOrderListRecord): WebOrderSummaryResponse => ({
  id: order.id,
  orderNumber: order.orderNumber,
  sourceChannel: order.sourceChannel,
  externalOrderRef: order.externalOrderRef ?? null,
  status: order.status,
  fulfillmentMethod: order.fulfillmentMethod,
  customerId: order.customerId ?? null,
  customerName: order.customerName,
  customerEmail: order.customerEmail,
  customerPhone: order.customerPhone ?? null,
  shippingRecipientName: order.shippingRecipientName,
  shippingPostcode: order.shippingPostcode,
  shippingCountry: order.shippingCountry,
  subtotalPence: order.subtotalPence,
  shippingPricePence: order.shippingPricePence,
  totalPence: order.totalPence,
  placedAt: order.placedAt,
  packedAt: order.packedAt ?? null,
  packedByStaffId: order.packedByStaffId ?? null,
  createdAt: order.createdAt,
  updatedAt: order.updatedAt,
  itemCount: order.items.length,
  itemQuantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
  latestShipment: order.shipments[0] ? toShipmentResponse(order.shipments[0]) : null,
});

const toOrderDetail = (order: WebOrderDetailRecord): WebOrderDetailResponse => ({
  id: order.id,
  orderNumber: order.orderNumber,
  sourceChannel: order.sourceChannel,
  externalOrderRef: order.externalOrderRef ?? null,
  status: order.status,
  fulfillmentMethod: order.fulfillmentMethod,
  customerId: order.customerId ?? null,
  customerName: order.customerName,
  customerEmail: order.customerEmail,
  customerPhone: order.customerPhone ?? null,
  deliveryInstructions: order.deliveryInstructions ?? null,
  shippingRecipientName: order.shippingRecipientName,
  shippingAddressLine1: order.shippingAddressLine1,
  shippingAddressLine2: order.shippingAddressLine2 ?? null,
  shippingCity: order.shippingCity,
  shippingRegion: order.shippingRegion ?? null,
  shippingPostcode: order.shippingPostcode,
  shippingCountry: order.shippingCountry,
  subtotalPence: order.subtotalPence,
  shippingPricePence: order.shippingPricePence,
  totalPence: order.totalPence,
  placedAt: order.placedAt,
  packedAt: order.packedAt ?? null,
  packedByStaffId: order.packedByStaffId ?? null,
  createdAt: order.createdAt,
  updatedAt: order.updatedAt,
  items: order.items.map(toItemResponse),
  shipments: order.shipments.map(toShipmentResponse),
});

const isOrderPacked = (order: { packedAt: Date | null }) => Boolean(order.packedAt);

const canBulkCreateShipmentForOrder = (order: {
  status: WebOrderStatus;
  fulfillmentMethod: WebOrderFulfillmentMethod;
  packedAt: Date | null;
  latestShipment?: { status: WebOrderShipmentStatus } | null;
}) => (
  order.status === "READY_FOR_DISPATCH"
  && order.fulfillmentMethod === "SHIPPING"
  && isOrderPacked(order)
  && !order.latestShipment
);

const canBulkPrintShipmentForOrder = (order: {
  status: WebOrderStatus;
  fulfillmentMethod: WebOrderFulfillmentMethod;
  packedAt: Date | null;
  latestShipment?: {
    status: WebOrderShipmentStatus;
    printedAt: Date | null;
    dispatchedAt: Date | null;
  } | null;
}) => (
  order.status === "READY_FOR_DISPATCH"
  && order.fulfillmentMethod === "SHIPPING"
  && isOrderPacked(order)
  && Boolean(order.latestShipment)
  && isShipmentPrintable(order.latestShipment?.status ?? "VOIDED")
  && order.latestShipment?.status !== "DISPATCHED"
);

const canBulkDispatchShipmentForOrder = (order: {
  status: WebOrderStatus;
  fulfillmentMethod: WebOrderFulfillmentMethod;
  packedAt: Date | null;
  latestShipment?: {
    status: WebOrderShipmentStatus;
    printedAt: Date | null;
    dispatchedAt: Date | null;
  } | null;
}) => getShipmentDispatchEligibility(order, order.latestShipment ?? null).canDispatch;

const parseBulkOrderIds = (orderIds: string[]) => {
  const normalizedIds = orderIds.map((orderId, index) =>
    parseRequiredUuid(orderId, `orderIds[${index}]`, "INVALID_WEB_ORDER_ID"));
  return [...new Set(normalizedIds)];
};

const toBulkShipmentActionResult = (
  order: Pick<WebOrderSummaryResponse, "id" | "orderNumber" | "packedAt" | "latestShipment">,
  outcome: BulkShipmentActionResult["outcome"],
  message: string,
  code: string | null = null,
): BulkShipmentActionResult => ({
  orderId: order.id,
  orderNumber: order.orderNumber,
  outcome,
  code,
  message,
  packedAt: order.packedAt,
  shipmentId: order.latestShipment?.id ?? null,
  trackingNumber: order.latestShipment?.trackingNumber ?? null,
  shipmentStatus: order.latestShipment?.status ?? null,
  printedAt: order.latestShipment?.printedAt ?? null,
  dispatchedAt: order.latestShipment?.dispatchedAt ?? null,
});

const buildDefaultOrderNumber = () => `WEB-${Date.now()}`;

const buildShipFromAddress = async (): Promise<ShippingPartyAddress> => {
  const store = await listStoreInfoSettings();
  return {
    name: store.businessName || store.name || "CorePOS Store",
    addressLine1: store.addressLine1 || "Store address pending",
    addressLine2: store.addressLine2 || null,
    city: store.city || "Local",
    region: store.region || null,
    postcode: store.postcode || "UNKNOWN",
    country: store.country || "United Kingdom",
    phone: store.phone || null,
    email: store.email || null,
  };
};

const loadShipmentCreationPreflight = async (
  tx: Prisma.TransactionClient,
  orderId: string,
) => {
  const order = await tx.webOrder.findUnique({
    where: { id: orderId },
    select: webOrderDetailSelect,
  });

  if (!order) {
    throw new HttpError(404, "Web order not found", "WEB_ORDER_NOT_FOUND");
  }
  if (order.fulfillmentMethod !== "SHIPPING") {
    throw new HttpError(409, "Only shipping web orders can generate shipment labels", "WEB_ORDER_NOT_SHIPPING");
  }
  if (order.status === "CANCELLED") {
    throw new HttpError(409, "Cancelled web orders cannot generate shipment labels", "WEB_ORDER_CANCELLED");
  }
  if (order.status === "DISPATCHED") {
    throw new HttpError(409, "Dispatched web orders cannot generate another active shipment", "WEB_ORDER_ALREADY_DISPATCHED");
  }
  if (!order.packedAt) {
    throw new HttpError(
      409,
      "Mark this web order as packed before creating a shipment label",
      "WEB_ORDER_NOT_PACKED",
    );
  }

  const activeShipment = await tx.webOrderShipment.findFirst({
    where: {
      webOrderId: order.id,
      status: { in: [...ACTIVE_SHIPMENT_STATUSES, "DISPATCHED"] },
    },
    select: { id: true, status: true },
  });

  if (activeShipment) {
    throw new HttpError(409, "An active shipment already exists for this web order", "ACTIVE_SHIPMENT_EXISTS");
  }

  const lastShipment = await tx.webOrderShipment.findFirst({
    where: { webOrderId: order.id },
    orderBy: [{ shipmentNumber: "desc" }],
    select: { shipmentNumber: true },
  });

  return {
    order,
    shipmentNumber: (lastShipment?.shipmentNumber ?? 0) + 1,
  };
};

const resolveVariantsById = async (
  tx: Prisma.TransactionClient,
  inputs: Array<{ variantId?: string }>,
) => {
  const variantIds = [...new Set(inputs.map((item) => parseEntityIdOrUndefined(item.variantId, "items.variantId")).filter(Boolean))] as string[];
  if (variantIds.length === 0) {
    return new Map<string, { sku: string | null; variantName: string; productName: string }>();
  }

  const variants = await tx.variant.findMany({
    where: { id: { in: variantIds } },
    select: {
      id: true,
      sku: true,
      name: true,
      product: {
        select: {
          name: true,
        },
      },
    },
  });

  if (variants.length !== variantIds.length) {
    throw new HttpError(404, "One or more variants were not found", "VARIANT_NOT_FOUND");
  }

  return new Map(variants.map((variant) => [variant.id, {
    sku: variant.sku ?? null,
    variantName: variant.name,
    productName: variant.product.name,
  }]));
};

const buildPrintRequest = (
  order: Pick<WebOrderDetailResponse, "id" | "orderNumber" | "sourceChannel">,
  shipment: WebOrderShipmentResponse,
  document: ShippingLabelDocument,
  printer: ResolvedShipmentPrinter,
  input: Pick<ShippingPrintPreparationInput, "copies">,
): ShipmentPrintRequest => ({
  version: 1,
  intentType: "SHIPMENT_LABEL_PRINT",
  shipmentId: shipment.id,
  orderId: order.id,
  orderNumber: order.orderNumber,
  trackingNumber: shipment.trackingNumber,
  printer: {
    transport: "WINDOWS_LOCAL_AGENT",
    printerId: printer.id,
    printerKey: printer.key,
    printerFamily: printer.printerFamily,
    printerModelHint: printer.printerModelHint,
    printerName: printer.name,
    transportMode: printer.transportMode,
    rawTcpHost: printer.rawTcpHost,
    rawTcpPort: printer.rawTcpPort,
    copies: Number.isInteger(input.copies) && input.copies && input.copies > 0 ? input.copies : 1,
  },
  document,
  metadata: {
    providerKey: shipment.providerKey,
    providerDisplayName: shipment.providerDisplayName,
    serviceCode: shipment.serviceCode,
    serviceName: shipment.serviceName,
    sourceChannel: order.sourceChannel,
  },
});

const isSuccessfulProviderVoidResult = (result: ShippingProviderShipmentLifecycleResult) => {
  const refundStatus = normalizeProviderLifecycleToken(result.providerRefundStatus);
  if (refundStatus && SUCCESSFUL_PROVIDER_VOID_STATUSES.has(refundStatus)) {
    return true;
  }

  return !refundStatus && normalizeProviderLifecycleToken(result.providerStatus) === "CANCELLED";
};

const buildProviderVoidFailureMessage = (result: ShippingProviderShipmentLifecycleResult) => {
  const refundStatus = normalizeProviderLifecycleToken(result.providerRefundStatus);
  if (refundStatus && FAILED_PROVIDER_VOID_STATUSES.has(refundStatus)) {
    if (refundStatus === "NOT_APPLICABLE") {
      return "The courier reported that this shipment cannot be refunded or voided";
    }
    return `The courier rejected the void request (${refundStatus.toLowerCase()})`;
  }

  if (!refundStatus && normalizeProviderLifecycleToken(result.providerStatus) !== "CANCELLED") {
    return "The courier did not confirm that the shipment could be voided";
  }

  return null;
};

const assertShipmentActionable = (shipment: { status: WebOrderShipmentStatus }) => {
  if (shipment.status === "VOID_PENDING") {
    throw new HttpError(
      409,
      "This shipment is waiting for provider void confirmation and cannot be printed or dispatched",
      "SHIPMENT_VOID_PENDING",
    );
  }
  if (!isShipmentPrintable(shipment.status)) {
    throw new HttpError(409, "This shipment is voided and can no longer be used", "SHIPMENT_VOIDED");
  }
};

const getShipmentDispatchEligibility = (
  order: {
    status: WebOrderStatus;
    fulfillmentMethod: WebOrderFulfillmentMethod;
    packedAt: Date | null;
  },
  shipment: {
    status: WebOrderShipmentStatus;
    printedAt: Date | null;
    dispatchedAt: Date | null;
  } | null,
): ShipmentDispatchEligibility => {
  if (!isOrderPacked(order)) {
    return {
      canDispatch: false,
      code: "ORDER_NOT_PACKED",
      message: "Order is not packed yet",
    };
  }
  if (order.fulfillmentMethod !== "SHIPPING") {
    return {
      canDispatch: false,
      code: "WEB_ORDER_NOT_SHIPPING",
      message: "Only shipping orders can be dispatched here",
    };
  }
  if (!shipment) {
    return {
      canDispatch: false,
      code: "WEB_ORDER_SHIPMENT_NOT_FOUND",
      message: "No shipment exists yet",
    };
  }
  if (shipment.dispatchedAt || shipment.status === "DISPATCHED" || order.status === "DISPATCHED") {
    return {
      canDispatch: false,
      code: "SHIPMENT_ALREADY_DISPATCHED",
      message: "Shipment is already dispatched",
    };
  }
  if (order.status !== "READY_FOR_DISPATCH") {
    return {
      canDispatch: false,
      code: order.status === "CANCELLED" ? "WEB_ORDER_CANCELLED" : "INVALID_WEB_ORDER_STATE",
      message: order.status === "CANCELLED" ? "Order is cancelled" : `Order is ${humanizeToken(order.status)}`,
    };
  }
  if (!shipment.printedAt) {
    return {
      canDispatch: false,
      code: "SHIPMENT_NOT_PRINTED",
      message: "Shipment label must be printed before dispatch",
    };
  }
  if (shipment.status === "VOID_PENDING") {
    return {
      canDispatch: false,
      code: "SHIPMENT_VOID_PENDING",
      message: "Shipment is waiting for provider void confirmation",
    };
  }
  if (!isShipmentPrintable(shipment.status)) {
    return {
      canDispatch: false,
      code: "SHIPMENT_VOIDED",
      message: "Shipment is voided and can no longer be dispatched",
    };
  }

  return {
    canDispatch: true,
    code: null,
    message: null,
  };
};

const normalizeDispatchScanValue = (value: string) =>
  normalizeRequiredText(value, "scanValue", 160).toUpperCase();

const matchesDispatchScanValue = (candidate: string | null | undefined, needle: string) =>
  normalizeOptionalText(candidate)?.toUpperCase() === needle;

const toDispatchScanCandidateFromShipment = (
  shipment: WebOrderShipmentScanRecord,
  matchedBy: DispatchScanMatchType,
): DispatchScanCandidateResponse => ({
  orderId: shipment.webOrder.id,
  orderNumber: shipment.webOrder.orderNumber,
  shipmentId: shipment.id,
  trackingNumber: shipment.trackingNumber,
  shipmentStatus: shipment.status,
  dispatchedAt: shipment.dispatchedAt ?? null,
  matchedBy,
});

const toDispatchScanCandidateFromOrder = (
  order: WebOrderListRecord,
  matchedBy: DispatchScanMatchType,
): DispatchScanCandidateResponse => ({
  orderId: order.id,
  orderNumber: order.orderNumber,
  shipmentId: order.shipments[0]?.id ?? null,
  trackingNumber: order.shipments[0]?.trackingNumber ?? null,
  shipmentStatus: order.shipments[0]?.status ?? null,
  dispatchedAt: order.shipments[0]?.dispatchedAt ?? null,
  matchedBy,
});

const assertShipmentCancellable = (shipment: {
  status: WebOrderShipmentStatus;
  dispatchedAt: Date | null;
}) => {
  if (shipment.dispatchedAt) {
    throw new HttpError(409, "Dispatched shipments cannot be voided from CorePOS", "SHIPMENT_ALREADY_DISPATCHED");
  }
  if (shipment.status === "VOID_PENDING") {
    throw new HttpError(
      409,
      "This shipment already has a provider void request in flight. Refresh it instead.",
      "SHIPMENT_VOID_PENDING",
    );
  }
  if (shipment.status === "VOIDED") {
    throw new HttpError(409, "This shipment is already voided", "SHIPMENT_VOIDED");
  }
  if (!CANCELLABLE_SHIPMENT_STATUSES.has(shipment.status)) {
    throw new HttpError(409, "This shipment cannot be voided in its current state", "INVALID_SHIPMENT_STATE");
  }
};

const assertShipmentRegeneratable = (shipment: {
  status: WebOrderShipmentStatus;
  webOrder: {
    status: WebOrderStatus;
    fulfillmentMethod: WebOrderFulfillmentMethod;
  };
}) => {
  if (shipment.webOrder.fulfillmentMethod !== "SHIPPING") {
    throw new HttpError(409, "Only shipping web orders can regenerate shipment labels", "WEB_ORDER_NOT_SHIPPING");
  }
  if (shipment.webOrder.status === "CANCELLED") {
    throw new HttpError(409, "Cancelled web orders cannot regenerate shipment labels", "WEB_ORDER_CANCELLED");
  }
  if (shipment.webOrder.status === "DISPATCHED") {
    throw new HttpError(409, "Dispatched web orders cannot regenerate shipment labels", "WEB_ORDER_ALREADY_DISPATCHED");
  }
  if (shipment.status !== "VOIDED") {
    throw new HttpError(
      409,
      "Only voided shipments can generate a replacement shipment label",
      "SHIPMENT_REGENERATION_NOT_ALLOWED",
    );
  }
};

const assertWebOrderPackable = (order: {
  status: WebOrderStatus;
  fulfillmentMethod: WebOrderFulfillmentMethod;
}) => {
  if (order.fulfillmentMethod !== "SHIPPING") {
    throw new HttpError(409, "Only shipping web orders use the packing workflow", "WEB_ORDER_NOT_SHIPPING");
  }
  if (order.status === "CANCELLED") {
    throw new HttpError(409, "Cancelled web orders cannot be marked as packed", "WEB_ORDER_CANCELLED");
  }
  if (order.status === "DISPATCHED") {
    throw new HttpError(409, "Dispatched web orders cannot be changed back into the packing queue", "WEB_ORDER_ALREADY_DISPATCHED");
  }
};

const getOrderOrThrow = async (orderId: string) => {
  const order = await prisma.webOrder.findUnique({
    where: { id: parseRequiredUuid(orderId, "orderId", "INVALID_WEB_ORDER_ID") },
    select: webOrderDetailSelect,
  });

  if (!order) {
    throw new HttpError(404, "Web order not found", "WEB_ORDER_NOT_FOUND");
  }

  return order;
};

const getOrderSummaryOrThrow = async (orderId: string) => {
  const order = await prisma.webOrder.findUnique({
    where: { id: parseRequiredUuid(orderId, "orderId", "INVALID_WEB_ORDER_ID") },
    select: webOrderListSelect,
  });

  if (!order) {
    throw new HttpError(404, "Web order not found", "WEB_ORDER_NOT_FOUND");
  }

  return order;
};

const getShipmentWithOrderOrThrow = async (shipmentId: string) => {
  const normalizedId = parseRequiredUuid(shipmentId, "shipmentId", "INVALID_WEB_ORDER_SHIPMENT_ID");
  const shipment = await prisma.webOrderShipment.findUnique({
    where: { id: normalizedId },
    select: webOrderShipmentWithOrderAndContentSelect,
  });

  if (!shipment) {
    throw new HttpError(404, "Web order shipment not found", "WEB_ORDER_SHIPMENT_NOT_FOUND");
  }

  return shipment;
};

export const listOnlineStoreOrders = async (input: {
  q?: string;
  status?: WebOrderStatus;
  packed?: boolean;
  take?: number;
  skip?: number;
} = {}) => {
  const take = parsePageSize(input.take);
  const skip = parseSkip(input.skip);
  const q = normalizeOptionalText(input.q);

  const where: Prisma.WebOrderWhereInput = {};

  if (input.status) {
    where.status = input.status;
  }
  if (input.packed === true) {
    where.packedAt = { not: null };
  } else if (input.packed === false) {
    where.packedAt = null;
  }

  if (q) {
    where.OR = [
      { orderNumber: { contains: q, mode: "insensitive" } },
      { customerName: { contains: q, mode: "insensitive" } },
      { customerEmail: { contains: q, mode: "insensitive" } },
      { externalOrderRef: { contains: q, mode: "insensitive" } },
      {
        shipments: {
          some: {
            trackingNumber: { contains: q, mode: "insensitive" },
          },
        },
      },
    ];
  }

  const [orders, total, providerSettings] = await Promise.all([
    prisma.webOrder.findMany({
      where,
      select: webOrderListSelect,
      orderBy: [{ placedAt: "desc" }, { createdAt: "desc" }],
      take,
      skip,
    }),
    prisma.webOrder.count({ where }),
    listShippingProviderSettings(),
  ]);

  const mappedOrders = orders.map(toOrderSummary);

  return {
    filters: {
      q: q ?? null,
      status: input.status ?? null,
      packed: input.packed ?? null,
      take,
      skip,
    },
    summary: {
      total,
      readyForDispatchCount: mappedOrders.filter((order) => order.status === "READY_FOR_DISPATCH").length,
      packedCount: mappedOrders.filter((order) => Boolean(order.packedAt)).length,
      packedWithoutShipmentCount: mappedOrders.filter((order) => canBulkCreateShipmentForOrder(order)).length,
      labelReadyCount: mappedOrders.filter((order) =>
        order.latestShipment
        && (order.latestShipment.status === "LABEL_READY" || order.latestShipment.status === "PRINT_PREPARED")).length,
      readyToDispatchCount: mappedOrders.filter((order) => canBulkDispatchShipmentForOrder(order)).length,
      dispatchedCount: mappedOrders.filter((order) => order.status === "DISPATCHED").length,
    },
    supportedProviders: providerSettings.providers,
    orders: mappedOrders,
  };
};

export const getOnlineStoreOrderDetail = async (orderId: string) => {
  const [order, providerSettings] = await Promise.all([
    getOrderOrThrow(orderId),
    listShippingProviderSettings(),
  ]);
  return {
    order: toOrderDetail(order),
    supportedProviders: providerSettings.providers,
  };
};

export const lookupDispatchScan = async (scanValue: string): Promise<DispatchScanLookupResponse> => {
  const normalizedValue = normalizeDispatchScanValue(scanValue);

  const [shipments, orders] = await Promise.all([
    prisma.webOrderShipment.findMany({
      where: {
        OR: [
          { trackingNumber: { equals: normalizedValue, mode: "insensitive" } },
          { providerTrackingReference: { equals: normalizedValue, mode: "insensitive" } },
          { providerShipmentReference: { equals: normalizedValue, mode: "insensitive" } },
          { providerReference: { equals: normalizedValue, mode: "insensitive" } },
        ],
      },
      select: webOrderShipmentScanSelect,
      orderBy: [{ createdAt: "desc" }],
    }),
    prisma.webOrder.findMany({
      where: {
        OR: [
          { orderNumber: { equals: normalizedValue, mode: "insensitive" } },
          { externalOrderRef: { equals: normalizedValue, mode: "insensitive" } },
        ],
      },
      select: webOrderListSelect,
      orderBy: [{ placedAt: "desc" }, { createdAt: "desc" }],
    }),
  ]);

  const matchers: Array<{
    matchedBy: DispatchScanMatchType;
    candidates: DispatchScanCandidateResponse[];
    matchedOrder?: WebOrderListRecord;
    matchedShipment?: WebOrderShipmentRecord | null;
  }> = [
    {
      matchedBy: "TRACKING_NUMBER",
      candidates: shipments
        .filter((shipment) => matchesDispatchScanValue(shipment.trackingNumber, normalizedValue))
        .map((shipment) => toDispatchScanCandidateFromShipment(shipment, "TRACKING_NUMBER")),
      matchedOrder: shipments.find((shipment) => matchesDispatchScanValue(shipment.trackingNumber, normalizedValue))?.webOrder,
      matchedShipment: shipments.find((shipment) => matchesDispatchScanValue(shipment.trackingNumber, normalizedValue)) ?? null,
    },
    {
      matchedBy: "PROVIDER_TRACKING_REFERENCE",
      candidates: shipments
        .filter((shipment) => matchesDispatchScanValue(shipment.providerTrackingReference, normalizedValue))
        .map((shipment) => toDispatchScanCandidateFromShipment(shipment, "PROVIDER_TRACKING_REFERENCE")),
      matchedOrder: shipments.find((shipment) => matchesDispatchScanValue(shipment.providerTrackingReference, normalizedValue))?.webOrder,
      matchedShipment: shipments.find((shipment) => matchesDispatchScanValue(shipment.providerTrackingReference, normalizedValue)) ?? null,
    },
    {
      matchedBy: "PROVIDER_SHIPMENT_REFERENCE",
      candidates: shipments
        .filter((shipment) => matchesDispatchScanValue(shipment.providerShipmentReference, normalizedValue))
        .map((shipment) => toDispatchScanCandidateFromShipment(shipment, "PROVIDER_SHIPMENT_REFERENCE")),
      matchedOrder: shipments.find((shipment) => matchesDispatchScanValue(shipment.providerShipmentReference, normalizedValue))?.webOrder,
      matchedShipment: shipments.find((shipment) => matchesDispatchScanValue(shipment.providerShipmentReference, normalizedValue)) ?? null,
    },
    {
      matchedBy: "PROVIDER_REFERENCE",
      candidates: shipments
        .filter((shipment) => matchesDispatchScanValue(shipment.providerReference, normalizedValue))
        .map((shipment) => toDispatchScanCandidateFromShipment(shipment, "PROVIDER_REFERENCE")),
      matchedOrder: shipments.find((shipment) => matchesDispatchScanValue(shipment.providerReference, normalizedValue))?.webOrder,
      matchedShipment: shipments.find((shipment) => matchesDispatchScanValue(shipment.providerReference, normalizedValue)) ?? null,
    },
    {
      matchedBy: "ORDER_NUMBER",
      candidates: orders
        .filter((order) => matchesDispatchScanValue(order.orderNumber, normalizedValue))
        .map((order) => toDispatchScanCandidateFromOrder(order, "ORDER_NUMBER")),
      matchedOrder: orders.find((order) => matchesDispatchScanValue(order.orderNumber, normalizedValue)),
      matchedShipment: orders.find((order) => matchesDispatchScanValue(order.orderNumber, normalizedValue))?.shipments[0] ?? null,
    },
    {
      matchedBy: "EXTERNAL_ORDER_REFERENCE",
      candidates: orders
        .filter((order) => matchesDispatchScanValue(order.externalOrderRef, normalizedValue))
        .map((order) => toDispatchScanCandidateFromOrder(order, "EXTERNAL_ORDER_REFERENCE")),
      matchedOrder: orders.find((order) => matchesDispatchScanValue(order.externalOrderRef, normalizedValue)),
      matchedShipment: orders.find((order) => matchesDispatchScanValue(order.externalOrderRef, normalizedValue))?.shipments[0] ?? null,
    },
  ];

  const firstResolvedMatch = matchers.find((matcher) => matcher.candidates.length > 0);
  if (!firstResolvedMatch) {
    return {
      status: "NO_MATCH",
      scanValue,
      normalizedValue,
      matchedBy: null,
      dispatchable: false,
      dispatchBlockedCode: null,
      dispatchBlockedReason: "No web-order shipment matched that scan value.",
      order: null,
      shipment: null,
      candidates: [],
    };
  }

  if (firstResolvedMatch.candidates.length > 1 || !firstResolvedMatch.matchedOrder) {
    return {
      status: "AMBIGUOUS",
      scanValue,
      normalizedValue,
      matchedBy: firstResolvedMatch.matchedBy,
      dispatchable: false,
      dispatchBlockedCode: "DISPATCH_SCAN_AMBIGUOUS",
      dispatchBlockedReason: "More than one web order matched this scan value. Narrow the identifier before dispatch.",
      order: null,
      shipment: null,
      candidates: firstResolvedMatch.candidates,
    };
  }

  const matchedOrder = toOrderSummary(firstResolvedMatch.matchedOrder);
  const matchedShipment = firstResolvedMatch.matchedShipment ? toShipmentResponse(firstResolvedMatch.matchedShipment) : null;
  const eligibility = getShipmentDispatchEligibility(matchedOrder, matchedShipment);

  return {
    status: "MATCHED",
    scanValue,
    normalizedValue,
    matchedBy: firstResolvedMatch.matchedBy,
    dispatchable: eligibility.canDispatch,
    dispatchBlockedCode: eligibility.code,
    dispatchBlockedReason: eligibility.message,
    order: matchedOrder,
    shipment: matchedShipment,
    candidates: firstResolvedMatch.candidates,
  };
};

export const createOnlineStoreOrder = async (input: CreateWebOrderInput, auditActor?: AuditActor) => {
  const items = Array.isArray(input.items) ? input.items : [];
  if (items.length === 0) {
    throw new HttpError(400, "items must include at least one line", "INVALID_WEB_ORDER");
  }

  const fulfillmentMethod = input.fulfillmentMethod ?? "SHIPPING";
  if (fulfillmentMethod !== "SHIPPING" && fulfillmentMethod !== "CLICK_AND_COLLECT") {
    throw new HttpError(400, "fulfillmentMethod must be SHIPPING or CLICK_AND_COLLECT", "INVALID_WEB_ORDER");
  }

  const order = await prisma.$transaction(async (tx) => {
    const customerId = parseUuidOrUndefined(input.customerId, "customerId") ?? null;
    if (customerId) {
      const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { id: true } });
      if (!customer) {
        throw new HttpError(404, "Customer not found", "CUSTOMER_NOT_FOUND");
      }
    }

    const variantsById = await resolveVariantsById(tx, items);
    const normalizedItems = items.map((item, index) => {
      const variantId = parseEntityIdOrUndefined(item.variantId, `items[${index}].variantId`);
      const variantRecord = variantId ? variantsById.get(variantId) : undefined;
      const quantity = parsePositiveInt(item.quantity, `items[${index}].quantity`);
      const unitPricePence = parseOptionalPence(item.unitPricePence, `items[${index}].unitPricePence`);
      const productName = normalizeRequiredText(
        item.productName ?? variantRecord?.productName,
        `items[${index}].productName`,
      );
      const variantName = normalizeOptionalLimitedText(
        item.variantName ?? variantRecord?.variantName,
        `items[${index}].variantName`,
      );
      const sku = normalizeOptionalLimitedText(item.sku ?? variantRecord?.sku ?? null, `items[${index}].sku`, 64);

      return {
        variantId: variantId ?? null,
        sku,
        productName,
        variantName,
        quantity,
        unitPricePence,
        lineTotalPence: quantity * unitPricePence,
      };
    });

    const subtotalPence = normalizedItems.reduce((sum, item) => sum + item.lineTotalPence, 0);
    const shippingPricePence = parseOptionalPence(input.shippingPricePence, "shippingPricePence", 0);
    const orderNumber = normalizeOptionalLimitedText(input.orderNumber, "orderNumber", 64) ?? buildDefaultOrderNumber();
    const customerName = normalizeRequiredText(input.customerName, "customerName");
    const customerEmail = normalizeEmail(input.customerEmail, "customerEmail");
    const customerPhone = normalizeOptionalLimitedText(input.customerPhone, "customerPhone", 64);
    const deliveryInstructions = normalizeOptionalLimitedText(input.deliveryInstructions, "deliveryInstructions", 400);
    const shippingRecipientName = normalizeRequiredText(
      input.shippingRecipientName ?? customerName,
      "shippingRecipientName",
    );
    const shippingAddressLine1 = normalizeRequiredText(input.shippingAddressLine1, "shippingAddressLine1");
    const shippingAddressLine2 = normalizeOptionalLimitedText(input.shippingAddressLine2, "shippingAddressLine2");
    const shippingCity = normalizeRequiredText(input.shippingCity, "shippingCity", 120);
    const shippingRegion = normalizeOptionalLimitedText(input.shippingRegion, "shippingRegion", 120);
    const shippingPostcode = normalizeRequiredText(input.shippingPostcode, "shippingPostcode", 32).toUpperCase();
    const shippingCountry = normalizeRequiredText(input.shippingCountry, "shippingCountry", 80);
    const sourceChannel = normalizeOptionalLimitedText(input.sourceChannel, "sourceChannel", 64) ?? "INTERNAL_MOCK_WEB_STORE";
    const externalOrderRef = normalizeOptionalLimitedText(input.externalOrderRef, "externalOrderRef", 80);
    const placedAt = parseOptionalDate(input.placedAt, "placedAt");

    const created = await tx.webOrder.create({
      data: {
        orderNumber,
        sourceChannel,
        externalOrderRef,
        status: "READY_FOR_DISPATCH",
        fulfillmentMethod,
        customerId,
        customerName,
        customerEmail,
        customerPhone,
        deliveryInstructions,
        shippingRecipientName,
        shippingAddressLine1,
        shippingAddressLine2,
        shippingCity,
        shippingRegion,
        shippingPostcode,
        shippingCountry,
        subtotalPence,
        shippingPricePence,
        totalPence: subtotalPence + shippingPricePence,
        placedAt,
        createdByStaffId: auditActor?.actorId ?? null,
        items: {
          create: normalizedItems,
        },
      },
      select: webOrderDetailSelect,
    });

    await createAuditEventTx(
      tx,
      {
        action: "WEB_ORDER_CREATED",
        entityType: "WEB_ORDER",
        entityId: created.id,
        metadata: {
          orderNumber: created.orderNumber,
          sourceChannel: created.sourceChannel,
          fulfillmentMethod: created.fulfillmentMethod,
          itemCount: created.items.length,
          totalPence: created.totalPence,
        },
      },
      auditActor,
    );

    return created;
  });

  logOperationalEvent("online_store.order.created", {
    entityId: order.id,
    orderNumber: order.orderNumber,
    fulfillmentMethod: order.fulfillmentMethod,
  });

  return { order: toOrderDetail(order) };
};

export const setWebOrderPackedState = async (
  orderId: string,
  input: SetWebOrderPackedInput,
  auditActor?: AuditActor,
) => {
  const normalizedOrderId = parseRequiredUuid(orderId, "orderId", "INVALID_WEB_ORDER_ID");

  const order = await prisma.$transaction(async (tx) => {
    const existing = await tx.webOrder.findUnique({
      where: { id: normalizedOrderId },
      select: webOrderDetailSelect,
    });

    if (!existing) {
      throw new HttpError(404, "Web order not found", "WEB_ORDER_NOT_FOUND");
    }

    assertWebOrderPackable(existing);

    const shouldPack = input.packed === true;
    const alreadyPacked = isOrderPacked(existing);
    if (shouldPack === alreadyPacked) {
      return existing;
    }
    if (!shouldPack && existing.shipments[0] && existing.shipments[0].status !== "VOIDED") {
      throw new HttpError(
        409,
        "Orders with an active shipment stay in the packed queue. Void or dispatch the shipment first if the workflow has changed.",
        "WEB_ORDER_PACKING_LOCKED",
      );
    }

    const saved = await tx.webOrder.update({
      where: { id: existing.id },
      data: {
        packedAt: shouldPack ? new Date() : null,
        packedByStaffId: shouldPack ? (auditActor?.actorId ?? null) : null,
      },
      select: webOrderDetailSelect,
    });

    await createAuditEventTx(
      tx,
      {
        action: shouldPack ? "WEB_ORDER_PACKED" : "WEB_ORDER_UNPACKED",
        entityType: "WEB_ORDER",
        entityId: saved.id,
        metadata: {
          orderNumber: saved.orderNumber,
          packedAt: saved.packedAt?.toISOString() ?? null,
          packedByStaffId: saved.packedByStaffId ?? null,
        },
      },
      auditActor,
    );

    return saved;
  });

  logOperationalEvent(input.packed ? "online_store.order.packed" : "online_store.order.unpacked", {
    entityId: order.id,
    orderNumber: order.orderNumber,
    packedAt: order.packedAt?.toISOString() ?? null,
  });

  return { order: toOrderDetail(order) };
};

const buildBulkOperationSummary = (requestedCount: number, results: BulkShipmentActionResult[]) => ({
  requestedCount,
  processedCount: results.filter((result) => result.outcome !== "SKIPPED").length,
  succeededCount: results.filter((result) => result.outcome === "SUCCEEDED").length,
  failedCount: results.filter((result) => result.outcome === "FAILED").length,
  skippedCount: results.filter((result) => result.outcome === "SKIPPED").length,
});

const toUnknownBulkResult = (
  orderId: string,
  message: string,
  code: string | null = null,
): BulkShipmentActionResult => ({
  orderId,
  orderNumber: "Unknown order",
  outcome: "FAILED",
  code,
  message,
  packedAt: null,
  shipmentId: null,
  trackingNumber: null,
  shipmentStatus: null,
  printedAt: null,
  dispatchedAt: null,
});

const getBulkOrderSummaries = async (orderIds: string[]) => {
  const orders = await prisma.webOrder.findMany({
    where: { id: { in: orderIds } },
    select: webOrderListSelect,
  });

  return new Map(orders.map((order) => [order.id, toOrderSummary(order)]));
};

export const bulkCreateShipmentLabels = async (
  input: BulkCreateShipmentsInput,
  auditActor?: AuditActor,
): Promise<BulkShipmentOperationResponse> => {
  const orderIds = parseBulkOrderIds(input.orderIds);
  if (orderIds.length === 0) {
    throw new HttpError(400, "orderIds must include at least one web order", "INVALID_WEB_ORDER");
  }

  await resolveShippingProviderForShipment(normalizeOptionalText(input.providerKey) ?? null);

  const ordersById = await getBulkOrderSummaries(orderIds);
  const results: BulkShipmentActionResult[] = [];

  for (const orderId of orderIds) {
    const order = ordersById.get(orderId);
    if (!order) {
      results.push(toUnknownBulkResult(orderId, "Web order not found", "WEB_ORDER_NOT_FOUND"));
      continue;
    }

    if (!canBulkCreateShipmentForOrder(order)) {
      results.push(
        toBulkShipmentActionResult(
          order,
          "SKIPPED",
          !isOrderPacked(order)
            ? "Order is not packed yet"
            : order.fulfillmentMethod !== "SHIPPING"
              ? "Only shipping orders can create shipment labels"
              : order.status !== "READY_FOR_DISPATCH"
                ? `Order is ${humanizeToken(order.status)}`
                : "An active shipment already exists",
          !isOrderPacked(order)
            ? "ORDER_NOT_PACKED"
            : order.fulfillmentMethod !== "SHIPPING"
              ? "WEB_ORDER_NOT_SHIPPING"
              : order.status !== "READY_FOR_DISPATCH"
                ? "INVALID_WEB_ORDER_STATE"
                : "ACTIVE_SHIPMENT_EXISTS",
        ),
      );
      continue;
    }

    try {
      const created = await createShipmentLabelForOrder(order.id, input, auditActor);
      const refreshedOrder = await getOrderSummaryOrThrow(order.id);
      results.push(
        toBulkShipmentActionResult(
          toOrderSummary(refreshedOrder),
          "SUCCEEDED",
          `Shipment ${created.shipment.trackingNumber} created`,
        ),
      );
    } catch (error) {
      const latestOrder = await getOrderSummaryOrThrow(order.id).catch(() => null);
      const latestSummary = latestOrder ? toOrderSummary(latestOrder) : order;
      results.push(
        toBulkShipmentActionResult(
          latestSummary,
          "FAILED",
          error instanceof Error ? error.message : "Shipment creation failed",
          error instanceof HttpError ? error.code : "WEB_ORDER_SHIPMENT_FAILED",
        ),
      );
    }
  }

  const summary = buildBulkOperationSummary(orderIds.length, results);
  logOperationalEvent("online_store.bulk_create_shipments.completed", {
    requestedCount: summary.requestedCount,
    succeededCount: summary.succeededCount,
    failedCount: summary.failedCount,
    skippedCount: summary.skippedCount,
  });

  return {
    action: "CREATE_SHIPMENTS",
    summary,
    results,
  };
};

export const bulkPrintShipmentLabels = async (
  input: BulkPrintShipmentsInput,
  auditActor?: AuditActor,
): Promise<BulkShipmentOperationResponse> => {
  const orderIds = parseBulkOrderIds(input.orderIds);
  if (orderIds.length === 0) {
    throw new HttpError(400, "orderIds must include at least one web order", "INVALID_WEB_ORDER");
  }

  await resolveShipmentLabelPrinterSelection({
    printerId: input.printerId ?? null,
    printerKey: input.printerKey ?? null,
  });

  const ordersById = await getBulkOrderSummaries(orderIds);
  const results: BulkShipmentActionResult[] = [];

  for (const orderId of orderIds) {
    const order = ordersById.get(orderId);
    if (!order) {
      results.push(toUnknownBulkResult(orderId, "Web order not found", "WEB_ORDER_NOT_FOUND"));
      continue;
    }

    if (!canBulkPrintShipmentForOrder(order)) {
      results.push(
        toBulkShipmentActionResult(
          order,
          "SKIPPED",
          !isOrderPacked(order)
            ? "Order is not packed yet"
            : order.fulfillmentMethod !== "SHIPPING"
              ? "Only shipping orders can print shipment labels"
              : order.status !== "READY_FOR_DISPATCH"
                ? `Order is ${humanizeToken(order.status)}`
                : !order.latestShipment
                  ? "No shipment exists yet"
                  : order.latestShipment.status === "DISPATCHED"
                    ? "Shipment is already dispatched"
                    : "Shipment is not in a printable state",
          !isOrderPacked(order)
            ? "ORDER_NOT_PACKED"
            : order.fulfillmentMethod !== "SHIPPING"
              ? "WEB_ORDER_NOT_SHIPPING"
              : order.status !== "READY_FOR_DISPATCH"
                ? "INVALID_WEB_ORDER_STATE"
                : !order.latestShipment
                  ? "WEB_ORDER_SHIPMENT_NOT_FOUND"
                  : order.latestShipment.status === "DISPATCHED"
                    ? "SHIPMENT_ALREADY_DISPATCHED"
                    : "INVALID_SHIPMENT_STATE",
        ),
      );
      continue;
    }

    try {
      const printed = await printShipmentLabelViaAgent(order.latestShipment!.id, input, auditActor);
      const refreshedOrder = await getOrderSummaryOrThrow(order.id);
      results.push(
        toBulkShipmentActionResult(
          toOrderSummary(refreshedOrder),
          "SUCCEEDED",
          printed.shipment.reprintCount > 0
            ? `Shipment ${printed.shipment.trackingNumber} reprinted`
            : `Shipment ${printed.shipment.trackingNumber} printed`,
        ),
      );
    } catch (error) {
      const latestOrder = await getOrderSummaryOrThrow(order.id).catch(() => null);
      const latestSummary = latestOrder ? toOrderSummary(latestOrder) : order;
      results.push(
        toBulkShipmentActionResult(
          latestSummary,
          "FAILED",
          error instanceof Error ? error.message : "Shipment print failed",
          error instanceof HttpError ? error.code : "SHIPPING_PRINT_AGENT_FAILED",
        ),
      );
    }
  }

  const summary = buildBulkOperationSummary(orderIds.length, results);
  logOperationalEvent("online_store.bulk_print_shipments.completed", {
    requestedCount: summary.requestedCount,
    succeededCount: summary.succeededCount,
    failedCount: summary.failedCount,
    skippedCount: summary.skippedCount,
  });

  return {
    action: "PRINT_SHIPMENTS",
    summary,
    results,
  };
};

export const bulkDispatchShipments = async (
  input: BulkDispatchShipmentsInput,
  auditActor?: AuditActor,
): Promise<BulkShipmentOperationResponse> => {
  const orderIds = parseBulkOrderIds(input.orderIds);
  if (orderIds.length === 0) {
    throw new HttpError(400, "orderIds must include at least one web order", "INVALID_WEB_ORDER");
  }

  const ordersById = await getBulkOrderSummaries(orderIds);
  const results: BulkShipmentActionResult[] = [];

  for (const orderId of orderIds) {
    const order = ordersById.get(orderId);
    if (!order) {
      results.push(toUnknownBulkResult(orderId, "Web order not found", "WEB_ORDER_NOT_FOUND"));
      continue;
    }

    const dispatchEligibility = getShipmentDispatchEligibility(order, order.latestShipment ?? null);
    if (!dispatchEligibility.canDispatch) {
      results.push(
        toBulkShipmentActionResult(
          order,
          "SKIPPED",
          dispatchEligibility.message ?? "Shipment is not in a dispatchable state",
          dispatchEligibility.code ?? "INVALID_SHIPMENT_STATE",
        ),
      );
      continue;
    }

    try {
      const dispatched = await dispatchShipment(order.latestShipment!.id, auditActor);
      const refreshedOrder = await getOrderSummaryOrThrow(order.id);
      results.push(
        toBulkShipmentActionResult(
          toOrderSummary(refreshedOrder),
          "SUCCEEDED",
          `Shipment ${dispatched.shipment.trackingNumber} dispatched`,
        ),
      );
    } catch (error) {
      const latestOrder = await getOrderSummaryOrThrow(order.id).catch(() => null);
      const latestSummary = latestOrder ? toOrderSummary(latestOrder) : order;
      results.push(
        toBulkShipmentActionResult(
          latestSummary,
          "FAILED",
          error instanceof Error ? error.message : "Shipment dispatch failed",
          error instanceof HttpError ? error.code : "WEB_ORDER_SHIPMENT_DISPATCH_FAILED",
        ),
      );
    }
  }

  const summary = buildBulkOperationSummary(orderIds.length, results);
  logOperationalEvent("online_store.bulk_dispatch_shipments.completed", {
    requestedCount: summary.requestedCount,
    succeededCount: summary.succeededCount,
    failedCount: summary.failedCount,
    skippedCount: summary.skippedCount,
  });

  return {
    action: "DISPATCH_SHIPMENTS",
    summary,
    results,
  };
};

export const createShipmentLabelForOrder = async (
  orderId: string,
  input: CreateShipmentLabelInput = {},
  auditActor?: AuditActor,
) => {
  const normalizedOrderId = parseRequiredUuid(orderId, "orderId", "INVALID_WEB_ORDER_ID");
  const resolvedProvider = await resolveShippingProviderForShipment(normalizeOptionalText(input.providerKey) ?? null);
  const configuredDefaultServiceCode =
    normalizeOptionalLimitedText(
      resolvedProvider.runtimeConfig?.defaultServiceCode ?? undefined,
      "configuredDefaultServiceCode",
      64,
    ) ?? null;
  const configuredDefaultServiceName =
    normalizeOptionalLimitedText(
      resolvedProvider.runtimeConfig?.defaultServiceName ?? undefined,
      "configuredDefaultServiceName",
      120,
    ) ?? null;
  const requestedServiceCode = normalizeOptionalLimitedText(input.serviceCode, "serviceCode", 64);
  const requestedServiceName = normalizeOptionalLimitedText(input.serviceName, "serviceName", 120);
  const serviceCode = requestedServiceCode ?? configuredDefaultServiceCode ?? DEFAULT_SHIPPING_SERVICE_CODE;
  const serviceName = requestedServiceName
    ?? (requestedServiceCode ? serviceCode : configuredDefaultServiceName)
    ?? DEFAULT_SHIPPING_SERVICE_NAME;
  const shipFrom = await buildShipFromAddress();
  const preflight = await prisma.$transaction((tx) => loadShipmentCreationPreflight(tx, normalizedOrderId));

  const labelResult = await resolvedProvider.provider.createLabel(
    {
      order: {
        id: preflight.order.id,
        orderNumber: preflight.order.orderNumber,
        sourceChannel: preflight.order.sourceChannel,
        placedAt: preflight.order.placedAt,
        customerName: preflight.order.customerName,
        customerEmail: preflight.order.customerEmail,
        shippingRecipient: {
          name: preflight.order.shippingRecipientName,
          addressLine1: preflight.order.shippingAddressLine1,
          addressLine2: preflight.order.shippingAddressLine2,
          city: preflight.order.shippingCity,
          region: preflight.order.shippingRegion,
          postcode: preflight.order.shippingPostcode,
          country: preflight.order.shippingCountry,
          phone: preflight.order.customerPhone ?? null,
          email: preflight.order.customerEmail,
        },
        items: preflight.order.items.map((item) => ({
          sku: item.sku ?? null,
          productName: item.productName,
          variantName: item.variantName ?? null,
          quantity: item.quantity,
        })),
      },
      shipment: {
        shipmentId: `pending-${preflight.order.id}-${preflight.shipmentNumber}`,
        shipmentNumber: preflight.shipmentNumber,
        providerKey: resolvedProvider.providerKey,
        providerDisplayName: resolvedProvider.providerDisplayName,
        providerEnvironment: resolvedProvider.providerEnvironment,
        serviceCode,
        serviceName,
      },
      shipFrom,
    },
    {
      runtimeConfig: resolvedProvider.runtimeConfig,
    },
  );

  const shipment = await prisma.$transaction(async (tx) => {
    const finalPreflight = await loadShipmentCreationPreflight(tx, normalizedOrderId);
    if (finalPreflight.shipmentNumber !== preflight.shipmentNumber) {
      throw new HttpError(
        409,
        "Shipment numbering changed while the courier label was being prepared. Retry shipment creation.",
        "SHIPMENT_CREATION_CONFLICT",
      );
    }

    const finalServiceCode = labelResult.normalizedServiceCode ?? serviceCode;
    const finalServiceName = labelResult.normalizedServiceName ?? serviceName;
    const providerRefundStatus = normalizeProviderLifecycleToken(labelResult.providerRefundStatus);
    const providerSyncedAt = new Date();
    const created = await tx.webOrderShipment.create({
      data: {
        webOrderId: finalPreflight.order.id,
        shipmentNumber: finalPreflight.shipmentNumber,
        status: "LABEL_READY",
        providerKey: resolvedProvider.providerKey,
        providerDisplayName: resolvedProvider.providerDisplayName,
        providerEnvironment: resolvedProvider.providerEnvironment,
        serviceCode: finalServiceCode,
        serviceName: finalServiceName,
        trackingNumber: labelResult.trackingNumber,
        labelFormat: labelResult.document.format,
        labelStorageKind: "INLINE_TEXT",
        labelMimeType: labelResult.document.mimeType,
        labelFileName: labelResult.document.fileName,
        labelContent: labelResult.document.content,
        providerReference: labelResult.providerReference ?? labelResult.providerShipmentReference ?? null,
        providerShipmentReference: labelResult.providerShipmentReference ?? null,
        providerTrackingReference: labelResult.providerTrackingReference ?? null,
        providerLabelReference: labelResult.providerLabelReference ?? null,
        providerStatus: labelResult.providerStatus ?? null,
        providerRefundStatus,
        providerMetadata: (labelResult.providerMetadata ?? null) as Prisma.InputJsonValue | null,
        providerSyncedAt,
        providerSyncError: null,
        createdByStaffId: auditActor?.actorId ?? null,
      },
      select: webOrderShipmentSelect,
    });

    await createAuditEventTx(
      tx,
      {
        action: "WEB_ORDER_SHIPMENT_CREATED",
        entityType: "WEB_ORDER",
        entityId: finalPreflight.order.id,
        metadata: {
          shipmentId: created.id,
          shipmentNumber: created.shipmentNumber,
          providerKey: resolvedProvider.providerKey,
          providerEnvironment: resolvedProvider.providerEnvironment,
          serviceCode: created.serviceCode,
          trackingNumber: created.trackingNumber,
          providerShipmentReference: created.providerShipmentReference,
          providerStatus: created.providerStatus,
          providerRefundStatus: created.providerRefundStatus,
          labelFormat: created.labelFormat,
        },
      },
      auditActor,
    );

    await createAuditEventTx(
      tx,
      {
        action: "WEB_ORDER_SHIPMENT_CREATED",
        entityType: "WEB_ORDER_SHIPMENT",
        entityId: created.id,
        metadata: {
          webOrderId: finalPreflight.order.id,
          orderNumber: finalPreflight.order.orderNumber,
          trackingNumber: created.trackingNumber,
          providerShipmentReference: created.providerShipmentReference,
          providerTrackingReference: created.providerTrackingReference,
        },
      },
      auditActor,
    );

    return created;
  });

  logOperationalEvent("online_store.shipment.created", {
    entityId: shipment.id,
    shipmentId: shipment.id,
    webOrderId: normalizedOrderId,
    trackingNumber: shipment.trackingNumber,
    providerKey: shipment.providerKey,
    providerEnvironment: shipment.providerEnvironment,
    providerShipmentReference: shipment.providerShipmentReference,
  });

  return {
    shipment: toShipmentResponse(shipment),
    supportedProviders: (await listShippingProviderSettings()).providers,
  };
};

export const getShipmentLabelPayload = async (shipmentId: string) => {
  const shipmentWithOrder = await getShipmentWithOrderOrThrow(shipmentId);
  const shipment = toShipmentResponse(shipmentWithOrder);
  const order = toOrderDetail(shipmentWithOrder.webOrder);

  return {
    order,
    shipment,
    document: {
      format: shipment.labelFormat,
      mimeType: shipment.labelMimeType,
      fileName: shipment.labelFileName,
      content: shipmentWithOrder.labelContent,
    } satisfies ShippingLabelDocument,
  };
};

export const refreshShipmentProviderState = async (shipmentId: string, auditActor?: AuditActor) => {
  const shipment = await getShipmentForProviderLifecycleOrThrow(shipmentId);
  const resolvedProvider = await resolveShippingProviderForShipmentLifecycle(shipment.providerKey);
  if (!resolvedProvider.provider.supportsShipmentRefresh || !resolvedProvider.provider.syncShipment) {
    throw new HttpError(
      409,
      `${shipment.providerDisplayName} does not support shipment refresh in CorePOS yet`,
      "SHIPMENT_PROVIDER_REFRESH_UNSUPPORTED",
    );
  }

  try {
    const lifecycleResult = await resolvedProvider.provider.syncShipment(
      buildShipmentLifecycleInput(shipment),
      {
        runtimeConfig: resolvedProvider.runtimeConfig,
      },
    );

    const saved = await applyShipmentLifecycleResult({
      shipmentId: shipment.id,
      lifecycleResult,
      action: "SYNC",
      syncSource: "MANUAL_REFRESH",
      auditActor,
    });
    const savedDetail = await getShipmentWithOrderOrThrow(saved.id);

    logOperationalEvent("online_store.shipment.provider_synced", {
      entityId: savedDetail.id,
      shipmentId: savedDetail.id,
      webOrderId: savedDetail.webOrder.id,
      providerKey: savedDetail.providerKey,
      status: savedDetail.status,
    });

    return {
      order: toOrderDetail(savedDetail.webOrder),
      shipment: toShipmentResponse(savedDetail),
    };
  } catch (error) {
    await persistShipmentLifecycleFailure(shipment.id, "SYNC", error, auditActor);
    throw error;
  }
};

export const cancelShipment = async (shipmentId: string, auditActor?: AuditActor) => {
  const shipment = await getShipmentForProviderLifecycleOrThrow(shipmentId);
  assertShipmentCancellable(shipment);

  const resolvedProvider = await resolveShippingProviderForShipmentLifecycle(shipment.providerKey);
  if (!resolvedProvider.provider.supportsShipmentVoid || !resolvedProvider.provider.voidShipment) {
    throw new HttpError(
      409,
      `${shipment.providerDisplayName} does not support shipment voiding in CorePOS yet`,
      "SHIPMENT_PROVIDER_VOID_UNSUPPORTED",
    );
  }

  try {
    const lifecycleResult = await resolvedProvider.provider.voidShipment(
      buildShipmentLifecycleInput(shipment),
      {
        runtimeConfig: resolvedProvider.runtimeConfig,
      },
    );

    const syncError = buildProviderVoidFailureMessage(lifecycleResult);
    const saved = await applyShipmentLifecycleResult({
      shipmentId: shipment.id,
      lifecycleResult,
      action: "VOID",
      syncSource: "VOID_REQUEST",
      syncError,
      auditActor,
      assertCurrentShipment: assertShipmentCancellable,
    });
    const savedDetail = await getShipmentWithOrderOrThrow(saved.id);

    if (syncError || !isSuccessfulProviderVoidResult(lifecycleResult)) {
      logOperationalEvent("online_store.shipment.void_rejected", {
        entityId: savedDetail.id,
        shipmentId: savedDetail.id,
        webOrderId: savedDetail.webOrder.id,
        providerKey: savedDetail.providerKey,
      });
      throw new HttpError(409, syncError ?? "The courier did not confirm that the shipment was voided", "SHIPMENT_VOID_REJECTED");
    }

    logOperationalEvent("online_store.shipment.void_requested", {
      entityId: savedDetail.id,
      shipmentId: savedDetail.id,
      webOrderId: savedDetail.webOrder.id,
      providerKey: savedDetail.providerKey,
      status: savedDetail.status,
    });

    return {
      order: toOrderDetail(savedDetail.webOrder),
      shipment: toShipmentResponse(savedDetail),
    };
  } catch (error) {
    if (!(error instanceof HttpError && error.code === "SHIPMENT_VOID_REJECTED")) {
      await persistShipmentLifecycleFailure(shipment.id, "VOID", error, auditActor);
    }
    throw error;
  }
};

export const regenerateShipmentLabel = async (shipmentId: string, auditActor?: AuditActor) => {
  const shipment = await prisma.webOrderShipment.findUnique({
    where: { id: parseRequiredUuid(shipmentId, "shipmentId", "INVALID_WEB_ORDER_SHIPMENT_ID") },
    select: {
      ...webOrderShipmentSelect,
      webOrder: {
        select: {
          id: true,
          status: true,
          fulfillmentMethod: true,
        },
      },
    },
  });

  if (!shipment) {
    throw new HttpError(404, "Web order shipment not found", "WEB_ORDER_SHIPMENT_NOT_FOUND");
  }

  assertShipmentRegeneratable(shipment);

  const latestShipment = await prisma.webOrderShipment.findFirst({
    where: { webOrderId: shipment.webOrderId },
    orderBy: [{ shipmentNumber: "desc" }],
    select: { id: true },
  });

  if (!latestShipment || latestShipment.id !== shipment.id) {
    throw new HttpError(
      409,
      "Only the latest shipment can generate a replacement shipment label",
      "SHIPMENT_REGENERATION_NOT_ALLOWED",
    );
  }

  return createShipmentLabelForOrder(
    shipment.webOrderId,
    {
      providerKey: shipment.providerKey,
      serviceCode: shipment.serviceCode,
      serviceName: shipment.serviceName,
    },
    auditActor,
  );
};

export const prepareShipmentLabelPrint = async (
  shipmentId: string,
  input: ShippingPrintPreparationInput = {},
  auditActor?: AuditActor,
) => {
  const normalizedShipmentId = parseRequiredUuid(shipmentId, "shipmentId", "INVALID_WEB_ORDER_SHIPMENT_ID");
  const prepared = await prisma.$transaction(async (tx) => {
    const resolvedPrinter = await resolveShipmentLabelPrinterSelection({
      printerId: input.printerId ?? null,
      printerKey: input.printerKey ?? null,
    }, tx);
    const shipment = await tx.webOrderShipment.findUnique({
      where: { id: normalizedShipmentId },
      select: webOrderShipmentWithOrderAndContentSelect,
    });

    if (!shipment) {
      throw new HttpError(404, "Web order shipment not found", "WEB_ORDER_SHIPMENT_NOT_FOUND");
    }
    assertShipmentActionable(shipment);

    const nextStatus = shipment.status === "LABEL_READY" ? "PRINT_PREPARED" : shipment.status;
    const saved = await tx.webOrderShipment.update({
      where: { id: shipment.id },
      data: {
        status: nextStatus,
        printPreparedAt: new Date(),
      },
      select: webOrderShipmentWithOrderAndContentSelect,
    });

    await createAuditEventTx(
      tx,
        {
          action: "WEB_ORDER_SHIPMENT_PRINT_PREPARED",
          entityType: "WEB_ORDER_SHIPMENT",
          entityId: saved.id,
          metadata: {
            webOrderId: saved.webOrder.id,
            printerId: resolvedPrinter.id,
            printerKey: resolvedPrinter.key,
            printerName: resolvedPrinter.name,
            printerTransportMode: resolvedPrinter.transportMode,
            copies: Number.isInteger(input.copies) && input.copies && input.copies > 0 ? input.copies : 1,
            status: saved.status,
          },
        },
      auditActor,
    );

    return {
      shipment: saved,
      resolvedPrinter,
    };
  });

  const shipment = toShipmentResponse(prepared.shipment);
  const order = toOrderDetail(prepared.shipment.webOrder);
  const document = {
    format: shipment.labelFormat,
    mimeType: shipment.labelMimeType,
    fileName: shipment.labelFileName,
    content: prepared.shipment.labelContent,
  } satisfies ShippingLabelDocument;

  return {
    order,
    shipment,
    printRequest: buildPrintRequest(order, shipment, document, prepared.resolvedPrinter, input),
  };
};

const recordShipmentPrintFailure = async (
  shipmentId: string,
  printRequest: ShipmentPrintRequest,
  error: unknown,
  auditActor?: AuditActor,
) => {
  const normalizedShipmentId = parseRequiredUuid(shipmentId, "shipmentId", "INVALID_WEB_ORDER_SHIPMENT_ID");
  const failureMessage = error instanceof Error ? error.message : String(error);
  const failureCode = error instanceof HttpError ? error.code : "SHIPPING_PRINT_AGENT_FAILED";

  const shipment = await prisma.$transaction(async (tx) => {
    const shipmentRecord = await tx.webOrderShipment.findUnique({
      where: { id: normalizedShipmentId },
      select: {
        id: true,
        webOrderId: true,
        trackingNumber: true,
        status: true,
      },
    });

    if (!shipmentRecord) {
      return null;
    }

    await createAuditEventTx(
      tx,
      {
        action: "WEB_ORDER_SHIPMENT_PRINT_FAILED",
        entityType: "WEB_ORDER_SHIPMENT",
        entityId: shipmentRecord.id,
        metadata: {
          webOrderId: shipmentRecord.webOrderId,
          trackingNumber: shipmentRecord.trackingNumber,
          status: shipmentRecord.status,
          printerId: printRequest.printer.printerId,
          printerKey: printRequest.printer.printerKey,
          printerName: printRequest.printer.printerName,
          copies: printRequest.printer.copies,
          failureCode,
          failureMessage,
        },
      },
      auditActor,
    );

    return shipmentRecord;
  });

  if (shipment) {
    logOperationalEvent("online_store.shipment.print_failed", {
      entityId: shipment.id,
      shipmentId: shipment.id,
      webOrderId: shipment.webOrderId,
      trackingNumber: shipment.trackingNumber,
      failureCode,
    });
  }
};

export const printShipmentLabelViaAgent = async (
  shipmentId: string,
  input: ShippingPrintPreparationInput = {},
  auditActor?: AuditActor,
) => {
  const prepared = await prepareShipmentLabelPrint(shipmentId, input, auditActor);

  try {
    const printAgentResponse = await deliverShipmentPrintRequestToAgent(prepared.printRequest);
    const recorded = await recordShipmentPrinted(
      shipmentId,
      auditActor,
      {
        printRequest: prepared.printRequest,
        printJob: printAgentResponse.job,
      },
    );

    logOperationalEvent("online_store.shipment.print_agent_completed", {
      entityId: recorded.shipment.id,
      shipmentId: recorded.shipment.id,
      webOrderId: prepared.order.id,
      trackingNumber: recorded.shipment.trackingNumber,
      transportMode: printAgentResponse.job.transportMode,
      printerTarget: printAgentResponse.job.printerTarget,
    });

    return {
      order: prepared.order,
      shipment: recorded.shipment,
      printRequest: prepared.printRequest,
      printJob: printAgentResponse.job,
    };
  } catch (error) {
    await recordShipmentPrintFailure(shipmentId, prepared.printRequest, error, auditActor);
    throw error;
  }
};

export const recordShipmentPrinted = async (
  shipmentId: string,
  auditActor?: AuditActor,
  options: RecordShipmentPrintedOptions = {},
) => {
  const normalizedShipmentId = parseRequiredUuid(shipmentId, "shipmentId", "INVALID_WEB_ORDER_SHIPMENT_ID");
  const saved = await prisma.$transaction(async (tx) => {
    const shipment = await tx.webOrderShipment.findUnique({
      where: { id: normalizedShipmentId },
      select: webOrderShipmentSelect,
    });

    if (!shipment) {
      throw new HttpError(404, "Web order shipment not found", "WEB_ORDER_SHIPMENT_NOT_FOUND");
    }
    assertShipmentActionable(shipment);

    const savedShipment = await tx.webOrderShipment.update({
      where: { id: shipment.id },
      data: {
        status: shipment.status === "DISPATCHED" ? shipment.status : "PRINTED",
        printedAt: new Date(),
        reprintCount: shipment.printedAt ? shipment.reprintCount + 1 : shipment.reprintCount,
      },
      select: webOrderShipmentSelect,
    });

    await createAuditEventTx(
      tx,
      {
        action: shipment.printedAt ? "WEB_ORDER_SHIPMENT_REPRINT_RECORDED" : "WEB_ORDER_SHIPMENT_PRINT_RECORDED",
        entityType: "WEB_ORDER_SHIPMENT",
        entityId: savedShipment.id,
        metadata: {
          webOrderId: savedShipment.webOrderId,
          status: savedShipment.status,
          reprintCount: savedShipment.reprintCount,
          printerId: options.printJob?.printerId ?? options.printRequest?.printer.printerId ?? null,
          printerKey: options.printJob?.printerKey ?? options.printRequest?.printer.printerKey ?? null,
          printerName: options.printJob?.printerName ?? options.printRequest?.printer.printerName ?? null,
          printerTarget: options.printJob?.printerTarget ?? null,
          copies: options.printJob?.copies ?? options.printRequest?.printer.copies ?? null,
          transportMode: options.printJob?.transportMode ?? null,
          printJobId: options.printJob?.jobId ?? null,
          simulated: options.printJob?.simulated ?? null,
        },
      },
      auditActor,
    );

    return savedShipment;
  });

  logOperationalEvent("online_store.shipment.print_recorded", {
    entityId: saved.id,
    shipmentId: saved.id,
    webOrderId: saved.webOrderId,
    reprintCount: saved.reprintCount,
  });

  return { shipment: toShipmentResponse(saved) };
};

export const dispatchShipment = async (shipmentId: string, auditActor?: AuditActor) => {
  const normalizedShipmentId = parseRequiredUuid(shipmentId, "shipmentId", "INVALID_WEB_ORDER_SHIPMENT_ID");
  const result = await prisma.$transaction(async (tx) => {
    const shipment = await tx.webOrderShipment.findUnique({
      where: { id: normalizedShipmentId },
      select: {
        ...webOrderShipmentSelect,
        webOrder: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
          },
        },
      },
    });

    if (!shipment) {
      throw new HttpError(404, "Web order shipment not found", "WEB_ORDER_SHIPMENT_NOT_FOUND");
    }
    assertShipmentActionable(shipment);
    if (!shipment.printedAt) {
      throw new HttpError(409, "Shipment label must be printed before dispatch is recorded", "SHIPMENT_NOT_PRINTED");
    }
    if (shipment.dispatchedAt) {
      return shipment;
    }

    const dispatchedAt = new Date();
    const savedShipment = await tx.webOrderShipment.update({
      where: { id: shipment.id },
      data: {
        status: "DISPATCHED",
        dispatchedAt,
      },
      select: {
        ...webOrderShipmentSelect,
        webOrder: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
          },
        },
      },
    });

    await tx.webOrder.update({
      where: { id: savedShipment.webOrder.id },
      data: {
        status: "DISPATCHED",
      },
    });

    await createAuditEventTx(
      tx,
      {
        action: "WEB_ORDER_SHIPMENT_DISPATCHED",
        entityType: "WEB_ORDER_SHIPMENT",
        entityId: savedShipment.id,
        metadata: {
          webOrderId: savedShipment.webOrder.id,
          orderNumber: savedShipment.webOrder.orderNumber,
          trackingNumber: savedShipment.trackingNumber,
          dispatchedAt: dispatchedAt.toISOString(),
        },
      },
      auditActor,
    );

    await createAuditEventTx(
      tx,
      {
        action: "WEB_ORDER_DISPATCHED",
        entityType: "WEB_ORDER",
        entityId: savedShipment.webOrder.id,
        metadata: {
          shipmentId: savedShipment.id,
          trackingNumber: savedShipment.trackingNumber,
        },
      },
      auditActor,
    );

    return savedShipment;
  });

  logOperationalEvent("online_store.shipment.dispatched", {
    entityId: result.id,
    shipmentId: result.id,
    webOrderId: result.webOrder.id,
    trackingNumber: result.trackingNumber,
  });

  return {
    shipment: toShipmentResponse(result),
  };
};
