import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "../api/client";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useToasts } from "../components/ToastProvider";
import { toBackendUrl } from "../utils/backendUrl";

const ACTIVE_SALE_KEY = "corepos.activeSaleId";
const BARCODE_PREFIXES = ["EAN:", "BC:", "BAR:", "UPC:"];

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
    sku: string;
    productName: string;
    variantName: string | null;
    quantity: number;
    unitPricePence: number;
    lineTotalPence: number;
  }>;
  totals: {
    subtotalPence: number;
    taxPence: number;
    totalPence: number;
  };
};

type SaleResponse = {
  sale: {
    id: string;
    subtotalPence: number;
    taxPence: number;
    totalPence: number;
    completedAt: string | null;
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

type CompleteSaleResult = {
  saleId: string;
  completedAt: string;
  changeDuePence: number;
  receiptUrl?: string;
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const isBarcodeLikeQuery = (value: string) => {
  const trimmed = value.trim();
  if (/^\d{8,14}$/.test(trimmed)) {
    return true;
  }
  const upper = trimmed.toUpperCase();
  return BARCODE_PREFIXES.some((prefix) => upper.startsWith(prefix));
};

const normalizeBarcodeInput = (value: string) => {
  const trimmed = value.trim();
  const upper = trimmed.toUpperCase();
  for (const prefix of BARCODE_PREFIXES) {
    if (upper.startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim();
    }
  }
  return trimmed;
};

const isEditableElement = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
};

export const PosPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { success, error } = useToasts();
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [searchText, setSearchText] = useState("");
  const debouncedSearch = useDebouncedValue(searchText, 250);
  const [searchRows, setSearchRows] = useState<ProductSearchRow[]>([]);
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(0);

  const [basket, setBasket] = useState<BasketResponse | null>(null);
  const [sale, setSale] = useState<SaleResponse | null>(null);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);

  const [loading, setLoading] = useState(false);
  const [completing, setCompleting] = useState(false);

  const basketId = searchParams.get("basketId");
  const saleId = searchParams.get("saleId");

  const focusSearch = () => {
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
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

  const loadBasket = async (id: string) => {
    const payload = await apiGet<BasketResponse>(`/api/baskets/${encodeURIComponent(id)}`);
    setBasket(payload);
  };

  const loadSale = async (id: string) => {
    const payload = await apiGet<SaleResponse>(`/api/sales/${encodeURIComponent(id)}`);
    setSale(payload);
    localStorage.setItem(ACTIVE_SALE_KEY, payload.sale.id);
  };

  const createBasket = async () => {
    const created = await apiPost<BasketResponse>("/api/baskets", {});
    setBasket(created);
    setSale(null);
    setReceiptUrl(null);
    setSelectedLineId(null);
    syncQuery({ basketId: created.id, saleId: null });
    success("New sale created");
    focusSearch();
  };

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      setLoading(true);
      try {
        if (saleId) {
          await loadSale(saleId);
        }

        if (basketId) {
          await loadBasket(basketId);
        } else if (!saleId) {
          const created = await apiPost<BasketResponse>("/api/baskets", {});
          if (cancelled) return;
          setBasket(created);
          syncQuery({ basketId: created.id, saleId: null });
        }
      } catch (initError) {
        const message = initError instanceof Error ? initError.message : "Failed to initialize POS";
        error(message);
      } finally {
        if (!cancelled) {
          setLoading(false);
          focusSearch();
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
      setSelectedSearchIndex(0);
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
          setSelectedSearchIndex(rows.length > 0 ? 0 : -1);
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
    const items = basket?.items ?? [];
    if (items.length === 0) {
      setSelectedLineId(null);
      return;
    }
    if (!selectedLineId || !items.some((item) => item.id === selectedLineId)) {
      setSelectedLineId(items[0].id);
    }
  }, [basket, selectedLineId]);

  const addItemByVariant = async (variantId: string, scannedCode?: string) => {
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
      setSelectedSearchIndex(0);
      if (scannedCode) {
        setLastScanned(scannedCode);
      }
      success("Item added");
      focusSearch();
    } catch (addError) {
      const message = addError instanceof Error ? addError.message : "Failed to add item";
      error(message);
      focusSearch();
    }
  };

  const findBarcodeMatch = async (rawCode: string): Promise<ProductSearchRow | null> => {
    const code = normalizeBarcodeInput(rawCode);
    if (!code) {
      return null;
    }

    try {
      const payload = await apiGet<{ row?: ProductSearchRow }>(
        `/api/products/barcode/${encodeURIComponent(code)}`,
      );
      if (payload.row) {
        return payload.row;
      }
    } catch (lookupError) {
      if (!(lookupError instanceof ApiError) || lookupError.status !== 404) {
        throw lookupError;
      }
    }

    const fallback = await apiGet<{ rows: ProductSearchRow[] }>(
      `/api/products/search?q=${encodeURIComponent(code)}`,
    );

    const exact = (fallback.rows || []).find((row) => {
      const barcode = row.barcode?.trim().toUpperCase();
      const sku = row.sku.trim().toUpperCase();
      const wanted = code.trim().toUpperCase();
      return barcode === wanted || sku === wanted;
    });

    return exact || null;
  };

  const handleSearchEnter = async () => {
    const query = searchText.trim();
    if (!query) {
      if (searchRows.length > 0 && selectedSearchIndex >= 0) {
        await addItemByVariant(searchRows[selectedSearchIndex]?.id || searchRows[0].id);
      }
      return;
    }

    if (isBarcodeLikeQuery(query)) {
      try {
        const match = await findBarcodeMatch(query);
        if (!match) {
          error("No exact barcode match found");
          setLastScanned(normalizeBarcodeInput(query));
          focusSearch();
          return;
        }
        await addItemByVariant(match.id, normalizeBarcodeInput(query));
      } catch (scanError) {
        const message = scanError instanceof Error ? scanError.message : "Barcode scan failed";
        error(message);
        focusSearch();
      }
      return;
    }

    const target =
      selectedSearchIndex >= 0 && selectedSearchIndex < searchRows.length
        ? searchRows[selectedSearchIndex]
        : searchRows[0];

    if (target) {
      await addItemByVariant(target.id);
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
      focusSearch();
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : "Failed to update quantity";
      error(message);
      focusSearch();
    }
  };

  const removeLine = async (itemId: string) => {
    if (!basketId) {
      return;
    }

    const line = basket?.items.find((item) => item.id === itemId);
    if (line && line.quantity > 1) {
      const confirmed = window.confirm(
        `Remove ${line.quantity} units of ${line.productName}${line.variantName ? ` (${line.variantName})` : ""}?`,
      );
      if (!confirmed) {
        focusSearch();
        return;
      }
    }

    try {
      const payload = await apiDelete<BasketResponse>(
        `/api/baskets/${encodeURIComponent(basketId)}/items/${encodeURIComponent(itemId)}`,
      );
      setBasket(payload);
      success("Line removed");
      focusSearch();
    } catch (removeError) {
      const message = removeError instanceof Error ? removeError.message : "Failed to remove line";
      error(message);
      focusSearch();
    }
  };

  const checkoutBasket = async () => {
    if (!basketId) {
      error("No active basket.");
      return;
    }

    try {
      const payload = await apiPost<{ sale: { id: string } }>(
        `/api/baskets/${encodeURIComponent(basketId)}/checkout`,
        {},
      );
      const nextSaleId = payload.sale.id;
      syncQuery({ basketId, saleId: nextSaleId });
      await loadSale(nextSaleId);
      success("Sale created.");
      focusSearch();
    } catch (checkoutError) {
      const message = checkoutError instanceof Error ? checkoutError.message : "Checkout failed";
      error(message);
      focusSearch();
    }
  };

  const completeSale = async () => {
    if (!sale) {
      error("No sale to complete.");
      return;
    }

    setCompleting(true);
    try {
      const remaining = sale.tenderSummary.remainingPence;
      if (remaining > 0) {
        await apiPost(`/api/sales/${encodeURIComponent(sale.sale.id)}/tenders`, {
          method: "CASH",
          amountPence: remaining,
        });
      }

      const result = await apiPost<CompleteSaleResult>(
        `/api/sales/${encodeURIComponent(sale.sale.id)}/complete`,
        {},
      );
      setReceiptUrl(result.receiptUrl || `/r/${sale.sale.id}`);
      await loadSale(sale.sale.id);
      success("Sale completed.");
      setShowCompleteConfirm(false);
      focusSearch();
    } catch (completeError) {
      const message = completeError instanceof Error ? completeError.message : "Completion failed";
      error(message);
      focusSearch();
    } finally {
      setCompleting(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const targetIsEditable = isEditableElement(event.target);

      if (event.key === "/" && !targetIsEditable) {
        event.preventDefault();
        focusSearch();
        return;
      }

      if (event.ctrlKey && event.key === "Enter") {
        if (sale && !completing) {
          event.preventDefault();
          setShowCompleteConfirm(true);
        }
        return;
      }

      if (!basket || Boolean(saleId)) {
        return;
      }

      const lines = basket.items;
      if (lines.length === 0) {
        return;
      }

      if (targetIsEditable) {
        return;
      }

      const currentIndex = Math.max(
        0,
        lines.findIndex((line) => line.id === selectedLineId),
      );

      if (event.key === "ArrowDown") {
        event.preventDefault();
        const nextIndex = Math.min(lines.length - 1, currentIndex + 1);
        setSelectedLineId(lines[nextIndex].id);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        const nextIndex = Math.max(0, currentIndex - 1);
        setSelectedLineId(lines[nextIndex].id);
        return;
      }

      const selectedLine = lines[currentIndex];
      if (!selectedLine) {
        return;
      }

      if (event.key === "+") {
        event.preventDefault();
        void updateLineQty(selectedLine.id, selectedLine.quantity + 1);
        return;
      }

      if (event.key === "-") {
        event.preventDefault();
        if (selectedLine.quantity > 1) {
          void updateLineQty(selectedLine.id, selectedLine.quantity - 1);
        }
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        void removeLine(selectedLine.id);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [basket, sale, saleId, selectedLineId, completing]);

  const activeTotal = useMemo(() => {
    if (sale) {
      return sale.tenderSummary.totalPence;
    }
    return basket?.totals.totalPence ?? 0;
  }, [sale, basket]);

  const selectedLine = useMemo(
    () => basket?.items.find((item) => item.id === selectedLineId) ?? null,
    [basket, selectedLineId],
  );

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <h1>POS</h1>
          <div className="actions-inline">
            <button
              type="button"
              className="primary"
              onClick={checkoutBasket}
              disabled={!basket || basket.items.length === 0 || Boolean(saleId)}
              title="Ctrl+Enter to complete once sale exists"
            >
              Checkout Basket
            </button>
            <button type="button" onClick={() => void createBasket()}>
              New Sale
            </button>
          </div>
        </div>

        <p className="muted-text">
          Basket: {basketId || "-"} | Sale: {sale?.sale.id || saleId || "-"} | Total: {formatMoney(activeTotal)}
        </p>

        <p className="muted-text">
          Shortcuts: <code>/</code> search, <code>Enter</code> add top result, <code>↑/↓</code> select line,
          <code> + / - </code>qty, <code>Delete</code> remove, <code>Ctrl+Enter</code> complete.
        </p>

        {selectedLine ? (
          <p className="muted-text">
            Selected line: {selectedLine.productName}
            {selectedLine.variantName ? ` (${selectedLine.variantName})` : ""} x{selectedLine.quantity}
          </p>
        ) : null}

        {loading ? <p>Loading...</p> : null}
      </section>

      <section className="card">
        <h2>Product Search</h2>
        <label className="grow">
          Search / Barcode
            <input
              ref={searchInputRef}
              autoFocus
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleSearchEnter();
              }
            }}
            placeholder="sku, barcode, name"
          />
        </label>

        <div className="scan-indicator">
          Last scanned: {lastScanned ? <strong>{lastScanned}</strong> : "-"}
        </div>

        <div className="table-wrap" style={{ marginTop: "10px" }}>
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
                  <td colSpan={5}>No results.</td>
                </tr>
              ) : (
                searchRows.map((row, index) => (
                  <tr key={row.id} className={index === selectedSearchIndex ? "selected-row" : ""}>
                    <td>{row.name}</td>
                    <td>{row.sku}</td>
                    <td>{formatMoney(row.pricePence)}</td>
                    <td>{row.onHandQty}</td>
                    <td>
                      <button type="button" onClick={() => void addItemByVariant(row.id)} disabled={!basketId || Boolean(saleId)}>
                        Add
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Basket Lines</h2>

        {basket && basket.items.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {basket.items.map((item) => (
                  <tr
                    key={item.id}
                    className={selectedLineId === item.id ? "selected-row" : ""}
                    onClick={() => setSelectedLineId(item.id)}
                  >
                    <td>{item.productName}{item.variantName ? ` (${item.variantName})` : ""}</td>
                    <td>
                      <div className="actions-inline">
                        <button
                          type="button"
                          onClick={() => {
                            void updateLineQty(item.id, Math.max(1, item.quantity - 1));
                          }}
                          disabled={Boolean(saleId) || item.quantity <= 1}
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min={1}
                          value={item.quantity}
                          onChange={(event) => {
                            const next = Number(event.target.value) || 1;
                            void updateLineQty(item.id, next);
                          }}
                          disabled={Boolean(saleId)}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            void updateLineQty(item.id, item.quantity + 1);
                          }}
                          disabled={Boolean(saleId)}
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td>{formatMoney(item.unitPricePence)}</td>
                    <td>{formatMoney(item.lineTotalPence)}</td>
                    <td>
                      <button type="button" onClick={() => void removeLine(item.id)} disabled={Boolean(saleId)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted-text">No basket lines yet.</p>
        )}
      </section>

      {sale ? (
        <section className="card">
          <h2>Sale</h2>
          <p className="muted-text">
            Tendered: {formatMoney(sale.tenderSummary.tenderedPence)} | Remaining: {formatMoney(sale.tenderSummary.remainingPence)} | Change: {formatMoney(sale.tenderSummary.changeDuePence)}
          </p>

          <div className="actions-inline">
            <button
              type="button"
              className="primary"
              onClick={() => setShowCompleteConfirm(true)}
              disabled={completing}
            >
              {completing ? "Completing..." : "Complete Sale"}
            </button>
          </div>

          {receiptUrl ? (
            <div className="success-panel">
              <strong>Sale complete.</strong>
              <div className="success-links">
                <a href={toBackendUrl(receiptUrl)} target="_blank" rel="noreferrer">
                  Open receipt
                </a>
                <a
                  href={toBackendUrl(`/sales/${encodeURIComponent(sale.sale.id)}/receipt`)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open direct receipt page
                </a>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {showCompleteConfirm ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowCompleteConfirm(false)}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <h3>Complete Sale</h3>
            <p>
              Complete sale {sale?.sale.id ? sale.sale.id.slice(0, 8) : ""} for {formatMoney(sale?.sale.totalPence ?? 0)}?
            </p>
            <div className="actions-inline">
              <button type="button" onClick={() => setShowCompleteConfirm(false)} disabled={completing}>
                Cancel
              </button>
              <button type="button" className="primary" onClick={() => void completeSale()} disabled={completing}>
                {completing ? "Completing..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
