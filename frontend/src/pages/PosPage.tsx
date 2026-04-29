import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { apiDelete, apiGet, apiPatch, apiPost } from "../api/client";
import { type AppConfig, useAppConfig } from "../config/appConfig";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useToasts } from "../components/ToastProvider";
import { PosCustomerCapturePanel } from "../features/customerCapture/PosCustomerCapturePanel";
import { usePosCustomerCapture } from "../features/customerCapture/usePosCustomerCapture";
import { type PosCustomerCaptureTarget } from "../features/customerCapture/posCustomerCapture";
import {
  getManagedPrintJob,
  getManagedPrintJobStatusBadgeClassName,
  getManagedPrintJobStatusLabel,
  isManagedPrintJobTerminal,
  type ManagedPrintJobSummary,
} from "../features/printing/managedPrintJobs";
import {
  getManagedReceiptPrintErrorMessage,
  getManagedReceiptPrintSuccessMessage,
  printManagedReceipt,
} from "../features/receipts/managedReceiptPrinting";
import { getStoredReceiptWorkstationKey } from "../features/receipts/receiptWorkstation";
import { parseCombinedCustomerName } from "../utils/customerName";
import {
  DEFAULT_SALE_CONTEXT,
  getPosOpenState,
  getPosSaleSourceLabel,
  getSaleContextSourceRef,
  resolvePosLineItemType,
  type PosLineItem,
  type PosSaleSource,
  type SaleContext,
} from "../features/pos/posContext";
import {
  CARD_TERMINAL_ROUTES,
  POS_TILL_POINTS,
  getCardTerminalRoute,
  getDefaultTerminalRouteIdForTill,
  getPosTillPoint,
  getStoredPosWorkstationAssignment,
  isCardTerminalRouteId,
  isPosTillPointId,
  saveStoredPosWorkstationAssignment,
  type CardTerminalRouteId,
  type PosTillPointId,
} from "../features/pos/tillWorkstation";
import { toBackendUrl } from "../utils/backendUrl";
import { isExactLookupMatch, looksLikeScannerInput } from "../utils/barcode";

const ACTIVE_SALE_KEY = "corepos.activeSaleId";
const LazyCustomerProfilePage = lazy(async () => {
  const mod = await import("./CustomerProfilePage");
  return {
    default: mod.CustomerProfilePage,
  };
});

const ACTIVE_BASKET_KEY = "corepos_active_basket_id";

type ProductSearchRow = {
  id: string;
  productId?: string;
  name: string;
  sku: string;
  barcode: string | null;
  pricePence: number;
  onHandQty: number;
};

type VariantDetail = {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  name: string | null;
  option: string | null;
  retailPricePence: number;
  product?: {
    name: string;
  };
};

type ServiceTemplateQuickAdd = {
  id: string;
  name: string;
  targetTotalPricePence: number | null;
  lineCount: number;
  lines: Array<{
    lineTotalPence: number;
    isOptional: boolean;
  }>;
};

type QuickAddTile = {
  key: string;
  testId: string;
  label: string;
  query: string;
} & (
  | {
      type: "INVENTORY";
      product: ProductSearchRow;
    }
  | {
      type: "SERVICE_TEMPLATE";
      template: ServiceTemplateQuickAdd;
      pricePence: number;
    }
);

type BasketResponse = {
  id: string;
  customer: CustomerSearchRow | null;
  status: string;
  source?: PosSaleSource;
  sourceRef?: string | null;
  sourceLabel?: string;
  sourceDetail?: string | null;
  items: Array<{
    id: string;
    variantId: string;
    type?: "PART" | "LABOUR";
    sku: string;
    productName: string;
    variantName: string | null;
    quantity: number;
    unitPricePence: number;
    lineTotalPence: number;
    createdAt?: string;
    updatedAt?: string;
  }>;
  totals: {
    subtotalPence: number;
    taxPence: number;
    totalPence: number;
  };
};

type CustomerSearchRow = {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type SaleResponse = {
  sale: {
    id: string;
    subtotalPence: number;
    taxPence: number;
    totalPence: number;
    completedAt: string | null;
    source?: PosSaleSource;
    sourceRef?: string | null;
    sourceLabel?: string;
    sourceDetail?: string | null;
    customer: CustomerSearchRow | null;
  };
  saleItems: Array<{
    id: string;
    productName: string;
    variantName: string | null;
    quantity: number;
    unitPricePence: number;
    lineTotalPence: number;
  }>;
  tenderSummary: {
    totalPence: number;
    tenderedPence: number;
    remainingPence: number;
    changeDuePence: number;
  };
  tenders: Array<{
    id: string;
    method: string;
    amountPence: number;
  }>;
};

type PreloadedBasketItemInput = {
  variantId: string;
  quantity: number;
  unitPricePence: number;
};

type CompleteSaleResult = {
  saleId: string;
  completedAt: string;
  changeDuePence: number;
  receiptUrl?: string;
};

type ConfiguredTenderMethod = AppConfig["pos"]["enabledTenderMethods"][number];
type TenderMethod = ConfiguredTenderMethod | "GIFT_CARD";
type SaleTenderMethod = Exclude<ConfiguredTenderMethod, "STORE_CREDIT">;
type CardPaymentMode = "TERMINAL" | "MANUAL";
type MockCardTerminalStatus = "PENDING" | "APPROVED" | "DECLINED";
type CardTerminalTrafficState = "idle" | "pending" | "approved" | "declined";

type MockCardTerminalState = {
  status: MockCardTerminalStatus;
  amountPence: number;
  tillPointId: PosTillPointId;
  terminalRouteId: CardTerminalRouteId;
  terminalLabel: string;
  reference: string;
  message: string;
  requestedAt: string;
  completedAt: string | null;
};

type CreditBalanceResponse = {
  account: {
    id: string;
    customerId: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  balancePence: number;
};

type CreditApplyResponse = {
  appliedPence: number;
  outstandingPence: number;
  balancePence: number;
};

type SaleTenderSummaryResponse = {
  tenderedPence: number;
  tenders: Array<{
    id: string;
    method: string;
    amountPence: number;
  }>;
};

type CardTerminalPublicConfig = {
  provider: "DOJO";
  enabled: boolean;
  configured: boolean;
  mockMode: boolean;
  defaultTerminalId: string | null;
  terminalRoutes: Array<{
    routeId: CardTerminalRouteId;
    label: string;
    terminalId: string | null;
  }>;
  workstationHint: {
    remoteAddress: string | null;
    suggestedTillPointId: PosTillPointId | null;
  };
  currencyCode: string;
};

type CardTerminalOption = {
  id: string;
  terminalId: string;
  name: string;
  status: string;
  tid?: string | null;
};

type CardTerminalSessionState = {
  id: string;
  provider: "DOJO";
  status: string;
  saleId: string;
  corePaymentIntentId: string | null;
  saleTenderId: string | null;
  providerPaymentIntentId: string | null;
  providerTerminalSessionId: string | null;
  terminalId: string;
  amountPence: number;
  currencyCode: string;
  providerStatus: string | null;
  providerReference: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  isFinal: boolean;
};

type CardTerminalConfigResponse = {
  config: CardTerminalPublicConfig;
};

type CardTerminalListResponse = CardTerminalConfigResponse & {
  terminals: CardTerminalOption[];
};

type CardTerminalSessionResponse = {
  session: CardTerminalSessionState;
};

type CompletedSaleState = {
  saleId: string;
  receiptUrl: string;
  changeDuePence: number;
  tenderMethod: TenderMethod;
  customerName: string | null;
  customerEmail: string | null;
  cashTenderedPence: number | null;
  totalPaidPence: number;
  receiptPrintJob: ManagedPrintJobSummary | null;
  receiptPrinterName: string | null;
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;
const CARD_TERMINAL_POLL_MS = 1500;

const createMockCardTerminalReference = () =>
  `MOCK-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 12)}`;

const getInitialPosWorkstationState = () => {
  const assignment = getStoredPosWorkstationAssignment();
  const terminalRouteId = assignment.terminalRouteId
    ?? (assignment.tillPointId ? getDefaultTerminalRouteIdForTill(assignment.tillPointId) : "TERMINAL_A");

  return {
    tillPointId: assignment.tillPointId,
    terminalRouteId,
    terminalRouteOverride: assignment.terminalRouteOverride,
  };
};

const getInitialCardPaymentMode = (): CardPaymentMode =>
  getStoredPosWorkstationAssignment().tillPointId ? "TERMINAL" : "MANUAL";

const resolveCardTerminalRouteProviderId = (
  routeId: CardTerminalRouteId,
  terminals: CardTerminalOption[],
  config: CardTerminalPublicConfig | null,
) => {
  const configuredRoute = config?.terminalRoutes.find((route) => route.routeId === routeId);
  if (configuredRoute?.terminalId) {
    return configuredRoute.terminalId;
  }

  const routeIndex = routeId === "TERMINAL_A" ? 0 : 1;
  const terminal = terminals[routeIndex] ?? terminals[0];
  return terminal?.terminalId || terminal?.id || config?.defaultTerminalId || "";
};

const getCardTerminalRouteLabel = (
  routeId: CardTerminalRouteId,
  terminals: CardTerminalOption[],
  config: CardTerminalPublicConfig | null,
) => {
  const route = getCardTerminalRoute(routeId);
  if (!config?.enabled || !config.configured) {
    return route.label;
  }

  const configuredRoute = config.terminalRoutes.find((entry) => entry.routeId === routeId);
  const configuredTerminal = configuredRoute?.terminalId
    ? terminals.find((terminal) =>
        terminal.terminalId === configuredRoute.terminalId || terminal.id === configuredRoute.terminalId)
    : null;
  if (configuredTerminal) {
    return configuredTerminal.name || configuredTerminal.terminalId || route.label;
  }

  const routeIndex = routeId === "TERMINAL_A" ? 0 : 1;
  const terminal = terminals[routeIndex];
  return terminal?.name || terminal?.terminalId || terminal?.id || configuredRoute?.label || route.label;
};

const TENDER_METHOD_OPTIONS: Array<{ value: TenderMethod; label: string; shortLabel: string }> = [
  { value: "CARD", label: "Card", shortLabel: "Card" },
  { value: "CASH", label: "Cash", shortLabel: "Cash" },
  { value: "BANK_TRANSFER", label: "Bank transfer", shortLabel: "Bank" },
  { value: "VOUCHER", label: "Voucher", shortLabel: "Voucher" },
  { value: "GIFT_CARD", label: "Gift card", shortLabel: "Gift" },
  { value: "STORE_CREDIT", label: "Store credit", shortLabel: "S.Credit" },
];

const FALLBACK_TENDER_METHODS: TenderMethod[] = ["CARD", "CASH"];
const CUSTOMER_EMAIL_DOMAIN_SHORTCUTS = [
  "@gmail.com",
  "@hotmail.com",
  "@hotmail.co.uk",
  "@outlook.com",
  "@yahoo.co.uk",
  "@icloud.com",
] as const;

type CustomerEmailDomainShortcut = (typeof CUSTOMER_EMAIL_DOMAIN_SHORTCUTS)[number];

const isSaleTenderMethod = (method: TenderMethod): method is SaleTenderMethod =>
  method !== "STORE_CREDIT" && method !== "GIFT_CARD";

const getTenderMethodLabel = (method: TenderMethod | string) =>
  TENDER_METHOD_OPTIONS.find((option) => option.value === method)?.label ?? method;

const getTenderMethodShortLabel = (method: TenderMethod | string) =>
  TENDER_METHOD_OPTIONS.find((option) => option.value === method)?.shortLabel
  ?? getTenderMethodLabel(method);

const getTenderMethodIcon = (method: TenderMethod) => {
  const commonProps = {
    "aria-hidden": true,
    focusable: false,
    viewBox: "0 0 24 24",
  } as const;

  switch (method) {
    case "CASH":
      return (
        <svg {...commonProps}>
          <rect x="3.5" y="7" width="17" height="10" rx="1.5" />
          <circle cx="12" cy="12" r="2.4" />
          <path d="M6.5 9.5h1.2M16.3 14.5h1.2" />
        </svg>
      );
    case "CARD":
      return (
        <svg {...commonProps}>
          <rect x="3.5" y="6.5" width="17" height="11" rx="2" />
          <path d="M3.5 10h17" />
          <path d="M7 14.5h3.2" />
        </svg>
      );
    case "BANK_TRANSFER":
      return (
        <svg {...commonProps}>
          <path d="M4 10h16" />
          <path d="M5.5 10v7M9.8 10v7M14.2 10v7M18.5 10v7" />
          <path d="M3.5 17h17" />
          <path d="M12 4.5 4.5 8h15L12 4.5Z" />
        </svg>
      );
    case "VOUCHER":
      return (
        <svg {...commonProps}>
          <path d="M5 8.5h14v7H5z" />
          <path d="M8 8.5v7M16 8.5v7" />
          <path d="m9.2 12.8 5.6-3.1M9.5 10.2h.1M14.4 14.6h.1" />
        </svg>
      );
    case "STORE_CREDIT":
      return (
        <svg {...commonProps}>
          <path d="M5 10.5h14" />
          <path d="m6 10.5 1.2-4h9.6l1.2 4" />
          <path d="M7 10.5v7h10v-7" />
          <path d="M9 17.5v-4h6v4" />
          <path d="M4.8 10.5c.2 1.3 1 2 2.2 2s2-.7 2.2-2c.2 1.3 1 2 2.2 2s2-.7 2.2-2c.2 1.3 1 2 2.2 2s2-.7 2.2-2" />
        </svg>
      );
    case "GIFT_CARD":
      return (
        <svg {...commonProps}>
          <path d="M4.5 10h15v9h-15z" />
          <path d="M12 10v9M4 10h16M5.5 7.5h13v2.5h-13z" />
          <path d="M12 7.5c-1.6-3-5-2.7-5-.8 0 1.6 2.2 1.7 5 .8Z" />
          <path d="M12 7.5c1.6-3 5-2.7 5-.8 0 1.6-2.2 1.7-5 .8Z" />
        </svg>
      );
    default:
      return null;
  }
};

const getCustomerEmailLocalPart = (email: string) => {
  const [localPart = ""] = email.trim().split("@");
  return localPart.trim().replace(/\s+/g, "");
};

const getCardTerminalStatusLabel = (session: CardTerminalSessionState | null) => {
  if (!session) {
    return null;
  }

  if (session.lastErrorMessage) {
    return session.lastErrorMessage;
  }

  switch (session.status) {
    case "CREATED":
    case "INITIATED":
      return "Waiting for the customer on the card terminal.";
    case "SIGNATURE_VERIFICATION_REQUIRED":
      return "Signature verification is required.";
    case "AUTHORIZED":
      return "Card payment authorized.";
    case "CAPTURED":
      return "Card payment captured.";
    case "DECLINED":
      return "Card payment declined.";
    case "CANCELED":
      return "Card payment canceled.";
    case "EXPIRED":
      return "Card payment expired.";
    case "FAILED":
      return "Card payment failed.";
    default:
      return session.providerStatus ?? "Card terminal status unknown.";
  }
};

const getCardTerminalSetupLabel = (config: CardTerminalPublicConfig | null) => {
  if (!config) {
    return "Checking";
  }
  if (config.enabled && config.configured) {
    return config.mockMode ? "Mock ready" : "Ready";
  }
  if (config.enabled) {
    return "Details needed";
  }
  return "Setup pending";
};

const getPosReceiptPrintButtonLabel = (
  queueing: boolean,
  printJob: ManagedPrintJobSummary | null,
) => {
  if (queueing) {
    return "Queueing...";
  }
  if (printJob?.status === "PENDING" || printJob?.status === "PROCESSING") {
    return "Printing...";
  }
  if (printJob?.status === "SUCCEEDED") {
    return "Reprint receipt";
  }
  if (printJob?.status === "FAILED" || printJob?.status === "CANCELLED") {
    return "Retry receipt print";
  }
  return "Print receipt";
};

const parseCurrencyInputToPence = (value: string): number | null => {
  const normalized = value.trim().replace(/[^0-9.]/g, "");
  if (!normalized) {
    return null;
  }

  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) {
    return null;
  }

  const [pounds, decimal = ""] = normalized.split(".");
  return Number(pounds) * 100 + Number((decimal + "00").slice(0, 2));
};

const getApiErrorStatus = (value: unknown) => {
  if (!value || typeof value !== "object" || !("status" in value)) {
    return null;
  }

  const status = (value as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
};

const resolveHighlightedProductIndex = (
  rows: ProductSearchRow[],
  highlightedIndex: number,
) => {
  if (rows.length === 0) {
    return -1;
  }

  return highlightedIndex >= 0 && highlightedIndex < rows.length ? highlightedIndex : 0;
};

const toQuickAddKey = (label: string, index: number) => {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || `quick-add-${index + 1}`;
};

const toProductSearchRowFromVariant = (variant: VariantDetail): ProductSearchRow => ({
  id: variant.id,
  productId: variant.productId,
  name: variant.name ?? variant.option ?? variant.product?.name ?? variant.sku,
  sku: variant.sku,
  barcode: variant.barcode,
  pricePence: variant.retailPricePence,
  onHandQty: 0,
});

export const PosPage = () => {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { success, error } = useToasts();
  const appConfig = useAppConfig();
  const isPageActiveRef = useRef(true);
  const posLifecycleRequestIdRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const productResultRefs = useRef<Array<HTMLTableRowElement | null>>([]);
  const customerSearchInputRef = useRef<HTMLInputElement | null>(null);
  const customerResultRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const newCustomerNameInputRef = useRef<HTMLInputElement | null>(null);
  const cashTenderedInputRef = useRef<HTMLInputElement | null>(null);
  const lastAddedRowTimeoutRef = useRef<number | null>(null);
  const cardTerminalPollTimeoutRef = useRef<number | null>(null);
  const pendingQuerySyncFrameRef = useRef<number | null>(null);
  const searchFocusFrameRef = useRef<number | null>(null);
  const basketItemRefs = useRef<Record<string, HTMLElement | null>>({});
  const basketStateRef = useRef<BasketResponse | null>(null);
  const saleStateRef = useRef<SaleResponse | null>(null);
  const selectedCustomerStateRef = useRef<CustomerSearchRow | null>(null);

  const [searchText, setSearchText] = useState("");
  const debouncedSearch = useDebouncedValue(searchText, 250);
  const [searchRows, setSearchRows] = useState<ProductSearchRow[]>([]);
  const [quickAddTiles, setQuickAddTiles] = useState<QuickAddTile[]>([]);
  const [highlightedProductIndex, setHighlightedProductIndex] = useState(-1);
  const [lastAddedBasketItemId, setLastAddedBasketItemId] = useState<string | null>(null);
  const [customerSearchText, setCustomerSearchText] = useState("");
  const debouncedCustomerSearch = useDebouncedValue(customerSearchText, 250);
  const [customerResults, setCustomerResults] = useState<CustomerSearchRow[]>([]);
  const [highlightedCustomerIndex, setHighlightedCustomerIndex] = useState(-1);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSearchRow | null>(null);
  const [customerOptionsOpen, setCustomerOptionsOpen] = useState(false);
  const [customerToolsExpanded, setCustomerToolsExpanded] = useState(false);
  const [customerProfileModalOpen, setCustomerProfileModalOpen] = useState(false);
  const [contextCustomerId, setContextCustomerId] = useState<string | null>(null);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [showCreateCustomer, setShowCreateCustomer] = useState(false);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerEmail, setNewCustomerEmail] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const hasNewCustomerEmailLocalPart = getCustomerEmailLocalPart(newCustomerEmail).length > 0;

  const applyCustomerEmailDomainShortcut = (domain: CustomerEmailDomainShortcut) => {
    setNewCustomerEmail((currentEmail) => {
      const localPart = getCustomerEmailLocalPart(currentEmail);
      return localPart ? `${localPart}${domain}` : currentEmail;
    });
  };

  const [basket, setBasket] = useState<BasketResponse | null>(null);
  const [sale, setSale] = useState<SaleResponse | null>(null);
  const [saleContext, setSaleContext] = useState<SaleContext>(DEFAULT_SALE_CONTEXT);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [selectedTenderMethod, setSelectedTenderMethod] = useState<TenderMethod>("CARD");
  const [selectedCardPaymentMode, setSelectedCardPaymentMode] = useState<CardPaymentMode>(getInitialCardPaymentMode);
  const [posWorkstationState, setPosWorkstationState] = useState(() => getInitialPosWorkstationState());
  const [suggestedTillPointId, setSuggestedTillPointId] = useState<PosTillPointId | null>(null);
  const [cashTenderedAmount, setCashTenderedAmount] = useState("");
  const [completedSale, setCompletedSale] = useState<CompletedSaleState | null>(null);
  const [printingReceipt, setPrintingReceipt] = useState(false);

  const [loading, setLoading] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [confirmingCardPayment, setConfirmingCardPayment] = useState(false);
  const [cardTerminalConfig, setCardTerminalConfig] = useState<CardTerminalPublicConfig | null>(null);
  const [cardTerminals, setCardTerminals] = useState<CardTerminalOption[]>([]);
  const [, setSelectedCardTerminalId] = useState("");
  const [cardTerminalSession, setCardTerminalSession] = useState<CardTerminalSessionState | null>(null);
  const [mockCardTerminalState, setMockCardTerminalState] = useState<MockCardTerminalState | null>(null);
  const [cardTerminalLoading, setCardTerminalLoading] = useState(false);
  const [cardTerminalMessage, setCardTerminalMessage] = useState<string | null>(null);
  const [returningToBasket, setReturningToBasket] = useState(false);
  const [paymentBasketExpanded, setPaymentBasketExpanded] = useState(false);

  const activeProductIndex = resolveHighlightedProductIndex(searchRows, highlightedProductIndex);
  const enabledTenderMethods = useMemo(() => {
    const configured = new Set(appConfig.pos.enabledTenderMethods);
    const enabled = TENDER_METHOD_OPTIONS
      .map((option) => option.value)
      .filter((method) =>
        method === "GIFT_CARD"
          ? configured.has("VOUCHER")
          : configured.has(method),
      );

    return enabled.length > 0 ? enabled : FALLBACK_TENDER_METHODS;
  }, [appConfig.pos.enabledTenderMethods]);
  const defaultTenderMethod = enabledTenderMethods[0] ?? "CARD";
  const cardTerminalConfigured = Boolean(cardTerminalConfig?.enabled && cardTerminalConfig.configured);
  const selectedTillPoint = posWorkstationState.tillPointId
    ? getPosTillPoint(posWorkstationState.tillPointId)
    : null;
  const selectedCardTerminalRouteId = posWorkstationState.terminalRouteId;
  const defaultCardTerminalRouteId = selectedTillPoint?.defaultTerminalRouteId ?? "TERMINAL_A";
  const selectedCardTerminalRoute = getCardTerminalRoute(selectedCardTerminalRouteId);
  const routedCardTerminalProviderId = cardTerminalConfigured
    ? resolveCardTerminalRouteProviderId(selectedCardTerminalRouteId, cardTerminals, cardTerminalConfig)
    : selectedCardTerminalRoute.mockTerminalId;

  const basketId = searchParams.get("basketId");
  const saleId = searchParams.get("saleId");
  const activeBasketId = basket?.id ?? basketId;
  const basketItemCount = basket?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const selectedCustomerAttachedToSale = Boolean(
    selectedCustomer
    && sale
    && (!sale.sale.customer?.id || sale.sale.customer.id === selectedCustomer.id),
  );
  const selectedCustomerAttachedToBasket = Boolean(
    selectedCustomer
    && !selectedCustomerAttachedToSale
    && basket?.customer?.id === selectedCustomer.id,
  );
  const checkoutMode = Boolean(sale);
  const compactCustomerRail = checkoutMode && !customerToolsExpanded;
  const showCustomerPanel = !completedSale;
  const showCustomerCapturePanel = showCustomerPanel;
  const showCustomerSearchTools = !selectedCustomer || customerToolsExpanded;
  const showBasketPanel = !checkoutMode || paymentBasketExpanded;
  const showBasketLineControls = !checkoutMode;
  const receiptWorkstationKey = useMemo(() => getStoredReceiptWorkstationKey(), []);
  const announcedReceiptPrintFailureRef = useRef<string | null>(null);
  const posOpenState = useMemo(() => getPosOpenState(location.state), [location.state]);
  const posOpenStateSignature = useMemo(() => JSON.stringify(posOpenState ?? null), [posOpenState]);

  useEffect(() => {
    basketStateRef.current = basket;
  }, [basket]);

  useEffect(() => {
    saleStateRef.current = sale;
  }, [sale]);

  useEffect(() => {
    selectedCustomerStateRef.current = selectedCustomer;
  }, [selectedCustomer]);

  useEffect(() => {
    if (!checkoutMode) {
      setPaymentBasketExpanded(false);
    }
  }, [checkoutMode]);

  useEffect(() => {
    if (!enabledTenderMethods.includes(selectedTenderMethod)) {
      setSelectedTenderMethod(defaultTenderMethod);
      setCashTenderedAmount("");
    }
  }, [defaultTenderMethod, enabledTenderMethods, selectedTenderMethod]);

  useEffect(() => {
    if (!posWorkstationState.tillPointId) {
      return;
    }

    try {
      saveStoredPosWorkstationAssignment({
        tillPointId: posWorkstationState.tillPointId,
        terminalRouteId: posWorkstationState.terminalRouteId,
        terminalRouteOverride: posWorkstationState.terminalRouteOverride,
        source: "manual",
      });
    } catch {
      // Local storage is only a workstation convenience; POS can continue without it.
    }
  }, [posWorkstationState]);

  useEffect(() => {
    if (!cardTerminalConfigured || !routedCardTerminalProviderId) {
      return;
    }

    setSelectedCardTerminalId(routedCardTerminalProviderId);
  }, [cardTerminalConfigured, routedCardTerminalProviderId]);

  useEffect(() => {
    if (!selectedCustomer?.id && customerProfileModalOpen) {
      setCustomerProfileModalOpen(false);
    }
  }, [customerProfileModalOpen, selectedCustomer?.id]);

  useEffect(() => {
    if (!customerProfileModalOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCustomerProfileModalOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [customerProfileModalOpen]);

  const beginPosLifecycleRequest = () => {
    posLifecycleRequestIdRef.current += 1;
    return posLifecycleRequestIdRef.current;
  };

  const canApplyPosLifecycle = (requestId?: number) =>
    isPageActiveRef.current && (requestId === undefined || requestId === posLifecycleRequestIdRef.current);

  const focusProductSearch = () => {
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  };

  const focusCustomerSearch = () => {
    window.requestAnimationFrame(() => {
      customerSearchInputRef.current?.focus();
    });
  };

  const restoreScannerSearchFocus = () => {
    if (searchFocusFrameRef.current) {
      window.cancelAnimationFrame(searchFocusFrameRef.current);
    }
    searchFocusFrameRef.current = window.requestAnimationFrame(() => {
      searchFocusFrameRef.current = window.requestAnimationFrame(() => {
        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement) {
          if (activeElement === customerSearchInputRef.current || activeElement === cashTenderedInputRef.current) {
            searchFocusFrameRef.current = null;
            return;
          }
          if (activeElement.closest(".pos-customer-panel, .pos-payment-panel, .pos-basket-panel, .pos-workstation-panel")) {
            searchFocusFrameRef.current = null;
            return;
          }
        }
        searchInputRef.current?.focus();
        searchFocusFrameRef.current = null;
      });
    });
  };

  const chooseTenderMethod = (method: TenderMethod) => {
    setSelectedTenderMethod(method);
    if (method !== "CASH") {
      setCashTenderedAmount("");
    }
    if (method !== "CARD") {
      setMockCardTerminalState(null);
      setCardTerminalMessage(null);
    }
  };

  const chooseCardPaymentMode = (mode: CardPaymentMode) => {
    setSelectedCardPaymentMode(mode);
    if (mode === "MANUAL") {
      setMockCardTerminalState(null);
      setCardTerminalMessage(null);
    }
  };

  const clearCardTerminalRoutePreview = () => {
    setMockCardTerminalState(null);
    setCardTerminalMessage(null);
    setCardTerminalSession((current) => (current?.isFinal ? null : current));
  };

  const chooseTillPoint = (id: PosTillPointId) => {
    if (mockCardTerminalState?.status === "PENDING" || (cardTerminalSession && !cardTerminalSession.isFinal)) {
      return;
    }

    const nextDefaultTerminalRouteId = getDefaultTerminalRouteIdForTill(id);
    setPosWorkstationState({
      tillPointId: id,
      terminalRouteId: nextDefaultTerminalRouteId,
      terminalRouteOverride: false,
    });
    setSuggestedTillPointId(null);
    clearCardTerminalRoutePreview();
  };

  const chooseCardTerminalRoute = (id: CardTerminalRouteId) => {
    if (mockCardTerminalState?.status === "PENDING" || (cardTerminalSession && !cardTerminalSession.isFinal)) {
      return;
    }

    setPosWorkstationState((current) => {
      if (!current.tillPointId) {
        return current;
      }

      return {
        tillPointId: current.tillPointId,
        terminalRouteId: id,
        terminalRouteOverride: id !== getDefaultTerminalRouteIdForTill(current.tillPointId),
      };
    });
    clearCardTerminalRoutePreview();
  };

  const clearCardTerminalPoll = () => {
    if (cardTerminalPollTimeoutRef.current) {
      window.clearTimeout(cardTerminalPollTimeoutRef.current);
      cardTerminalPollTimeoutRef.current = null;
    }
  };

  const flashBasketRow = (itemId: string | null) => {
    if (lastAddedRowTimeoutRef.current) {
      window.clearTimeout(lastAddedRowTimeoutRef.current);
    }
    setLastAddedBasketItemId(itemId);
    if (!itemId) {
      lastAddedRowTimeoutRef.current = null;
      return;
    }
    lastAddedRowTimeoutRef.current = window.setTimeout(() => {
      setLastAddedBasketItemId((current) => (current === itemId ? null : current));
      lastAddedRowTimeoutRef.current = null;
    }, 1400);
  };

  const findHighlightedBasketItemId = (previous: BasketResponse | null, next: BasketResponse) => {
    const previousById = new Map(previous?.items.map((item) => [item.id, item.quantity]) ?? []);
    const increasedItem = next.items.find((item) => item.quantity > (previousById.get(item.id) ?? 0));
    return increasedItem?.id ?? null;
  };

  const readStoredBasketId = () => localStorage.getItem(ACTIVE_BASKET_KEY)?.trim() || null;

  const persistActiveBasketId = (id: string) => {
    localStorage.setItem(ACTIVE_BASKET_KEY, id);
  };

  const clearStoredBasketId = () => {
    localStorage.removeItem(ACTIVE_BASKET_KEY);
  };

  const syncQuery = (next: { basketId?: string | null; saleId?: string | null }) => {
    // Ignore late async POS updates once the route has unmounted so they cannot
    // navigate the SPA back to /pos after the user has left the page.
    if (!isPageActiveRef.current) {
      return;
    }

    if (pendingQuerySyncFrameRef.current) {
      window.cancelAnimationFrame(pendingQuerySyncFrameRef.current);
    }

    const routePathname = location.pathname;
    pendingQuerySyncFrameRef.current = window.requestAnimationFrame(() => {
      pendingQuerySyncFrameRef.current = window.requestAnimationFrame(() => {
        pendingQuerySyncFrameRef.current = null;
        if (!isPageActiveRef.current || window.location.pathname !== routePathname) {
          return;
        }

        const currentSearch = window.location.search.startsWith("?")
          ? window.location.search.slice(1)
          : window.location.search;
        const updated = new URLSearchParams(window.location.search);

        if (next.basketId !== undefined) {
          if (next.basketId) {
            updated.set("basketId", next.basketId);
          } else {
            updated.delete("basketId");
          }
        }

        if (next.saleId !== undefined) {
          if (next.saleId) {
            updated.set("saleId", next.saleId);
          } else {
            updated.delete("saleId");
          }
        }

        if (updated.toString() === currentSearch) {
          return;
        }

        setSearchParams(updated, {
          replace: true,
          state: location.state,
        });
      });
    });
  };

  const loadContextCustomer = async (
    customerId: string | null,
    options?: {
      requestId?: number;
      syncContext?: boolean;
    },
  ) => {
    if (options?.syncContext !== false) {
      setContextCustomerId(customerId);
    }
    if (!customerId) {
      return null;
    }

    const customer = await apiGet<CustomerSearchRow>(`/api/customers/${encodeURIComponent(customerId)}`);
    if (!canApplyPosLifecycle(options?.requestId)) {
      return null;
    }
    setSelectedCustomer(customer);
    return customer;
  };

  const loadBasket = async (id: string, options?: { requestId?: number }) => {
    const payload = await apiGet<BasketResponse>(`/api/baskets/${encodeURIComponent(id)}`);
    if (!canApplyPosLifecycle(options?.requestId)) {
      return null;
    }
    setBasket(payload);
    setSelectedCustomer(payload.customer ?? null);
    setContextCustomerId(payload.customer?.id ?? null);
    persistActiveBasketId(payload.id);
    return payload;
  };

  const loadProductMatches = async (params: URLSearchParams) => {
    const payload = await apiGet<{ rows: ProductSearchRow[] }>(`/api/products/search?${params.toString()}`);
    return payload.rows || [];
  };

  const loadSale = async (
    id: string,
    options?: {
      requestId?: number;
    },
  ) => {
    const payload = await apiGet<SaleResponse>(`/api/sales/${encodeURIComponent(id)}`);
    if (!canApplyPosLifecycle(options?.requestId)) {
      return null;
    }
    setSale(payload);
    setSelectedCustomer(payload.sale.customer ?? null);
    setContextCustomerId(payload.sale.customer?.id ?? null);
    localStorage.setItem(ACTIVE_SALE_KEY, payload.sale.id);
    return payload;
  };

  const customerCaptureTarget = useMemo<PosCustomerCaptureTarget | null>(() => {
    if (sale) {
      return {
        ownerType: "sale",
        sale: {
          ...sale.sale,
          customer: sale.sale.customer ?? selectedCustomer ?? null,
        },
      };
    }

    if (basket) {
      return {
        ownerType: "basket",
        basket: {
          id: basket.id,
          status: basket.status,
          customer: basket.customer,
        },
      };
    }

    return null;
  }, [basket, sale]);

  const {
    captureCompletionSummary,
    captureSession,
    captureSessionLoading,
    captureSessionLaunchMode,
    captureStatusError,
    captureUrl,
    creatingCaptureSession,
    isCaptureEligible,
    copyCaptureUrl,
    createCustomerCaptureSession,
    dismissCaptureCompletionSummary,
    refreshCaptureStatus,
    refreshTargetAfterCustomerCapture,
  } = usePosCustomerCapture({
    target: customerCaptureTarget,
    loadBasket: (targetBasketId) => loadBasket(targetBasketId),
    loadSale: (targetSaleId) => loadSale(targetSaleId),
    success,
    error,
  });

  const createBasket = async (options?: {
    saleContext?: SaleContext;
    customerId?: string | null;
    preloadedItems?: PreloadedBasketItemInput[];
    announce?: boolean;
    preserveTransientUi?: boolean;
    successMessage?: string;
    requestId?: number;
  }) => {
    const requestId = options?.requestId ?? beginPosLifecycleRequest();
    const basketSaleContext = options?.saleContext ?? DEFAULT_SALE_CONTEXT;
    const created = await apiPost<BasketResponse>("/api/baskets", {
      ...(options?.preloadedItems?.length ? { items: options.preloadedItems } : {}),
      ...(options?.customerId !== undefined ? { customerId: options.customerId } : {}),
      source: basketSaleContext.type,
      sourceRef: getSaleContextSourceRef(basketSaleContext),
    });
    if (!canApplyPosLifecycle(requestId)) {
      return null;
    }
    setBasket(created);
    setSelectedCustomer(created.customer ?? null);
    persistActiveBasketId(created.id);
    setSale(null);
    setReceiptUrl(null);
    setCashTenderedAmount("");
    setCardTerminalSession(null);
    setMockCardTerminalState(null);
    setCardTerminalMessage(null);
    clearCardTerminalPoll();
    if (!options?.preserveTransientUi) {
      setSearchText("");
      setSearchRows([]);
      setHighlightedProductIndex(-1);
      setCustomerSearchText("");
      setCustomerResults([]);
      setHighlightedCustomerIndex(-1);
      setShowCreateCustomer(false);
    }
    setSaleContext(basketSaleContext);
    setContextCustomerId(created.customer?.id ?? options?.customerId ?? null);
    if (!canApplyPosLifecycle(requestId)) {
      return null;
    }
    syncQuery({ basketId: created.id, saleId: null });
    if (options?.announce !== false) {
      success(options?.successMessage ?? "New sale created");
    }
    if (!options?.preserveTransientUi) {
      focusProductSearch();
    }
    return created;
  };

  const toPreloadedBasketItems = (items: PosLineItem[]): PreloadedBasketItemInput[] =>
    items
      .filter((item): item is PosLineItem & { variantId: string } => Boolean(item.variantId))
      .map((item) => ({
        variantId: item.variantId,
        quantity: item.quantity,
        unitPricePence: item.unitPricePence,
      }));

  useEffect(() => {
    isPageActiveRef.current = true;

    return () => {
      isPageActiveRef.current = false;
      posLifecycleRequestIdRef.current += 1;
      if (pendingQuerySyncFrameRef.current) {
        window.cancelAnimationFrame(pendingQuerySyncFrameRef.current);
      }
      clearCardTerminalPoll();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadCardTerminalIntegration = async () => {
      try {
        const configPayload = await apiGet<CardTerminalConfigResponse>("/api/payments/terminal-config");
        if (cancelled) {
          return;
        }

        setCardTerminalConfig(configPayload.config);
        const suggestedTillPoint = configPayload.config.workstationHint?.suggestedTillPointId;
        if (
          isPosTillPointId(suggestedTillPoint)
          && !getStoredPosWorkstationAssignment().tillPointId
        ) {
          setSuggestedTillPointId(suggestedTillPoint);
        }

        if (!configPayload.config.enabled || !configPayload.config.configured) {
          setCardTerminals([]);
          setSelectedCardTerminalId("");
          return;
        }

        const terminalPayload = await apiGet<CardTerminalListResponse>("/api/payments/terminals");
        if (cancelled) {
          return;
        }

        const firstTerminalId = terminalPayload.terminals[0]?.terminalId || terminalPayload.terminals[0]?.id || "";
        setCardTerminalConfig(terminalPayload.config);
        setCardTerminals(terminalPayload.terminals);
        setSelectedCardTerminalId((current) =>
          current || terminalPayload.config.defaultTerminalId || firstTerminalId,
        );
      } catch {
        if (!cancelled) {
          setCardTerminalConfig(null);
          setCardTerminals([]);
          setSelectedCardTerminalId("");
        }
      }
    };

    void loadCardTerminalIntegration();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const requestId = beginPosLifecycleRequest();
    let didStartAsyncWork = false;
    const nextContext = posOpenState?.saleContext ?? DEFAULT_SALE_CONTEXT;
    const nextCustomerId = posOpenState?.customerId ?? null;

    const beginAsyncLoad = () => {
      if (!didStartAsyncWork && canApplyPosLifecycle(requestId)) {
        didStartAsyncWork = true;
        setLoading(true);
      }
    };

    setSaleContext(nextContext);
    setContextCustomerId(nextCustomerId);

    const syncPosStateFromRoute = async () => {
      try {
        const currentSale = saleStateRef.current;
        const currentBasket = basketStateRef.current;
        const currentSelectedCustomer = selectedCustomerStateRef.current;

        if (saleId) {
          const needsSaleLoad = !currentSale || currentSale.sale.id !== saleId;
          const needsContextCustomerLoad = Boolean(
            nextCustomerId
              && currentSale?.sale.customer?.id !== nextCustomerId
              && currentSelectedCustomer?.id !== nextCustomerId,
          );

          if (needsSaleLoad) {
            beginAsyncLoad();
          }
          const loadedSale = needsSaleLoad
            ? await loadSale(saleId, {
                requestId,
              })
            : currentSale;

          if (!loadedSale || !canApplyPosLifecycle(requestId)) {
            return;
          }

          if (needsContextCustomerLoad && nextCustomerId) {
            beginAsyncLoad();
            await loadContextCustomer(nextCustomerId, {
              requestId,
              syncContext: false,
            });
          }
          return;
        }

        if (currentSale) {
          setSale(null);
          setReceiptUrl(null);
        }

        const storedBasketId = readStoredBasketId();
        const candidateBasketId = basketId ?? storedBasketId;

        if (candidateBasketId) {
          try {
            const restoredBasket = currentBasket?.id === candidateBasketId
              ? currentBasket
              : await (() => {
                  beginAsyncLoad();
                  return loadBasket(candidateBasketId, { requestId });
                })();

            if (!restoredBasket || !canApplyPosLifecycle(requestId)) {
              return;
            }

            if (!basketId) {
              syncQuery({ basketId: restoredBasket.id, saleId: null });
            }

            if (nextCustomerId && currentSelectedCustomer?.id !== nextCustomerId) {
              beginAsyncLoad();
              await loadContextCustomer(nextCustomerId, {
                requestId,
                syncContext: false,
              });
            }
            return;
          } catch (loadBasketError) {
            if (!canApplyPosLifecycle(requestId)) {
              return;
            }

            const isStoredBasketRestore = Boolean(storedBasketId) && candidateBasketId === storedBasketId;
            const canRecoverFromMissingBasket = getApiErrorStatus(loadBasketError) === 404;
            const canRecoverBasket = isStoredBasketRestore || canRecoverFromMissingBasket;

            if (!canRecoverBasket) {
              throw loadBasketError;
            }

            clearStoredBasketId();
          }
        }

        beginAsyncLoad();
        await createBasket({
          saleContext: nextContext,
          customerId: nextCustomerId,
          preloadedItems: posOpenState?.items?.length ? toPreloadedBasketItems(posOpenState.items) : undefined,
          announce: false,
          preserveTransientUi: true,
          requestId,
        });
      } catch (initError) {
        if (!canApplyPosLifecycle(requestId)) {
          return;
        }
        const message = initError instanceof Error ? initError.message : "Failed to initialize POS";
        error(message);
      } finally {
        if (canApplyPosLifecycle(requestId)) {
          setLoading(false);
        }
      }
    };

    void syncPosStateFromRoute();
  }, [basketId, saleId, posOpenStateSignature, error]);

  useEffect(() => {
    if (!debouncedSearch.trim()) {
      setSearchRows([]);
      setHighlightedProductIndex(-1);
      return;
    }

    let cancelled = false;

    const search = async () => {
      try {
        const payload = await apiGet<{ rows: ProductSearchRow[] }>(
          `/api/products/search?q=${encodeURIComponent(debouncedSearch.trim())}`,
        );
        if (!cancelled) {
          const rows = payload.rows || [];
          setSearchRows(rows);
          setHighlightedProductIndex(rows.length > 0 ? 0 : -1);
        }
      } catch (searchError) {
        if (!cancelled) {
          const message = searchError instanceof Error ? searchError.message : "Search failed";
          error(message);
          setHighlightedProductIndex(-1);
        }
      }
    };

    void search();

    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, error]);

  useEffect(() => {
    let cancelled = false;

    const loadQuickAddTiles = async () => {
      if (!appConfig.pos.quickAddEnabled || appConfig.pos.quickAddProducts.length === 0) {
        setQuickAddTiles([]);
        return;
      }

      try {
        const tiles = await Promise.all(
          appConfig.pos.quickAddProducts.map(async (definition, index) => {
            const quickAddKey = toQuickAddKey(definition.label, index);
            if (definition.type === "SERVICE_TEMPLATE" && definition.refId) {
              const payload = await apiGet<{ template: ServiceTemplateQuickAdd }>(
                `/api/workshop/service-templates/${encodeURIComponent(definition.refId)}`,
              );
              const template = payload.template;
              const requiredLineTotal = template.lines
                .filter((line) => !line.isOptional)
                .reduce((sum, line) => sum + line.lineTotalPence, 0);

              return {
                key: `${quickAddKey}-${index + 1}`,
                testId: quickAddKey,
                label: definition.label,
                query: definition.query,
                type: "SERVICE_TEMPLATE" as const,
                template,
                pricePence: template.targetTotalPricePence ?? requiredLineTotal,
              };
            }

            let product: ProductSearchRow | null = null;
            if (definition.refId) {
              product = toProductSearchRowFromVariant(
                await apiGet<VariantDetail>(`/api/variants/${encodeURIComponent(definition.refId)}`),
              );
            } else {
              const searchParams = new URLSearchParams();
              searchParams.set("q", definition.query);
              searchParams.set("take", "6");
              const payload = await apiGet<{ rows: ProductSearchRow[] }>(
                `/api/products/search?${searchParams.toString()}`,
              );
              const rows = payload.rows || [];
              const normalizedQuery = definition.query.toLowerCase();
              product = rows.find((row) =>
                row.name.toLowerCase().includes(normalizedQuery)
                  || row.sku.toLowerCase() === normalizedQuery
                  || row.barcode?.toLowerCase() === normalizedQuery,
              ) ?? rows[0] ?? null;
            }

            return product
              ? {
                  ...definition,
                  key: `${quickAddKey}-${index + 1}`,
                  testId: quickAddKey,
                  type: "INVENTORY" as const,
                  product,
                }
              : null;
          }),
        );

        if (!cancelled) {
          setQuickAddTiles(tiles.filter((tile): tile is QuickAddTile => Boolean(tile)));
        }
      } catch (quickAddError) {
        if (!cancelled) {
          const message = quickAddError instanceof Error ? quickAddError.message : "Quick add products failed to load";
          error(message);
          setQuickAddTiles([]);
        }
      }
    };

    void loadQuickAddTiles();

    return () => {
      cancelled = true;
    };
  }, [appConfig.pos.quickAddEnabled, appConfig.pos.quickAddProducts, error]);

  useEffect(() => {
    if (!searchText.trim() || searchRows.length === 0) {
      setHighlightedProductIndex(-1);
      productResultRefs.current = [];
      return;
    }

    setHighlightedProductIndex((current) => (
      current >= 0 && current < searchRows.length ? current : 0
    ));
  }, [searchRows, searchText]);

  useEffect(() => {
    if (activeProductIndex < 0) {
      return;
    }

    productResultRefs.current[activeProductIndex]?.scrollIntoView({
      block: "nearest",
    });
  }, [activeProductIndex]);

  useEffect(() => {
    if (!loading && basket && !sale) {
      focusProductSearch();
    }
  }, [loading, basket, sale]);

  useEffect(() => {
    if (!sale || selectedTenderMethod !== "CASH") {
      return;
    }

    window.requestAnimationFrame(() => {
      cashTenderedInputRef.current?.focus();
      cashTenderedInputRef.current?.select();
    });
  }, [sale, selectedTenderMethod]);

  useEffect(() => {
    if (!debouncedCustomerSearch.trim()) {
      setCustomerResults([]);
      setCustomerLoading(false);
      return;
    }

    let cancelled = false;

    const searchCustomers = async () => {
      setCustomerLoading(true);
      try {
        const payload = await apiGet<{ customers: CustomerSearchRow[] }>(
          `/api/customers/search?q=${encodeURIComponent(debouncedCustomerSearch.trim())}&take=12`,
        );
        if (!cancelled) {
          setCustomerResults(payload.customers || []);
        }
      } catch (searchError) {
        if (!cancelled) {
          const message = searchError instanceof Error ? searchError.message : "Customer search failed";
          error(message);
        }
      } finally {
        if (!cancelled) {
          setCustomerLoading(false);
        }
      }
    };

    void searchCustomers();

    return () => {
      cancelled = true;
    };
  }, [debouncedCustomerSearch, error]);

  useEffect(() => {
    if (!customerSearchText.trim() || customerResults.length === 0) {
      setHighlightedCustomerIndex(-1);
      customerResultRefs.current = [];
      return;
    }

    setHighlightedCustomerIndex((current) => (
      current >= 0 && current < customerResults.length ? current : 0
    ));
  }, [customerResults, customerSearchText]);

  useEffect(() => {
    if (highlightedCustomerIndex < 0) {
      return;
    }

    customerResultRefs.current[highlightedCustomerIndex]?.scrollIntoView({
      block: "nearest",
    });
  }, [highlightedCustomerIndex]);

  const attachCustomerToSale = async (
    targetSaleId: string,
    customerId: string | null,
    options?: { requestId?: number },
  ) => {
    const payload = await apiPatch<SaleResponse>(`/api/sales/${encodeURIComponent(targetSaleId)}/customer`, {
      customerId,
    });
    if (!canApplyPosLifecycle(options?.requestId)) {
      return null;
    }
    setSale(payload);
    setSelectedCustomer(payload.sale.customer ?? null);
    localStorage.setItem(ACTIVE_SALE_KEY, payload.sale.id);
    return payload;
  };

  const attachCustomerToBasket = async (
    targetBasketId: string,
    customerId: string | null,
    options?: { requestId?: number },
  ) => {
    const payload = await apiPatch<BasketResponse>(`/api/baskets/${encodeURIComponent(targetBasketId)}/customer`, {
      customerId,
    });
    if (!canApplyPosLifecycle(options?.requestId)) {
      return null;
    }
    setBasket(payload);
    setSelectedCustomer(payload.customer ?? null);
    setContextCustomerId(payload.customer?.id ?? null);
    persistActiveBasketId(payload.id);
    return payload;
  };

  const selectCustomer = async (customer: CustomerSearchRow) => {
    setSelectedCustomer(customer);
    setContextCustomerId(customer.id);
    setCustomerSearchText("");
    setCustomerResults([]);
    setHighlightedCustomerIndex(-1);
    setCustomerOptionsOpen(false);
    setCustomerToolsExpanded(false);
    setShowCreateCustomer(false);

    if (sale?.sale.id) {
      try {
        await attachCustomerToSale(sale.sale.id, customer.id);
        success("Customer attached to sale");
      } catch (attachError) {
        const message = attachError instanceof Error ? attachError.message : "Failed to attach customer";
        error(message);
      }
      return;
    }

    if (activeBasketId) {
      try {
        await attachCustomerToBasket(activeBasketId, customer.id);
        success("Customer selected. It will attach after checkout.");
      } catch (attachError) {
        const message = attachError instanceof Error ? attachError.message : "Failed to attach customer";
        error(message);
      }
      return;
    }

    success("Customer selected. It will attach after checkout.");
  };

  const clearSelectedCustomer = async () => {
    if (sale?.sale.id) {
      try {
        await attachCustomerToSale(sale.sale.id, null);
        success("Customer removed from sale");
      } catch (detachError) {
        const message = detachError instanceof Error ? detachError.message : "Failed to remove customer";
        error(message);
        return;
      }
    } else if (activeBasketId) {
      if (
        selectedCustomerAttachedToBasket
        && basketItemCount > 0
        && !window.confirm(
          "Remove this customer from the active basket? The basket items will stay in place and the basket will return to walk-in.",
        )
      ) {
        return;
      }

      try {
        await attachCustomerToBasket(activeBasketId, null);
        success("Customer removed. Basket is back to walk-in.");
      } catch (detachError) {
        const message = detachError instanceof Error ? detachError.message : "Failed to clear customer";
        error(message);
        return;
      }
    } else {
      setSelectedCustomer(null);
    }

    setSelectedCustomer(null);
    setContextCustomerId(null);
    setCustomerSearchText("");
    setCustomerResults([]);
    setHighlightedCustomerIndex(-1);
    setCustomerOptionsOpen(false);
    setCustomerToolsExpanded(Boolean(sale?.sale.id));
    setShowCreateCustomer(false);
  };

  const openCustomerProfileModal = () => {
    if (!selectedCustomer?.id) {
      return;
    }

    setCustomerProfileModalOpen(true);
  };

  const openCustomerTools = () => {
    setCustomerToolsExpanded(true);
    setShowCreateCustomer(false);
    setCustomerOptionsOpen(false);
    window.requestAnimationFrame(() => {
      customerSearchInputRef.current?.focus();
    });
  };

  const collapseCustomerTools = () => {
    setCustomerToolsExpanded(false);
    setCustomerSearchText("");
    setCustomerResults([]);
    setHighlightedCustomerIndex(-1);
    setShowCreateCustomer(false);
  };

  const editPaymentCustomer = () => {
    setCustomerOptionsOpen((current) => !current);
  };

  const chooseWalkInCustomer = async () => {
    setShowCreateCustomer(false);
    if (selectedCustomer?.id) {
      await clearSelectedCustomer();
      return;
    }

    setCustomerSearchText("");
    setCustomerResults([]);
    setHighlightedCustomerIndex(-1);
    setCustomerToolsExpanded(false);
    setCustomerOptionsOpen(false);
  };

  const chooseLinkedCustomer = () => {
    setShowCreateCustomer(false);
    setCustomerOptionsOpen(false);
    setCustomerToolsExpanded(true);
    focusCustomerSearch();
  };

  const chooseTapCustomer = () => {
    setCustomerOptionsOpen(false);
    setCustomerToolsExpanded(true);
    void createCustomerCaptureSession();
  };

  const openCustomerCreatePanel = () => {
    const searchedName = customerSearchText.trim();
    setShowCreateCustomer(true);
    setCustomerOptionsOpen(false);
    if (searchedName) {
      setNewCustomerName(searchedName);
    }
    window.requestAnimationFrame(() => {
      newCustomerNameInputRef.current?.focus();
    });
  };

  const chooseNewCustomer = () => {
    setCustomerToolsExpanded(true);
    openCustomerCreatePanel();
  };

  const startQuickCustomerCreate = () => {
    if (showCreateCustomer) {
      setShowCreateCustomer(false);
      return;
    }

    openCustomerCreatePanel();
  };

  const createCustomerAndSelect = async (options?: { openProfile?: boolean }) => {
    if (creatingCustomer) {
      return;
    }

    if (!newCustomerName.trim()) {
      error("Customer name is required.");
      return;
    }

    setCreatingCustomer(true);
    try {
      const parsedName = parseCombinedCustomerName(newCustomerName);
      const created = await apiPost<CustomerSearchRow>("/api/customers", {
        firstName: parsedName.firstName,
        lastName: parsedName.lastName || undefined,
        email: newCustomerEmail.trim() || undefined,
        phone: newCustomerPhone.trim() || undefined,
      });

      setNewCustomerName("");
      setNewCustomerEmail("");
      setNewCustomerPhone("");
      await selectCustomer(created);
      if (options?.openProfile) {
        setCustomerProfileModalOpen(true);
      }
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : "Failed to create customer";
      error(message);
    } finally {
      setCreatingCustomer(false);
    }
  };

  const resolveProductSearchRow = async (rawInput: string) => {
    const trimmed = rawInput.trim();
    if (!trimmed) {
      return null;
    }

    const exactLoadedMatch = searchRows.find((row) =>
      isExactLookupMatch(row.barcode, trimmed) || isExactLookupMatch(row.sku, trimmed),
    );
    if (exactLoadedMatch) {
      return exactLoadedMatch;
    }

    if (looksLikeScannerInput(trimmed)) {
      const barcodeParams = new URLSearchParams();
      barcodeParams.set("barcode", trimmed);
      barcodeParams.set("take", "5");
      const barcodeRows = await loadProductMatches(barcodeParams);
      const exactBarcodeMatch = barcodeRows.find((row) => isExactLookupMatch(row.barcode, trimmed));
      if (exactBarcodeMatch) {
        return exactBarcodeMatch;
      }

      const skuParams = new URLSearchParams();
      skuParams.set("sku", trimmed);
      skuParams.set("take", "5");
      const skuRows = await loadProductMatches(skuParams);
      const exactSkuMatch = skuRows.find((row) => isExactLookupMatch(row.sku, trimmed));
      if (exactSkuMatch) {
        return exactSkuMatch;
      }
    }

    if (searchRows.length > 0) {
      return searchRows[0];
    }

    const queryParams = new URLSearchParams();
    queryParams.set("q", trimmed);
    queryParams.set("take", "5");
    const queriedRows = await loadProductMatches(queryParams);
    return queriedRows[0] ?? null;
  };

  const addItem = async (variantId: string) => {
    if (!basketId) {
      error("No active basket.");
      return;
    }

    try {
      const previousBasket = basket;
      const payload = await apiPost<BasketResponse>(`/api/baskets/${encodeURIComponent(basketId)}/items`, {
        variantId,
        quantity: 1,
      });
      setBasket(payload);
      flashBasketRow(findHighlightedBasketItemId(previousBasket, payload));
      setSearchText("");
      setSearchRows([]);
      setHighlightedProductIndex(-1);
      restoreScannerSearchFocus();
    } catch (addError) {
      const message = addError instanceof Error ? addError.message : "Failed to add item";
      error(message);
    }
  };

  const addMultipleItems = async (variantId: string, quantity: number) => {
    if (!basketId) {
      error("No active basket.");
      return;
    }

    try {
      const previousBasket = basket;
      const payload = await apiPost<BasketResponse>(`/api/baskets/${encodeURIComponent(basketId)}/items`, {
        variantId,
        quantity,
      });
      setBasket(payload);
      flashBasketRow(findHighlightedBasketItemId(previousBasket, payload));
      setSearchText("");
      setSearchRows([]);
      setHighlightedProductIndex(-1);
      restoreScannerSearchFocus();
    } catch (addError) {
      const message = addError instanceof Error ? addError.message : "Failed to add item";
      error(message);
    }
  };

  const addServiceTemplate = async (templateId: string) => {
    if (!basketId) {
      error("No active basket.");
      return;
    }

    try {
      const previousBasket = basket;
      const payload = await apiPost<BasketResponse>(
        `/api/baskets/${encodeURIComponent(basketId)}/service-templates`,
        { templateId },
      );
      setBasket(payload);
      flashBasketRow(findHighlightedBasketItemId(previousBasket, payload));
      restoreScannerSearchFocus();
    } catch (addError) {
      const message = addError instanceof Error ? addError.message : "Failed to add service template";
      error(message);
    }
  };

  const submitProductSearch = async (quantity: number) => {
    if (!basketId) {
      error("No active basket.");
      return;
    }
    if (saleId) {
      error("Finish or reset the current sale before adding more items.");
      return;
    }

    try {
      const row = activeProductIndex >= 0 && activeProductIndex < searchRows.length
        ? searchRows[activeProductIndex]
        : await resolveProductSearchRow(searchText);
      if (!row) {
        error("No product matched that barcode, SKU, or search.");
        return;
      }

      if (quantity === 1) {
        await addItem(row.id);
      } else {
        await addMultipleItems(row.id, quantity);
      }
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Failed to add searched item";
      error(message);
    }
  };

  const updateLineQty = async (itemId: string, quantity: number) => {
    if (!basketId || quantity < 1) {
      return;
    }

    try {
      const payload = await apiPatch<BasketResponse>(
        `/api/baskets/${encodeURIComponent(basketId)}/items/${encodeURIComponent(itemId)}`,
        { quantity },
      );
      setBasket(payload);
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : "Failed to update quantity";
      error(message);
    }
  };

  useEffect(() => {
    if (!lastAddedBasketItemId) {
      return;
    }
    window.requestAnimationFrame(() => {
      basketItemRefs.current[lastAddedBasketItemId]?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    });
  }, [basket, lastAddedBasketItemId]);

  useEffect(() => {
    return () => {
      if (lastAddedRowTimeoutRef.current) {
        window.clearTimeout(lastAddedRowTimeoutRef.current);
      }
      if (searchFocusFrameRef.current) {
        window.cancelAnimationFrame(searchFocusFrameRef.current);
      }
      clearCardTerminalPoll();
    };
  }, []);

  const removeLine = async (itemId: string) => {
    if (!basketId) {
      return;
    }

    try {
      const payload = await apiDelete<BasketResponse>(
        `/api/baskets/${encodeURIComponent(basketId)}/items/${encodeURIComponent(itemId)}`,
      );
      setBasket(payload);
    } catch (removeError) {
      const message = removeError instanceof Error ? removeError.message : "Failed to remove line";
      error(message);
    }
  };

  const adjustLineQty = async (itemId: string, currentQuantity: number, delta: number) => {
    const nextQuantity = currentQuantity + delta;
    if (nextQuantity < 1) {
      await removeLine(itemId);
      return;
    }

    await updateLineQty(itemId, nextQuantity);
  };

  const clearBasket = async () => {
    if (!basketId || !basket || basket.items.length === 0) {
      return;
    }

    try {
      let latestBasket = basket;
      for (const item of basket.items) {
        latestBasket = await apiDelete<BasketResponse>(
          `/api/baskets/${encodeURIComponent(basketId)}/items/${encodeURIComponent(item.id)}`,
        );
      }
      setBasket(latestBasket);
      success("Basket cleared");
    } catch (clearError) {
      const message = clearError instanceof Error ? clearError.message : "Failed to clear basket";
      error(message);
    }
  };

  const checkoutBasket = async () => {
    if (!activeBasketId) {
      error("No active basket.");
      return;
    }

    setLoading(true);
    try {
      const requestId = beginPosLifecycleRequest();
      setCompletedSale(null);
      setMockCardTerminalState(null);
      setCardTerminalMessage(null);
      const payload = await apiPost<{ sale: { id: string } }>(
        `/api/baskets/${encodeURIComponent(activeBasketId)}/checkout`,
        {},
      );
      if (!canApplyPosLifecycle(requestId)) {
        return;
      }
      const nextSaleId = payload.sale.id;
      clearStoredBasketId();
      const nextSale = await loadSale(nextSaleId, {
        requestId,
      });
      if (!canApplyPosLifecycle(requestId)) {
        return;
      }
      syncQuery({ basketId: activeBasketId, saleId: nextSaleId });
      success(nextSale?.sale.customer?.id ? "Sale created and customer attached." : "Sale created.");
    } catch (checkoutError) {
      const message = checkoutError instanceof Error ? checkoutError.message : "Checkout failed";
      error(message);
    } finally {
      setLoading(false);
    }
  };

  const applyStoreCreditTender = async (amountPence: number) => {
    if (!sale) {
      throw new Error("No sale to apply store credit to.");
    }

    const creditCustomer = sale.sale.customer ?? selectedCustomer;
    if (!creditCustomer?.id && !creditCustomer?.email && !creditCustomer?.phone) {
      throw new Error("Attach a customer before using store credit.");
    }

    const creditIdentity = {
      ...(creditCustomer.id ? { customerId: creditCustomer.id } : {}),
      ...(creditCustomer.email ? { email: creditCustomer.email } : {}),
      ...(creditCustomer.phone ? { phone: creditCustomer.phone } : {}),
    };

    const balanceParams = new URLSearchParams(creditIdentity);
    const balance = await apiGet<CreditBalanceResponse>(`/api/credits/balance?${balanceParams.toString()}`);
    if (balance.balancePence < amountPence) {
      throw new Error(
        `Store credit balance is ${formatMoney(balance.balancePence)}. ${formatMoney(amountPence)} is required.`,
      );
    }

    const credit = await apiPost<CreditApplyResponse>("/api/credits/apply", {
      saleId: sale.sale.id,
      ...creditIdentity,
      amountPence,
      notes: "Applied from POS checkout",
      idempotencyKey: `pos-store-credit:${sale.sale.id}:${amountPence}`,
    });

    const summary = await apiGet<SaleTenderSummaryResponse>(
      `/api/sales/${encodeURIComponent(sale.sale.id)}/tenders`,
    );
    const expectedTenderedPence = sale.tenderSummary.tenderedPence + credit.appliedPence;
    if (summary.tenderedPence < expectedTenderedPence) {
      await apiPost(`/api/sales/${encodeURIComponent(sale.sale.id)}/tenders`, {
        method: "VOUCHER",
        amountPence: credit.appliedPence,
      });
    }
  };

  const confirmManualCardPayment = async () => {
    if (!sale) {
      error("No sale to confirm card payment for.");
      return;
    }
    if (payablePence <= 0) {
      success("Card payment is already covered.");
      return;
    }

    setConfirmingCardPayment(true);
    try {
      await apiPost(`/api/sales/${encodeURIComponent(sale.sale.id)}/tenders`, {
        method: "CARD",
        amountPence: payablePence,
      });
      await loadSale(sale.sale.id);
      success("Card payment confirmed.");
    } catch (cardError) {
      const message = cardError instanceof Error ? cardError.message : "Card payment confirmation failed";
      error(message);
    } finally {
      setConfirmingCardPayment(false);
    }
  };

  const completeCardTerminalSale = async (session: CardTerminalSessionState) => {
    if (!sale) {
      return;
    }

    const result = await apiPost<CompleteSaleResult>(
      `/api/sales/${encodeURIComponent(sale.sale.id)}/complete`,
      {},
    );
    setCompletedSale({
      saleId: sale.sale.id,
      receiptUrl: result.receiptUrl || `/r/${sale.sale.id}`,
      changeDuePence: result.changeDuePence,
      tenderMethod: "CARD",
      customerName: sale.sale.customer?.name ?? selectedCustomer?.name ?? null,
      customerEmail: sale.sale.customer?.email ?? selectedCustomer?.email ?? null,
      cashTenderedPence: null,
      totalPaidPence: sale.sale.totalPence,
      receiptPrintJob: null,
      receiptPrinterName: null,
    });
    setReceiptUrl(result.receiptUrl || `/r/${sale.sale.id}`);
    setCardTerminalSession(session);
    setCardTerminalMessage(getCardTerminalStatusLabel(session));
    clearCardTerminalPoll();
    await createBasket({ announce: false });
    setSelectedTenderMethod(defaultTenderMethod);
    setCashTenderedAmount("");
    success("Card payment captured.");
  };

  const handleCardTerminalSessionResult = async (
    payload: CardTerminalSessionResponse,
  ) => {
    const nextSession = payload.session;
    setCardTerminalSession(nextSession);
    setCardTerminalMessage(getCardTerminalStatusLabel(nextSession));

    if (nextSession.status === "CAPTURED") {
      setCardTerminalLoading(false);
      await completeCardTerminalSale(nextSession);
      return true;
    }

    if (nextSession.isFinal) {
      setCardTerminalLoading(false);
      clearCardTerminalPoll();
      if (sale) {
        await loadSale(sale.sale.id);
      }
      if (nextSession.status !== "CANCELED") {
        error(getCardTerminalStatusLabel(nextSession) ?? "Card terminal payment did not complete.");
      }
      return true;
    }

    setCardTerminalLoading(false);
    return false;
  };

  const pollCardTerminalSession = (sessionId: string) => {
    clearCardTerminalPoll();

    const poll = async () => {
      try {
        const payload = await apiGet<CardTerminalSessionResponse>(
          `/api/payments/terminal-sessions/${encodeURIComponent(sessionId)}`,
        );
        const finished = await handleCardTerminalSessionResult(payload);
        if (!finished) {
          cardTerminalPollTimeoutRef.current = window.setTimeout(poll, CARD_TERMINAL_POLL_MS);
        }
      } catch (terminalError) {
        const message = terminalError instanceof Error ? terminalError.message : "Card terminal status refresh failed";
        setCardTerminalLoading(false);
        setCardTerminalMessage(message);
        error(message);
      }
    };

    cardTerminalPollTimeoutRef.current = window.setTimeout(poll, CARD_TERMINAL_POLL_MS);
  };

  const startMockCardTerminalPayment = () => {
    if (!sale) {
      error("No sale to send to the card terminal.");
      return;
    }
    if (payablePence <= 0) {
      success("Card payment is already covered.");
      return;
    }

    clearCardTerminalPoll();
    setCardTerminalSession(null);
    setCardTerminalLoading(false);
    const terminalLabel = getCardTerminalRouteLabel(selectedCardTerminalRouteId, cardTerminals, cardTerminalConfig);
    setCardTerminalMessage(`Waiting for the customer on ${terminalLabel}.`);
    setMockCardTerminalState({
      status: "PENDING",
      amountPence: payablePence,
      tillPointId: posWorkstationState.tillPointId ?? "TILL_1",
      terminalRouteId: selectedCardTerminalRouteId,
      terminalLabel,
      reference: createMockCardTerminalReference(),
      message: `${terminalLabel} is waiting for customer tap, insert, or PIN entry.`,
      requestedAt: new Date().toISOString(),
      completedAt: null,
    });
    success(`Demo payment sent to ${terminalLabel}.`);
  };

  const approveMockCardTerminalPayment = () => {
    if (!mockCardTerminalState || mockCardTerminalState.status !== "PENDING") {
      return;
    }

    setCardTerminalMessage("Demo card payment approved.");
    setMockCardTerminalState({
      ...mockCardTerminalState,
      status: "APPROVED",
      message: `Approved on ${mockCardTerminalState.terminalLabel}.`,
      completedAt: new Date().toISOString(),
    });
    success("Demo card payment approved.");
  };

  const declineMockCardTerminalPayment = () => {
    if (!mockCardTerminalState || mockCardTerminalState.status !== "PENDING") {
      return;
    }

    setCardTerminalMessage("Demo card payment declined.");
    setMockCardTerminalState({
      ...mockCardTerminalState,
      status: "DECLINED",
      message: `Declined on ${mockCardTerminalState.terminalLabel}.`,
      completedAt: new Date().toISOString(),
    });
    error("Demo card payment declined.");
  };

  const cancelMockCardTerminalPayment = () => {
    if (!mockCardTerminalState || mockCardTerminalState.status !== "PENDING") {
      return;
    }

    setMockCardTerminalState(null);
    setCardTerminalMessage(null);
  };

  const startCardTerminalPayment = async () => {
    if (!sale) {
      error("No sale to send to the card terminal.");
      return;
    }
    if (payablePence <= 0) {
      success("Card payment is already covered.");
      return;
    }
    if (!cardTerminalConfig?.enabled || !cardTerminalConfig.configured) {
      startMockCardTerminalPayment();
      return;
    }

    const terminalId = routedCardTerminalProviderId || cardTerminalConfig.defaultTerminalId || "";

    if (!terminalId) {
      error("Select a card terminal before taking payment.");
      return;
    }

    setCardTerminalLoading(true);
    setCardTerminalMessage(null);
    clearCardTerminalPoll();

    try {
      const payload = await apiPost<CardTerminalSessionResponse>("/api/payments/terminal-sessions", {
        saleId: sale.sale.id,
        amountPence: payablePence,
        terminalId,
      });
      const finished = await handleCardTerminalSessionResult(payload);
      if (!finished) {
        success("Payment sent to card terminal.");
        pollCardTerminalSession(payload.session.id);
      }
    } catch (terminalError) {
      const message = terminalError instanceof Error ? terminalError.message : "Card terminal payment failed to start";
      setCardTerminalLoading(false);
      setCardTerminalMessage(message);
      error(message);
    }
  };

  const cancelCardTerminalPayment = async () => {
    if (!cardTerminalSession || cardTerminalSession.isFinal) {
      return;
    }

    setCardTerminalLoading(true);
    try {
      const payload = await apiPost<CardTerminalSessionResponse>(
        `/api/payments/terminal-sessions/${encodeURIComponent(cardTerminalSession.id)}/cancel`,
        {},
      );
      clearCardTerminalPoll();
      await handleCardTerminalSessionResult(payload);
    } catch (terminalError) {
      const message = terminalError instanceof Error ? terminalError.message : "Card terminal cancellation failed";
      setCardTerminalMessage(message);
      error(message);
    } finally {
      setCardTerminalLoading(false);
    }
  };

  const respondToCardTerminalSignature = async (accepted: boolean) => {
    if (!cardTerminalSession || cardTerminalSession.isFinal) {
      return;
    }

    setCardTerminalLoading(true);
    try {
      const payload = await apiPost<CardTerminalSessionResponse>(
        `/api/payments/terminal-sessions/${encodeURIComponent(cardTerminalSession.id)}/signature`,
        { accepted },
      );
      const finished = await handleCardTerminalSessionResult(payload);
      if (!finished) {
        pollCardTerminalSession(payload.session.id);
      }
    } catch (signatureError) {
      const message = signatureError instanceof Error ? signatureError.message : "Signature response failed";
      setCardTerminalMessage(message);
      error(message);
    } finally {
      setCardTerminalLoading(false);
    }
  };

  const returnSaleToBasket = async () => {
    if (!sale) {
      error("No live sale to return.");
      return;
    }

    setReturningToBasket(true);
    try {
      const requestId = beginPosLifecycleRequest();
      const payload = await apiPost<BasketResponse>(
        `/api/sales/${encodeURIComponent(sale.sale.id)}/reopen-basket`,
        {},
      );
      if (!canApplyPosLifecycle(requestId)) {
        return;
      }
      setSale(null);
      setReceiptUrl(null);
      setBasket(payload);
      setSelectedCustomer(payload.customer ?? null);
      setContextCustomerId(payload.customer?.id ?? null);
      setSelectedTenderMethod(defaultTenderMethod);
      setCashTenderedAmount("");
      setMockCardTerminalState(null);
      setCardTerminalMessage(null);
      localStorage.removeItem(ACTIVE_SALE_KEY);
      persistActiveBasketId(payload.id);
      syncQuery({ basketId: payload.id, saleId: null });
      success("Returned to basket.");
    } catch (returnError) {
      const message = returnError instanceof Error ? returnError.message : "Could not return to basket";
      error(message);
    } finally {
      setReturningToBasket(false);
    }
  };

  const completeSale = async () => {
    if (!sale) {
      error("No sale to complete.");
      return;
    }

    setCompleting(true);
    try {
      const cashTenderedPence = parseCurrencyInputToPence(cashTenderedAmount);
      if (payablePence > 0) {
        if (selectedTenderMethod === "CASH") {
          if (cashTenderedPence === null) {
            error("Enter the amount tendered.");
            return;
          }

          if (cashTenderedPence < payablePence) {
            error("Cash tendered must cover the total due.");
            return;
          }
        }

        if (selectedTenderMethod === "STORE_CREDIT") {
          await applyStoreCreditTender(payablePence);
        } else if (selectedTenderMethod === "GIFT_CARD") {
          await apiPost(`/api/sales/${encodeURIComponent(sale.sale.id)}/tenders`, {
            method: "VOUCHER",
            amountPence: payablePence,
          });
        } else if (selectedTenderMethod === "CARD") {
          if (
            selectedCardPaymentMode === "TERMINAL"
            && mockCardTerminalState?.status === "APPROVED"
            && mockCardTerminalState.amountPence >= payablePence
          ) {
            await apiPost(`/api/sales/${encodeURIComponent(sale.sale.id)}/tenders`, {
              method: "CARD",
              amountPence: payablePence,
            });
          } else {
            error("Confirm card payment before completing the sale.");
            return;
          }
        } else if (isSaleTenderMethod(selectedTenderMethod)) {
          await apiPost(`/api/sales/${encodeURIComponent(sale.sale.id)}/tenders`, {
            method: selectedTenderMethod,
            amountPence: selectedTenderMethod === "CASH" ? cashTenderedPence : payablePence,
          });
        }
      }

      const result = await apiPost<CompleteSaleResult>(
        `/api/sales/${encodeURIComponent(sale.sale.id)}/complete`,
        {},
      );
      setCompletedSale({
        saleId: sale.sale.id,
        receiptUrl: result.receiptUrl || `/r/${sale.sale.id}`,
        changeDuePence: result.changeDuePence,
        tenderMethod: selectedTenderMethod,
        customerName: sale.sale.customer?.name ?? selectedCustomer?.name ?? null,
        customerEmail: sale.sale.customer?.email ?? selectedCustomer?.email ?? null,
        cashTenderedPence: selectedTenderMethod === "CASH" ? cashTenderedPence : null,
        totalPaidPence: sale.tenderSummary.totalPence,
        receiptPrintJob: null,
        receiptPrinterName: null,
      });
      setReceiptUrl(result.receiptUrl || `/r/${sale.sale.id}`);
      await createBasket();
      setSelectedTenderMethod(defaultTenderMethod);
      setCashTenderedAmount("");
      success("Sale completed.");
    } catch (completeError) {
      const message = completeError instanceof Error ? completeError.message : "Completion failed";
      error(message);
    } finally {
      setCompleting(false);
    }
  };

  const handleManagedReceiptPrint = async () => {
    if (!completedSale) {
      error("No completed sale is ready to print.");
      return;
    }

    setPrintingReceipt(true);
    try {
      const result = await printManagedReceipt(
        completedSale.saleId,
        receiptWorkstationKey ? { workstationKey: receiptWorkstationKey } : {},
      );
      success(getManagedReceiptPrintSuccessMessage(result));
      announcedReceiptPrintFailureRef.current = null;
      setCompletedSale((current) => current ? {
        ...current,
        receiptPrintJob: result.job,
        receiptPrinterName: result.printer.name,
      } : current);
    } catch (printError) {
      error(getManagedReceiptPrintErrorMessage(printError));
    } finally {
      setPrintingReceipt(false);
    }
  };

  useEffect(() => {
    const job = completedSale?.receiptPrintJob;
    if (!job || isManagedPrintJobTerminal(job.status)) {
      return undefined;
    }

    let cancelled = false;
    const refreshJob = async () => {
      try {
        const payload = await getManagedPrintJob(job.id);
        if (!cancelled) {
          setCompletedSale((current) => current ? {
            ...current,
            receiptPrintJob: payload.job,
            receiptPrinterName: current.receiptPrinterName ?? payload.job.printerName,
          } : current);
        }
      } catch (jobError) {
        if (!cancelled) {
          error(jobError instanceof Error ? jobError.message : "Failed to refresh receipt print status");
        }
      }
    };

    void refreshJob();
    const intervalId = window.setInterval(() => {
      void refreshJob();
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [completedSale?.receiptPrintJob, error]);

  useEffect(() => {
    const job = completedSale?.receiptPrintJob;
    if (!job || (job.status !== "FAILED" && job.status !== "CANCELLED")) {
      return;
    }

    const failureKey = `${job.id}:${job.status}:${job.attemptCount}`;
    if (announcedReceiptPrintFailureRef.current === failureKey) {
      return;
    }
    announcedReceiptPrintFailureRef.current = failureKey;
    error(job.lastError || "Receipt print failed. Use Receipt options for browser fallback if needed.");
  }, [completedSale?.receiptPrintJob, error]);

  const activeTotal = useMemo(() => {
    if (sale) {
      return sale.tenderSummary.totalPence;
    }
    return basket?.totals.totalPence ?? 0;
  }, [sale, basket]);

  const basketLineCount = basket?.items.length ?? 0;
  const activeLineItemCount = sale
    ? sale.saleItems.reduce((sum, item) => sum + item.quantity, 0)
    : basketItemCount;
  const basketSummaryLabel = `${activeLineItemCount} item${activeLineItemCount === 1 ? "" : "s"}`;
  const remainingDuePence = sale?.tenderSummary.remainingPence ?? 0;
  const depositPaidPence = saleContext.type === "WORKSHOP" ? saleContext.depositPaidPence ?? 0 : 0;
  const discountAppliedPence = 0;
  const contextRemainingPence = Math.max(activeTotal - depositPaidPence, 0);
  const payablePence = sale ? remainingDuePence : contextRemainingPence;
  const cashTenderedPence = parseCurrencyInputToPence(cashTenderedAmount);
  const cashChangeDuePence =
    selectedTenderMethod === "CASH" && cashTenderedPence !== null
      ? Math.max(cashTenderedPence - payablePence, 0)
      : 0;
  const cashValidationMessage =
    selectedTenderMethod !== "CASH" || payablePence === 0
      ? null
      : cashTenderedAmount.trim() === ""
        ? "Enter the cash received."
        : cashTenderedPence === null
          ? "Enter a valid amount in pounds."
          : cashTenderedPence < payablePence
            ? `Cash tendered is short by ${formatMoney(payablePence - cashTenderedPence)}.`
            : null;
  const quickCashAmounts = [500, 1000, 2000, 5000];
  const basketGroups = useMemo(() => {
    const labour = (basket?.items ?? []).filter((item) => resolvePosLineItemType(item) === "LABOUR");
    const parts = (basket?.items ?? []).filter((item) => resolvePosLineItemType(item) === "PART");

    return [
      { key: "LABOUR", label: "Labour", items: labour },
      { key: "PART", label: "Parts", items: parts },
    ].filter((group) => group.items.length > 0);
  }, [basket?.items]);
  const apiSourceLabel = sale?.sale.sourceLabel ?? basket?.sourceLabel ?? null;
  const apiSourceDetail = sale?.sale.sourceDetail ?? basket?.sourceDetail ?? null;
  const contextHeaderTitle = apiSourceLabel ?? getPosSaleSourceLabel(saleContext.type);
  const workshopContextMeta = saleContext.type === "WORKSHOP"
    ? [
        `Job #${saleContext.jobId}`,
        saleContext.customerName,
        saleContext.bikeLabel,
      ].filter(Boolean).join(" | ")
    : null;
  const contextHeaderMeta = workshopContextMeta || apiSourceDetail;
  const searchResultSummary = searchText.trim()
    ? `${searchRows.length} result${searchRows.length === 1 ? "" : "s"}`
    : "";
  const activeCustomerName =
    sale?.sale.customer?.name
    || selectedCustomer?.name
    || (saleContext.type === "WORKSHOP" ? saleContext.customerName : null)
    || "Walk-in";
  const activeCustomerStatusLabel = selectedCustomer
    ? "Linked profile"
    : saleContext.type === "WORKSHOP" && saleContext.customerName
      ? "Workshop contact"
      : "No profile attached";
  const activeCustomerContact =
    sale?.sale.customer?.email
    || sale?.sale.customer?.phone
    || selectedCustomer?.email
    || selectedCustomer?.phone
    || activeCustomerStatusLabel;
  const discountSummaryLabel = discountAppliedPence > 0 ? formatMoney(discountAppliedPence) : "None";
  const discountSummaryNote = discountAppliedPence > 0 ? "Applied to basket" : "Full price";
  const depositSummaryLabel = depositPaidPence > 0 ? formatMoney(depositPaidPence) : "None";
  const depositSummaryNote = depositPaidPence > 0 ? "Already paid" : "No deposit applied";
  const showDiscountSummary = !checkoutMode || discountAppliedPence > 0;
  const showDepositSummary = !checkoutMode || depositPaidPence > 0;
  const storeCreditCustomer = sale?.sale.customer ?? selectedCustomer;
  const storeCreditValidationMessage =
    selectedTenderMethod === "STORE_CREDIT"
    && !storeCreditCustomer?.id
    && !storeCreditCustomer?.email
    && !storeCreditCustomer?.phone
      ? "Attach a customer before using store credit."
      : null;
  const hasConfiguredCardTerminal = cardTerminalConfigured;
  const hasActiveCardTerminalSession = Boolean(cardTerminalSession && !cardTerminalSession.isFinal);
  const hasPendingMockCardTerminalSession = mockCardTerminalState?.status === "PENDING";
  const hasApprovedMockCardTerminalSession = mockCardTerminalState?.status === "APPROVED";
  const hasDeclinedMockCardTerminalSession = mockCardTerminalState?.status === "DECLINED";
  const hasInProgressCardTerminalSession = hasActiveCardTerminalSession || hasPendingMockCardTerminalSession;
  const selectedCardTerminal = cardTerminals.find((terminal) =>
    terminal.terminalId === routedCardTerminalProviderId || terminal.id === routedCardTerminalProviderId,
  );
  const selectedCardTerminalRouteLabel =
    mockCardTerminalState?.terminalLabel
    ?? getCardTerminalRouteLabel(selectedCardTerminalRouteId, cardTerminals, cardTerminalConfig);
  const posWorkstationConfigured = Boolean(selectedTillPoint);
  const suggestedTillPoint = suggestedTillPointId ? getPosTillPoint(suggestedTillPointId) : null;
  const posWorkstationTillLabel = selectedTillPoint?.label ?? "Till point not set";
  const cardTerminalRouteOverrideActive =
    posWorkstationState.terminalRouteOverride && selectedCardTerminalRouteId !== defaultCardTerminalRouteId;
  const cardTerminalStatusLabel = cardTerminalMessage ?? getCardTerminalStatusLabel(cardTerminalSession);
  const cardTerminalTrafficState: CardTerminalTrafficState = hasPendingMockCardTerminalSession || hasActiveCardTerminalSession
    ? "pending"
    : hasApprovedMockCardTerminalSession || cardTerminalSession?.status === "CAPTURED"
      ? "approved"
      : hasDeclinedMockCardTerminalSession
        || cardTerminalSession?.status === "DECLINED"
        || cardTerminalSession?.status === "FAILED"
        || cardTerminalSession?.status === "CANCELED"
        || cardTerminalSession?.status === "EXPIRED"
          ? "declined"
          : "idle";
  const cardTerminalRouteStatusLabel =
    cardTerminalTrafficState === "pending"
      ? `Sent to ${selectedCardTerminalRouteLabel}`
      : cardTerminalTrafficState === "approved"
        ? `Approved on ${selectedCardTerminalRouteLabel}`
        : cardTerminalTrafficState === "declined"
          ? `Declined on ${selectedCardTerminalRouteLabel}`
          : `Sending to ${selectedCardTerminalRouteLabel}`;
  const cardTerminalTrafficLabel =
    cardTerminalTrafficState === "pending"
      ? "Amber"
      : cardTerminalTrafficState === "approved"
        ? "Green"
        : cardTerminalTrafficState === "declined"
          ? "Red"
          : "Ready";
  const cardTerminalTrafficTitle =
    cardTerminalTrafficState === "pending"
      ? "Waiting for card machine"
      : cardTerminalTrafficState === "approved"
        ? "Approved"
        : cardTerminalTrafficState === "declined"
          ? "Declined"
          : hasConfiguredCardTerminal
            ? "Ready to send"
            : "Demo terminal ready";
  const cardTerminalTrafficMessage = cardTerminalTrafficState === "idle"
    ? null
    : mockCardTerminalState?.message
      ?? cardTerminalStatusLabel
      ?? (hasConfiguredCardTerminal ? "Waiting for the paired terminal." : null);
  const cardTerminalDisplayAmountPence =
    mockCardTerminalState?.amountPence
    ?? cardTerminalSession?.amountPence
    ?? payablePence;
  const cardTerminalDisplaySetupLabel = hasConfiguredCardTerminal ? getCardTerminalSetupLabel(cardTerminalConfig) : "Demo mode";
  const saleContextCompactItems = [
    {
      label: "Customer",
      value: activeCustomerName,
      note: activeCustomerContact,
    },
    {
      label: "Basket",
      value: basketSummaryLabel,
      note: formatMoney(sale ? sale.tenderSummary.totalPence : activeTotal),
    },
    {
      label: "Workstation",
      value: posWorkstationTillLabel,
      note: selectedCardTerminalRouteLabel,
    },
  ];
  const cardValidationMessage =
    selectedTenderMethod !== "CARD" || payablePence <= 0
      ? null
      : hasInProgressCardTerminalSession
        ? "Card terminal payment is still in progress."
        : hasApprovedMockCardTerminalSession
          ? null
          : hasDeclinedMockCardTerminalSession
            ? "Card payment was declined. Try again or choose another tender."
        : selectedCardPaymentMode === "TERMINAL"
          ? hasConfiguredCardTerminal
            ? "Send card payment to the terminal before completing the sale."
            : "Send card payment to the demo terminal or choose manual approval."
          : "Confirm card approval before completing the sale.";
  const tenderValidationMessage = cashValidationMessage ?? storeCreditValidationMessage ?? cardValidationMessage;
  const canCheckoutBasket = Boolean(basket && basket.items.length > 0 && !saleId);
  const canReturnSaleToBasket = Boolean(
    sale
    && sale.tenderSummary.tenderedPence === 0
    && !sale.payment,
  );
  const beginNextSaleFromSuccess = async () => {
    setCompletedSale(null);

    if (basket?.items.length === 0 && !sale) {
      focusProductSearch();
      return;
    }

    setSelectedTenderMethod(defaultTenderMethod);
    setCashTenderedAmount("");
    await createBasket();
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isEditableTarget = target instanceof HTMLElement
        && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (isEditableTarget) {
          return;
        }
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (event.key === "F2") {
        event.preventDefault();
        focusCustomerSearch();
        return;
      }

      if (isEditableTarget) {
        return;
      }

      if (event.key === "F4") {
        event.preventDefault();
        setCompletedSale(null);
        setSelectedTenderMethod(defaultTenderMethod);
        setCashTenderedAmount("");
        void createBasket();
        return;
      }

      if (event.key === "F8" && basket && basket.items.length > 0 && !sale) {
        event.preventDefault();
        void checkoutBasket();
        return;
      }

      if (event.key === "F9" && sale && !completing && !confirmingCardPayment && !tenderValidationMessage) {
        event.preventDefault();
        void completeSale();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [basket, completing, confirmingCardPayment, defaultTenderMethod, sale, tenderValidationMessage]);

  const completedSaleReceiptUrl = completedSale ? toBackendUrl(completedSale.receiptUrl) : "";
  const completedSaleCustomerEmail = completedSale?.customerEmail ?? selectedCustomer?.email ?? null;
  const completedSaleEmailHref = completedSaleCustomerEmail
    ? `mailto:${encodeURIComponent(completedSaleCustomerEmail)}?subject=${encodeURIComponent("Your CorePOS receipt")}&body=${encodeURIComponent(`Thanks for your purchase.\n\nYour receipt is available here:\n${completedSaleReceiptUrl}`)}`
    : null;

  const completedSalePanel = completedSale ? (
    <div className="success-panel success-panel-sale">
      <div className="success-panel-heading">
        <strong>Sale complete.</strong>
        <span className="status-badge status-complete">Ready for next sale</span>
      </div>
      <div className="success-summary-grid">
        <div>
          <div className="muted-text">Sale reference</div>
          <div className="table-primary mono-text">{completedSale.saleId}</div>
        </div>
        <div>
          <div className="muted-text">Tender</div>
          <div className="table-primary">{getTenderMethodLabel(completedSale.tenderMethod)}</div>
        </div>
        <div>
          <div className="muted-text">Total paid</div>
          <div className="table-primary">{formatMoney(completedSale.totalPaidPence)}</div>
        </div>
        <div>
          <div className="muted-text">Customer</div>
          <div className="table-primary">{completedSale.customerName || "Walk-in"}</div>
        </div>
      </div>
      {completedSale.tenderMethod === "CASH" && completedSale.cashTenderedPence !== null ? (
        <div className="success-summary-grid success-summary-grid--cash">
          <div>
            <div className="muted-text">Cash received</div>
            <div className="table-primary">{formatMoney(completedSale.cashTenderedPence)}</div>
          </div>
          <div>
            <div className="muted-text">Change due</div>
            <div className="table-primary">{formatMoney(completedSale.changeDuePence)}</div>
          </div>
        </div>
      ) : null}
      <div className="success-receipt-actions" aria-label="Receipt options">
        {completedSaleEmailHref ? (
          <a className="success-receipt-action success-receipt-action--email" href={completedSaleEmailHref}>
            <span className="success-receipt-action__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M4 7.5h16v10H4z" />
                <path d="m4.8 8.4 7.2 5.1 7.2-5.1" />
              </svg>
            </span>
            <span>
              <strong>Email receipt</strong>
              <small>{completedSaleCustomerEmail}</small>
            </span>
          </a>
        ) : (
          <button type="button" className="success-receipt-action success-receipt-action--email" disabled>
            <span className="success-receipt-action__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M4 7.5h16v10H4z" />
                <path d="m4.8 8.4 7.2 5.1 7.2-5.1" />
              </svg>
            </span>
            <span>
              <strong>Email receipt</strong>
              <small>No email on customer</small>
            </span>
          </button>
        )}
        <button
          type="button"
          className="success-receipt-action success-receipt-action--print"
          onClick={() => void handleManagedReceiptPrint()}
          data-testid="pos-print-receipt-link"
          disabled={printingReceipt || Boolean(completedSale.receiptPrintJob && !isManagedPrintJobTerminal(completedSale.receiptPrintJob.status))}
        >
          <span className="success-receipt-action__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M7 8V4h10v4" />
              <path d="M6 17H4.5v-6.5h15V17H18" />
              <path d="M7 14h10v6H7z" />
              <path d="M17 11.8h.1" />
            </svg>
          </span>
          <span>
            <strong>{getPosReceiptPrintButtonLabel(printingReceipt, completedSale.receiptPrintJob)}</strong>
            <small>Thermal printer</small>
          </span>
        </button>
      </div>
      <div className="success-links success-links-sale">
        <button type="button" className="primary" onClick={() => void beginNextSaleFromSuccess()}>
          New sale
        </button>
        <a
          href={`/sales/${encodeURIComponent(completedSale.saleId)}/receipt/print`}
          target="_blank"
          rel="noreferrer"
          data-testid="pos-receipt-options-link"
        >
          Receipt options
        </a>
        <a
          href={`/sales/${encodeURIComponent(completedSale.saleId)}/invoice/print`}
          target="_blank"
          rel="noreferrer"
          data-testid="pos-print-invoice-link"
        >
          Print A4 invoice
        </a>
        <a href={completedSaleReceiptUrl} target="_blank" rel="noreferrer">
          Open receipt
        </a>
        <a
          href={toBackendUrl(`/sales/${encodeURIComponent(completedSale.saleId)}/receipt`)}
          target="_blank"
          rel="noreferrer"
        >
          Open direct receipt page
        </a>
      </div>
      {completedSale.receiptPrintJob ? (
        <div className="success-panel-sale__print-status">
          <span className={getManagedPrintJobStatusBadgeClassName(completedSale.receiptPrintJob.status)}>
            {getManagedPrintJobStatusLabel(completedSale.receiptPrintJob.status)}
          </span>
          <span className="table-secondary">
            {completedSale.receiptPrinterName || completedSale.receiptPrintJob.printerName || "Managed receipt printer"}
            {completedSale.receiptPrintJob.status === "PENDING" ? " is queued." : null}
            {completedSale.receiptPrintJob.status === "PROCESSING" ? " is printing now." : null}
            {completedSale.receiptPrintJob.status === "SUCCEEDED" ? " finished printing." : null}
            {completedSale.receiptPrintJob.status === "FAILED" ? ` failed after ${completedSale.receiptPrintJob.attemptCount} attempt${completedSale.receiptPrintJob.attemptCount === 1 ? "" : "s"}.` : null}
            {completedSale.receiptPrintJob.status === "CANCELLED" ? " was cancelled." : null}
          </span>
          {completedSale.receiptPrintJob.lastError ? (
            <span className="warning-text">{completedSale.receiptPrintJob.lastError}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <div className="page-shell pos-page-shell">
      <section className="pos-workstation">
        <div className="pos-layout">
          <div className="pos-main-column">
            <div className="pos-main-header-stack">
              <div className="pos-utility-strip">
                <div className="pos-topbar">
                  <div className="pos-topbar-copy">
                    <h1>POS</h1>
                  </div>
                </div>

                <div className="pos-context-header" data-testid="pos-context-header">
                  <div className="pos-context-copy">
                    <div className="table-primary pos-context-title">{contextHeaderTitle}</div>
                    {contextHeaderMeta ? (
                      <div className="muted-text pos-context-meta">{contextHeaderMeta}</div>
                    ) : null}
                  </div>
                  {saleContext.type === "WORKSHOP" ? (
                    <div className="pos-context-totals">
                      <div>
                        <span className="muted-text">Job Total</span>
                        <strong>{formatMoney(activeTotal)}</strong>
                      </div>
                      <div>
                        <span className="muted-text">Deposit Paid</span>
                        <strong>{formatMoney(depositPaidPence)}</strong>
                      </div>
                      <div>
                        <span className="muted-text">Remaining</span>
                        <strong data-testid="pos-context-remaining">{formatMoney(contextRemainingPence)}</strong>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="pos-meta-strip" aria-label="POS sale metadata">
                  <span className="pos-meta-shortcuts">
                    <kbd>/</kbd> search <kbd>F2</kbd> customer <kbd>F8</kbd> checkout <kbd>F9</kbd> complete
                  </span>
                </div>
              </div>

              {loading ? <p className="muted-text">Loading...</p> : null}

            </div>

            <section className="pos-panel pos-search-panel">
              <div className="pos-panel-heading">
                <div>
                  <h2>Search / Scan</h2>
                </div>
                {searchText.trim() ? (
                  <div className="pos-search-status" aria-live="polite">
                    <strong>{searchResultSummary}</strong>
                  </div>
                ) : null}
              </div>

              <label className="pos-search-field">
                <input
                  ref={searchInputRef}
                  data-testid="pos-product-search"
                  aria-label="Search / Scan"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  onKeyDown={(event) => {
                    if (searchRows.length > 0 && event.key === "ArrowDown") {
                      event.preventDefault();
                      setHighlightedProductIndex((current) => (
                        current < 0 ? 0 : Math.min(current + 1, searchRows.length - 1)
                      ));
                      return;
                    }

                    if (searchRows.length > 0 && event.key === "ArrowUp") {
                      event.preventDefault();
                      setHighlightedProductIndex((current) => (
                        current < 0 ? 0 : Math.max(current - 1, 0)
                      ));
                      return;
                    }

                    if (event.key !== "Enter") {
                      return;
                    }

                    event.preventDefault();
                    if (event.shiftKey) {
                      void submitProductSearch(2);
                      return;
                    }
                    void submitProductSearch(1);
                  }}
                  placeholder="sku, barcode, name"
                />
              </label>

              {quickAddTiles.length > 0 ? (
                <div className="pos-quick-add" data-testid="pos-quick-add-grid">
                  <div className="pos-section-kicker">Quick Add</div>
                  <div className="pos-quick-add-grid">
                    {quickAddTiles.map((tile) => {
                      const canQuickAdd = Boolean(basketId) && !saleId;

                      return (
                        <button
                          key={tile.key}
                          type="button"
                          className="pos-quick-add-tile"
                          data-testid={`pos-quick-add-${tile.testId}`}
                          onClick={() => {
                            if (tile.type === "SERVICE_TEMPLATE") {
                              void addServiceTemplate(tile.template.id);
                              return;
                            }
                            void addItem(tile.product.id);
                          }}
                          disabled={!canQuickAdd}
                          aria-label={`Quick add ${tile.label}`}
                        >
                          <span className="pos-quick-add-name">{tile.label}</span>
                          <span className="pos-quick-add-price">
                            {formatMoney(tile.type === "SERVICE_TEMPLATE" ? tile.pricePence : tile.product.pricePence)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="table-wrap pos-results-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>SKU</th>
                      <th>Price</th>
                      <th>On Hand</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {searchRows.length === 0 ? (
                      <tr>
                        <td colSpan={5}>
                          {searchText.trim() ? "No products matched that search." : "Scan or search to start"}
                        </td>
                      </tr>
                    ) : (
                      searchRows.map((row, index) => {
                        const canAdd = Boolean(basketId) && !saleId;

                        return (
                          <tr
                            key={row.id}
                            ref={(element) => {
                              productResultRefs.current[index] = element;
                            }}
                            className={[
                              canAdd ? "clickable-row" : "",
                              index === activeProductIndex ? "pos-search-result-active" : "",
                            ].filter(Boolean).join(" ")}
                            onClick={canAdd ? () => void addItem(row.id) : undefined}
                            onMouseMove={() => setHighlightedProductIndex(index)}
                            onFocus={() => setHighlightedProductIndex(index)}
                            onKeyDown={
                              canAdd
                                ? (event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                      event.preventDefault();
                                      void addItem(row.id);
                                    }
                                  }
                                : undefined
                            }
                            role={canAdd ? "button" : undefined}
                            tabIndex={canAdd ? 0 : undefined}
                            aria-label={canAdd ? `Add ${row.name} to basket` : undefined}
                            aria-selected={index === activeProductIndex}
                          >
                            <td>{row.name}</td>
                            <td>{row.sku}</td>
                            <td>{formatMoney(row.pricePence)}</td>
                            <td>{row.onHandQty}</td>
                            <td>
                              <div className="actions-inline">
                                <button
                                  type="button"
                                  data-testid={`pos-product-add-${row.id}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void addItem(row.id);
                                  }}
                                  disabled={!canAdd}
                                >
                                  Add
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void addMultipleItems(row.id, 2);
                                  }}
                                  disabled={!canAdd}
                                >
                                  Add 2
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>

          </div>

          <div className={`pos-side-column${checkoutMode ? " pos-side-column--checkout" : ""}${completedSale ? " pos-side-column--complete" : ""}`}>
            {completedSalePanel}

            {showCustomerPanel ? (
            <section className={`pos-panel pos-customer-panel${compactCustomerRail ? " pos-customer-panel--checkout" : ""}`}>
              <div className="pos-panel-heading">
                <div>
                  <div className="pos-section-kicker">Customer</div>
                </div>
              </div>

              {selectedCustomer ? (
                <div className={`selected-customer-panel${compactCustomerRail ? " selected-customer-panel--checkout" : ""}`} data-testid="pos-selected-customer">
                  <div className="selected-customer-panel__summary">
                    <div className="selected-customer-panel__identity">
                      <div className="table-primary">{selectedCustomer.name}</div>
                      <div className="muted-text">
                        {selectedCustomer.email || selectedCustomer.phone || "No contact details"}
                      </div>
                    </div>
                    <div className="customer-status-chip">
                      {selectedCustomerAttachedToSale
                        ? "Attached to sale"
                        : selectedCustomerAttachedToBasket
                          ? "Attached to basket"
                          : "Selected for checkout"}
                    </div>
                  </div>
                  <div className="selected-customer-panel__actions" aria-label={`Customer actions for ${selectedCustomer.name}`}>
                    {!compactCustomerRail || customerToolsExpanded ? (
                      <button type="button" className="selected-customer-action" onClick={openCustomerProfileModal}>
                        Profile
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="selected-customer-action"
                      onClick={customerToolsExpanded ? collapseCustomerTools : openCustomerTools}
                      aria-expanded={customerToolsExpanded}
                    >
                      {customerToolsExpanded ? "Done" : "Change"}
                    </button>
                    <button
                      type="button"
                      className="selected-customer-action selected-customer-action--danger"
                      data-testid="pos-customer-clear"
                      onClick={() => void clearSelectedCustomer()}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : null}

              {showCustomerCapturePanel ? (
                <div className={compactCustomerRail ? "pos-customer-capture-compact-shell" : undefined}>
                  <PosCustomerCapturePanel
                    target={customerCaptureTarget}
                    isCaptureEligible={isCaptureEligible}
                    actionsDisabled={loading || completing}
                    captureSession={captureSession}
                    captureSessionLoading={captureSessionLoading}
                    captureSessionLaunchMode={captureSessionLaunchMode}
                    creatingCaptureSession={creatingCaptureSession}
                    captureStatusError={captureStatusError}
                    captureUrl={captureUrl}
                    captureCompletionSummary={captureCompletionSummary}
                    onDismissCompletion={dismissCaptureCompletionSummary}
                    onCreateCustomerCaptureSession={() => void createCustomerCaptureSession()}
                    onCopyCaptureUrl={() => void copyCaptureUrl()}
                    onRefreshStatus={() => void refreshCaptureStatus()}
                    onRefreshTarget={() => {
                      if (!customerCaptureTarget) {
                        return;
                      }
                      void refreshTargetAfterCustomerCapture(customerCaptureTarget, { showToast: true });
                    }}
                  />
                </div>
              ) : null}

              {showCustomerSearchTools ? (
                <>
                  <div className="customer-search-panel">
                    <div className="customer-search-stack grow">
                      <div className="grow">
                        <input
                          ref={customerSearchInputRef}
                          data-testid="pos-customer-search"
                          value={customerSearchText}
                          onChange={(event) => setCustomerSearchText(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              if (highlightedCustomerIndex >= 0 && customerResults[highlightedCustomerIndex]) {
                                void selectCustomer(customerResults[highlightedCustomerIndex]);
                                return;
                              }
                              if (customerSearchText.trim()) {
                                openCustomerCreatePanel();
                              }
                              return;
                            }

                            if (customerResults.length === 0) {
                              return;
                            }

                            if (event.key === "ArrowDown") {
                              event.preventDefault();
                              setHighlightedCustomerIndex((current) => (
                                current < 0 ? 0 : Math.min(current + 1, customerResults.length - 1)
                              ));
                              return;
                            }

                            if (event.key === "ArrowUp") {
                              event.preventDefault();
                              setHighlightedCustomerIndex((current) => (
                                current < 0 ? 0 : Math.max(current - 1, 0)
                              ));
                            }
                          }}
                          placeholder="name, phone, email"
                        />
                      </div>

                      {customerLoading ? <p className="muted-text pos-customer-search-status">Searching customers...</p> : null}

                      {customerSearchText.trim() && !showCreateCustomer ? (
                        <div className="pos-customer-results" role="listbox" aria-label="Customer search results">
                          {customerResults.length === 0 ? (
                            <p className="pos-customer-results-empty">No match. Enter to create.</p>
                          ) : (
                            customerResults.map((customer, index) => {
                              const metadata = [customer.email, customer.phone].filter(Boolean).join(" • ") || "No email or phone";

                              return (
                                <button
                                  key={customer.id}
                                  type="button"
                                  ref={(element) => {
                                    customerResultRefs.current[index] = element;
                                  }}
                                  className={index === highlightedCustomerIndex ? "pos-customer-result pos-customer-result-active" : "pos-customer-result"}
                                  data-testid={`pos-customer-select-${customer.id}`}
                                  aria-selected={index === highlightedCustomerIndex}
                                  onClick={() => void selectCustomer(customer)}
                                  onMouseEnter={() => setHighlightedCustomerIndex(index)}
                                >
                                  <span className="pos-customer-result-copy">
                                    <span className="pos-customer-result-name">{customer.name}</span>
                                    <span className="pos-customer-result-meta">{metadata}</span>
                                  </span>
                                  <span className="pos-customer-result-action">{sale ? "Attach" : "Select"}</span>
                                </button>
                              );
                            })
                          )}
                        </div>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      aria-expanded={showCreateCustomer}
                      onClick={startQuickCustomerCreate}
                    >
                      {showCreateCustomer ? "Hide quick create" : "Quick create"}
                    </button>
                  </div>

                  {showCreateCustomer ? (
                    <form
                      className="quick-create-panel pos-customer-create-panel"
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) {
                          return;
                        }

                        event.preventDefault();
                        void createCustomerAndSelect();
                      }}
                      onSubmit={(event) => {
                        event.preventDefault();
                        void createCustomerAndSelect();
                      }}
                    >
                      <div className="quick-create-grid">
                        <label>
                          Name
                          <input
                            ref={newCustomerNameInputRef}
                            value={newCustomerName}
                            onChange={(event) => setNewCustomerName(event.target.value)}
                            placeholder="Customer name"
                          />
                        </label>
                        <div className="pos-quick-create-email-field">
                          <label>
                            Email
                            <input
                              value={newCustomerEmail}
                              onChange={(event) => setNewCustomerEmail(event.target.value)}
                              placeholder="name@example.com"
                            />
                          </label>
                          <div className="pos-email-domain-shortcuts" aria-label="Common email domains">
                            {CUSTOMER_EMAIL_DOMAIN_SHORTCUTS.map((domain) => (
                              <button
                                key={domain}
                                type="button"
                                className="pos-email-domain-chip"
                                onClick={() => applyCustomerEmailDomainShortcut(domain)}
                                disabled={!hasNewCustomerEmailLocalPart}
                                aria-label={`Set email domain to ${domain}`}
                              >
                                {domain}
                              </button>
                            ))}
                          </div>
                        </div>
                        <label>
                          Phone
                          <input
                            value={newCustomerPhone}
                            onChange={(event) => setNewCustomerPhone(event.target.value)}
                            placeholder="Phone number"
                          />
                        </label>
                      </div>
                      <div className="actions-inline">
                        <button type="submit" className="primary" disabled={creatingCustomer}>
                          {creatingCustomer ? "Creating..." : "Create and Select"}
                        </button>
                        <button
                          type="button"
                          className="pos-add-more-details-link"
                          onClick={() => void createCustomerAndSelect({ openProfile: true })}
                          disabled={creatingCustomer}
                        >
                          Add more details
                        </button>
                      </div>
                    </form>
                  ) : null}
                </>
              ) : null}

            </section>
            ) : null}

            {!checkoutMode ? (
            <section className={`pos-panel pos-workstation-panel${posWorkstationConfigured ? "" : " pos-workstation-panel--warning"}`}>
              <div className="pos-panel-heading">
                <div>
                  <div className="pos-section-kicker">Workstation</div>
                </div>
              </div>

              <div className="pos-workstation-summary">
                <label className="pos-workstation-picker">
                  <span>Till point</span>
                  <select
                    value={posWorkstationState.tillPointId ?? ""}
                    onChange={(event) => {
                      const nextTillPointId = event.target.value;
                      if (isPosTillPointId(nextTillPointId)) {
                        chooseTillPoint(nextTillPointId);
                      }
                    }}
                    disabled={hasInProgressCardTerminalSession}
                    aria-label="Till point"
                  >
                    <option value="" disabled>Choose till</option>
                    {POS_TILL_POINTS.map((tillPoint) => (
                      <option key={tillPoint.id} value={tillPoint.id}>
                        {tillPoint.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="pos-workstation-picker">
                  <span>Card terminal</span>
                  <select
                    value={selectedCardTerminalRouteId}
                    onChange={(event) => {
                      const nextTerminalRouteId = event.target.value;
                      if (isCardTerminalRouteId(nextTerminalRouteId)) {
                        chooseCardTerminalRoute(nextTerminalRouteId);
                      }
                    }}
                    disabled={!posWorkstationConfigured || hasInProgressCardTerminalSession}
                    aria-label="Card terminal route"
                  >
                    {CARD_TERMINAL_ROUTES.map((route) => (
                      <option key={route.id} value={route.id}>
                        {getCardTerminalRouteLabel(route.id, cardTerminals, cardTerminalConfig)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {!posWorkstationConfigured ? (
                <div className="pos-workstation-warning">
                  <p>Set the till point for this browser before live card use.</p>
                  {suggestedTillPoint ? (
                    <button type="button" onClick={() => chooseTillPoint(suggestedTillPoint.id)}>
                      Use {suggestedTillPoint.label}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>
            ) : null}

            {showBasketPanel ? (
              <section className="pos-panel pos-basket-panel">
                <div className="pos-panel-heading">
                  <div>
                    <div className="pos-section-kicker">Basket</div>
                  </div>
                  {showBasketLineControls || checkoutMode ? (
                    <div className="actions-inline pos-basket-heading-actions">
                      {showBasketLineControls ? (
                        <button
                          type="button"
                          onClick={() => void clearBasket()}
                          disabled={!basket || basket.items.length === 0 || Boolean(saleId)}
                        >
                          Clear basket
                        </button>
                      ) : null}
                      {checkoutMode ? (
                        <button
                          type="button"
                          onClick={() => setPaymentBasketExpanded(false)}
                        >
                          Hide basket
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {basket && basket.items.length > 0 ? (
                  <div className="pos-basket-groups">
                    {basketGroups.map((group) => (
                      <section key={group.key} className={`pos-basket-group pos-basket-group-${group.key.toLowerCase()}`}>
                        <div className="pos-basket-group-header pos-group-row">
                          <div>
                            <strong>{saleContext.type === "WORKSHOP" ? group.label : group.key === "PART" ? "" : group.label}</strong>
                          </div>
                        </div>
                        <div className="pos-basket-list">
                          {group.items.map((item) => (
                            <article
                              key={item.id}
                              ref={(element) => {
                                basketItemRefs.current[item.id] = element;
                              }}
                              className={`pos-line-item${lastAddedBasketItemId === item.id ? " pos-line-item-highlighted" : ""}${!showBasketLineControls ? " pos-line-item-readonly" : ""}`}
                            >
                              <div className="pos-line-main" title={`SKU ${item.sku}`} data-sku={item.sku}>
                                <div className="table-primary pos-line-title">
                                  {item.productName}
                                  {item.variantName ? ` (${item.variantName})` : ""}
                                </div>
                              </div>
                              <div className="pos-line-pricing">
                                <strong>{formatMoney(item.lineTotalPence)}</strong>
                                <span>{formatMoney(item.unitPricePence)} each</span>
                              </div>
                              {showBasketLineControls ? (
                                <div className="pos-line-actions">
                                  <div className="actions-inline pos-qty-controls">
                                    <button
                                      type="button"
                                      onClick={() => void adjustLineQty(item.id, item.quantity, -1)}
                                      disabled={Boolean(saleId)}
                                      aria-label={`Decrease quantity for ${item.productName}`}
                                    >
                                      -
                                    </button>
                                    <strong>{item.quantity}</strong>
                                    <button
                                      type="button"
                                      onClick={() => void adjustLineQty(item.id, item.quantity, 1)}
                                      disabled={Boolean(saleId)}
                                      aria-label={`Increase quantity for ${item.productName}`}
                                    >
                                      +
                                    </button>
                                  </div>
                                  <button
                                    type="button"
                                    className="pos-line-remove-button"
                                    onClick={() => void removeLine(item.id)}
                                    disabled={Boolean(saleId)}
                                    aria-label={`Remove ${item.productName}`}
                                  >
                                    Remove
                                  </button>
                                </div>
                              ) : null}
                            </article>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : sale && sale.saleItems.length > 0 ? (
                  <div className="pos-basket-groups">
                    <section className="pos-basket-group pos-basket-group-labour">
                      <div className="pos-basket-group-header pos-group-row">
                        <div>
                          <strong>Sale items</strong>
                        </div>
                      </div>
                      <div className="pos-basket-list">
                        {sale.saleItems.map((item) => (
                          <article key={item.id} className="pos-line-item pos-line-item-readonly">
                            <div className="pos-line-main">
                              <div className="table-primary pos-line-title">
                                {item.productName}
                                {item.variantName ? ` (${item.variantName})` : ""}
                              </div>
                            </div>
                            <div className="pos-line-pricing">
                              <strong>{formatMoney(item.lineTotalPence)}</strong>
                              <span>{item.quantity} × {formatMoney(item.unitPricePence)}</span>
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  </div>
                ) : (
                  <div className="pos-empty-state">
                    <strong>Scan or search to start</strong>
                  </div>
                )}
              </section>
            ) : null}

            <section className="pos-panel pos-payment-panel">
              <div className="pos-panel-heading">
                <div>
                  <div className="pos-section-kicker">Totals & Payment</div>
                  {sale ? <h2>Take Payment</h2> : null}
                </div>
                <div className="actions-inline pos-payment-heading-actions">
                  {sale ? (
                    <button
                      type="button"
                      className="secondary pos-return-basket-button"
                      onClick={() => void returnSaleToBasket()}
                      disabled={
                        !canReturnSaleToBasket
                        || completing
                        || confirmingCardPayment
                        || cardTerminalLoading
                        || hasInProgressCardTerminalSession
                        || returningToBasket
                      }
                      title={canReturnSaleToBasket ? "Return this unpaid sale to basket editing" : "Cannot return after payment activity"}
                    >
                      {returningToBasket ? "Returning..." : "Back to basket"}
                    </button>
                  ) : null}
                  {!sale ? <span className="pos-payment-state">Basket open</span> : null}
                </div>
              </div>

              {sale ? (
                <div className="pos-payment-focus-summary" data-testid="pos-payment-focus-summary">
                  <div className="pos-payment-focus-summary__items">
                    {saleContextCompactItems.map((item) => (
                      <div key={item.label} className="pos-payment-focus-summary__item">
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                        <small>{item.note}</small>
                      </div>
                    ))}
                  </div>
                  <div className="pos-payment-focus-summary__actions">
                    <button
                      type="button"
                      onClick={() => setPaymentBasketExpanded((current) => !current)}
                      aria-expanded={paymentBasketExpanded}
                    >
                      {paymentBasketExpanded ? "Hide basket" : "View basket"}
                    </button>
                    <button
                      type="button"
                      onClick={openCustomerTools}
                      aria-expanded={customerToolsExpanded}
                    >
                      Change customer
                    </button>
                  </div>
                </div>
              ) : null}

              {saleContext.type === "WORKSHOP" ? (
                <div className="pos-checkout-summary pos-payment-summary" data-testid="pos-checkout-summary">
                  <div className="pos-payment-total-block">
                    <span className="muted-text">Job Total</span>
                    <strong>{formatMoney(sale ? sale.tenderSummary.totalPence : activeTotal)}</strong>
                  </div>
                  <div>
                    <span className="muted-text">Deposit Paid</span>
                    <strong>{formatMoney(depositPaidPence)}</strong>
                  </div>
                  <div>
                    <span className="muted-text">Remaining</span>
                    <strong>{formatMoney(payablePence)}</strong>
                  </div>
                  {showDiscountSummary ? (
                    <div>
                      <span className="muted-text">Discount</span>
                      <strong>{discountSummaryLabel}</strong>
                      <span className="pos-payment-summary-note">{discountSummaryNote}</span>
                    </div>
                  ) : null}
                  {showDepositSummary ? (
                    <div>
                      <span className="muted-text">Deposit</span>
                      <strong>{depositSummaryLabel}</strong>
                      <span className="pos-payment-summary-note">{depositSummaryNote}</span>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="pos-payment-summary pos-payment-summary-retail">
                  <div className="pos-payment-total-block">
                    <span className="muted-text">Payable</span>
                    <strong>{formatMoney(payablePence)}</strong>
                  </div>
                  <div>
                    <span className="muted-text">Total</span>
                    <strong>{formatMoney(sale ? sale.tenderSummary.totalPence : activeTotal)}</strong>
                  </div>
                  {showDiscountSummary ? (
                    <div>
                      <span className="muted-text">Discount</span>
                      <strong>{discountSummaryLabel}</strong>
                      <span className="pos-payment-summary-note">{discountSummaryNote}</span>
                    </div>
                  ) : null}
                  {showDepositSummary ? (
                    <div>
                      <span className="muted-text">Deposit</span>
                      <strong>{depositSummaryLabel}</strong>
                      <span className="pos-payment-summary-note">{depositSummaryNote}</span>
                    </div>
                  ) : null}
                </div>
              )}

              {customerOptionsOpen ? (
                <div className="pos-customer-options-panel" id="pos-customer-options-panel">
                  <button
                    type="button"
                    className={!selectedCustomer ? "pos-customer-option pos-customer-option-active" : "pos-customer-option"}
                    onClick={() => void chooseWalkInCustomer()}
                  >
                    <span>Walk-in</span>
                    <strong>No profile attached</strong>
                  </button>
                  <button
                    type="button"
                    className={selectedCustomer ? "pos-customer-option pos-customer-option-active" : "pos-customer-option"}
                    onClick={chooseLinkedCustomer}
                  >
                    <span>Linked customer</span>
                    <strong>Search existing profile</strong>
                  </button>
                  <button
                    type="button"
                    className="pos-customer-option"
                    onClick={chooseTapCustomer}
                    disabled={!isCaptureEligible || creatingCaptureSession}
                  >
                    <span>Tap customer</span>
                    <strong>{creatingCaptureSession ? "Starting..." : "NFC capture flow"}</strong>
                  </button>
                  <button
                    type="button"
                    className="pos-customer-option"
                    onClick={chooseNewCustomer}
                  >
                    <span>New customer</span>
                    <strong>Quick create profile</strong>
                  </button>
                </div>
              ) : null}

              {sale ? (
                <>
                  <section className="pos-payment-method-panel" aria-label="Payment method">
                    <div className="pos-payment-method-panel__heading">
                      <span>Payment method</span>
                    </div>
                    <div className="pos-tender-switch" role="group" aria-label="Tender type">
                      {enabledTenderMethods.map((method) => (
                        <button
                          key={method}
                          type="button"
                          className={[
                            "pos-tender-option",
                            selectedTenderMethod === method ? "primary pos-tender-option--active" : "",
                          ].filter(Boolean).join(" ")}
                          onClick={() => chooseTenderMethod(method)}
                          disabled={completing || confirmingCardPayment || cardTerminalLoading || hasInProgressCardTerminalSession}
                          aria-label={getTenderMethodLabel(method)}
                          title={getTenderMethodLabel(method)}
                        >
                          <strong className="pos-tender-option__symbol" aria-hidden="true">
                            {getTenderMethodIcon(method)}
                          </strong>
                          <span>{getTenderMethodLabel(method)}</span>
                        </button>
                      ))}
                    </div>
                  </section>

                  {selectedTenderMethod === "CARD" ? (
                    <div className="quick-create-panel pos-card-panel">
                      <div className="actions-inline pos-card-mode-switch" role="group" aria-label="Card payment mode">
                        <button
                          type="button"
                          className={selectedCardPaymentMode === "TERMINAL" ? "primary" : ""}
                          onClick={() => chooseCardPaymentMode("TERMINAL")}
                          disabled={completing || confirmingCardPayment || cardTerminalLoading || hasInProgressCardTerminalSession}
                        >
                          Auto
                        </button>
                        <button
                          type="button"
                          className={selectedCardPaymentMode === "MANUAL" ? "primary" : ""}
                          onClick={() => chooseCardPaymentMode("MANUAL")}
                          disabled={completing || confirmingCardPayment || cardTerminalLoading || hasInProgressCardTerminalSession}
                        >
                          Manual
                        </button>
                      </div>

                      {selectedCardPaymentMode === "TERMINAL" ? (
                        <div className={`pos-card-terminal-card${hasConfiguredCardTerminal ? " pos-card-terminal-card--ready" : " pos-card-terminal-card--pending"}`}>
                          <div className="pos-card-terminal-card__header">
                            <div className="pos-card-terminal-card__copy">
                              <span className="pos-card-terminal-pill">{cardTerminalDisplaySetupLabel}</span>
                            </div>
                            <div className="pos-card-terminal-amount">
                              <span>Amount</span>
                              <strong>{formatMoney(cardTerminalDisplayAmountPence)}</strong>
                            </div>
                          </div>

                          <div className={`pos-card-terminal-route${posWorkstationConfigured ? "" : " pos-card-terminal-route--warning"}`}>
                            <div className="pos-card-terminal-route__copy">
                              <span>{posWorkstationTillLabel}</span>
                              <strong>{cardTerminalRouteStatusLabel}</strong>
                              {!posWorkstationConfigured ? (
                                <em>Till point setup needed</em>
                              ) : cardTerminalRouteOverrideActive ? (
                                <em>Custom terminal route</em>
                              ) : null}
                            </div>
                          </div>

                          <div
                            className={`pos-card-terminal-traffic pos-card-terminal-traffic--${cardTerminalTrafficState}`}
                            data-testid="pos-card-terminal-traffic"
                          >
                            <div className="pos-card-terminal-signal" aria-hidden="true">
                              {cardTerminalTrafficState === "pending" ? (
                                <span className="pos-card-terminal-spinner" />
                              ) : (
                                <span className="pos-card-terminal-light" />
                              )}
                            </div>
                            <div className="pos-card-terminal-traffic__copy">
                              <span>{cardTerminalTrafficLabel}</span>
                              <strong>{cardTerminalTrafficTitle}</strong>
                              {cardTerminalTrafficMessage ? <p>{cardTerminalTrafficMessage}</p> : null}
                            </div>
                          </div>

                          {hasConfiguredCardTerminal ? (
                            <div className="pos-card-terminal-controls">
                              {cardTerminals.length === 0 && cardTerminalConfig?.defaultTerminalId ? (
                                <p className="muted-text">
                                  Terminal: {cardTerminalConfig.defaultTerminalId}
                                </p>
                              ) : null}

                              <div className="actions-inline pos-card-terminal-actions">
                                <button
                                  type="button"
                                  className="primary"
                                  data-testid="pos-send-card-terminal-payment"
                                  onClick={() => void startCardTerminalPayment()}
                                  disabled={
                                    payablePence <= 0
                                    || completing
                                    || confirmingCardPayment
                                    || cardTerminalLoading
                                    || hasInProgressCardTerminalSession
                                    || !routedCardTerminalProviderId
                                  }
                                >
                                  {hasInProgressCardTerminalSession
                                    ? "Waiting..."
                                    : cardTerminalLoading
                                      ? "Starting..."
                                      : payablePence <= 0
                                        ? "Card captured"
                                        : "Send to terminal"}
                                </button>
                                {cardTerminalSession && !cardTerminalSession.isFinal ? (
                                  <button
                                    type="button"
                                    onClick={() => void cancelCardTerminalPayment()}
                                    disabled={cardTerminalLoading || completing}
                                  >
                                    Cancel
                                  </button>
                                ) : null}
                              </div>

                              {cardTerminalSession?.status === "SIGNATURE_VERIFICATION_REQUIRED" ? (
                                <div className="actions-inline pos-card-terminal-actions">
                                  <button
                                    type="button"
                                    className="primary"
                                    onClick={() => void respondToCardTerminalSignature(true)}
                                    disabled={cardTerminalLoading}
                                  >
                                    Accept signature
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void respondToCardTerminalSignature(false)}
                                    disabled={cardTerminalLoading}
                                  >
                                    Decline signature
                                  </button>
                                </div>
                              ) : null}

                              {cardTerminalStatusLabel ? (
                                <p className="muted-text pos-card-terminal-status">
                                  {selectedCardTerminal ? `${selectedCardTerminal.name}: ` : ""}
                                  {cardTerminalStatusLabel}
                                </p>
                              ) : null}
                            </div>
                          ) : (
                            <div className="pos-card-terminal-controls">
                              <div className="actions-inline pos-card-terminal-actions">
                                <button
                                  type="button"
                                  className="primary"
                                  data-testid="pos-send-card-terminal-payment"
                                  onClick={() => void startCardTerminalPayment()}
                                  disabled={
                                    payablePence <= 0
                                    || completing
                                    || confirmingCardPayment
                                    || hasPendingMockCardTerminalSession
                                    || hasApprovedMockCardTerminalSession
                                  }
                                >
                                  {hasPendingMockCardTerminalSession
                                    ? "Payment sent"
                                    : hasApprovedMockCardTerminalSession
                                      ? "Approved"
                                      : "Send to terminal"}
                                </button>
                                {hasPendingMockCardTerminalSession ? (
                                  <button
                                    type="button"
                                    onClick={cancelMockCardTerminalPayment}
                                    disabled={completing}
                                  >
                                    Cancel
                                  </button>
                                ) : null}
                              </div>

                              {hasPendingMockCardTerminalSession ? (
                                <div className="actions-inline pos-card-terminal-outcomes" role="group" aria-label="Demo card outcome">
                                  <button
                                    type="button"
                                    className="pos-card-terminal-approve"
                                    data-testid="pos-mock-card-approved"
                                    onClick={approveMockCardTerminalPayment}
                                  >
                                    Simulate approved
                                  </button>
                                  <button
                                    type="button"
                                    className="pos-card-terminal-decline"
                                    data-testid="pos-mock-card-declined"
                                    onClick={declineMockCardTerminalPayment}
                                  >
                                    Simulate declined
                                  </button>
                                </div>
                              ) : null}

                              {hasDeclinedMockCardTerminalSession ? (
                                <div className="actions-inline pos-card-terminal-actions">
                                  <button type="button" onClick={startMockCardTerminalPayment}>
                                    Try again
                                  </button>
                                  <button type="button" onClick={() => chooseCardPaymentMode("MANUAL")}>
                                    Manual approval
                                  </button>
                                </div>
                              ) : null}

                              {hasApprovedMockCardTerminalSession ? (
                                <p className="muted-text pos-card-terminal-status">
                                  Auth {mockCardTerminalState.reference}. Complete sale when ready.
                                </p>
                              ) : null}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="pos-card-manual-fallback">
                        <div>
                          <strong>Manual approval</strong>
                          <p className="muted-text">
                            Confirm the card machine has approved {formatMoney(payablePence)}.
                          </p>
                        </div>
                        <button
                          type="button"
                          className="primary"
                          data-testid="pos-confirm-card-payment"
                          onClick={() => void confirmManualCardPayment()}
                          disabled={
                            payablePence <= 0
                            || completing
                            || confirmingCardPayment
                            || cardTerminalLoading
                            || hasInProgressCardTerminalSession
                          }
                        >
                          {payablePence <= 0
                            ? "Card confirmed"
                            : confirmingCardPayment
                              ? "Confirming..."
                              : "Confirm approved"}
                        </button>
                        </div>
                      )}
                    </div>
                  ) : null}

                  {selectedTenderMethod === "CASH" ? (
                    <div className="quick-create-panel pos-cash-panel">
                      <div className="quick-create-grid pos-cash-grid">
                        <label>
                          Amount tendered
                          <input
                            ref={cashTenderedInputRef}
                            data-testid="pos-cash-tendered"
                            inputMode="decimal"
                            value={cashTenderedAmount}
                            onChange={(event) => setCashTenderedAmount(event.target.value)}
                            placeholder="0.00"
                            disabled={completing}
                          />
                        </label>
                      </div>

                      <div className="actions-inline pos-cash-shortcuts" role="group" aria-label="Quick cash amounts">
                        <button
                          type="button"
                          onClick={() => setCashTenderedAmount((payablePence / 100).toFixed(2))}
                          disabled={payablePence === 0 || completing}
                        >
                          Exact
                        </button>
                        {quickCashAmounts.map((amountPence) => (
                          <button
                            key={amountPence}
                            type="button"
                            onClick={() => setCashTenderedAmount((amountPence / 100).toFixed(2))}
                            disabled={completing}
                          >
                            {formatMoney(amountPence)}
                          </button>
                        ))}
                      </div>

                      <div className="pos-cash-summary" aria-label="Cash payment summary">
                        <div>
                          <span>Due</span>
                          <strong>{formatMoney(payablePence)}</strong>
                        </div>
                        <div>
                          <span>Tendered</span>
                          <strong>{formatMoney(cashTenderedPence ?? 0)}</strong>
                        </div>
                        <div className={`pos-cash-change${cashChangeDuePence > 0 ? " pos-cash-change--due" : ""}`}>
                          <span>Change</span>
                          <strong>{formatMoney(cashChangeDuePence)}</strong>
                        </div>
                      </div>

                      {cashValidationMessage ? <p className="muted-text pos-cash-warning">{cashValidationMessage}</p> : null}
                    </div>
                  ) : null}

                  {selectedTenderMethod === "STORE_CREDIT" ? (
                    <div className="quick-create-panel pos-store-credit-panel">
                      <strong>Store credit</strong>
                      <p className="muted-text">
                        Uses the attached customer's available credit balance for the amount due.
                      </p>
                      {storeCreditValidationMessage ? (
                        <p className="muted-text pos-cash-warning">{storeCreditValidationMessage}</p>
                      ) : (
                        <p className="muted-text">
                          Customer: {storeCreditCustomer?.name ?? "Linked account"}
                        </p>
                      )}
                    </div>
                  ) : null}
                </>
              ) : null}

              <div className="actions-inline pos-payment-actions">
                {sale ? (
                  <button
                    type="button"
                    className="primary"
                    data-testid="pos-complete-sale"
                    onClick={completeSale}
                    disabled={
                      completing
                      || confirmingCardPayment
                      || cardTerminalLoading
                      || hasInProgressCardTerminalSession
                      || Boolean(tenderValidationMessage)
                    }
                  >
                    {completing ? "Completing..." : "Complete Sale"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="primary"
                    data-testid="pos-checkout-basket"
                    onClick={checkoutBasket}
                    disabled={!canCheckoutBasket}
                  >
                    Checkout Basket
                  </button>
                )}
              </div>
            </section>
          </div>
        </div>
      </section>

      {customerProfileModalOpen && selectedCustomer?.id ? (
        <div
          className="customer-profile-overlay"
          role="presentation"
          onClick={() => setCustomerProfileModalOpen(false)}
        >
          <div
            className="customer-profile-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Customer profile for ${selectedCustomer.name}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="customer-profile-modal__header">
              <div>
                <strong>Customer Profile</strong>
                <div className="muted-text">{selectedCustomer.name}</div>
              </div>
              <div className="actions-inline">
                <Link
                  to={`/customers/${encodeURIComponent(selectedCustomer.id)}`}
                  className="button-link"
                  onClick={() => setCustomerProfileModalOpen(false)}
                >
                  Open page
                </Link>
                <button type="button" onClick={() => setCustomerProfileModalOpen(false)}>
                  Close
                </button>
              </div>
            </div>
            <div className="customer-profile-modal__content">
              <Suspense fallback={<p className="muted-text">Loading customer profile...</p>}>
                <LazyCustomerProfilePage customerId={selectedCustomer.id} embedded />
              </Suspense>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
