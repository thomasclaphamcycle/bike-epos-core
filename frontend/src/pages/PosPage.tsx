import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { apiDelete, apiGet, apiPatch, apiPost } from "../api/client";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useToasts } from "../components/ToastProvider";
import { PosCustomerCapturePanel } from "../features/customerCapture/PosCustomerCapturePanel";
import { usePosCustomerCapture } from "../features/customerCapture/usePosCustomerCapture";
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
  resolvePosLineItemType,
  type PosLineItem,
  type SaleContext,
} from "../features/pos/posContext";
import { toBackendUrl } from "../utils/backendUrl";
import { isExactLookupMatch, looksLikeScannerInput } from "../utils/barcode";

const ACTIVE_SALE_KEY = "corepos.activeSaleId";
const QUICK_ADD_TILE_DEFINITIONS = [
  { key: "inner-tube", label: "Inner Tube", query: "Inner Tube" },
  { key: "chain-lube", label: "Chain Lube", query: "Chain Lube" },
  { key: "brake-pads", label: "Brake Pads", query: "Brake Pads" },
  { key: "helmet", label: "Helmet", query: "Helmet" },
  { key: "floor-pump", label: "Floor Pump", query: "Floor Pump" },
  { key: "city-bike", label: "City Bike", query: "City Bike" },
] as const;
const ACTIVE_BASKET_KEY = "corepos_active_basket_id";

type ProductSearchRow = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  pricePence: number;
  onHandQty: number;
};

type QuickAddTile = {
  key: (typeof QUICK_ADD_TILE_DEFINITIONS)[number]["key"];
  label: string;
  query: string;
  product: ProductSearchRow;
};

type BasketResponse = {
  id: string;
  status: string;
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

type TenderMethod = "CASH" | "CARD";

type CompletedSaleState = {
  saleId: string;
  receiptUrl: string;
  changeDuePence: number;
  tenderMethod: TenderMethod;
  customerName: string | null;
  cashTenderedPence: number | null;
  totalPaidPence: number;
  receiptPrintJob: ManagedPrintJobSummary | null;
  receiptPrinterName: string | null;
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

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

export const PosPage = () => {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { success, error } = useToasts();
  const isPageActiveRef = useRef(true);
  const posLifecycleRequestIdRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const productResultRefs = useRef<Array<HTMLTableRowElement | null>>([]);
  const customerSearchInputRef = useRef<HTMLInputElement | null>(null);
  const customerResultRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const cashTenderedInputRef = useRef<HTMLInputElement | null>(null);
  const lastAddedRowTimeoutRef = useRef<number | null>(null);
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
  const [contextCustomerId, setContextCustomerId] = useState<string | null>(null);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [showCreateCustomer, setShowCreateCustomer] = useState(false);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerEmail, setNewCustomerEmail] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");

  const [basket, setBasket] = useState<BasketResponse | null>(null);
  const [sale, setSale] = useState<SaleResponse | null>(null);
  const [saleContext, setSaleContext] = useState<SaleContext>(DEFAULT_SALE_CONTEXT);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [selectedTenderMethod, setSelectedTenderMethod] = useState<TenderMethod>("CARD");
  const [cashTenderedAmount, setCashTenderedAmount] = useState("");
  const [completedSale, setCompletedSale] = useState<CompletedSaleState | null>(null);
  const [printingReceipt, setPrintingReceipt] = useState(false);

  const [loading, setLoading] = useState(false);
  const [completing, setCompleting] = useState(false);

  const activeProductIndex = resolveHighlightedProductIndex(searchRows, highlightedProductIndex);

  const basketId = searchParams.get("basketId");
  const saleId = searchParams.get("saleId");
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
          if (activeElement.closest(".pos-customer-panel, .pos-payment-panel, .pos-basket-panel")) {
            searchFocusFrameRef.current = null;
            return;
          }
        }
        searchInputRef.current?.focus();
        searchFocusFrameRef.current = null;
      });
    });
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

        setSearchParams(updated, { replace: true });
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
    localStorage.setItem(ACTIVE_SALE_KEY, payload.sale.id);
    return payload;
  };

  const {
    captureCompletionSummary,
    captureQrBusy,
    captureQrImage,
    captureSession,
    captureSessionLoading,
    captureStatusError,
    captureUrl,
    creatingCaptureSession,
    isCaptureEligible,
    copyCaptureUrl,
    createCustomerCaptureSession,
    dismissCaptureCompletionSummary,
    refreshCaptureStatus,
    refreshSaleAfterCustomerCapture,
  } = usePosCustomerCapture({
    sale,
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
    const created = await apiPost<BasketResponse>("/api/baskets", options?.preloadedItems?.length
      ? { items: options.preloadedItems }
      : {});
    if (!canApplyPosLifecycle(requestId)) {
      return null;
    }
    setBasket(created);
    persistActiveBasketId(created.id);
    setSale(null);
    setReceiptUrl(null);
    setCashTenderedAmount("");
    if (!options?.preserveTransientUi) {
      setSearchText("");
      setSearchRows([]);
      setHighlightedProductIndex(-1);
      setCustomerSearchText("");
      setCustomerResults([]);
      setHighlightedCustomerIndex(-1);
      setShowCreateCustomer(false);
    }
    setSaleContext(options?.saleContext ?? DEFAULT_SALE_CONTEXT);
    setContextCustomerId(options?.customerId ?? null);
    if (options?.customerId) {
      const customer = await loadContextCustomer(options.customerId, {
        requestId,
        syncContext: false,
      });
      if (!customer) {
        return null;
      }
    } else {
      setSelectedCustomer(null);
    }
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
      try {
        const tiles = await Promise.all(
          QUICK_ADD_TILE_DEFINITIONS.map(async (definition) => {
            const payload = await apiGet<{ rows: ProductSearchRow[] }>(
              `/api/products/search?q=${encodeURIComponent(definition.query)}&take=6`,
            );
            const rows = payload.rows || [];
            const normalizedQuery = definition.query.toLowerCase();
            const product = rows.find((row) => row.name.toLowerCase().includes(normalizedQuery)) ?? rows[0] ?? null;
            return product ? { ...definition, product } : null;
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
  }, [error]);

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

  const selectCustomer = async (customer: CustomerSearchRow) => {
    setSelectedCustomer(customer);
    setContextCustomerId(customer.id);
    setCustomerSearchText("");
    setCustomerResults([]);
    setHighlightedCustomerIndex(-1);
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
    } else {
      setSelectedCustomer(null);
    }

    setSelectedCustomer(null);
    setContextCustomerId(null);
    setCustomerSearchText("");
    setCustomerResults([]);
    setHighlightedCustomerIndex(-1);
    setShowCreateCustomer(false);
  };

  const createCustomerAndSelect = async () => {
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
    if (!basketId) {
      error("No active basket.");
      return;
    }

      try {
        const requestId = beginPosLifecycleRequest();
        setCompletedSale(null);
        const payload = await apiPost<{ sale: { id: string } }>(
          `/api/baskets/${encodeURIComponent(basketId)}/checkout`,
          {},
      );
      if (!canApplyPosLifecycle(requestId)) {
        return;
      }
      const nextSaleId = payload.sale.id;
      clearStoredBasketId();
      if (selectedCustomer?.id) {
        await attachCustomerToSale(nextSaleId, selectedCustomer.id, { requestId });
        if (!canApplyPosLifecycle(requestId)) {
          return;
        }
        syncQuery({ basketId, saleId: nextSaleId });
        success("Sale created and customer attached.");
      } else if (contextCustomerId) {
        await attachCustomerToSale(nextSaleId, contextCustomerId, { requestId });
        if (!canApplyPosLifecycle(requestId)) {
          return;
        }
        syncQuery({ basketId, saleId: nextSaleId });
        success("Sale created and customer attached.");
      } else {
        await loadSale(nextSaleId, {
          requestId,
        });
        if (!canApplyPosLifecycle(requestId)) {
          return;
        }
        syncQuery({ basketId, saleId: nextSaleId });
        success("Sale created.");
      }
    } catch (checkoutError) {
      const message = checkoutError instanceof Error ? checkoutError.message : "Checkout failed";
      error(message);
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

        await apiPost(`/api/sales/${encodeURIComponent(sale.sale.id)}/tenders`, {
          method: selectedTenderMethod,
          amountPence: selectedTenderMethod === "CASH" ? cashTenderedPence : payablePence,
        });
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
        cashTenderedPence: selectedTenderMethod === "CASH" ? cashTenderedPence : null,
        totalPaidPence: sale.tenderSummary.totalPence,
        receiptPrintJob: null,
        receiptPrinterName: null,
      });
      setReceiptUrl(result.receiptUrl || `/r/${sale.sale.id}`);
      await createBasket();
      setSelectedTenderMethod("CARD");
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
  const remainingDuePence = sale?.tenderSummary.remainingPence ?? 0;
  const depositPaidPence = saleContext.type === "WORKSHOP" ? saleContext.depositPaidPence ?? 0 : 0;
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
  const contextHeaderTitle = saleContext.type === "WORKSHOP"
    ? `Workshop Job #${saleContext.jobId}`
    : "New Sale";
  const contextHeaderMeta = saleContext.type === "WORKSHOP"
    ? [
        saleContext.customerName,
        saleContext.bikeLabel,
      ].filter(Boolean).join(" | ")
    : "Retail sale";
  const searchResultSummary = searchText.trim()
    ? `${searchRows.length} result${searchRows.length === 1 ? "" : "s"}`
    : "";
  const activeCustomerName =
    sale?.sale.customer?.name
    || selectedCustomer?.name
    || (saleContext.type === "WORKSHOP" ? saleContext.customerName : null)
    || "Walk-in";
  const canCheckoutBasket = Boolean(basket && basket.items.length > 0 && !saleId);
  const beginNextSaleFromSuccess = async () => {
    setCompletedSale(null);

    if (basket?.items.length === 0 && !sale) {
      focusProductSearch();
      return;
    }

    setSelectedTenderMethod("CARD");
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
        setSelectedTenderMethod("CARD");
        setCashTenderedAmount("");
        void createBasket();
        return;
      }

      if (event.key === "F8" && basket && basket.items.length > 0 && !sale) {
        event.preventDefault();
        void checkoutBasket();
        return;
      }

      if (event.key === "F9" && sale && !completing && !cashValidationMessage) {
        event.preventDefault();
        void completeSale();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [basket, cashValidationMessage, completing, sale]);

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
                    <div className="muted-text pos-context-meta">{contextHeaderMeta}</div>
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
                  <button
                    type="button"
                    className="pos-meta-action"
                    onClick={() => {
                      setCompletedSale(null);
                      setSelectedTenderMethod("CARD");
                      setCashTenderedAmount("");
                      void createBasket();
                    }}
                  >
                    New Sale
                  </button>
                  <span>Sale {sale?.sale.id || saleId || "-"}</span>
                  <span className="pos-meta-shortcuts">
                    <kbd>/</kbd> search <kbd>F2</kbd> customer <kbd>F4</kbd> new sale <kbd>F8</kbd> checkout <kbd>F9</kbd> complete
                  </span>
                </div>
              </div>

              {loading ? <p className="muted-text">Loading...</p> : null}

              {completedSale ? (
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
                      <div className="table-primary">{completedSale.tenderMethod}</div>
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
                    <div className="success-summary-grid">
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
                  <div className="success-links success-links-sale">
                    <button type="button" className="primary" onClick={() => void beginNextSaleFromSuccess()}>
                      New sale
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleManagedReceiptPrint()}
                      data-testid="pos-print-receipt-link"
                      disabled={printingReceipt || Boolean(completedSale.receiptPrintJob && !isManagedPrintJobTerminal(completedSale.receiptPrintJob.status))}
                    >
                      {getPosReceiptPrintButtonLabel(printingReceipt, completedSale.receiptPrintJob)}
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
                    <a href={toBackendUrl(completedSale.receiptUrl)} target="_blank" rel="noreferrer">
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
              ) : null}
            </div>

            <section className="pos-panel pos-search-panel">
              <div className="pos-panel-heading">
                <div>
                  <div className="pos-section-kicker">Input</div>
                  <h2>Search / Scan</h2>
                </div>
                {searchText.trim() ? (
                  <div className="pos-search-status" aria-live="polite">
                    <strong>{searchResultSummary}</strong>
                  </div>
                ) : null}
              </div>

              <label className="pos-search-field">
                <span>Search / Scan</span>
                <input
                  ref={searchInputRef}
                  data-testid="pos-product-search"
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
                          data-testid={`pos-quick-add-${tile.key}`}
                          onClick={() => void addItem(tile.product.id)}
                          disabled={!canQuickAdd}
                          aria-label={`Quick add ${tile.label}`}
                        >
                          <span className="pos-quick-add-name">{tile.label}</span>
                          <span className="pos-quick-add-price">{formatMoney(tile.product.pricePence)}</span>
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

          <div className="pos-side-column">
            <section className="pos-panel pos-customer-panel">
              <div className="pos-panel-heading">
                <div>
                  <div className="pos-section-kicker">Customer</div>
                </div>
                {selectedCustomer ? (
                  <button
                    type="button"
                    data-testid="pos-customer-clear"
                    onClick={() => void clearSelectedCustomer()}
                  >
                    {sale?.sale.customer ? "Remove Customer" : "Clear Selection"}
                  </button>
                ) : null}
              </div>

              {selectedCustomer ? (
                <div className="selected-customer-panel" data-testid="pos-selected-customer">
                  <div>
                    <div className="table-primary">{selectedCustomer.name}</div>
                    <div className="muted-text">
                      {selectedCustomer.email || selectedCustomer.phone || "No contact details"}
                    </div>
                  </div>
                  <div className="customer-status-chip">
                    {sale?.sale.customer?.id === selectedCustomer.id ? "Attached to sale" : "Selected for checkout"}
                  </div>
                </div>
              ) : (
                <p className="muted-text">No customer selected yet. Search below or leave this sale as walk-in.</p>
              )}

              <PosCustomerCapturePanel
                sale={sale}
                isCaptureEligible={isCaptureEligible}
                captureSession={captureSession}
                captureSessionLoading={captureSessionLoading}
                creatingCaptureSession={creatingCaptureSession}
                captureStatusError={captureStatusError}
                captureQrImage={captureQrImage}
                captureQrBusy={captureQrBusy}
                captureUrl={captureUrl}
                captureCompletionSummary={captureCompletionSummary}
                onDismissCompletion={dismissCaptureCompletionSummary}
                onCreateCustomerCaptureSession={() => void createCustomerCaptureSession()}
                onCopyCaptureUrl={() => void copyCaptureUrl()}
                onRefreshStatus={() => void refreshCaptureStatus()}
                onRefreshSale={() => {
                  if (!sale?.sale.id) {
                    return;
                  }
                  void refreshSaleAfterCustomerCapture(sale.sale.id, { showToast: true });
                }}
              />

              <div className="customer-search-panel">
                <div className="customer-search-stack grow">
                  <div className="grow">
                    <input
                      ref={customerSearchInputRef}
                      data-testid="pos-customer-search"
                      value={customerSearchText}
                      onChange={(event) => setCustomerSearchText(event.target.value)}
                      onKeyDown={(event) => {
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
                          return;
                        }

                        if (event.key === "Enter" && highlightedCustomerIndex >= 0) {
                          event.preventDefault();
                          void selectCustomer(customerResults[highlightedCustomerIndex]);
                        }
                      }}
                      placeholder="name, phone, email"
                    />
                  </div>

                  {customerLoading ? <p className="muted-text pos-customer-search-status">Searching customers...</p> : null}

                  {customerSearchText.trim() ? (
                    <div className="pos-customer-results" role="listbox" aria-label="Customer search results">
                      {customerResults.length === 0 ? (
                        <p className="pos-customer-results-empty">No customers matched that search. Use quick create if you need a new account.</p>
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
                  onClick={() => setShowCreateCustomer((value) => !value)}
                >
                  {showCreateCustomer ? "Hide quick create" : "Quick create"}
                </button>
                <button
                  type="button"
                  onClick={() => void clearBasket()}
                  disabled={!basket || basket.items.length === 0 || Boolean(saleId)}
                >
                  Clear basket
                </button>
              </div>

              {showCreateCustomer ? (
                <div className="quick-create-panel">
                  <div className="quick-create-grid">
                    <label>
                      Name
                      <input
                        value={newCustomerName}
                        onChange={(event) => setNewCustomerName(event.target.value)}
                        placeholder="Customer name"
                      />
                    </label>
                    <label>
                      Email
                      <input
                        value={newCustomerEmail}
                        onChange={(event) => setNewCustomerEmail(event.target.value)}
                        placeholder="name@example.com"
                      />
                    </label>
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
                    <button type="button" className="primary" onClick={() => void createCustomerAndSelect()} disabled={creatingCustomer}>
                      {creatingCustomer ? "Creating..." : "Create and Select"}
                    </button>
                  </div>
                </div>
              ) : null}

            </section>

            <section className="pos-panel pos-basket-panel">
              <div className="pos-panel-heading">
                <div>
                  <div className="pos-section-kicker">Basket</div>
                </div>
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
                            className={`pos-line-item${lastAddedBasketItemId === item.id ? " pos-line-item-highlighted" : ""}`}
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
                              <button type="button" onClick={() => void removeLine(item.id)} disabled={Boolean(saleId)}>
                                Remove
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="pos-empty-state">
                  <strong>Scan or search to start</strong>
                </div>
              )}
            </section>

            <section className="pos-panel pos-payment-panel">
              <div className="pos-panel-heading">
                <div>
                  <div className="pos-section-kicker">Totals & Payment</div>
                  {sale ? <h2>Take Payment</h2> : null}
                </div>
                <span className="pos-payment-state">{sale ? "Sale live" : "Basket open"}</span>
              </div>

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
                  <div>
                    <span className="muted-text">Customer</span>
                    <strong>{activeCustomerName}</strong>
                  </div>
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
                  <div>
                    <span className="muted-text">Lines</span>
                    <strong>{sale ? sale.saleItems.length : basketLineCount}</strong>
                  </div>
                  <div>
                    <span className="muted-text">Customer</span>
                    <strong>{activeCustomerName}</strong>
                  </div>
                </div>
              )}

              {sale ? (
                <>
                  <div className="muted-text pos-payment-running-total">
                    <span>Tendered {formatMoney(sale.tenderSummary.tenderedPence)}</span>
                    <span>Remaining {formatMoney(sale.tenderSummary.remainingPence)}</span>
                    <span>Change {formatMoney(sale.tenderSummary.changeDuePence)}</span>
                  </div>

                  <div className="actions-inline pos-tender-switch" role="group" aria-label="Tender type">
                    <button
                      type="button"
                      className={selectedTenderMethod === "CARD" ? "primary" : ""}
                      onClick={() => setSelectedTenderMethod("CARD")}
                      disabled={completing}
                    >
                      Card
                    </button>
                    <button
                      type="button"
                      className={selectedTenderMethod === "CASH" ? "primary" : ""}
                      onClick={() => setSelectedTenderMethod("CASH")}
                      disabled={completing}
                    >
                      Cash
                    </button>
                  </div>

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

                      <div className="muted-text pos-cash-summary">
                        Due: {formatMoney(payablePence)} | Tendered: {formatMoney(cashTenderedPence ?? 0)} | Change: {formatMoney(cashChangeDuePence)}
                      </div>

                      {cashValidationMessage ? <p className="muted-text pos-cash-warning">{cashValidationMessage}</p> : null}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="pos-ready-note">
                  <strong>Checkout to continue</strong>
                </div>
              )}

              <div className="actions-inline pos-payment-actions">
                {sale ? (
                  <button
                    type="button"
                    className="primary"
                    data-testid="pos-complete-sale"
                    onClick={completeSale}
                    disabled={completing || Boolean(cashValidationMessage)}
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
    </div>
  );
};
