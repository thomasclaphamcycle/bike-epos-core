import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { useLocation, useSearchParams } from "react-router-dom";
import { apiDelete, apiGet, apiPatch, apiPost } from "../api/client";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useToasts } from "../components/ToastProvider";
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

type ProductSearchRow = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  pricePence: number;
  onHandQty: number;
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
};

type CaptureSessionStatus = "ACTIVE" | "COMPLETED" | "EXPIRED";

type SaleCustomerCaptureSession = {
  id: string;
  saleId: string;
  token: string;
  status: CaptureSessionStatus;
  expiresAt: string;
  createdAt: string;
  completedAt?: string | null;
  publicPath: string;
};

type SaleCustomerCaptureSessionResponse = {
  session: SaleCustomerCaptureSession;
};

type PublicSaleCustomerCaptureSessionState = {
  session: {
    status: CaptureSessionStatus;
    expiresAt: string;
    completedAt: string | null;
  };
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const getPublicAppOrigin = () => {
  const configuredOrigin = import.meta.env.VITE_PUBLIC_APP_ORIGIN?.trim();
  return configuredOrigin ? configuredOrigin.replace(/\/$/, "") : window.location.origin;
};

const buildCustomerCaptureEntryUrl = (token: string) =>
  `${getPublicAppOrigin()}/customer-capture?token=${encodeURIComponent(token)}`;

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

export const PosPage = () => {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { success, error } = useToasts();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const productResultRefs = useRef<Array<HTMLTableRowElement | null>>([]);
  const customerSearchInputRef = useRef<HTMLInputElement | null>(null);
  const customerResultRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const cashTenderedInputRef = useRef<HTMLInputElement | null>(null);

  const [searchText, setSearchText] = useState("");
  const debouncedSearch = useDebouncedValue(searchText, 250);
  const [searchRows, setSearchRows] = useState<ProductSearchRow[]>([]);
  const [highlightedProductIndex, setHighlightedProductIndex] = useState(-1);
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
  const [captureSession, setCaptureSession] = useState<SaleCustomerCaptureSession | null>(null);
  const [creatingCaptureSession, setCreatingCaptureSession] = useState(false);
  const [captureQrImage, setCaptureQrImage] = useState<string | null>(null);
  const [captureQrBusy, setCaptureQrBusy] = useState(false);

  const [loading, setLoading] = useState(false);
  const [completing, setCompleting] = useState(false);

  const basketId = searchParams.get("basketId");
  const saleId = searchParams.get("saleId");
  const posOpenState = getPosOpenState(location.state);

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

  const syncQuery = (next: { basketId?: string | null; saleId?: string | null }) => {
    const updated = new URLSearchParams(searchParams);

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

    setSearchParams(updated, { replace: true });
  };

  const loadContextCustomer = async (customerId: string | null) => {
    setContextCustomerId(customerId);
    if (!customerId) {
      return null;
    }

    const customer = await apiGet<CustomerSearchRow>(`/api/customers/${encodeURIComponent(customerId)}`);
    setSelectedCustomer(customer);
    return customer;
  };

  const loadBasket = async (id: string) => {
    const payload = await apiGet<BasketResponse>(`/api/baskets/${encodeURIComponent(id)}`);
    setBasket(payload);
  };

  const loadProductMatches = async (params: URLSearchParams) => {
    const payload = await apiGet<{ rows: ProductSearchRow[] }>(`/api/products/search?${params.toString()}`);
    return payload.rows || [];
  };

  const loadSale = async (id: string, options?: { preserveCaptureSession?: boolean }) => {
    const payload = await apiGet<SaleResponse>(`/api/sales/${encodeURIComponent(id)}`);
    setSale(payload);
    setSelectedCustomer(payload.sale.customer ?? null);
    if (!options?.preserveCaptureSession) {
      setCaptureSession(null);
    }
    localStorage.setItem(ACTIVE_SALE_KEY, payload.sale.id);
  };

  const createBasket = async (options?: {
    saleContext?: SaleContext;
    customerId?: string | null;
    preloadedItems?: PreloadedBasketItemInput[];
    announce?: boolean;
    successMessage?: string;
  }) => {
    const created = await apiPost<BasketResponse>("/api/baskets", options?.preloadedItems?.length
      ? { items: options.preloadedItems }
      : {});
    setBasket(created);
    setSale(null);
    setReceiptUrl(null);
    setCashTenderedAmount("");
    setCustomerSearchText("");
    setCustomerResults([]);
    setShowCreateCustomer(false);
    setCaptureSession(null);
    setSaleContext(options?.saleContext ?? DEFAULT_SALE_CONTEXT);
    setContextCustomerId(options?.customerId ?? null);
    if (options?.customerId) {
      await loadContextCustomer(options.customerId);
    } else {
      setSelectedCustomer(null);
    }
    syncQuery({ basketId: created.id, saleId: null });
    if (options?.announce !== false) {
      success(options?.successMessage ?? "New sale created");
    }
    focusProductSearch();
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
    let cancelled = false;

    const init = async () => {
      setLoading(true);
      try {
        const nextContext = posOpenState?.saleContext ?? DEFAULT_SALE_CONTEXT;
        const nextCustomerId = posOpenState?.customerId ?? null;
        if (!cancelled) {
          setSaleContext(nextContext);
          setContextCustomerId(nextCustomerId);
        }

        if (saleId) {
          await loadSale(saleId);
          if (nextCustomerId) {
            await loadContextCustomer(nextCustomerId);
          }
        }

        if (basketId) {
          await loadBasket(basketId);
          if (nextCustomerId && !saleId) {
            await loadContextCustomer(nextCustomerId);
          }
        } else if (!saleId) {
          await createBasket({
            saleContext: nextContext,
            customerId: nextCustomerId,
            preloadedItems: posOpenState?.items?.length ? toPreloadedBasketItems(posOpenState.items) : undefined,
            announce: false,
          });
        }
      } catch (initError) {
        const message = initError instanceof Error ? initError.message : "Failed to initialize POS";
        error(message);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void init();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!debouncedSearch.trim()) {
      setSearchRows([]);
      return;
    }

    let cancelled = false;

    const search = async () => {
      try {
        const payload = await apiGet<{ rows: ProductSearchRow[] }>(
          `/api/products/search?q=${encodeURIComponent(debouncedSearch.trim())}`,
        );
        if (!cancelled) {
          setSearchRows(payload.rows || []);
        }
      } catch (searchError) {
        if (!cancelled) {
          const message = searchError instanceof Error ? searchError.message : "Search failed";
          error(message);
        }
      }
    };

    void search();

    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, error]);

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
    if (highlightedProductIndex < 0) {
      return;
    }

    productResultRefs.current[highlightedProductIndex]?.scrollIntoView({
      block: "nearest",
    });
  }, [highlightedProductIndex]);

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

  const attachCustomerToSale = async (targetSaleId: string, customerId: string | null) => {
    const payload = await apiPatch<SaleResponse>(`/api/sales/${encodeURIComponent(targetSaleId)}/customer`, {
      customerId,
    });
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
      const created = await apiPost<CustomerSearchRow>("/api/customers", {
        name: newCustomerName.trim(),
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
      const payload = await apiPost<BasketResponse>(`/api/baskets/${encodeURIComponent(basketId)}/items`, {
        variantId,
        quantity: 1,
      });
      setBasket(payload);
      setSearchText("");
      setSearchRows([]);
      setHighlightedProductIndex(-1);
      success("Item added");
      window.requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
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
      const payload = await apiPost<BasketResponse>(`/api/baskets/${encodeURIComponent(basketId)}/items`, {
        variantId,
        quantity,
      });
      setBasket(payload);
      setSearchText("");
      setSearchRows([]);
      setHighlightedProductIndex(-1);
      success(`${quantity} item${quantity === 1 ? "" : "s"} added`);
      focusProductSearch();
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
      const row = highlightedProductIndex >= 0 && highlightedProductIndex < searchRows.length
        ? searchRows[highlightedProductIndex]
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
      setCompletedSale(null);
      setCaptureSession(null);
      const payload = await apiPost<{ sale: { id: string } }>(
        `/api/baskets/${encodeURIComponent(basketId)}/checkout`,
        {},
      );
      const nextSaleId = payload.sale.id;
      syncQuery({ basketId, saleId: nextSaleId });
      if (selectedCustomer?.id) {
        await attachCustomerToSale(nextSaleId, selectedCustomer.id);
        success("Sale created and customer attached.");
      } else if (contextCustomerId) {
        await attachCustomerToSale(nextSaleId, contextCustomerId);
        success("Sale created and customer attached.");
      } else {
        await loadSale(nextSaleId);
        success("Sale created.");
      }
    } catch (checkoutError) {
      const message = checkoutError instanceof Error ? checkoutError.message : "Checkout failed";
      error(message);
    }
  };

  const captureUrl = useMemo(() => {
    if (!captureSession) {
      return null;
    }

    return buildCustomerCaptureEntryUrl(captureSession.token);
  }, [captureSession]);

  useEffect(() => {
    if (!captureUrl || captureSession?.status !== "ACTIVE") {
      setCaptureQrImage(null);
      setCaptureQrBusy(false);
      return;
    }

    let cancelled = false;
    setCaptureQrBusy(true);

    void QRCode.toDataURL(captureUrl, {
      margin: 1,
      width: 240,
    })
      .then((nextImage) => {
        if (!cancelled) {
          setCaptureQrImage(nextImage);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCaptureQrImage(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCaptureQrBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [captureSession?.status, captureUrl]);

  useEffect(() => {
    if (!captureSession || captureSession.status !== "ACTIVE" || !sale?.sale.id || sale.sale.completedAt) {
      return;
    }

    let cancelled = false;

    const syncCaptureState = async () => {
      try {
        const payload = await apiGet<PublicSaleCustomerCaptureSessionState>(
          `/api/public/customer-capture/${encodeURIComponent(captureSession.token)}`,
        );
        if (cancelled) {
          return;
        }

        if (payload.session.status === "ACTIVE") {
          setCaptureSession((current) => {
            if (!current || current.id !== captureSession.id) {
              return current;
            }

            return {
              ...current,
              expiresAt: payload.session.expiresAt,
            };
          });
          return;
        }

        if (payload.session.status === "COMPLETED") {
          const refreshedSale = await apiGet<SaleResponse>(`/api/sales/${encodeURIComponent(sale.sale.id)}`);
          if (cancelled) {
            return;
          }
          setSale(refreshedSale);
          setSelectedCustomer(refreshedSale.sale.customer ?? null);
          localStorage.setItem(ACTIVE_SALE_KEY, refreshedSale.sale.id);
          setCaptureSession((current) => {
            if (!current || current.id !== captureSession.id) {
              return current;
            }

            return {
              ...current,
              status: payload.session.status,
              expiresAt: payload.session.expiresAt,
              completedAt: payload.session.completedAt,
            };
          });
          success("Customer details attached to sale.");
          return;
        }

        setCaptureSession((current) => {
          if (!current || current.id !== captureSession.id) {
            return current;
          }

          return {
            ...current,
            status: payload.session.status,
            expiresAt: payload.session.expiresAt,
            completedAt: payload.session.completedAt,
          };
        });
      } catch {
        // Keep polling quiet; the visible session state will recover on the next successful check.
      }
    };

    void syncCaptureState();
    const intervalId = window.setInterval(() => {
      void syncCaptureState();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [captureSession, sale?.sale.completedAt, sale?.sale.id, success]);

  const createCustomerCaptureSession = async () => {
    if (!sale?.sale.id) {
      error("Create a sale before generating a customer capture link.");
      return;
    }

    setCreatingCaptureSession(true);
    try {
      const payload = await apiPost<SaleCustomerCaptureSessionResponse>(
        `/api/sales/${encodeURIComponent(sale.sale.id)}/customer-capture-sessions`,
        {},
      );
      setCaptureSession(payload.session);
      success("Customer capture link ready.");
    } catch (captureError) {
      const message = captureError instanceof Error ? captureError.message : "Failed to create capture link";
      error(message);
    } finally {
      setCreatingCaptureSession(false);
    }
  };

  const copyCaptureUrl = async () => {
    if (!captureUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(captureUrl);
      success("Capture link copied.");
    } catch {
      error("Could not copy the capture link.");
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
                              index === highlightedProductIndex ? "pos-search-result-active" : "",
                            ].filter(Boolean).join(" ")}
                            onClick={canAdd ? () => void addItem(row.id) : undefined}
                            onMouseEnter={() => setHighlightedProductIndex(index)}
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
                            aria-selected={index === highlightedProductIndex}
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
              ) : null}

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

              {captureSession && captureUrl ? (
                <div className="quick-create-panel" data-testid="pos-customer-capture-panel">
                  {captureSession.status === "ACTIVE" ? (
                    <div className="cash-qr-card">
                      <div className="card-header-row">
                        <div>
                          <span className="status-badge">Waiting for customer</span>
                          <p className="muted-text">
                            Scan QR or tap NFC. This sale refreshes automatically as soon as the customer saves their details.
                          </p>
                        </div>
                        <button
                          type="button"
                          className="primary"
                          data-testid="pos-customer-capture-generate"
                          onClick={() => void createCustomerCaptureSession()}
                          disabled={creatingCaptureSession}
                        >
                          {creatingCaptureSession ? "Preparing..." : "Refresh Link"}
                        </button>
                      </div>
                      <div className="cash-qr-layout">
                        <div className="cash-qr-box">
                          {captureQrBusy ? (
                            <span>Generating QR...</span>
                          ) : captureQrImage ? (
                            <img
                              src={captureQrImage}
                              alt="Customer capture QR code"
                              data-testid="pos-customer-capture-qr"
                            />
                          ) : (
                            <span>QR unavailable</span>
                          )}
                        </div>
                        <div className="cash-qr-copy">
                          <div>
                            <div className="table-primary">Need the link instead?</div>
                            <p className="muted-text">Copy it or open it directly if the customer cannot scan the QR.</p>
                          </div>
                          <label>
                            Public capture URL
                            <input
                              data-testid="pos-customer-capture-url"
                              value={captureUrl}
                              readOnly
                            />
                          </label>
                          <div className="actions-inline">
                            <button type="button" onClick={() => void copyCaptureUrl()}>
                              Copy Link
                            </button>
                            <a href={captureUrl} target="_blank" rel="noreferrer">
                              Open Link
                            </a>
                          </div>
                          <p className="muted-text">
                            Expires {new Date(captureSession.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : captureSession.status === "COMPLETED" ? (
                    <div className="success-panel success-panel-sale">
                      <div className="success-panel-heading">
                        <strong>Customer capture complete.</strong>
                        <span className="status-badge status-complete">Attached to sale</span>
                      </div>
                      <p className="muted-text">
                        {sale?.sale.customer?.name
                          ? `${sale.sale.customer.name} is now attached to this sale.`
                          : "The customer details have been attached to the active sale."}
                      </p>
                    </div>
                  ) : (
                    <div className="pos-customer-capture-note">
                      <span className="status-badge">Expired</span>
                      <strong>Capture link expired</strong>
                      <button
                        type="button"
                        data-testid="pos-customer-capture-generate"
                        onClick={() => void createCustomerCaptureSession()}
                        disabled={creatingCaptureSession}
                      >
                        {creatingCaptureSession ? "Preparing..." : "Start Again"}
                      </button>
                    </div>
                  )}
                </div>
              ) : sale?.sale.id && !sale.sale.completedAt ? (
                <div className="quick-create-panel pos-customer-capture-compact" data-testid="pos-customer-capture-panel">
                  <div>
                    <div className="table-primary">Add Customer</div>
                    <p className="muted-text">QR/NFC capture for the active sale.</p>
                  </div>
                  <button
                    type="button"
                    className="primary"
                    data-testid="pos-customer-capture-generate"
                    onClick={() => void createCustomerCaptureSession()}
                    disabled={creatingCaptureSession}
                  >
                    {creatingCaptureSession ? "Preparing..." : "Start Add Customer"}
                  </button>
                </div>
              ) : (
                null
              )}
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
                          <strong>{group.label}</strong>
                          <span>{group.items.length} line{group.items.length === 1 ? "" : "s"}</span>
                        </div>
                      </div>
                      <div className="pos-basket-list">
                        {group.items.map((item) => (
                          <article key={item.id} className="pos-line-item">
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
                  <h2>{sale ? "Take Payment" : "Checkout"}</h2>
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
