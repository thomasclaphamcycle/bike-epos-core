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
  createdAt: string;
  updatedAt: string;
  items: WebOrderItem[];
  shipments: WebOrderShipment[];
};

type ListOrdersResponse = {
  filters: {
    q: string | null;
    status: WebOrderStatus | null;
    take: number;
    skip: number;
  };
  summary: {
    total: number;
    readyForDispatchCount: number;
    labelReadyCount: number;
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

const humanizeToken = (value: string) =>
  value
    .toLowerCase()
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");

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
          ? provider?.isAvailable
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

  return [shipmentItem, printItem, dispatchItem];
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

export const OnlineStoreOrdersPage = () => {
  const { error, success } = useToasts();
  const listRequestSequenceRef = useRef(0);
  const detailRequestSequenceRef = useRef(0);
  const labelRequestSequenceRef = useRef(0);

  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | WebOrderStatus>("");
  const [ordersPayload, setOrdersPayload] = useState<ListOrdersResponse | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [detailPayload, setDetailPayload] = useState<OrderDetailResponse | null>(null);
  const [printersPayload, setPrintersPayload] = useState<RegisteredPrinterListResponse | null>(null);
  const [labelPayload, setLabelPayload] = useState<ShipmentLabelPayloadResponse | null>(null);
  const [printPayload, setPrintPayload] = useState<ShipmentPrintRequestResponse | null>(null);
  const [printJob, setPrintJob] = useState<ShipmentPrintExecutionResponse["printJob"] | null>(null);
  const [printNotice, setPrintNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
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

      const payload = await apiGet<ListOrdersResponse>(`/api/online-store/orders?${params.toString()}`);
      if (requestSequence !== listRequestSequenceRef.current) {
        return null;
      }

      setOrdersPayload(payload);
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
  }, [error, searchQuery, statusFilter]);

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
    void loadPrinters();
  }, [loadPrinters]);

  useEffect(() => {
    setLabelPayload(null);
    setPrintPayload(null);
    setPrintJob(null);
    setPrintNotice(null);

    if (!selectedOrderId) {
      setDetailPayload(null);
      return;
    }

    void loadOrderDetail(selectedOrderId);
  }, [loadOrderDetail, selectedOrderId]);

  const selectedShipmentId = detailPayload?.order.shipments[0]?.id ?? "";

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

  const canGenerateShipment = Boolean(
    selectedOrder
      && selectedOrder.fulfillmentMethod === "SHIPPING"
      && selectedOrder.status === "READY_FOR_DISPATCH"
      && selectedProvider?.isAvailable
      && !selectedShipment,
  );
  const shipmentIsVoidBlocked = selectedShipment
    ? selectedShipment.status === "VOIDED" || selectedShipment.status === "VOID_PENDING"
    : false;
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
            <span className="metric-label">Ready for dispatch</span>
            <strong className="metric-value">{ordersPayload?.summary.readyForDispatchCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Orders waiting on shipment action</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Labels ready</span>
            <strong className="metric-value">{ordersPayload?.summary.labelReadyCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Orders with an unprinted active label</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Dispatched</span>
            <strong className="metric-value">{ordersPayload?.summary.dispatchedCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Completed shipment confirmations</span>
          </div>
        </div>

        <div className="restricted-panel info-panel online-orders-info-panel">
          This flow keeps shipment orchestration inside CorePOS, resolves shipment creation through managed courier-provider settings, returns a stored ZPL artifact for reliable thermal-label output, and routes every print through a registered dispatch printer before handing the job to the Windows/local print agent.
        </div>
      </SurfaceCard>

      <div className="online-orders-toolbar">
        <label className="online-orders-toolbar__field">
          Search orders
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Order number, customer, email, tracking"
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
      </div>

      <div className="online-orders-layout">
        <SurfaceCard className="online-orders-panel">
          <SectionHeader
            title="Web Orders"
            description="Manager-facing dispatch view for current online orders. Use the API or demo seed data to create additional web orders while the wider storefront remains under construction."
          />

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
                return (
                  <button
                    key={order.id}
                    type="button"
                    className={`online-order-row${isSelected ? " online-order-row--selected" : ""}`}
                    onClick={() => setSelectedOrderId(order.id)}
                    data-testid={`online-store-order-row-${order.id}`}
                  >
                    <div className="online-order-row__topline">
                      <strong>{order.orderNumber}</strong>
                      <span className={orderStatusClassName(order.status)}>{humanizeToken(order.status)}</span>
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
                      <span>
                        {order.latestShipment
                          ? `${humanizeToken(order.latestShipment.status)} · ${order.latestShipment.trackingNumber}`
                          : "No shipment yet"}
                      </span>
                    </div>
                  </button>
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
                      <dt>Total</dt>
                      <dd>{formatMoney(selectedOrder.totalPence)}</dd>
                    </div>
                  </dl>
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

                <section className="online-orders-detail__section online-orders-detail__section--shipment">
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
                          ? selectedProvider?.isAvailable
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
                          {selectedShipment.providerSyncError}
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
