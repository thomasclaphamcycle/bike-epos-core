import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";
import { SectionHeader } from "../components/ui/SectionHeader";
import { SurfaceCard } from "../components/ui/SurfaceCard";

type WebOrderStatus = "READY_FOR_DISPATCH" | "DISPATCHED" | "CANCELLED";
type WebOrderFulfillmentMethod = "SHIPPING" | "CLICK_AND_COLLECT";
type WebOrderShipmentStatus =
  | "LABEL_READY"
  | "PRINT_PREPARED"
  | "PRINTED"
  | "DISPATCHED"
  | "VOID_PENDING"
  | "VOIDED";

type SupportedShippingProvider = {
  key: string;
  displayName: string;
  mode: "mock" | "integration";
  implementationState: "mock" | "scaffold" | "live";
  requiresConfiguration: boolean;
  supportsShipmentRefresh: boolean;
  supportsShipmentVoid: boolean;
  supportedLabelFormats: string[];
  defaultServiceCode: string;
  defaultServiceName: string;
  isDefaultProvider: boolean;
  isAvailable: boolean;
  configuration: {
    enabled: boolean;
    environment: "SANDBOX" | "LIVE";
    displayName: string | null;
    endpointBaseUrl: string | null;
    accountId: string | null;
    hasApiKey: boolean;
    apiKeyHint: string | null;
    updatedAt: string;
  } | null;
};

type WebOrderShipment = {
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
  providerMetadata: unknown;
  labelGeneratedAt: string;
  providerSyncedAt: string | null;
  providerSyncError: string | null;
  printPreparedAt: string | null;
  printedAt: string | null;
  dispatchedAt: string | null;
  voidRequestedAt: string | null;
  voidedAt: string | null;
  reprintCount: number;
  createdAt: string;
  updatedAt: string;
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

type WebOrderSummary = {
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
  placedAt: string;
  packedAt: string | null;
  packedByStaffId: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  itemQuantity: number;
  latestShipment: WebOrderShipment | null;
};

type WebOrderItem = {
  id: string;
  variantId: string | null;
  sku: string | null;
  productName: string;
  variantName: string | null;
  quantity: number;
  unitPricePence: number;
  lineTotalPence: number;
  createdAt: string;
};

type WebOrderDetail = {
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
  placedAt: string;
  packedAt: string | null;
  packedByStaffId: string | null;
  createdAt: string;
  updatedAt: string;
  items: WebOrderItem[];
  shipments: WebOrderShipment[];
};

type ListOrdersResponse = {
  filters: {
    q: string | null;
    status: WebOrderStatus | null;
    packed: boolean | null;
    take: number;
    skip: number;
  };
  summary: {
    total: number;
    readyForDispatchCount: number;
    packedCount: number;
    packedWithoutShipmentCount: number;
    labelReadyCount: number;
    readyToDispatchCount: number;
    dispatchedCount: number;
  };
  supportedProviders: SupportedShippingProvider[];
  orders: WebOrderSummary[];
};

type OrderDetailResponse = {
  order: WebOrderDetail;
  supportedProviders: SupportedShippingProvider[];
};

type ShipmentLabelPayloadResponse = {
  order: WebOrderDetail;
  shipment: WebOrderShipment;
  document: {
    format: "ZPL";
    mimeType: string;
    fileName: string;
    content: string;
  };
};

type ShipmentPrintRequestResponse = {
  order: WebOrderDetail;
  shipment: WebOrderShipment;
  printRequest: {
    version: 1;
    intentType: "SHIPMENT_LABEL_PRINT";
    shipmentId: string;
    orderId: string;
    orderNumber: string;
    trackingNumber: string;
    printer: {
      transport: "WINDOWS_LOCAL_AGENT";
      printerId: string;
      printerKey: string;
      printerFamily: "ZEBRA_LABEL";
      printerModelHint: string;
      printerName: string;
      transportMode: "DRY_RUN" | "RAW_TCP";
      rawTcpHost: string | null;
      rawTcpPort: number | null;
      copies: number;
    };
    document: {
      format: "ZPL";
      mimeType: string;
      fileName: string;
      content: string;
    };
    metadata: {
      providerKey: string;
      providerDisplayName: string;
      serviceCode: string;
      serviceName: string;
      sourceChannel: string;
    };
  };
};

type ShipmentPrintExecutionResponse = ShipmentPrintRequestResponse & {
  printJob: {
    jobId: string;
    acceptedAt: string;
    completedAt: string;
    transportMode: "DRY_RUN" | "RAW_TCP";
    printerId: string;
    printerKey: string;
    printerName: string;
    printerTarget: string;
    copies: number;
    documentFormat: "ZPL";
    bytesSent: number;
    simulated: boolean;
    outputPath: string | null;
  };
};

type RegisteredPrinter = {
  id: string;
  name: string;
  key: string;
  printerFamily: "ZEBRA_LABEL";
  printerModelHint: "GK420D_OR_COMPATIBLE";
  supportsShippingLabels: boolean;
  isActive: boolean;
  transportMode: "DRY_RUN" | "RAW_TCP";
  rawTcpHost: string | null;
  rawTcpPort: number | null;
  location: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  isDefaultShippingLabelPrinter: boolean;
};

type RegisteredPrinterListResponse = {
  printers: RegisteredPrinter[];
  defaultShippingLabelPrinterId: string | null;
  defaultShippingLabelPrinter: RegisteredPrinter | null;
};

type BulkShipmentActionResult = {
  orderId: string;
  orderNumber: string;
  outcome: "SUCCEEDED" | "FAILED" | "SKIPPED";
  code: string | null;
  message: string;
  packedAt: string | null;
  shipmentId: string | null;
  trackingNumber: string | null;
  shipmentStatus: WebOrderShipmentStatus | null;
  printedAt: string | null;
  dispatchedAt: string | null;
};

type BulkShipmentOperationResponse = {
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

type DispatchScanMatchType =
  | "TRACKING_NUMBER"
  | "PROVIDER_TRACKING_REFERENCE"
  | "PROVIDER_SHIPMENT_REFERENCE"
  | "PROVIDER_REFERENCE"
  | "ORDER_NUMBER"
  | "EXTERNAL_ORDER_REFERENCE";

type DispatchScanCandidate = {
  orderId: string;
  orderNumber: string;
  shipmentId: string | null;
  trackingNumber: string | null;
  shipmentStatus: WebOrderShipmentStatus | null;
  dispatchedAt: string | null;
  matchedBy: DispatchScanMatchType;
};

type DispatchScanLookupResponse = {
  status: "MATCHED" | "NO_MATCH" | "AMBIGUOUS";
  scanValue: string;
  normalizedValue: string;
  matchedBy: DispatchScanMatchType | null;
  dispatchable: boolean;
  dispatchBlockedCode: string | null;
  dispatchBlockedReason: string | null;
  order: WebOrderSummary | null;
  shipment: WebOrderShipment | null;
  candidates: DispatchScanCandidate[];
};

type DispatchScanSessionEntry = {
  id: string;
  scanValue: string;
  outcome: "DISPATCHED" | "READY" | "BLOCKED" | "NO_MATCH" | "AMBIGUOUS";
  orderId: string | null;
  orderNumber: string | null;
  trackingNumber: string | null;
  detail: string;
  timestamp: string;
};

type PackingSessionEntry = {
  id: string;
  orderId: string;
  orderNumber: string;
  outcome: "PACKED" | "UNPACKED";
  detail: string;
  timestamp: string;
};

const formatMoney = (pence: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(pence / 100);

const formatDateTime = (value: string | null | undefined) => {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString();
};

const isSameLocalCalendarDay = (value: string | null | undefined, referenceDate: Date) => {
  if (!value) {
    return false;
  }

  const candidate = new Date(value);
  return candidate.getFullYear() === referenceDate.getFullYear()
    && candidate.getMonth() === referenceDate.getMonth()
    && candidate.getDate() === referenceDate.getDate();
};

const humanizeToken = (value: string) =>
  value
    .toLowerCase()
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");

const isOrderPacked = (order: Pick<WebOrderSummary, "packedAt"> | Pick<WebOrderDetail, "packedAt">) => Boolean(order.packedAt);

const isShipmentVoidBlocked = (shipment: WebOrderShipment | null) =>
  shipment ? shipment.status === "VOIDED" || shipment.status === "VOID_PENDING" : false;

const canBulkCreateShipmentForOrder = (order: WebOrderSummary) =>
  order.status === "READY_FOR_DISPATCH"
  && order.fulfillmentMethod === "SHIPPING"
  && isOrderPacked(order)
  && !order.latestShipment;

const canPackOrderFromSummary = (order: WebOrderSummary) =>
  order.status === "READY_FOR_DISPATCH"
  && order.fulfillmentMethod === "SHIPPING"
  && !isOrderPacked(order);

const canBulkPrintShipmentForOrder = (order: WebOrderSummary) =>
  order.status === "READY_FOR_DISPATCH"
  && order.fulfillmentMethod === "SHIPPING"
  && isOrderPacked(order)
  && Boolean(order.latestShipment)
  && order.latestShipment?.status !== "VOIDED"
  && order.latestShipment?.status !== "VOID_PENDING"
  && order.latestShipment?.status !== "DISPATCHED";

const canBulkDispatchShipmentForOrder = (order: WebOrderSummary) =>
  order.status === "READY_FOR_DISPATCH"
  && order.fulfillmentMethod === "SHIPPING"
  && isOrderPacked(order)
  && Boolean(order.latestShipment?.printedAt)
  && !order.latestShipment?.dispatchedAt
  && order.latestShipment?.status !== "VOIDED"
  && order.latestShipment?.status !== "VOID_PENDING"
  && order.latestShipment?.status !== "DISPATCHED";

const needsCloseoutReviewForOrder = (order: WebOrderSummary) =>
  order.status === "READY_FOR_DISPATCH"
  && order.fulfillmentMethod === "SHIPPING"
  && Boolean(order.latestShipment)
  && !order.latestShipment?.dispatchedAt
  && (
    Boolean(order.latestShipment?.providerSyncError)
    || order.latestShipment?.status === "VOID_PENDING"
    || order.latestShipment?.status === "VOIDED"
  );

const getShipmentRecoveryHint = (shipment: WebOrderShipment) => {
  if (shipment.providerSyncError) {
    return `Provider review needed: ${shipment.providerSyncError}`;
  }
  if (shipment.status === "VOID_PENDING") {
    return "Void pending provider confirmation";
  }
  if (shipment.status === "VOIDED") {
    return "Voided shipment; replacement may be needed";
  }
  return null;
};

const getOrderDispatchQueueHint = (order: WebOrderSummary) => {
  if (order.latestShipment?.dispatchedAt || order.status === "DISPATCHED") {
    return "Dispatched";
  }
  if (order.latestShipment) {
    const recoveryHint = getShipmentRecoveryHint(order.latestShipment);
    if (recoveryHint) {
      return recoveryHint;
    }
  }
  if (order.latestShipment?.printedAt) {
    return "Printed and ready to dispatch";
  }
  if (order.latestShipment?.printPreparedAt) {
    return "Print prepared and waiting for output";
  }
  if (order.latestShipment) {
    return "Label ready, needs print";
  }
  if (isOrderPacked(order)) {
    return "Packed and ready to create shipment";
  }
  return "Needs packing before shipment work";
};

const getDetailNextStep = (order: WebOrderDetail, shipment: WebOrderShipment | null) => {
  if (order.fulfillmentMethod !== "SHIPPING") {
    return {
      title: "Outside shipping flow",
      detail: "Click & collect orders stay outside the shipment-label dispatch bench.",
    };
  }
  if (shipment?.dispatchedAt || order.status === "DISPATCHED") {
    return {
      title: "Dispatch complete",
      detail: "This order has already been confirmed as dispatched. Reprints stay available for audit, but no further bench action is needed.",
    };
  }
  if (!isOrderPacked(order)) {
    return {
      title: "Next: mark packed",
      detail: "Packing is the first gate. Once packed, the order becomes eligible for shipment creation and bulk bench work.",
    };
  }
  if (!shipment) {
    return {
      title: "Next: create shipment",
      detail: "Generate the provider-backed shipment label now that the parcel is packed and ready for dispatch processing.",
    };
  }
  if (shipment.status === "VOID_PENDING") {
    return {
      title: "Next: refresh provider status",
      detail: "This shipment is waiting on the courier void outcome. Refresh it before attempting any further bench action.",
    };
  }
  if (shipment.status === "VOIDED") {
    return {
      title: "Next: regenerate if still shipping",
      detail: "Voided shipments cannot be printed or dispatched. Generate a replacement shipment if the order still needs to go out.",
    };
  }
  if (shipment.providerSyncError) {
    return {
      title: "Next: review provider mismatch",
      detail: `CorePOS kept the shipment available, but the last provider sync needs review: ${shipment.providerSyncError}`,
    };
  }
  if (!shipment.printedAt) {
    return {
      title: "Next: print label",
      detail: "Dispatch remains blocked until the shipment label has been printed through the registered dispatch printer.",
    };
  }
  return {
    title: "Next: confirm dispatch",
    detail: "Once the parcel has physically left the dispatch bench, use Mark Dispatched or the bulk dispatch action to record it explicitly.",
  };
};

const getBulkActionLabel = (action: BulkShipmentOperationResponse["action"]) => {
  switch (action) {
    case "CREATE_SHIPMENTS":
      return "Bulk shipment creation";
    case "PRINT_SHIPMENTS":
      return "Bulk label print";
    case "DISPATCH_SHIPMENTS":
      return "Bulk dispatch confirmation";
    default:
      return "Bulk dispatch action";
  }
};

const getScanSessionOutcomeClassName = (outcome: DispatchScanSessionEntry["outcome"]) => {
  switch (outcome) {
    case "DISPATCHED":
      return "online-orders-scan-session__item online-orders-scan-session__item--success";
    case "READY":
      return "online-orders-scan-session__item online-orders-scan-session__item--ready";
    case "BLOCKED":
    case "AMBIGUOUS":
      return "online-orders-scan-session__item online-orders-scan-session__item--warning";
    case "NO_MATCH":
    default:
      return "online-orders-scan-session__item online-orders-scan-session__item--danger";
  }
};

const getBulkResultGuidance = (result: BulkShipmentOperationResponse | null) => {
  if (!result) {
    return "";
  }
  switch (result.action) {
    case "CREATE_SHIPMENTS":
      return "Skipped rows usually need packing first or already have an active shipment. Printed output still remains a separate next step.";
    case "PRINT_SHIPMENTS":
      return "Printed rows are ready for the final explicit dispatch confirmation step. Failed or skipped rows can be retried from the printable or dispatch-ready queues.";
    case "DISPATCH_SHIPMENTS":
      return "Dispatch confirmation only applies to printed, active shipments. Skipped rows usually still need print, provider recovery, or operator review.";
    default:
      return "";
  }
};

const orderStatusClassName = (status: WebOrderStatus) => {
  switch (status) {
    case "DISPATCHED":
      return "status-badge status-complete";
    case "CANCELLED":
      return "status-badge status-cancelled";
    case "READY_FOR_DISPATCH":
    default:
      return "status-badge status-warning";
  }
};

const shipmentStatusClassName = (status: WebOrderShipmentStatus) => {
  switch (status) {
    case "DISPATCHED":
      return "status-badge status-complete";
    case "PRINTED":
      return "status-badge status-ready";
    case "PRINT_PREPARED":
      return "status-badge status-warning";
    case "VOID_PENDING":
      return "status-badge status-warning";
    case "VOIDED":
      return "status-badge status-cancelled";
    case "LABEL_READY":
    default:
      return "status-badge status-info";
  }
};

type DispatchReadinessState = "ready" | "pending" | "blocked" | "complete";
type DispatchActionKey =
  | "generate"
  | "refresh"
  | "cancel"
  | "regenerate"
  | "prepare-print"
  | "print"
  | "dispatch";

type DispatchReadinessItem = {
  label: string;
  state: DispatchReadinessState;
  headline: string;
  detail: string;
};

type DispatchActionCard = {
  key: DispatchActionKey;
  title: string;
  detail: string;
  enabled: boolean;
};

type ShipmentTimelineEntry = {
  key: string;
  label: string;
  detail: string;
  timestamp: string;
  tone: "default" | "success" | "warning" | "danger";
};

type DispatchRecommendation = {
  title: string;
  detail: string;
};

const readinessClassName = (state: DispatchReadinessState) => {
  switch (state) {
    case "complete":
      return "online-orders-readiness-card online-orders-readiness-card--complete";
    case "ready":
      return "online-orders-readiness-card online-orders-readiness-card--ready";
    case "blocked":
      return "online-orders-readiness-card online-orders-readiness-card--blocked";
    case "pending":
    default:
      return "online-orders-readiness-card online-orders-readiness-card--pending";
  }
};

const timelineToneClassName = (tone: ShipmentTimelineEntry["tone"]) => {
  switch (tone) {
    case "success":
      return "online-orders-timeline__item online-orders-timeline__item--success";
    case "warning":
      return "online-orders-timeline__item online-orders-timeline__item--warning";
    case "danger":
      return "online-orders-timeline__item online-orders-timeline__item--danger";
    case "default":
    default:
      return "online-orders-timeline__item";
  }
};

const getDispatchRecommendation = (
  order: WebOrderDetail | null,
  shipment: WebOrderShipment | null,
  provider: SupportedShippingProvider | null,
  printer: RegisteredPrinter | null,
): DispatchRecommendation => {
  if (!order) {
    return {
      title: "Select an order",
      detail: "Choose a web order to see shipment readiness, operator actions, and recent dispatch activity.",
    };
  }

  if (order.fulfillmentMethod !== "SHIPPING") {
    return {
      title: "No shipping workflow required",
      detail: "This order is click & collect, so the dispatch shipment flow does not apply.",
    };
  }

  if (order.status === "CANCELLED") {
    return {
      title: "Order is cancelled",
      detail: "No further dispatch action is expected unless the order itself is reinstated first.",
    };
  }

  if (!isOrderPacked(order)) {
    return {
      title: "Mark packed before shipment creation",
      detail: "Packing is the first gate for shipping orders. Confirm packing before generating a shipment label or moving this parcel into dispatch-bench work.",
    };
  }

  if (!shipment) {
    return provider?.isAvailable
      ? {
          title: "Generate the first shipment label",
          detail: "Start by creating a provider-backed shipment so CorePOS can store the label and tracking locally.",
        }
      : {
          title: "Configure or choose an available provider",
          detail: "Shipment creation is blocked until the selected provider is available in Settings.",
        };
  }

  if (shipment.status === "VOID_PENDING") {
    return {
      title: "Refresh provider status before doing anything else",
      detail: "A void request is in flight. Printing and dispatch stay blocked until the provider confirms the final outcome.",
    };
  }

  if (shipment.status === "VOIDED") {
    return {
      title: "Generate a replacement shipment when ready",
      detail: "This shipment is no longer active. Create a replacement only if the order still needs to be shipped.",
    };
  }
  if (shipment.providerSyncError) {
    return {
      title: "Review the provider exception before closeout",
      detail: `CorePOS still has a usable shipment record, but the last provider sync reported an issue: ${shipment.providerSyncError}`,
    };
  }

  if (!printer) {
    return {
      title: "Choose a dispatch printer",
      detail: "Printing is the next step, but CorePOS needs an active shipping-label printer selected first.",
    };
  }

  if (!shipment.printPreparedAt) {
    return {
      title: "Prepare the Zebra print payload",
      detail: "This confirms the target printer and lets staff preview the exact backend-owned print contract before sending it.",
    };
  }

  if (!shipment.printedAt) {
    return {
      title: "Print the shipment label",
      detail: "Send the stored ZPL label to the Windows dispatch agent. Dispatch remains blocked until print succeeds.",
    };
  }

  if (!shipment.dispatchedAt) {
    return {
      title: "Mark the parcel dispatched after handoff",
      detail: "The label has been printed. Confirm dispatch only once the parcel has actually left the store.",
    };
  }

  return {
    title: "Shipment workflow complete",
    detail: "This order has already been dispatched. Reprints remain available for operational follow-up if needed.",
  };
};

const getDispatchReadiness = (
  order: WebOrderDetail | null,
  shipment: WebOrderShipment | null,
  provider: SupportedShippingProvider | null,
  printer: RegisteredPrinter | null,
): DispatchReadinessItem[] => {
  const packingItem: DispatchReadinessItem = !order
    ? {
        label: "Packing",
        state: "pending",
        headline: "Select an order",
        detail: "Packing state appears once an order is selected.",
      }
    : order.fulfillmentMethod !== "SHIPPING"
      ? {
          label: "Packing",
          state: "blocked",
          headline: "Not a shipping order",
          detail: "Click & collect orders stay outside the shipping packing queue.",
        }
      : order.status === "CANCELLED"
        ? {
            label: "Packing",
            state: "blocked",
            headline: "Order cancelled",
            detail: "Cancelled orders should not move into shipment packing or dispatch work.",
          }
        : order.status === "DISPATCHED"
          ? {
              label: "Packing",
              state: "complete",
              headline: "Already dispatched",
              detail: "Packing and handoff were completed earlier for this order.",
            }
          : isOrderPacked(order)
            ? {
                label: "Packing",
                state: "complete",
                headline: shipment ? "Packed and handed off" : "Packed and ready",
                detail: shipment
                  ? "Packing is recorded and this order is already in shipment handling."
                  : "Packing is recorded. Shipment creation is now the next bench step.",
              }
            : {
                label: "Packing",
                state: "ready",
                headline: "Needs packing",
                detail: "Confirm packing before shipment creation, bulk creation, or dispatch-bench work.",
              };

  const shipmentItem: DispatchReadinessItem = !order
    ? {
        label: "Shipment",
        state: "pending",
        headline: "Select an order",
        detail: "No dispatch state is available until an order is selected.",
      }
    : order.fulfillmentMethod !== "SHIPPING"
      ? {
          label: "Shipment",
          state: "blocked",
          headline: "Not a shipping order",
          detail: "Click & collect orders do not use the shipment-label flow.",
        }
      : order.status === "CANCELLED"
        ? {
            label: "Shipment",
            state: "blocked",
            headline: "Order cancelled",
            detail: "Shipment creation is blocked because the order itself is cancelled.",
          }
        : !shipment
          ? !isOrderPacked(order)
            ? {
                label: "Shipment",
                state: "blocked",
                headline: "Pack first",
                detail: "Shipment creation stays blocked until packing has been confirmed for this parcel.",
              }
            : provider?.isAvailable
              ? {
                  label: "Shipment",
                  state: "pending",
                  headline: "Ready to create",
                  detail: "Generate the first provider-backed shipment label.",
                }
              : {
                  label: "Shipment",
                  state: "blocked",
                  headline: "Provider not ready",
                  detail: "Choose or configure an available provider before creating a shipment.",
                }
          : shipment.status === "VOID_PENDING"
            ? {
                label: "Shipment",
                state: "pending",
                headline: "Void pending",
                detail: "Refresh the provider outcome before using this shipment again.",
              }
            : shipment.status === "VOIDED"
              ? {
                  label: "Shipment",
                  state: "blocked",
                  headline: "Voided",
                  detail: "This label is no longer active and cannot be printed or dispatched.",
                }
              : shipment.providerSyncError
                ? {
                    label: "Shipment",
                    state: "pending",
                    headline: "Provider review needed",
                    detail: shipment.providerSyncError,
                  }
              : {
                  label: "Shipment",
                  state: "ready",
                  headline: humanizeToken(shipment.status),
                  detail: `${shipment.providerDisplayName} ${shipment.serviceName} · ${shipment.trackingNumber}`,
                };

  const printItem: DispatchReadinessItem = !shipment
    ? {
        label: "Print",
        state: "pending",
        headline: "Waiting for shipment",
        detail: "Create a shipment label before any print action is available.",
      }
    : shipment.status === "VOID_PENDING" || shipment.status === "VOIDED"
      ? {
          label: "Print",
          state: "blocked",
          headline: "Printing blocked",
          detail: "Voided or void-pending shipments stay visible for audit but cannot be treated as active printable labels.",
        }
      : !printer
        ? {
            label: "Print",
            state: "blocked",
            headline: "No printer selected",
            detail: "Choose an active shipping-label printer to prepare or print this label.",
          }
        : shipment.printedAt
          ? {
              label: "Print",
              state: "complete",
              headline: "Printed",
              detail: `Last print recorded ${formatDateTime(shipment.printedAt)}${shipment.reprintCount ? ` · ${shipment.reprintCount} reprints` : ""}`,
            }
          : shipment.printPreparedAt
            ? {
                label: "Print",
                state: "ready",
                headline: "Ready to print",
                detail: `Prepared for ${printer.name} at ${formatDateTime(shipment.printPreparedAt)}.`,
              }
            : {
                label: "Print",
                state: "pending",
                headline: "Prepare payload first",
                detail: `Printer selected: ${printer.name}. Prepare the payload before sending it to the Windows agent.`,
              };

  const dispatchItem: DispatchReadinessItem = !shipment
    ? {
        label: "Dispatch",
        state: "pending",
        headline: "Waiting for shipment",
        detail: "Dispatch stays locked until a shipment exists and a label has been printed.",
      }
    : shipment.dispatchedAt
      ? {
          label: "Dispatch",
          state: "complete",
          headline: "Dispatched",
          detail: `Confirmed at ${formatDateTime(shipment.dispatchedAt)}.`,
        }
      : shipment.status === "VOID_PENDING" || shipment.status === "VOIDED"
        ? {
            label: "Dispatch",
            state: "blocked",
            headline: "Dispatch blocked",
            detail: "CorePOS will not dispatch a shipment that has been voided or is waiting on a void outcome.",
          }
        : shipment.printedAt
          ? {
              label: "Dispatch",
              state: "ready",
              headline: "Ready to dispatch",
              detail: "Mark dispatched once the parcel has actually left the store.",
            }
          : {
              label: "Dispatch",
              state: "blocked",
              headline: "Print required first",
              detail: "Dispatch confirmation only unlocks after a successful print record exists.",
            };

  return [packingItem, shipmentItem, printItem, dispatchItem];
};

const getDispatchActionCards = (
  order: WebOrderDetail | null,
  shipment: WebOrderShipment | null,
  provider: SupportedShippingProvider | null,
  shipmentProvider: SupportedShippingProvider | null,
  printer: RegisteredPrinter | null,
  flags: {
    canGenerateShipment: boolean;
    canRefreshShipment: boolean;
    canCancelShipment: boolean;
    canRegenerateShipment: boolean;
    canPreparePrint: boolean;
    canPrintShipment: boolean;
    canDispatchShipment: boolean;
  },
): DispatchActionCard[] => {
  const cards: DispatchActionCard[] = [
    {
      key: "refresh",
      title: "Refresh provider status",
      detail: !shipment
        ? "Available after a shipment exists."
        : !shipmentProvider?.supportsShipmentRefresh
          ? `${shipment.providerDisplayName} does not currently expose refresh support in CorePOS.`
          : shipment.status === "VOID_PENDING"
            ? "Recommended now: confirm whether the provider void/refund has completed."
            : "Use when provider tracking or void status may have changed since the last sync.",
      enabled: flags.canRefreshShipment,
    },
    {
      key: "cancel",
      title: "Void shipment",
      detail: !shipment
        ? "Available after a shipment exists."
        : !shipmentProvider?.supportsShipmentVoid
          ? `${shipment.providerDisplayName} does not currently support voiding through CorePOS.`
          : shipment.dispatchedAt
            ? "Blocked because the shipment is already dispatched."
            : shipment.status === "VOID_PENDING"
              ? "Blocked until the current void request reaches a final provider outcome."
              : shipment.status === "VOIDED"
                ? "Already voided."
                : "Use only when this exact shipment should no longer be used.",
      enabled: flags.canCancelShipment,
    },
    {
      key: "regenerate",
      title: "Replacement shipment",
      detail: !shipment
        ? "Available after a shipment exists."
        : shipment.status === "VOIDED"
          ? "Ready now. CorePOS will create a new shipment with the same provider and service."
          : "Blocked until the current shipment is fully voided.",
      enabled: flags.canRegenerateShipment,
    },
    {
      key: "prepare-print",
      title: "Prepare print payload",
      detail: !shipment
        ? "Available after a shipment exists."
        : shipment.status === "VOID_PENDING" || shipment.status === "VOIDED"
          ? "Blocked because this shipment is no longer an active printable label."
          : !printer
            ? "Select an active shipping-label printer first."
            : shipment.printPreparedAt
              ? "Use again if you need to confirm a different printer or copy count before reprinting."
              : "First print step. Confirms printer targeting and previewable payload.",
      enabled: flags.canPreparePrint,
    },
    {
      key: "print",
      title: shipment?.printedAt ? "Reprint label" : "Print label",
      detail: !shipment
        ? "Available after a shipment exists."
        : shipment.status === "VOID_PENDING" || shipment.status === "VOIDED"
          ? "Blocked because this shipment is no longer an active printable label."
          : !printer
            ? "Select an active shipping-label printer first."
            : shipment.printedAt
              ? "Safe for operational reprints. Dispatch remains a separate action."
              : "Sends the stored ZPL document through the Windows dispatch agent.",
      enabled: flags.canPrintShipment,
    },
    {
      key: "dispatch",
      title: "Mark dispatched",
      detail: !shipment
        ? "Available after a shipment exists."
        : shipment.dispatchedAt
          ? "Already completed."
          : shipment.status === "VOID_PENDING" || shipment.status === "VOIDED"
            ? "Blocked because the shipment is voided or waiting on a void result."
            : !shipment.printedAt
              ? "Blocked until the label has been printed successfully."
              : "Final step. Use only after the parcel has physically left the store.",
      enabled: flags.canDispatchShipment,
    },
  ];

  if (!shipment) {
    cards.unshift({
      key: "generate",
      title: "Generate shipment",
      detail: !order
        ? "Select an order first."
        : order.fulfillmentMethod !== "SHIPPING"
          ? "Click & collect orders do not create shipping labels."
          : order.status === "CANCELLED"
            ? "Cancelled orders cannot create shipments."
            : !isOrderPacked(order)
              ? "Mark the parcel packed first so shipment creation and bulk bench handoff stay deliberate."
            : !provider?.isAvailable
              ? "Choose or configure an available provider before creating the shipment."
              : "Creates the first active shipment label and stores the result locally in CorePOS.",
      enabled: flags.canGenerateShipment,
    });
  }

  return cards;
};

const buildShipmentTimeline = (shipment: WebOrderShipment | null): ShipmentTimelineEntry[] => {
  if (!shipment) {
    return [];
  }

  const entries: ShipmentTimelineEntry[] = [];
  const pushEntry = (
    key: string,
    label: string,
    detail: string,
    timestamp: string | null | undefined,
    tone: ShipmentTimelineEntry["tone"] = "default",
  ) => {
    if (!timestamp) {
      return;
    }
    entries.push({ key, label, detail, timestamp, tone });
  };

  pushEntry("created", "Shipment created", `${shipment.providerDisplayName} created ${shipment.serviceName}.`, shipment.createdAt);
  pushEntry(
    "label-generated",
    "Label stored",
    `CorePOS stored ${shipment.labelFormat} for ${shipment.trackingNumber}.`,
    shipment.labelGeneratedAt,
  );
  pushEntry(
    "provider-synced",
    "Provider synced",
    shipment.providerStatus
      ? `Latest provider state: ${humanizeToken(shipment.providerStatus)}${shipment.providerRefundStatus ? ` · ${humanizeToken(shipment.providerRefundStatus)}` : ""}.`
      : "Provider status refreshed.",
    shipment.providerSyncedAt,
  );
  if (shipment.providerSyncError) {
    pushEntry(
      "provider-sync-error",
      "Provider sync issue",
      shipment.providerSyncError,
      shipment.providerSyncedAt ?? shipment.updatedAt,
      "danger",
    );
  }
  pushEntry("print-prepared", "Print payload prepared", "Printer targeting was confirmed for this shipment.", shipment.printPreparedAt, "warning");
  pushEntry("printed", shipment.reprintCount ? "Label reprinted" : "Label printed", `Print recorded${shipment.reprintCount ? ` · ${shipment.reprintCount} additional reprints` : ""}.`, shipment.printedAt, "success");
  pushEntry("void-requested", "Void requested", "A provider void/refund request was submitted for this shipment.", shipment.voidRequestedAt, "warning");
  pushEntry("voided", "Shipment voided", "The provider confirmed that this shipment is no longer active.", shipment.voidedAt, "danger");
  pushEntry("dispatched", "Dispatched", "Staff confirmed that the parcel left the store.", shipment.dispatchedAt, "success");

  return entries.sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
};

const getPackingSessionOutcomeClassName = (outcome: PackingSessionEntry["outcome"]) =>
  outcome === "PACKED"
    ? "online-orders-packing-session__item online-orders-packing-session__item--success"
    : "online-orders-packing-session__item online-orders-packing-session__item--warning";

export const OnlineStoreOrdersPage = () => {
  const { error, success } = useToasts();
  const listRequestSequenceRef = useRef(0);
  const detailRequestSequenceRef = useRef(0);
  const labelRequestSequenceRef = useRef(0);
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const shipmentSectionRef = useRef<HTMLElement | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | WebOrderStatus>("");
  const [packedFilter, setPackedFilter] = useState<"" | "packed" | "unpacked">("");
  const [ordersPayload, setOrdersPayload] = useState<ListOrdersResponse | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [detailPayload, setDetailPayload] = useState<OrderDetailResponse | null>(null);
  const [printersPayload, setPrintersPayload] = useState<RegisteredPrinterListResponse | null>(null);
  const [labelPayload, setLabelPayload] = useState<ShipmentLabelPayloadResponse | null>(null);
  const [printPayload, setPrintPayload] = useState<ShipmentPrintRequestResponse | null>(null);
  const [printJob, setPrintJob] = useState<ShipmentPrintExecutionResponse["printJob"] | null>(null);
  const [printNotice, setPrintNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [packingNotice, setPackingNotice] = useState<{ tone: "success" | "warning"; text: string } | null>(null);
  const [packingSession, setPackingSession] = useState<PackingSessionEntry[]>([]);
  const [bulkResult, setBulkResult] = useState<BulkShipmentOperationResponse | null>(null);
  const [scanValue, setScanValue] = useState("");
  const [scanResult, setScanResult] = useState<DispatchScanLookupResponse | null>(null);
  const [scanNotice, setScanNotice] = useState<{ tone: "success" | "warning" | "error"; text: string } | null>(null);
  const [scanSession, setScanSession] = useState<DispatchScanSessionEntry[]>([]);
  const [selectedProviderKey, setSelectedProviderKey] = useState("");
  const [selectedPrinterId, setSelectedPrinterId] = useState("");
  const [copies, setCopies] = useState("1");
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState(false);
  const [loadingPrinters, setLoadingPrinters] = useState(true);
  const [pendingAction, setPendingAction] = useState("");

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 250);

    return () => {
      window.clearTimeout(handle);
    };
  }, [searchInput]);

  const loadOrders = useCallback(async (preferredSelectedOrderId?: string) => {
    const requestSequence = ++listRequestSequenceRef.current;
    setLoadingOrders(true);

    try {
      const params = new URLSearchParams({
        take: "50",
        skip: "0",
      });
      if (searchQuery) {
        params.set("q", searchQuery);
      }
      if (statusFilter) {
        params.set("status", statusFilter);
      }
      if (packedFilter === "packed") {
        params.set("packed", "true");
      } else if (packedFilter === "unpacked") {
        params.set("packed", "false");
      }

      const payload = await apiGet<ListOrdersResponse>(`/api/online-store/orders?${params.toString()}`);
      if (requestSequence !== listRequestSequenceRef.current) {
        return null;
      }

      setOrdersPayload(payload);
      setSelectedOrderIds((current) => current.filter((orderId) => payload.orders.some((order) => order.id === orderId)));
      setSelectedOrderId((current) => {
        const requestedId = preferredSelectedOrderId ?? current;
        if (requestedId && payload.orders.some((order) => order.id === requestedId)) {
          return requestedId;
        }
        return payload.orders[0]?.id ?? "";
      });
      setSelectedProviderKey((current) =>
        current
        || payload.supportedProviders.find((provider) => provider.isDefaultProvider)?.key
        || payload.supportedProviders[0]?.key
        || "");
      return payload;
    } catch (loadError) {
      if (requestSequence === listRequestSequenceRef.current) {
        error(loadError instanceof Error ? loadError.message : "Failed to load online store orders");
      }
      return null;
    } finally {
      if (requestSequence === listRequestSequenceRef.current) {
        setLoadingOrders(false);
      }
    }
  }, [error, packedFilter, searchQuery, statusFilter]);

  const loadOrderDetail = useCallback(async (orderId: string) => {
    if (!orderId) {
      setDetailPayload(null);
      return null;
    }

    const requestSequence = ++detailRequestSequenceRef.current;
    setLoadingDetail(true);

    try {
      const payload = await apiGet<OrderDetailResponse>(`/api/online-store/orders/${encodeURIComponent(orderId)}`);
      if (requestSequence !== detailRequestSequenceRef.current) {
        return null;
      }

      setDetailPayload(payload);
      setSelectedProviderKey((current) => {
        const shipmentProviderKey = payload.order.shipments[0]?.providerKey;
        const supportedKeys = new Set(payload.supportedProviders.map((provider) => provider.key));
        if (shipmentProviderKey && supportedKeys.has(shipmentProviderKey)) {
          return shipmentProviderKey;
        }
        if (current && supportedKeys.has(current)) {
          return current;
        }
        return payload.supportedProviders.find((provider) => provider.isDefaultProvider)?.key
          || payload.supportedProviders[0]?.key
          || "";
      });
      return payload;
    } catch (loadError) {
      if (requestSequence === detailRequestSequenceRef.current) {
        error(loadError instanceof Error ? loadError.message : "Failed to load web order detail");
        setDetailPayload(null);
      }
      return null;
    } finally {
      if (requestSequence === detailRequestSequenceRef.current) {
        setLoadingDetail(false);
      }
    }
  }, [error]);

  const loadPrinters = useCallback(async (preferredPrinterId?: string) => {
    setLoadingPrinters(true);

    try {
      const payload = await apiGet<RegisteredPrinterListResponse>(
        "/api/settings/printers?activeOnly=true&shippingLabelOnly=true",
      );
      setPrintersPayload(payload);
      setSelectedPrinterId((current) => {
        const requestedPrinterId = preferredPrinterId ?? current;
        if (requestedPrinterId && payload.printers.some((printer) => printer.id === requestedPrinterId)) {
          return requestedPrinterId;
        }
        if (
          payload.defaultShippingLabelPrinterId
          && payload.printers.some((printer) => printer.id === payload.defaultShippingLabelPrinterId)
        ) {
          return payload.defaultShippingLabelPrinterId;
        }
        return "";
      });
      return payload;
    } catch (loadError) {
      error(loadError instanceof Error ? loadError.message : "Failed to load registered printers");
      return null;
    } finally {
      setLoadingPrinters(false);
    }
  }, [error]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    scanInputRef.current?.focus();
  }, []);

  const focusScanInput = useCallback((selectContents = false) => {
    const input = scanInputRef.current;
    if (!input) {
      return;
    }

    window.requestAnimationFrame(() => {
      input.focus();
      if (selectContents) {
        input.select();
      }
    });
  }, []);

  useEffect(() => {
    void loadPrinters();
  }, [loadPrinters]);

  useEffect(() => {
    setLabelPayload(null);
    setPrintPayload(null);
    setPrintJob(null);
    setPrintNotice(null);
    setPackingNotice(null);

    if (!selectedOrderId) {
      setDetailPayload(null);
      return;
    }

    void loadOrderDetail(selectedOrderId);
  }, [loadOrderDetail, selectedOrderId]);

  const selectedShipmentId = detailPayload?.order.shipments[0]?.id ?? "";

  useEffect(() => {
    if (selectedShipmentId) {
      setPackingNotice(null);
    }
  }, [selectedShipmentId]);

  useEffect(() => {
    if (!selectedShipmentId) {
      setLabelPayload(null);
      return;
    }

    const requestSequence = ++labelRequestSequenceRef.current;
    setLoadingLabel(true);

    void apiGet<ShipmentLabelPayloadResponse>(`/api/online-store/shipments/${encodeURIComponent(selectedShipmentId)}/label`)
      .then((payload) => {
        if (requestSequence !== labelRequestSequenceRef.current) {
          return;
        }
        setLabelPayload(payload);
      })
      .catch((loadError) => {
        if (requestSequence === labelRequestSequenceRef.current) {
          error(loadError instanceof Error ? loadError.message : "Failed to load shipment label payload");
          setLabelPayload(null);
        }
      })
      .finally(() => {
        if (requestSequence === labelRequestSequenceRef.current) {
          setLoadingLabel(false);
        }
      });
  }, [error, selectedShipmentId]);

  const selectedOrder = detailPayload?.order ?? null;
  const selectedShipment = selectedOrder?.shipments[0] ?? null;
  const providerOptions = detailPayload?.supportedProviders ?? ordersPayload?.supportedProviders ?? [];
  const selectedProvider = useMemo(() => {
    if (providerOptions.length === 0) {
      return null;
    }
    return providerOptions.find((provider) => provider.key === selectedProviderKey) ?? providerOptions[0];
  }, [providerOptions, selectedProviderKey]);
  const shipmentProvider = useMemo(() => {
    if (!selectedShipment) {
      return null;
    }
    return providerOptions.find((provider) => provider.key === selectedShipment.providerKey) ?? null;
  }, [providerOptions, selectedShipment]);
  const selectedPrinter = useMemo(() => {
    if (!printersPayload) {
      return null;
    }
    if (selectedPrinterId) {
      return printersPayload.printers.find((printer) => printer.id === selectedPrinterId) ?? null;
    }
    return printersPayload.defaultShippingLabelPrinter;
  }, [printersPayload, selectedPrinterId]);
  const visibleOrders = ordersPayload?.orders ?? [];
  const selectedOrders = useMemo(
    () => visibleOrders.filter((order) => selectedOrderIds.includes(order.id)),
    [selectedOrderIds, visibleOrders],
  );
  const visibleNeedsPackingOrders = useMemo(
    () => visibleOrders.filter(canPackOrderFromSummary),
    [visibleOrders],
  );
  const visibleCreateEligibleOrders = useMemo(
    () => visibleOrders.filter(canBulkCreateShipmentForOrder),
    [visibleOrders],
  );
  const visibleBlockedCloseoutOrders = useMemo(
    () => visibleOrders.filter(needsCloseoutReviewForOrder),
    [visibleOrders],
  );
  const selectedCreateEligibleOrders = useMemo(
    () => selectedOrders.filter(canBulkCreateShipmentForOrder),
    [selectedOrders],
  );
  const selectedPrintEligibleOrders = useMemo(
    () => selectedOrders.filter(canBulkPrintShipmentForOrder),
    [selectedOrders],
  );
  const selectedDispatchEligibleOrders = useMemo(
    () => selectedOrders.filter(canBulkDispatchShipmentForOrder),
    [selectedOrders],
  );
  const bulkSelectionSummary = useMemo(() => ({
    selectedCount: selectedOrders.length,
    creatableCount: selectedCreateEligibleOrders.length,
    printableCount: selectedPrintEligibleOrders.length,
    dispatchableCount: selectedDispatchEligibleOrders.length,
  }), [
    selectedCreateEligibleOrders.length,
    selectedDispatchEligibleOrders.length,
    selectedOrders.length,
    selectedPrintEligibleOrders.length,
  ]);
  const bulkActionState = useMemo(() => ({
    canCreateSelected: Boolean(
      selectedProvider
      && selectedOrders.length > 0
      && selectedCreateEligibleOrders.length === selectedOrders.length,
    ),
    canPrintSelected: Boolean(
      selectedPrinter
      && selectedOrders.length > 0
      && selectedPrintEligibleOrders.length === selectedOrders.length,
    ),
    canDispatchSelected: Boolean(
      selectedOrders.length > 0
      && selectedDispatchEligibleOrders.length === selectedOrders.length,
    ),
  }), [
    selectedCreateEligibleOrders.length,
    selectedDispatchEligibleOrders.length,
    selectedOrders.length,
    selectedPrintEligibleOrders.length,
    selectedPrinter,
    selectedProvider,
  ]);
  const detailNextStep = selectedOrder ? getDetailNextStep(selectedOrder, selectedShipment) : null;
  const bulkResultGuidance = getBulkResultGuidance(bulkResult);
  const closeoutDateLabel = useMemo(
    () => new Date().toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
    [],
  );
  const closeoutSummary = useMemo(() => {
    const today = new Date();
    const dispatchedTodayCount = visibleOrders.filter((order) => isSameLocalCalendarDay(order.latestShipment?.dispatchedAt, today)).length;
    const readyToDispatchCount = visibleOrders.filter(canBulkDispatchShipmentForOrder).length;
    const readyToCreateCount = visibleCreateEligibleOrders.length;
    const readyToPrintCount = visibleOrders.filter(canBulkPrintShipmentForOrder).length;
    const needsPackingCount = visibleNeedsPackingOrders.length;
    const blockedCount = visibleBlockedCloseoutOrders.length;
    const outstandingCount =
      readyToDispatchCount
      + readyToCreateCount
      + readyToPrintCount
      + needsPackingCount
      + blockedCount;
    const completedBenchCount = visibleOrders.filter((order) => order.status === "DISPATCHED" || Boolean(order.latestShipment?.dispatchedAt)).length;

    return {
      dispatchedTodayCount,
      readyToDispatchCount,
      readyToCreateCount,
      readyToPrintCount,
      needsPackingCount,
      blockedCount,
      outstandingCount,
      completedBenchCount,
    };
  }, [visibleBlockedCloseoutOrders.length, visibleCreateEligibleOrders.length, visibleNeedsPackingOrders.length, visibleOrders]);
  const closeoutHandoffText = useMemo(() => {
    const lines = [
      `Dispatch closeout for ${closeoutDateLabel} (current visible queue)`,
      `- ${closeoutSummary.dispatchedTodayCount} dispatched today`,
      `- ${closeoutSummary.readyToDispatchCount} printed but not dispatched`,
      `- ${closeoutSummary.readyToPrintCount} shipment labels created but not printed`,
      `- ${closeoutSummary.readyToCreateCount} packed and ready for shipment creation`,
      `- ${closeoutSummary.needsPackingCount} still need packing`,
      `- ${closeoutSummary.blockedCount} blocked or review-needed`,
    ];

    if (closeoutSummary.outstandingCount === 0) {
      lines.push("Handoff: the visible dispatch bench is clear. No outstanding parcels require immediate action in this scope.");
    } else {
      lines.push(
        "Handoff: ready-to-dispatch parcels should be completed before bench sign-off where possible. Blocked items need manager or provider review, and packing or label-creation work can be handed into the next shift if carriers are already closed.",
      );
    }

    return lines.join("\n");
  }, [closeoutDateLabel, closeoutSummary]);
  const packingSessionSummary = useMemo(() => ({
    packedCount: packingSession.filter((entry) => entry.outcome === "PACKED").length,
    unpackedCount: packingSession.filter((entry) => entry.outcome === "UNPACKED").length,
  }), [packingSession]);
  const scanSessionSummary = useMemo(() => ({
    dispatchedCount: scanSession.filter((entry) => entry.outcome === "DISPATCHED").length,
    blockedCount: scanSession.filter((entry) => entry.outcome === "BLOCKED").length,
    noMatchCount: scanSession.filter((entry) => entry.outcome === "NO_MATCH").length,
    ambiguousCount: scanSession.filter((entry) => entry.outcome === "AMBIGUOUS").length,
  }), [scanSession]);

  const appendScanSessionEntry = useCallback((entry: Omit<DispatchScanSessionEntry, "id">) => {
    setScanSession((current) => [
      {
        id: `${entry.timestamp}-${entry.scanValue}-${Math.random().toString(36).slice(2, 8)}`,
        ...entry,
      },
      ...current,
    ].slice(0, 6));
  }, []);

  const appendPackingSessionEntry = useCallback((entry: Omit<PackingSessionEntry, "id">) => {
    setPackingSession((current) => [
      {
        id: `${entry.timestamp}-${entry.orderId}-${entry.outcome}`,
        ...entry,
      },
      ...current,
    ].slice(0, 5));
  }, []);

  const clearScanLoop = useCallback((selectContents = false) => {
    setScanValue("");
    setScanResult(null);
    focusScanInput(selectContents);
  }, [focusScanInput]);

  const refreshSelectedOrder = useCallback(async (orderId: string) => {
    await Promise.all([
      loadOrders(orderId),
      loadOrderDetail(orderId),
    ]);
  }, [loadOrderDetail, loadOrders]);

  const runAction = async (actionKey: string, action: () => Promise<void>) => {
    setPendingAction(actionKey);
    try {
      await action();
    } catch (actionError) {
      error(actionError instanceof Error ? actionError.message : "Online store shipment action failed");
    } finally {
      setPendingAction("");
    }
  };

  const toggleOrderSelection = useCallback((orderId: string) => {
    setSelectedOrderIds((current) =>
      current.includes(orderId)
        ? current.filter((selectedId) => selectedId !== orderId)
        : [...current, orderId],
    );
  }, []);

  const selectPackedQueue = useCallback(() => {
    setSelectedOrderIds(visibleOrders.filter(canBulkCreateShipmentForOrder).map((order) => order.id));
  }, [visibleOrders]);

  const selectNeedsPackingQueue = useCallback(() => {
    setSelectedOrderIds(visibleOrders.filter(canPackOrderFromSummary).map((order) => order.id));
  }, [visibleOrders]);

  const selectPrintableQueue = useCallback(() => {
    setSelectedOrderIds(visibleOrders.filter(canBulkPrintShipmentForOrder).map((order) => order.id));
  }, [visibleOrders]);

  const selectDispatchQueue = useCallback(() => {
    setSelectedOrderIds(visibleOrders.filter(canBulkDispatchShipmentForOrder).map((order) => order.id));
  }, [visibleOrders]);

  const selectBlockedReviewQueue = useCallback(() => {
    setSelectedOrderIds(visibleOrders.filter(needsCloseoutReviewForOrder).map((order) => order.id));
  }, [visibleOrders]);

  const clearBulkSelection = useCallback(() => {
    setSelectedOrderIds([]);
  }, []);

  const handleGenerateShipment = async () => {
    if (!selectedOrder || !selectedProvider) {
      return;
    }

    await runAction("generate", async () => {
      await apiPost(`/api/online-store/orders/${encodeURIComponent(selectedOrder.id)}/shipments`, {
        providerKey: selectedProvider.key,
        serviceCode: selectedProvider.defaultServiceCode,
        serviceName: selectedProvider.defaultServiceName,
      });
      setPrintPayload(null);
      setPrintJob(null);
      setPrintNotice(null);
      success(`Shipment label generated for ${selectedOrder.orderNumber}.`);
      await refreshSelectedOrder(selectedOrder.id);
    });
  };

  const handleSetPackedState = async (packed: boolean) => {
    if (!selectedOrder) {
      return;
    }

    await runAction(packed ? "pack" : "unpack", async () => {
      await apiPost(`/api/online-store/orders/${encodeURIComponent(selectedOrder.id)}/packing`, { packed });
      setBulkResult(null);
      setPackingNotice({
        tone: packed ? "success" : "warning",
        text: packed
          ? `${selectedOrder.orderNumber} is packed. Generate the shipment label below or include it in the ready-to-create queue.`
          : `${selectedOrder.orderNumber} was removed from the packed queue. Shipment creation stays blocked until packing is confirmed again.`,
      });
      appendPackingSessionEntry({
        orderId: selectedOrder.id,
        orderNumber: selectedOrder.orderNumber,
        outcome: packed ? "PACKED" : "UNPACKED",
        detail: packed ? "Packed and ready for shipment creation" : "Removed from packed queue",
        timestamp: new Date().toISOString(),
      });
      success(
        packed
          ? `${selectedOrder.orderNumber} marked as packed and ready for shipment processing.`
          : `${selectedOrder.orderNumber} removed from the packed queue.`,
      );
      await refreshSelectedOrder(selectedOrder.id);
    });
  };

  const handleJumpToShipmentSection = useCallback(() => {
    shipmentSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const handleCopyCloseoutSummary = useCallback(async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard copy is not available here. The handoff summary text remains visible for manual copy.");
      }
      await navigator.clipboard.writeText(closeoutHandoffText);
      success("Dispatch closeout summary copied for handoff.");
    } catch (copyError) {
      error(copyError instanceof Error ? copyError.message : "Failed to copy the dispatch closeout summary");
    }
  }, [closeoutHandoffText, error, success]);

  const handleRefreshShipment = async () => {
    if (!selectedOrder || !selectedShipment) {
      return;
    }

    await runAction("refresh", async () => {
      const payload = await apiPost<{ shipment: WebOrderShipment }>(selectedShipment.refreshPath);
      setPrintNotice(null);
      success(
        payload.shipment.providerRefundStatus === "REFUNDED"
          ? `Shipment ${payload.shipment.trackingNumber} is now voided at the provider.`
          : `Shipment ${payload.shipment.trackingNumber} refreshed from ${payload.shipment.providerDisplayName}.`,
      );
      await refreshSelectedOrder(selectedOrder.id);
    });
  };

  const handleCancelShipment = async () => {
    if (!selectedOrder || !selectedShipment) {
      return;
    }

    await runAction("cancel", async () => {
      const payload = await apiPost<{ shipment: WebOrderShipment }>(selectedShipment.cancelPath);
      setPrintPayload(null);
      setPrintJob(null);
      setPrintNotice(null);
      success(
        payload.shipment.status === "VOID_PENDING"
          ? `Void requested for ${payload.shipment.trackingNumber}. Refresh later to confirm the final courier outcome.`
          : `Shipment ${payload.shipment.trackingNumber} has been voided.`,
      );
      await refreshSelectedOrder(selectedOrder.id);
    });
  };

  const handleRegenerateShipment = async () => {
    if (!selectedOrder || !selectedShipment) {
      return;
    }

    await runAction("regenerate", async () => {
      await apiPost(selectedShipment.regeneratePath);
      setPrintPayload(null);
      setPrintJob(null);
      setPrintNotice(null);
      success(`Replacement shipment label generated for ${selectedOrder.orderNumber}.`);
      await refreshSelectedOrder(selectedOrder.id);
    });
  };

  const handlePreparePrint = async () => {
    if (!selectedOrder || !selectedShipment || !selectedPrinter) {
      return;
    }

    const parsedCopies = Math.max(1, Number.parseInt(copies, 10) || 1);
    await runAction("prepare-print", async () => {
      setPrintNotice(null);
      const payload = await apiPost<ShipmentPrintRequestResponse>(selectedShipment.preparePrintPath, {
        printerId: selectedPrinter.id,
        copies: parsedCopies,
      });
      setSelectedPrinterId(payload.printRequest.printer.printerId);
      setCopies(String(payload.printRequest.printer.copies));
      setPrintPayload(payload);
      setPrintJob(null);
      success(`Print payload prepared for ${selectedShipment.trackingNumber} on ${payload.printRequest.printer.printerName}.`);
      await refreshSelectedOrder(selectedOrder.id);
    });
  };

  const handlePrintShipment = async () => {
    if (!selectedOrder || !selectedShipment || !selectedPrinter) {
      return;
    }

    const parsedCopies = Math.max(1, Number.parseInt(copies, 10) || 1);
    setPendingAction("print");
    setPrintNotice(null);

    try {
      const payload = await apiPost<ShipmentPrintExecutionResponse>(selectedShipment.printPath, {
        printerId: selectedPrinter.id,
        copies: parsedCopies,
      });
      setSelectedPrinterId(payload.printRequest.printer.printerId);
      setCopies(String(payload.printRequest.printer.copies));
      setPrintPayload(payload);
      setPrintJob(payload.printJob);
      setPrintNotice({
        tone: "success",
        text: payload.printJob.simulated
          ? `Dry-run print completed on ${payload.printJob.printerName}. Output stored at ${payload.printJob.outputPath ?? payload.printJob.printerTarget}.`
          : `Print job sent to ${payload.printJob.printerTarget} for ${selectedShipment.trackingNumber} on ${payload.printJob.printerName}.`,
      });
      success(
        payload.printJob.simulated
          ? `Dry-run print completed for ${selectedShipment.trackingNumber}.`
          : `Shipment label printed via ${payload.printJob.printerName}.`,
      );
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : "Shipment label print failed";
      setPrintNotice({
        tone: "error",
        text: message,
      });
      error(message);
    } finally {
      await refreshSelectedOrder(selectedOrder.id);
      setPendingAction("");
    }
  };

  const handleDispatchShipment = async () => {
    if (!selectedOrder || !selectedShipment) {
      return;
    }

    await runAction("dispatch", async () => {
      await apiPost(selectedShipment.dispatchPath);
      success(`Shipment ${selectedShipment.trackingNumber} marked as dispatched.`);
      await refreshSelectedOrder(selectedOrder.id);
    });
  };

  const handleBulkCreateShipments = async () => {
    if (!selectedProvider || selectedOrderIds.length === 0) {
      return;
    }

    await runAction("bulk-create", async () => {
      setPrintNotice(null);
      const payload = await apiPost<BulkShipmentOperationResponse>("/api/online-store/orders/bulk/shipments", {
        orderIds: selectedOrderIds,
        providerKey: selectedProvider.key,
        serviceCode: selectedProvider.defaultServiceCode,
        serviceName: selectedProvider.defaultServiceName,
      });
      setBulkResult(payload);
      setPrintNotice(null);
      success(
        payload.summary.succeededCount > 0
          ? `Bulk shipment creation finished: ${payload.summary.succeededCount} succeeded, ${payload.summary.failedCount} failed, ${payload.summary.skippedCount} skipped.`
          : "Bulk shipment creation finished with no successful rows.",
      );
      await Promise.all([
        loadOrders(selectedOrderId || undefined),
        selectedOrderId ? loadOrderDetail(selectedOrderId) : Promise.resolve(null),
      ]);
    });
  };

  const handleBulkPrintShipments = async () => {
    if (selectedOrderIds.length === 0 || !selectedPrinter) {
      return;
    }

    const parsedCopies = Math.max(1, Number.parseInt(copies, 10) || 1);
    await runAction("bulk-print", async () => {
      setPrintNotice(null);
      const payload = await apiPost<BulkShipmentOperationResponse>("/api/online-store/orders/bulk/print", {
        orderIds: selectedOrderIds,
        printerId: selectedPrinter.id,
        copies: parsedCopies,
      });
      setBulkResult(payload);
      success(
        payload.summary.succeededCount > 0
          ? `Bulk print finished: ${payload.summary.succeededCount} succeeded, ${payload.summary.failedCount} failed, ${payload.summary.skippedCount} skipped.`
          : "Bulk print finished with no successful rows.",
      );
      await Promise.all([
        loadOrders(selectedOrderId || undefined),
        selectedOrderId ? loadOrderDetail(selectedOrderId) : Promise.resolve(null),
      ]);
    });
  };

  const handleBulkDispatchShipments = async () => {
    if (selectedOrderIds.length === 0) {
      return;
    }

    await runAction("bulk-dispatch", async () => {
      setPrintNotice(null);
      const payload = await apiPost<BulkShipmentOperationResponse>("/api/online-store/orders/bulk/dispatch", {
        orderIds: selectedOrderIds,
      });
      setBulkResult(payload);
      success(
        payload.summary.succeededCount > 0
          ? `Bulk dispatch finished: ${payload.summary.succeededCount} succeeded, ${payload.summary.failedCount} failed, ${payload.summary.skippedCount} skipped.`
          : "Bulk dispatch finished with no successful rows.",
      );
      await Promise.all([
        loadOrders(selectedOrderId || undefined),
        selectedOrderId ? loadOrderDetail(selectedOrderId) : Promise.resolve(null),
      ]);
    });
  };

  const handleSubmitScanLookup = async () => {
    const value = scanValue.trim();
    if (!value) {
      error("Scan or type a tracking, provider, or order reference first.");
      focusScanInput();
      return;
    }

    await runAction("scan-lookup", async () => {
      const payload = await apiPost<DispatchScanLookupResponse>("/api/online-store/dispatch-scan", { value });
      setScanResult(payload);

      if (payload.status === "MATCHED" && payload.order) {
        setSelectedOrderId(payload.order.id);
        await loadOrderDetail(payload.order.id);
      }

      if (payload.status === "MATCHED" && payload.dispatchable) {
        setScanNotice({
          tone: "success",
          text: `Matched ${payload.order?.orderNumber ?? "shipment"}. Press Enter again or use Confirm Dispatch once the parcel has physically left the store.`,
        });
        appendScanSessionEntry({
          scanValue: payload.scanValue,
          outcome: "READY",
          orderId: payload.order?.id ?? null,
          orderNumber: payload.order?.orderNumber ?? null,
          trackingNumber: payload.shipment?.trackingNumber ?? null,
          detail: "Ready to dispatch",
          timestamp: new Date().toISOString(),
        });
      } else if (payload.status === "MATCHED") {
        setScanNotice({
          tone: "warning",
          text: payload.dispatchBlockedReason ?? "CorePOS is blocking dispatch for this scan right now.",
        });
        appendScanSessionEntry({
          scanValue: payload.scanValue,
          outcome: "BLOCKED",
          orderId: payload.order?.id ?? null,
          orderNumber: payload.order?.orderNumber ?? null,
          trackingNumber: payload.shipment?.trackingNumber ?? null,
          detail: payload.dispatchBlockedReason ?? "Dispatch blocked",
          timestamp: new Date().toISOString(),
        });
      } else if (payload.status === "AMBIGUOUS") {
        setScanNotice({
          tone: "warning",
          text: "More than one order matched that scan. Review the candidates before dispatch.",
        });
        appendScanSessionEntry({
          scanValue: payload.scanValue,
          outcome: "AMBIGUOUS",
          orderId: null,
          orderNumber: null,
          trackingNumber: null,
          detail: payload.dispatchBlockedReason ?? "More than one order matched this scan.",
          timestamp: new Date().toISOString(),
        });
        error("More than one order matched that scan. Review the candidates before dispatch.");
      } else {
        setScanNotice({
          tone: "error",
          text: payload.dispatchBlockedReason ?? "No shipment or order matched that scan value.",
        });
        appendScanSessionEntry({
          scanValue: payload.scanValue,
          outcome: "NO_MATCH",
          orderId: null,
          orderNumber: null,
          trackingNumber: null,
          detail: payload.dispatchBlockedReason ?? "No dispatch match found",
          timestamp: new Date().toISOString(),
        });
      }

      focusScanInput(true);
    });
  };

  const handleDispatchScannedShipment = async () => {
    if (scanResult?.status !== "MATCHED" || !scanResult.shipment || !scanResult.order || !scanResult.dispatchable) {
      return;
    }

    await runAction("scan-dispatch", async () => {
      await apiPost(scanResult.shipment.dispatchPath);
      success(`Shipment ${scanResult.shipment.trackingNumber} marked as dispatched from the scan bench.`);
      setScanNotice({
        tone: "success",
        text: `Dispatch confirmed for ${scanResult.order.orderNumber}. Bench is ready for the next scan.`,
      });
      appendScanSessionEntry({
        scanValue: scanResult.scanValue,
        outcome: "DISPATCHED",
        orderId: scanResult.order.id,
        orderNumber: scanResult.order.orderNumber,
        trackingNumber: scanResult.shipment.trackingNumber,
        detail: "Dispatch confirmed",
        timestamp: new Date().toISOString(),
      });
      await refreshSelectedOrder(scanResult.order.id);
      clearScanLoop();
    });
  };

  const handleResetScanPanel = useCallback(() => {
    setScanNotice(null);
    clearScanLoop();
  }, [clearScanLoop]);

  const handleOpenScanCandidate = async (orderId: string) => {
    setSelectedOrderId(orderId);
    await loadOrderDetail(orderId);
  };

  const canGenerateShipment = Boolean(
    selectedOrder
      && selectedOrder.fulfillmentMethod === "SHIPPING"
      && selectedOrder.status === "READY_FOR_DISPATCH"
      && isOrderPacked(selectedOrder)
      && selectedProvider?.isAvailable
      && !selectedShipment,
  );
  const shipmentIsVoidBlocked = isShipmentVoidBlocked(selectedShipment);
  const canRefreshShipment = Boolean(selectedShipment && shipmentProvider?.supportsShipmentRefresh);
  const canCancelShipment = Boolean(
    selectedShipment
      && shipmentProvider?.supportsShipmentVoid
      && selectedShipment.status !== "VOIDED"
      && selectedShipment.status !== "VOID_PENDING"
      && !selectedShipment.dispatchedAt,
  );
  const canRegenerateShipment = Boolean(selectedShipment && selectedShipment.status === "VOIDED");
  const canPreparePrint = Boolean(selectedShipment && !shipmentIsVoidBlocked && selectedPrinter);
  const canPrintShipment = Boolean(selectedShipment && !shipmentIsVoidBlocked && selectedPrinter);
  const canDispatchShipment = Boolean(
    selectedShipment
      && !shipmentIsVoidBlocked
      && selectedShipment.printedAt
      && !selectedShipment.dispatchedAt,
  );
  const packingActionState = useMemo(() => ({
    canPackOrder: Boolean(
      selectedOrder
        && selectedOrder.fulfillmentMethod === "SHIPPING"
        && selectedOrder.status === "READY_FOR_DISPATCH"
        && !isOrderPacked(selectedOrder),
    ),
    canUnpackOrder: Boolean(
      selectedOrder
        && selectedOrder.fulfillmentMethod === "SHIPPING"
        && selectedOrder.status === "READY_FOR_DISPATCH"
        && isOrderPacked(selectedOrder)
        && !selectedShipment,
    ),
  }), [selectedOrder, selectedShipment]);
  const dispatchRecommendation = getDispatchRecommendation(
    selectedOrder,
    selectedShipment,
    selectedShipment ? shipmentProvider : selectedProvider,
    selectedPrinter,
  );
  const dispatchReadiness = getDispatchReadiness(
    selectedOrder,
    selectedShipment,
    selectedShipment ? shipmentProvider : selectedProvider,
    selectedPrinter,
  );
  const dispatchActionCards = getDispatchActionCards(
    selectedOrder,
    selectedShipment,
    selectedProvider,
    shipmentProvider,
    selectedPrinter,
    {
      canGenerateShipment,
      canRefreshShipment,
      canCancelShipment,
      canRegenerateShipment,
      canPreparePrint,
      canPrintShipment,
      canDispatchShipment,
    },
  );
  const shipmentTimeline = buildShipmentTimeline(selectedShipment);

  return (
    <div className="page-shell ui-page online-orders-page" data-testid="online-store-orders-page">
      <SurfaceCard className="online-orders-hero" tone="soft">
        <PageHeader
          eyebrow="Online Store / Web Dispatch"
          title="Shipping Labels"
          description="Create, inspect, and reprint web-order shipment labels through a CorePOS-owned dispatch flow. Shipment creation now resolves through managed provider settings, while Zebra-oriented print jobs still hand off through the Windows/local agent without using the browser print dialog."
          actions={(
            <div className="actions-inline">
              <Link to="/online-store/products">Products</Link>
              <Link to="/online-store/website-builder">Website Builder</Link>
            </div>
          )}
        />

        <div className="dashboard-summary-grid online-orders-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Orders in scope</span>
            <strong className="metric-value">{ordersPayload?.summary.total ?? 0}</strong>
            <span className="dashboard-metric-detail">Current query across web orders</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Bench queue</span>
            <strong className="metric-value">{ordersPayload?.summary.readyForDispatchCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Open web orders still in dispatch handling</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Packed queue</span>
            <strong className="metric-value">{ordersPayload?.summary.packedCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Orders explicitly packed for shipping work</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Needs print</span>
            <strong className="metric-value">{ordersPayload?.summary.labelReadyCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Active labels still waiting to be printed</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Ready to dispatch</span>
            <strong className="metric-value">{ordersPayload?.summary.readyToDispatchCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Printed labels awaiting final dispatch confirmation</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Dispatched</span>
            <strong className="metric-value">{ordersPayload?.summary.dispatchedCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Completed shipment confirmations</span>
          </div>
        </div>

        <div className="restricted-panel info-panel online-orders-info-panel">
          Pack first, then create and print labels in CorePOS. Shipment orchestration stays inside CorePOS, label content stays stored locally as ZPL, and every print still routes through a registered dispatch printer before handing off to the Windows print agent.
        </div>
      </SurfaceCard>

      <div className="online-orders-toolbar">
        <label className="online-orders-toolbar__field">
          Search orders
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Order number, customer, email, tracking"
            data-testid="online-store-search-orders"
          />
        </label>
        <label className="online-orders-toolbar__field online-orders-toolbar__field--compact">
          Status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "" | WebOrderStatus)}>
            <option value="">All orders</option>
            <option value="READY_FOR_DISPATCH">Ready for dispatch</option>
            <option value="DISPATCHED">Dispatched</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </label>
        <label className="online-orders-toolbar__field online-orders-toolbar__field--compact">
          Packing
          <select value={packedFilter} onChange={(event) => setPackedFilter(event.target.value as "" | "packed" | "unpacked")}>
            <option value="">All packing states</option>
            <option value="packed">Packed only</option>
            <option value="unpacked">Needs packing</option>
          </select>
        </label>
      </div>

      <SurfaceCard className="online-orders-closeout-card" data-testid="online-store-closeout">
        <div className="online-orders-closeout-card__header">
          <div>
            <span className="online-orders-next-step__eyebrow">Dispatch closeout / handoff</span>
            <h2>Bench closeout for {closeoutDateLabel}</h2>
          </div>
          <span className={`status-badge${closeoutSummary.outstandingCount === 0 ? " status-ready" : ""}`}>
            {closeoutSummary.outstandingCount === 0 ? "Bench clear in visible scope" : `${closeoutSummary.outstandingCount} outstanding`}
          </span>
        </div>
        <div className="online-orders-closeout-card__metrics">
          <article className="online-orders-closeout-card__metric">
            <span>Dispatched today</span>
            <strong>{closeoutSummary.dispatchedTodayCount}</strong>
          </article>
          <article className="online-orders-closeout-card__metric">
            <span>Printed, not dispatched</span>
            <strong>{closeoutSummary.readyToDispatchCount}</strong>
          </article>
          <article className="online-orders-closeout-card__metric">
            <span>Packed, no shipment</span>
            <strong>{closeoutSummary.readyToCreateCount}</strong>
          </article>
          <article className="online-orders-closeout-card__metric">
            <span>Shipment created, not printed</span>
            <strong>{closeoutSummary.readyToPrintCount}</strong>
          </article>
          <article className="online-orders-closeout-card__metric">
            <span>Needs packing</span>
            <strong>{closeoutSummary.needsPackingCount}</strong>
          </article>
          <article className="online-orders-closeout-card__metric">
            <span>Blocked / review</span>
            <strong>{closeoutSummary.blockedCount}</strong>
          </article>
        </div>
        <div className="online-orders-closeout-card__guidance">
          <div className="restricted-panel info-panel online-orders-info-panel">
            {closeoutSummary.outstandingCount === 0
              ? `All currently visible dispatch work is closed out. ${closeoutSummary.completedBenchCount} orders in this scope have already been completed or handed off cleanly.`
              : closeoutSummary.blockedCount > 0
                ? "Outstanding blocked rows need review before the bench is considered fully handed over. Printed-but-not-dispatched parcels should be resolved first, then provider or void issues can be handed to the next shift or a manager."
                : "Outstanding work remains, but it is still in a normal operational state. Finish ready-to-dispatch parcels first, then decide whether remaining packing or label work can safely wait until tomorrow."}
          </div>
          <div className="online-orders-closeout-card__actions">
            <button type="button" className="button-link" onClick={selectNeedsPackingQueue} disabled={loadingOrders || pendingAction.length > 0}>
              Review Needs Packing
            </button>
            <button type="button" className="button-link" onClick={selectPackedQueue} disabled={loadingOrders || pendingAction.length > 0}>
              Review Ready To Create
            </button>
            <button type="button" className="button-link" onClick={selectPrintableQueue} disabled={loadingOrders || pendingAction.length > 0}>
              Review Ready To Print
            </button>
            <button type="button" className="button-link" onClick={selectDispatchQueue} disabled={loadingOrders || pendingAction.length > 0}>
              Review Ready To Dispatch
            </button>
            <button type="button" className="button-link" onClick={selectBlockedReviewQueue} disabled={loadingOrders || pendingAction.length > 0}>
              Review Blocked Items
            </button>
            <button
              type="button"
              className="button-link"
              onClick={() => void handleCopyCloseoutSummary()}
              disabled={pendingAction.length > 0}
              data-testid="online-store-closeout-copy"
            >
              Copy Handoff Summary
            </button>
          </div>
        </div>
        <pre className="online-orders-closeout-card__summary" data-testid="online-store-closeout-summary-text">
          {closeoutHandoffText}
        </pre>
      </SurfaceCard>

      <div className="online-orders-layout">
        <SurfaceCard className="online-orders-panel">
          <SectionHeader
            title="Web Orders"
            description="Manager-facing dispatch view for current online orders. Use the API or demo seed data to create additional web orders while the wider storefront remains under construction."
          />

          <div className="online-orders-bulk-toolbar">
            <div className="online-orders-bulk-toolbar__summary">
              <strong>Bulk throughput</strong>
              <span>
                {bulkSelectionSummary.selectedCount} selected
                {` · ${bulkSelectionSummary.creatableCount} ready to create`}
                {` · ${bulkSelectionSummary.printableCount} ready to print`}
                {` · ${bulkSelectionSummary.dispatchableCount} ready to dispatch`}
              </span>
            </div>
            <div className="online-orders-bulk-toolbar__queue-summary" data-testid="online-store-queue-shortcuts">
              <span>{visibleNeedsPackingOrders.length} need packing</span>
              <span>{visibleCreateEligibleOrders.length} ready to create</span>
              <span>{ordersPayload?.summary.labelReadyCount ?? 0} ready to print</span>
              <span>{ordersPayload?.summary.readyToDispatchCount ?? 0} ready to dispatch</span>
            </div>
            <div className="online-orders-bulk-toolbar__actions">
              <button type="button" className="button-link" onClick={selectPackedQueue} disabled={loadingOrders || pendingAction.length > 0}>
                Select Ready To Create
              </button>
              <button type="button" className="button-link" onClick={selectNeedsPackingQueue} disabled={loadingOrders || pendingAction.length > 0}>
                Select Needs Packing
              </button>
              <button type="button" className="button-link" onClick={selectPrintableQueue} disabled={loadingOrders || pendingAction.length > 0}>
                Select Printable Queue
              </button>
              <button type="button" className="button-link" onClick={selectDispatchQueue} disabled={loadingOrders || pendingAction.length > 0}>
                Select Ready To Dispatch
              </button>
              <button type="button" className="button-link" onClick={clearBulkSelection} disabled={selectedOrderIds.length === 0 || pendingAction.length > 0}>
                Clear Selection
              </button>
              <button
                type="button"
                className="button-link"
                onClick={() => void handleBulkCreateShipments()}
                disabled={!bulkActionState.canCreateSelected || pendingAction.length > 0}
                data-testid="online-store-bulk-create"
              >
                {pendingAction === "bulk-create" ? "Creating..." : "Bulk Create Shipments"}
              </button>
              <button
                type="button"
                className="button-link"
                onClick={() => void handleBulkPrintShipments()}
                disabled={!bulkActionState.canPrintSelected || pendingAction.length > 0}
                data-testid="online-store-bulk-print"
              >
                {pendingAction === "bulk-print" ? "Printing..." : "Bulk Print Labels"}
              </button>
              <button
                type="button"
                className="button-link"
                onClick={() => void handleBulkDispatchShipments()}
                disabled={!bulkActionState.canDispatchSelected || pendingAction.length > 0}
                data-testid="online-store-bulk-dispatch"
              >
                {pendingAction === "bulk-dispatch" ? "Dispatching..." : "Bulk Confirm Dispatch"}
              </button>
            </div>
          </div>

          {bulkResult ? (
            <div className="online-orders-bulk-results" data-testid="online-store-bulk-results">
              <div className="online-orders-bulk-results__summary">
                <strong>{getBulkActionLabel(bulkResult.action)}</strong>
                <span>
                  {bulkResult.summary.succeededCount} succeeded
                  {` · ${bulkResult.summary.failedCount} failed`}
                  {` · ${bulkResult.summary.skippedCount} skipped`}
                </span>
              </div>
              {bulkResultGuidance ? (
                <p className="online-orders-bulk-results__guidance">{bulkResultGuidance}</p>
              ) : null}
              <ul className="online-orders-bulk-results__list">
                {bulkResult.results.map((result) => (
                  <li
                    key={`${bulkResult.action}-${result.orderId}-${result.shipmentId ?? "none"}`}
                    className={`online-orders-bulk-results__item online-orders-bulk-results__item--${result.outcome.toLowerCase()}`}
                  >
                    <span className="online-orders-bulk-results__title">{result.orderNumber}</span>
                    <span className="online-orders-bulk-results__meta">
                      {result.trackingNumber ?? humanizeToken(result.outcome)}
                      {result.shipmentStatus ? ` · ${humanizeToken(result.shipmentStatus)}` : ""}
                      {result.dispatchedAt ? " · dispatched" : result.printedAt ? " · printed" : ""}
                    </span>
                    <span>{result.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {loadingOrders ? (
            <EmptyState title="Loading web orders" description="Pulling the current dispatch queue from CorePOS." />
          ) : null}

          {!loadingOrders && (!ordersPayload || ordersPayload.orders.length === 0) ? (
            <EmptyState
              title="No web orders yet"
              description="Create one through POST /api/online-store/orders or run the demo seed to populate a dispatch-friendly test queue."
            />
          ) : null}

          {!loadingOrders && ordersPayload && ordersPayload.orders.length > 0 ? (
            <div className="online-orders-list" role="list">
              {ordersPayload.orders.map((order) => {
                const isSelected = order.id === selectedOrderId;
                const isChecked = selectedOrderIds.includes(order.id);
                const packed = isOrderPacked(order);
                const dispatchable = canBulkDispatchShipmentForOrder(order);
                return (
                  <div
                    key={order.id}
                    className={`online-order-row-shell${isChecked ? " online-order-row-shell--checked" : ""}`}
                  >
                    <label className="online-order-row__select">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleOrderSelection(order.id)}
                        aria-label={`Select ${order.orderNumber} for bulk dispatch actions`}
                        data-testid={`online-store-select-order-${order.id}`}
                      />
                    </label>
                    <button
                      type="button"
                      className={`online-order-row${isSelected ? " online-order-row--selected" : ""}`}
                      onClick={() => setSelectedOrderId(order.id)}
                      data-testid={`online-store-order-row-${order.id}`}
                    >
                      <div className="online-order-row__topline">
                        <strong>{order.orderNumber}</strong>
                        <div className="online-order-row__badges">
                          <span className={`status-badge ${packed ? "status-ready" : "status-warning"}`}>
                            {packed ? "Packed" : "Needs Packing"}
                          </span>
                          {dispatchable ? <span className="status-badge status-ready">Ready To Dispatch</span> : null}
                          <span className={orderStatusClassName(order.status)}>{humanizeToken(order.status)}</span>
                        </div>
                      </div>
                      <div className="online-order-row__meta">
                        <span>{order.customerName}</span>
                        <span>{formatMoney(order.totalPence)}</span>
                      </div>
                      <div className="online-order-row__meta online-order-row__meta--muted">
                        <span>{order.shippingPostcode}</span>
                        <span>{formatDateTime(order.placedAt)}</span>
                      </div>
                      <div className="online-order-row__footer">
                        <span>{humanizeToken(order.fulfillmentMethod)}</span>
                        <span>{getOrderDispatchQueueHint(order)}</span>
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
        </SurfaceCard>

        <SurfaceCard className="online-orders-panel online-orders-detail-panel">
          <SectionHeader
            title="Dispatch Detail"
            description="Generate a shipment label, prepare a Zebra-style print payload, send it through the Windows print-agent path, and keep print/dispatch timestamps audit-safe."
            actions={selectedOrder ? <span className="status-badge">{selectedOrder.orderNumber}</span> : null}
          />

          <section className="online-orders-scan-panel" data-testid="online-store-scan-panel">
            <div className="online-orders-detail__section-header">
              <h3>Scan To Confirm Dispatch</h3>
              <span className="status-badge">Scan-first bench flow</span>
            </div>
            <p className="online-orders-scan-panel__copy">
              Scan a tracking number, provider shipment reference, provider tracking reference, provider reference, order number, or external order reference to load the right shipment before confirming dispatch.
            </p>
            <form
              className="online-orders-scan-panel__form"
              onSubmit={(event) => {
                event.preventDefault();
                const normalizedInput = scanValue.trim().toUpperCase();
                if (
                  scanResult?.status === "MATCHED"
                  && scanResult.dispatchable
                  && normalizedInput.length > 0
                  && normalizedInput === scanResult.normalizedValue
                ) {
                  void handleDispatchScannedShipment();
                  return;
                }
                void handleSubmitScanLookup();
              }}
            >
              <label className="online-orders-scan-panel__field">
                Scan or type identifier
                <input
                  ref={scanInputRef}
                  value={scanValue}
                  onChange={(event) => setScanValue(event.target.value)}
                  placeholder="Scan tracking, provider ref, or order number"
                  autoCapitalize="characters"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  data-testid="online-store-scan-input"
                />
              </label>
              <button
                type="submit"
                className="button-link"
                disabled={pendingAction.length > 0}
                data-testid="online-store-scan-submit"
              >
                {pendingAction === "scan-lookup" ? "Looking Up..." : "Lookup Scan"}
              </button>
            </form>

            {scanNotice ? (
              <div
                className={`online-orders-print-notice online-orders-print-notice--${scanNotice.tone}`}
                data-testid="online-store-scan-notice"
              >
                {scanNotice.text}
              </div>
            ) : null}

            <div className="online-orders-scan-session" data-testid="online-store-scan-session">
              <div className="online-orders-scan-session__summary">
                <strong>Dispatch bench session</strong>
                <span>
                  {scanSessionSummary.dispatchedCount} dispatched
                  {` · ${scanSessionSummary.blockedCount} blocked`}
                  {` · ${scanSessionSummary.noMatchCount} no match`}
                  {scanSessionSummary.ambiguousCount ? ` · ${scanSessionSummary.ambiguousCount} ambiguous` : ""}
                </span>
              </div>
              {scanSession.length > 0 ? (
                <ol className="online-orders-scan-session__list" data-testid="online-store-scan-history">
                  {scanSession.map((entry) => (
                    <li key={entry.id} className={getScanSessionOutcomeClassName(entry.outcome)}>
                      <div className="online-orders-scan-session__item-header">
                        <strong>{entry.orderNumber ?? entry.scanValue}</strong>
                        <span className="status-badge">
                          {entry.outcome === "NO_MATCH" ? "No Match" : humanizeToken(entry.outcome)}
                        </span>
                      </div>
                      <span>
                        {entry.trackingNumber ? `${entry.trackingNumber} · ` : ""}
                        {entry.detail}
                      </span>
                      <time dateTime={entry.timestamp}>{formatDateTime(entry.timestamp)}</time>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="online-orders-scan-session__empty">
                  The scan loop is idle. Scan a parcel identifier to load the next shipment and keep this session context warm.
                </p>
              )}
            </div>

            {scanResult ? (
              <div
                className={`online-orders-scan-result online-orders-scan-result--${scanResult.status.toLowerCase()}`}
                data-testid="online-store-scan-result"
              >
                {scanResult.status === "NO_MATCH" ? (
                  <>
                    <strong>No dispatch match found</strong>
                    <p>{scanResult.dispatchBlockedReason ?? "No shipment or order matched that scan value."}</p>
                    <div className="online-orders-scan-result__actions">
                      <button
                        type="button"
                        className="button-link"
                        onClick={() => handleResetScanPanel()}
                        disabled={pendingAction.length > 0}
                      >
                        Ready For Next Scan
                      </button>
                    </div>
                  </>
                ) : null}

                {scanResult.status === "AMBIGUOUS" ? (
                  <>
                    <strong>More than one order matched</strong>
                    <p>
                      {scanResult.dispatchBlockedReason ?? "Review the matched orders and open the correct one before dispatch."}
                    </p>
                    <ul className="online-orders-scan-result__candidate-list">
                      {scanResult.candidates.map((candidate) => (
                        <li key={`${candidate.orderId}-${candidate.shipmentId ?? "none"}-${candidate.matchedBy}`}>
                          <div>
                            <strong>{candidate.orderNumber}</strong>
                            <span>
                              {humanizeToken(candidate.matchedBy)}
                              {candidate.trackingNumber ? ` · ${candidate.trackingNumber}` : ""}
                              {candidate.shipmentStatus ? ` · ${humanizeToken(candidate.shipmentStatus)}` : ""}
                              {candidate.dispatchedAt ? " · dispatched" : ""}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="button-link"
                            onClick={() => void handleOpenScanCandidate(candidate.orderId)}
                            disabled={pendingAction.length > 0}
                          >
                            Open Order
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="online-orders-scan-result__actions">
                      <button
                        type="button"
                        className="button-link"
                        onClick={() => handleResetScanPanel()}
                        disabled={pendingAction.length > 0}
                      >
                        Ready For Next Scan
                      </button>
                    </div>
                  </>
                ) : null}

                {scanResult.status === "MATCHED" && scanResult.order ? (
                  <>
                    <div className="online-orders-scan-result__header">
                      <div>
                        <span className="online-orders-next-step__eyebrow">
                          Matched by {scanResult.matchedBy ? humanizeToken(scanResult.matchedBy) : "scan"}
                        </span>
                        <strong>{scanResult.order.orderNumber}</strong>
                      </div>
                      <span className={`status-badge${scanResult.dispatchable ? " status-ready" : ""}`}>
                        {scanResult.dispatchable ? "Ready To Dispatch" : "Review Required"}
                      </span>
                    </div>
                    <div className="online-orders-scan-result__facts">
                      <span>{scanResult.order.customerName}</span>
                      <span>{scanResult.shipment?.trackingNumber ?? "No shipment yet"}</span>
                      <span>
                        {scanResult.shipment ? humanizeToken(scanResult.shipment.status) : humanizeToken(scanResult.order.status)}
                      </span>
                    </div>
                    <p>
                      {scanResult.dispatchable
                        ? "This scan resolved to an active printed shipment. Press Enter again or use Confirm Dispatch once the parcel has physically left the store."
                        : scanResult.dispatchBlockedReason ?? "CorePOS is blocking dispatch for this scan right now."}
                    </p>
                    {!scanResult.dispatchable ? (
                      <div
                        className="online-orders-print-notice online-orders-print-notice--error"
                        data-testid="online-store-scan-blocked"
                      >
                        {scanResult.dispatchBlockedReason}
                      </div>
                    ) : null}
                    <div className="online-orders-scan-result__actions">
                      <button
                        type="button"
                        className="button-link"
                        onClick={() => void handleOpenScanCandidate(scanResult.order!.id)}
                        disabled={pendingAction.length > 0}
                      >
                        Open Matched Order
                      </button>
                      <button
                        type="button"
                        className="button-link"
                        onClick={() => void handleDispatchScannedShipment()}
                        disabled={!scanResult.dispatchable || pendingAction.length > 0}
                        data-testid="online-store-scan-dispatch"
                      >
                        {pendingAction === "scan-dispatch" ? "Dispatching..." : "Confirm Dispatch For Scanned Shipment"}
                      </button>
                      <button
                        type="button"
                        className="button-link"
                        onClick={() => handleResetScanPanel()}
                        disabled={pendingAction.length > 0}
                      >
                        Ready For Next Scan
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
          </section>

          {loadingDetail ? (
            <EmptyState title="Loading order detail" description="Fetching the selected order, shipment state, and shipping provider options." />
          ) : null}

          {!loadingDetail && !selectedOrder ? (
            <EmptyState title="Select a web order" description="Choose an order from the left to inspect shipment state and generate a shipping label." />
          ) : null}

          {!loadingDetail && selectedOrder ? (
            <div className="online-orders-detail" data-testid="online-store-order-detail">
              <div className="online-orders-detail__grid">
                <section className="online-orders-detail__section">
                  <h3>Order Overview</h3>
                  <div className="online-orders-detail__badges">
                    <span className={orderStatusClassName(selectedOrder.status)}>{humanizeToken(selectedOrder.status)}</span>
                    <span className="status-badge">{humanizeToken(selectedOrder.fulfillmentMethod)}</span>
                    <span className="status-badge">{selectedOrder.sourceChannel}</span>
                    <span className={`status-badge ${isOrderPacked(selectedOrder) ? "status-ready" : "status-warning"}`}>
                      {isOrderPacked(selectedOrder) ? "Packed" : "Needs Packing"}
                    </span>
                  </div>
                  <dl className="online-orders-detail__facts">
                    <div>
                      <dt>Order number</dt>
                      <dd data-testid="online-store-order-number">{selectedOrder.orderNumber}</dd>
                    </div>
                    <div>
                      <dt>Customer</dt>
                      <dd>{selectedOrder.customerName}</dd>
                    </div>
                    <div>
                      <dt>Email</dt>
                      <dd>{selectedOrder.customerEmail}</dd>
                    </div>
                    <div>
                      <dt>Placed</dt>
                      <dd>{formatDateTime(selectedOrder.placedAt)}</dd>
                    </div>
                    <div>
                      <dt>Packed</dt>
                      <dd>{formatDateTime(selectedOrder.packedAt)}</dd>
                    </div>
                    <div>
                      <dt>Total</dt>
                      <dd>{formatMoney(selectedOrder.totalPence)}</dd>
                    </div>
                  </dl>
                  <div className="online-orders-pack-actions">
                    <button
                      type="button"
                      className="button-link"
                      onClick={() => void handleSetPackedState(true)}
                      disabled={!packingActionState.canPackOrder || pendingAction.length > 0}
                      data-testid="online-store-mark-packed"
                    >
                      {pendingAction === "pack" ? "Marking..." : "Mark Packed"}
                    </button>
                    <button
                      type="button"
                      className="button-link"
                      onClick={() => void handleSetPackedState(false)}
                      disabled={!packingActionState.canUnpackOrder || pendingAction.length > 0}
                      data-testid="online-store-unmark-packed"
                    >
                      {pendingAction === "unpack" ? "Updating..." : "Remove From Packed Queue"}
                    </button>
                  </div>
                  {packingNotice ? (
                    <div
                      className={`online-orders-print-notice online-orders-print-notice--${packingNotice.tone}`}
                      data-testid="online-store-packing-notice"
                    >
                      {packingNotice.text}
                    </div>
                  ) : null}
                  <div className="online-orders-packing-handoff" data-testid="online-store-packing-handoff">
                    <div className="online-orders-packing-handoff__header">
                      <div>
                        <span className="online-orders-next-step__eyebrow">Packing handoff</span>
                        <strong>
                          {!isOrderPacked(selectedOrder)
                            ? "Packing must be confirmed first"
                            : !selectedShipment
                              ? "Packed and ready for shipment creation"
                              : selectedShipment.printedAt
                                ? "Packed order is in the dispatch-ready flow"
                                : "Packed order is active in shipment handling"}
                        </strong>
                      </div>
                      <span className={`status-badge ${isOrderPacked(selectedOrder) ? "status-ready" : "status-warning"}`}>
                        {isOrderPacked(selectedOrder) ? "Packed Gate Complete" : "Packing Gate Open"}
                      </span>
                    </div>
                    <p>
                      {!isOrderPacked(selectedOrder)
                        ? "Shipment creation, bulk create, and dispatch-bench work stay blocked until this parcel is marked packed."
                        : !selectedShipment
                          ? "Packing is recorded. The shipment section below is now ready for label creation and the order can join the ready-to-create queue."
                          : selectedShipment.printedAt
                            ? "Packing is complete and the printed label is already in the final dispatch flow."
                            : "Packing is complete and this order has already moved into shipment handling below."}
                    </p>
                    {isOrderPacked(selectedOrder) ? (
                      <div className="online-orders-packing-handoff__actions">
                        <button
                          type="button"
                          className="button-link"
                          onClick={handleJumpToShipmentSection}
                          disabled={pendingAction.length > 0}
                          data-testid="online-store-jump-to-shipment"
                        >
                          Jump To Shipment Actions
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div className="online-orders-packing-session" data-testid="online-store-packing-session">
                    <div className="online-orders-packing-session__summary">
                      <strong>Packing session</strong>
                      <span>
                        {packingSessionSummary.packedCount} packed
                        {packingSessionSummary.unpackedCount ? ` · ${packingSessionSummary.unpackedCount} unpacked` : ""}
                      </span>
                    </div>
                    {packingSession.length > 0 ? (
                      <ol className="online-orders-packing-session__list">
                        {packingSession.map((entry) => (
                          <li key={entry.id} className={getPackingSessionOutcomeClassName(entry.outcome)}>
                            <div className="online-orders-packing-session__item-header">
                              <strong>{entry.orderNumber}</strong>
                              <span className="status-badge">
                                {entry.outcome === "PACKED" ? "Packed" : "Unpacked"}
                              </span>
                            </div>
                            <span>{entry.detail}</span>
                            <time dateTime={entry.timestamp}>{formatDateTime(entry.timestamp)}</time>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="online-orders-packing-session__empty">
                        Recent packing changes appear here so the packing station can confirm what just moved into or out of the shipment queue.
                      </p>
                    )}
                  </div>
                  <div className="restricted-panel info-panel online-orders-dispatch-printer-info">
                    {isOrderPacked(selectedOrder)
                      ? selectedShipment
                        ? "Packed state is recorded. This order has already moved into shipment handling."
                        : "Packed orders are eligible for shipment label creation and bulk dispatch actions."
                      : "Mark the order as packed before creating a shipment label or including it in bulk dispatch work."}
                  </div>
                  {detailNextStep ? (
                    <div className="online-orders-next-step">
                      <strong>{detailNextStep.title}</strong>
                      <span>{detailNextStep.detail}</span>
                    </div>
                  ) : null}
                  <div className="online-orders-address-card">
                    <strong>Ship to</strong>
                    <p>{selectedOrder.shippingRecipientName}</p>
                    <p>{selectedOrder.shippingAddressLine1}</p>
                    {selectedOrder.shippingAddressLine2 ? <p>{selectedOrder.shippingAddressLine2}</p> : null}
                    <p>
                      {[selectedOrder.shippingCity, selectedOrder.shippingRegion].filter(Boolean).join(", ")}
                    </p>
                    <p>{`${selectedOrder.shippingPostcode} ${selectedOrder.shippingCountry}`}</p>
                  </div>
                  <div className="online-orders-line-items">
                    <strong>Items</strong>
                    <ul>
                      {selectedOrder.items.map((item) => (
                        <li key={item.id}>
                          <span>{`${item.quantity}x ${item.variantName ?? item.productName}`}</span>
                          <span>{formatMoney(item.lineTotalPence)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>

                <section
                  ref={shipmentSectionRef}
                  className="online-orders-detail__section online-orders-detail__section--shipment"
                >
                  <div className="online-orders-detail__section-header">
                    <h3>Shipment</h3>
                    {selectedShipment ? (
                      <span
                        className={shipmentStatusClassName(selectedShipment.status)}
                        data-testid="online-store-shipment-status"
                      >
                        {humanizeToken(selectedShipment.status)}
                      </span>
                    ) : null}
                  </div>

                  <div className="online-orders-next-step" data-testid="online-store-next-action">
                    <span className="online-orders-next-step__eyebrow">Recommended next step</span>
                    <strong>{dispatchRecommendation.title}</strong>
                    <p>{dispatchRecommendation.detail}</p>
                  </div>

                  <div className="online-orders-readiness-grid" data-testid="online-store-readiness">
                    {dispatchReadiness.map((item) => (
                      <article key={item.label} className={readinessClassName(item.state)}>
                        <span className="online-orders-readiness-card__label">{item.label}</span>
                        <strong>{item.headline}</strong>
                        <p>{item.detail}</p>
                      </article>
                    ))}
                  </div>

                  <div className="online-orders-dispatch-controls">
                    <label>
                      Provider
                      <select
                        value={selectedProviderKey}
                        onChange={(event) => setSelectedProviderKey(event.target.value)}
                        disabled={pendingAction.length > 0 || Boolean(selectedShipment)}
                      >
                        {(detailPayload?.supportedProviders ?? []).map((provider) => (
                          <option key={provider.key} value={provider.key}>
                            {`${provider.displayName}${provider.isDefaultProvider ? " (Default)" : ""} · ${provider.mode}/${provider.implementationState}${provider.isAvailable ? "" : " · needs config"}`}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Registered printer
                      <select
                        value={selectedPrinterId}
                        onChange={(event) => setSelectedPrinterId(event.target.value)}
                        disabled={pendingAction.length > 0 || loadingPrinters}
                        data-testid="online-store-printer-select"
                      >
                        <option value="">
                          {loadingPrinters
                            ? "Loading printers..."
                            : printersPayload?.defaultShippingLabelPrinterId
                              ? "Use default shipping-label printer"
                              : "Select a registered printer"}
                        </option>
                        {(printersPayload?.printers ?? []).map((printer) => (
                          <option key={printer.id} value={printer.id}>
                            {`${printer.name}${printer.isDefaultShippingLabelPrinter ? " (Default)" : ""} · ${printer.transportMode}`}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Copies
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={copies}
                        onChange={(event) => setCopies(event.target.value)}
                      />
                    </label>
                  </div>

                  <div className="restricted-panel info-panel online-orders-dispatch-printer-info">
                    {selectedPrinter
                      ? `Dispatch printer: ${selectedPrinter.name} (${selectedPrinter.transportMode})${selectedPrinter.location ? ` · ${selectedPrinter.location}` : ""}.`
                      : printersPayload?.printers.length
                        ? "Choose a registered shipping-label printer before preparing or printing this shipment."
                        : "No active shipping-label printer is registered. Ask an admin to add one in Settings before printing."}
                  </div>

                  <div className="restricted-panel info-panel online-orders-dispatch-printer-info">
                    {selectedShipment && shipmentProvider
                      ? `Shipment provider: ${shipmentProvider.displayName}${selectedShipment.providerEnvironment ? ` (${selectedShipment.providerEnvironment})` : ""} · service ${selectedShipment.serviceName}.${shipmentProvider.supportsShipmentRefresh ? " Refresh supported." : ""}${shipmentProvider.supportsShipmentVoid ? " Void supported." : ""}`
                      : selectedProvider
                        ? selectedProvider.isAvailable
                          ? `Shipment provider: ${selectedProvider.displayName}${selectedProvider.configuration?.environment ? ` (${selectedProvider.configuration.environment})` : ""}${selectedProvider.defaultServiceName ? ` · default service ${selectedProvider.defaultServiceName}` : ""}.`
                          : `Shipment provider: ${selectedProvider.displayName} is not ready. Configure its credentials/endpoint in Settings or choose an available provider.`
                        : "No shipment provider is currently selected."}
                  </div>

                  {!selectedShipment ? (
                    <EmptyState
                      title="No shipment label yet"
                      description={
                        selectedOrder.fulfillmentMethod === "SHIPPING"
                          ? !isOrderPacked(selectedOrder)
                            ? "Mark this order as packed before creating a shipment label or adding it to the bulk shipment queue."
                            : selectedProvider?.isAvailable
                            ? "Generate the first shipment label for this web order. CorePOS will resolve the selected provider, store the returned label artifact locally, and keep the result reprintable."
                            : "The selected provider is not currently ready for shipment creation. Configure or enable it in Settings, or switch back to an available provider."
                          : "Click & collect orders do not create shipping labels in this flow."
                      }
                    />
                  ) : (
                    <>
                      <div className="online-orders-shipment-card">
                        <dl className="online-orders-detail__facts">
                          <div>
                            <dt>Tracking</dt>
                            <dd data-testid="online-store-tracking-number">{selectedShipment.trackingNumber}</dd>
                          </div>
                          <div>
                            <dt>Provider</dt>
                            <dd>{selectedShipment.providerDisplayName}</dd>
                          </div>
                          <div>
                            <dt>Environment</dt>
                            <dd>{selectedShipment.providerEnvironment ?? "-"}</dd>
                          </div>
                          <div>
                            <dt>Service</dt>
                            <dd>{selectedShipment.serviceName}</dd>
                          </div>
                          <div>
                            <dt>Provider status</dt>
                            <dd>{selectedShipment.providerStatus ?? "-"}</dd>
                          </div>
                          <div>
                            <dt>Refund status</dt>
                            <dd>{selectedShipment.providerRefundStatus ?? "-"}</dd>
                          </div>
                          <div>
                            <dt>Label format</dt>
                            <dd>{selectedShipment.labelFormat}</dd>
                          </div>
                          <div>
                            <dt>Provider shipment ref</dt>
                            <dd>{selectedShipment.providerShipmentReference ?? selectedShipment.providerReference ?? "-"}</dd>
                          </div>
                          <div>
                            <dt>Provider tracking ref</dt>
                            <dd>{selectedShipment.providerTrackingReference ?? "-"}</dd>
                          </div>
                          <div>
                            <dt>Provider synced</dt>
                            <dd>{formatDateTime(selectedShipment.providerSyncedAt)}</dd>
                          </div>
                          <div>
                            <dt>Sync issue</dt>
                            <dd>{selectedShipment.providerSyncError ?? "-"}</dd>
                          </div>
                          <div>
                            <dt>Prepared</dt>
                            <dd>{formatDateTime(selectedShipment.printPreparedAt)}</dd>
                          </div>
                          <div>
                            <dt>Printed</dt>
                            <dd>{formatDateTime(selectedShipment.printedAt)}</dd>
                          </div>
                          <div>
                            <dt>Dispatched</dt>
                            <dd>{formatDateTime(selectedShipment.dispatchedAt)}</dd>
                          </div>
                          <div>
                            <dt>Void requested</dt>
                            <dd>{formatDateTime(selectedShipment.voidRequestedAt)}</dd>
                          </div>
                          <div>
                            <dt>Voided</dt>
                            <dd>{formatDateTime(selectedShipment.voidedAt)}</dd>
                          </div>
                          <div>
                            <dt>Reprints</dt>
                            <dd>{selectedShipment.reprintCount}</dd>
                          </div>
                        </dl>
                        <div className="online-orders-shipment-card__links">
                          <a className="button-link" href={selectedShipment.labelContentPath} target="_blank" rel="noreferrer">
                            Open raw ZPL
                          </a>
                          <a className="button-link" href={selectedShipment.labelPayloadPath} target="_blank" rel="noreferrer">
                            Open label payload
                          </a>
                        </div>
                      </div>

                      {selectedShipment?.providerSyncError ? (
                        <div className="online-orders-print-notice online-orders-print-notice--error">
                          {selectedShipment.providerSyncError} Refresh provider status before closeout, reprint, or replacement work.
                        </div>
                      ) : null}

                      {printNotice ? (
                        <div
                          className={`online-orders-print-notice online-orders-print-notice--${printNotice.tone}`}
                          data-testid="online-store-print-status-message"
                        >
                          {printNotice.text}
                        </div>
                      ) : null}
                    </>
                  )}

                  <div className="online-orders-dispatch-action-grid">
                    {dispatchActionCards.map((card) => {
                      let actionLabel = card.title;
                      let actionTestId = "";
                      let actionHandler: (() => void) | null = null;

                      switch (card.key) {
                        case "generate":
                          actionLabel = pendingAction === "generate" ? "Generating..." : "Generate Shipment Label";
                          actionTestId = "online-store-generate-label";
                          actionHandler = () => {
                            void handleGenerateShipment();
                          };
                          break;
                        case "refresh":
                          actionLabel = pendingAction === "refresh" ? "Refreshing..." : "Refresh Provider Status";
                          actionTestId = "online-store-refresh-shipment";
                          actionHandler = () => {
                            void handleRefreshShipment();
                          };
                          break;
                        case "cancel":
                          actionLabel = pendingAction === "cancel" ? "Voiding..." : "Void Shipment";
                          actionTestId = "online-store-cancel-shipment";
                          actionHandler = () => {
                            void handleCancelShipment();
                          };
                          break;
                        case "regenerate":
                          actionLabel = pendingAction === "regenerate" ? "Generating..." : "Generate Replacement Shipment";
                          actionTestId = "online-store-regenerate-shipment";
                          actionHandler = () => {
                            void handleRegenerateShipment();
                          };
                          break;
                        case "prepare-print":
                          actionLabel = pendingAction === "prepare-print"
                            ? "Preparing..."
                            : selectedShipment?.printPreparedAt
                              ? "Re-prepare Zebra Print Payload"
                              : "Prepare Zebra Print Payload";
                          actionTestId = "online-store-prepare-print";
                          actionHandler = () => {
                            void handlePreparePrint();
                          };
                          break;
                        case "print":
                          actionLabel = pendingAction === "print"
                            ? "Printing..."
                            : selectedShipment?.printedAt
                              ? "Reprint via Windows Agent"
                              : "Print via Windows Agent";
                          actionTestId = "online-store-print";
                          actionHandler = () => {
                            void handlePrintShipment();
                          };
                          break;
                        case "dispatch":
                          actionLabel = pendingAction === "dispatch" ? "Dispatching..." : "Mark Dispatched";
                          actionTestId = "online-store-dispatch";
                          actionHandler = () => {
                            void handleDispatchShipment();
                          };
                          break;
                        default:
                          break;
                      }

                      return (
                        <article
                          key={card.key}
                          className={`online-orders-dispatch-action-card${card.enabled ? "" : " online-orders-dispatch-action-card--disabled"}`}
                        >
                          <div className="online-orders-dispatch-action-card__copy">
                            <div className="online-orders-dispatch-action-card__header">
                              <strong>{card.title}</strong>
                              <span className={`status-badge${card.enabled ? " status-ready" : ""}`}>
                                {card.enabled ? "Available now" : "Blocked"}
                              </span>
                            </div>
                            <p>{card.detail}</p>
                          </div>
                          <button
                            type="button"
                            className={card.enabled ? "button-link" : "button-link"}
                            onClick={actionHandler ?? undefined}
                            disabled={!card.enabled || pendingAction.length > 0}
                            data-testid={actionTestId}
                          >
                            {actionLabel}
                          </button>
                        </article>
                      );
                    })}
                  </div>

                  <div className="online-orders-timeline" data-testid="online-store-shipment-timeline">
                    <div className="online-orders-detail__section-header">
                      <h3>Recent shipment activity</h3>
                      {selectedShipment ? <span className="status-badge">{shipmentTimeline.length} events</span> : null}
                    </div>
                    {shipmentTimeline.length > 0 ? (
                      <ol className="online-orders-timeline__list">
                        {shipmentTimeline.map((entry) => (
                          <li key={entry.key} className={timelineToneClassName(entry.tone)}>
                            <div className="online-orders-timeline__meta">
                              <strong>{entry.label}</strong>
                              <time dateTime={entry.timestamp}>{formatDateTime(entry.timestamp)}</time>
                            </div>
                            <p>{entry.detail}</p>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="online-orders-timeline__empty">
                        No shipment activity yet. Generate the first shipment label to start the dispatch timeline.
                      </p>
                    )}
                  </div>
                </section>
              </div>

              <div className="online-orders-detail__preview-grid">
                <section className="online-orders-preview-card">
                  <div className="online-orders-detail__section-header">
                    <h3>Label Preview</h3>
                    {loadingLabel ? <span className="status-badge">Loading</span> : null}
                  </div>
                  <p className="online-orders-preview-card__description">
                    Stored label content stays inline ZPL so provider-backed shipment labels remain reprintable inside CorePOS without depending on a remote label URL at print time. Voided or void-pending shipments stay visible for audit, but CorePOS blocks them from being treated as active printable labels.
                  </p>
                  <pre className="online-orders-preview" data-testid="online-store-label-preview">
                    {labelPayload?.document.content ?? "No shipment label available for this order yet."}
                  </pre>
                </section>

                <section className="online-orders-preview-card">
                  <div className="online-orders-detail__section-header">
                    <h3>Prepared Print Payload</h3>
                    <span className="status-badge">Windows local-agent contract</span>
                  </div>
                  <p className="online-orders-preview-card__description">
                    This payload is the backend-owned print intent that the Windows dispatch print agent consumes without routing through the browser print dialog.
                  </p>
                  <pre className="online-orders-preview" data-testid="online-store-print-request-preview">
                    {printPayload
                      ? JSON.stringify(printPayload.printRequest, null, 2)
                      : "Prepare print to view the print-request payload for this shipment."}
                  </pre>
                  {printJob ? (
                    <dl className="online-orders-print-job-summary" data-testid="online-store-print-job-result">
                      <div>
                        <dt>Print job</dt>
                        <dd>{printJob.jobId}</dd>
                      </div>
                      <div>
                        <dt>Transport</dt>
                        <dd>{printJob.transportMode}</dd>
                      </div>
                      <div>
                        <dt>Target</dt>
                        <dd>{printJob.printerTarget}</dd>
                      </div>
                      <div>
                        <dt>Completed</dt>
                        <dd>{formatDateTime(printJob.completedAt)}</dd>
                      </div>
                    </dl>
                  ) : null}
                </section>
              </div>
            </div>
          ) : null}
        </SurfaceCard>
      </div>
    </div>
  );
};
