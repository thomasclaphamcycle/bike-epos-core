import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiDelete, apiGet, apiPatch, apiPost } from "../api/client";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useToasts } from "../components/ToastProvider";
import { toBackendUrl } from "../utils/backendUrl";

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

export const PosPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { success, error } = useToasts();
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [searchText, setSearchText] = useState("");
  const debouncedSearch = useDebouncedValue(searchText, 250);
  const [searchRows, setSearchRows] = useState<ProductSearchRow[]>([]);

  const [basket, setBasket] = useState<BasketResponse | null>(null);
  const [sale, setSale] = useState<SaleResponse | null>(null);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [completing, setCompleting] = useState(false);

  const basketId = searchParams.get("basketId");
  const saleId = searchParams.get("saleId");

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
    syncQuery({ basketId: created.id, saleId: null });
    success("New sale created");
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
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
      success("Item added");
      window.requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    } catch (addError) {
      const message = addError instanceof Error ? addError.message : "Failed to add item";
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

        {loading ? <p>Loading...</p> : null}
      </section>

      <section className="card">
        <h2>Product Search</h2>
        <label className="grow">
          Search / Barcode
          <input
            ref={searchInputRef}
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="sku, barcode, name"
          />
        </label>

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
                searchRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{row.sku}</td>
                    <td>{formatMoney(row.pricePence)}</td>
                    <td>{row.onHandQty}</td>
                    <td>
                      <button type="button" onClick={() => void addItem(row.id)} disabled={!basketId || Boolean(saleId)}>
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
                  <tr key={item.id}>
                    <td>{item.productName}{item.variantName ? ` (${item.variantName})` : ""}</td>
                    <td>
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
            <button type="button" className="primary" onClick={completeSale} disabled={completing}>
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
    </div>
  );
};
