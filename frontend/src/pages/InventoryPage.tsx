import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiGet } from "../api/client";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useToasts } from "../components/ToastProvider";
import { useAppConfig } from "../config/appConfig";
import { isExactLookupMatch, looksLikeScannerInput } from "../utils/barcode";
import {
  getProductLabelDirectPrintErrorMessage,
  getProductLabelDirectPrintSuccessMessage,
  printProductLabelDirect,
} from "../features/labels/productLabelPrinting";

type InventoryRow = {
  variantId: string;
  sku: string;
  barcode: string | null;
  variantName: string | null;
  option: string | null;
  productId: string;
  productName: string;
  brand: string | null;
  retailPricePence: number;
  isActive: boolean;
  onHand: number;
};

type InventorySearchResponse = {
  rows: InventoryRow[];
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

type StockStateFilter = "" | "negative" | "zero" | "low" | "in_stock";
type SortOption = "productAsc" | "onHandAsc" | "onHandDesc" | "skuAsc";

const getStockState = (onHand: number, lowStockThreshold: number): StockStateFilter => {
  if (onHand < 0) {
    return "negative";
  }
  if (onHand === 0) {
    return "zero";
  }
  if (onHand <= lowStockThreshold) {
    return "low";
  }
  return "in_stock";
};

const getStockStateLabel = (onHand: number, lowStockThreshold: number) => {
  if (onHand < 0) {
    return "Negative";
  }
  if (onHand === 0) {
    return "Zero Stock";
  }
  if (onHand <= lowStockThreshold) {
    return "Low Stock";
  }
  return "In Stock";
};

const getStockStateClass = (onHand: number, lowStockThreshold: number) => {
  if (onHand < 0) {
    return "stock-badge stock-state-negative";
  }
  if (onHand === 0) {
    return "stock-badge stock-state-zero";
  }
  if (onHand <= lowStockThreshold) {
    return "stock-badge stock-state-low";
  }
  return "stock-badge stock-state-positive";
};

const getAttentionSummary = (row: InventoryRow, lowStockThreshold: number) => {
  if (!row.isActive) {
    return "Inactive variant. Review it before counting or buying more stock.";
  }
  if (row.onHand < 0) {
    return "Negative stock. Check recent movements and count this variant before the next sale or workshop allocation.";
  }
  if (row.onHand === 0) {
    return "Out of stock. Confirm whether stock is already on order or needs a new purchase order.";
  }
  if (row.onHand <= lowStockThreshold) {
    return "Low remaining cover. Review reordering before the next sale or workshop use.";
  }
  return "Healthy cover right now. Open the variant for locations, adjustments, and movement history.";
};

export const InventoryPage = () => {
  const appConfig = useAppConfig();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { error, success } = useToasts();
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [active, setActive] = useState("1");
  const [stockState, setStockState] = useState<StockStateFilter>("");
  const [sort, setSort] = useState<SortOption>("productAsc");
  const [pageSize, setPageSize] = useState("100");

  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [printingState, setPrintingState] = useState<{ variantId: string; copies: number } | null>(null);
  const [rowPrintFeedback, setRowPrintFeedback] = useState<Record<string, { message: string; tone: "success" | "error" }>>({});
  const lowStockThreshold = appConfig.operations.lowStockThreshold;

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedSearch.trim()) {
      params.set("q", debouncedSearch.trim());
    }
    if (active) {
      params.set("active", active);
    }
    params.set("take", pageSize);
    params.set("skip", "0");
    return params.toString();
  }, [active, debouncedSearch, pageSize]);

  const loadRows = async () => {
    setLoading(true);
    try {
      const payload = await apiGet<InventorySearchResponse>(`/api/inventory/on-hand/search?${query}`);
      setRows(payload.rows || []);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load inventory";
      error(message);
    } finally {
      setLoading(false);
    }
  };

  const findExactInventoryMatch = async (rawInput: string) => {
    const trimmed = rawInput.trim();
    if (!trimmed) {
      return null;
    }

    const exactLoadedMatch = rows.find((row) =>
      isExactLookupMatch(row.barcode, trimmed) || isExactLookupMatch(row.sku, trimmed),
    );
    if (exactLoadedMatch) {
      return exactLoadedMatch;
    }

    const payload = await apiGet<InventorySearchResponse>(
      `/api/inventory/on-hand/search?q=${encodeURIComponent(trimmed)}&active=${encodeURIComponent(active)}&take=25&skip=0`,
    );
    const matchedRows = payload.rows || [];
    return matchedRows.find((row) =>
      isExactLookupMatch(row.barcode, trimmed) || isExactLookupMatch(row.sku, trimmed),
    ) ?? null;
  };

  useEffect(() => {
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isEditableTarget = target instanceof HTMLElement
        && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if (!isEditableTarget && event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const incoming = searchParams.get("q") ?? "";
    if (incoming !== search) {
      setSearch(incoming);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    const current = searchParams.get("q") ?? "";
    const next = debouncedSearch.trim();
    if (current === next) {
      return;
    }

    const params = new URLSearchParams(searchParams);
    if (next) {
      params.set("q", next);
    } else {
      params.delete("q");
    }
    setSearchParams(params, { replace: true });
  }, [debouncedSearch, searchParams, setSearchParams]);

  const visibleRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      if (!stockState) {
        return true;
      }
      return getStockState(row.onHand, lowStockThreshold) === stockState;
    });

    const sorted = [...filtered];

    sorted.sort((left, right) => {
      switch (sort) {
        case "onHandAsc":
          return left.onHand - right.onHand || left.productName.localeCompare(right.productName);
        case "onHandDesc":
          return right.onHand - left.onHand || left.productName.localeCompare(right.productName);
        case "skuAsc":
          return left.sku.localeCompare(right.sku);
        case "productAsc":
        default: {
          const productCompare = left.productName.localeCompare(right.productName);
          if (productCompare !== 0) {
            return productCompare;
          }
          return (left.variantName || left.option || "").localeCompare(right.variantName || right.option || "");
        }
      }
    });

    return sorted;
  }, [lowStockThreshold, rows, sort, stockState]);

  const totalUnits = useMemo(
    () => visibleRows.reduce((sum, row) => sum + row.onHand, 0),
    [visibleRows],
  );

  const stockSummary = useMemo(
    () => ({
      inStock: visibleRows.filter((row) => row.onHand > lowStockThreshold).length,
      low: visibleRows.filter((row) => row.onHand > 0 && row.onHand <= lowStockThreshold).length,
      zero: visibleRows.filter((row) => row.onHand === 0).length,
      negative: visibleRows.filter((row) => row.onHand < 0).length,
    }),
    [lowStockThreshold, visibleRows],
  );

  const handleDirectPrint = async (row: InventoryRow, copies: number) => {
    setPrintingState({ variantId: row.variantId, copies });
    try {
      const payload = await printProductLabelDirect(row.variantId, { copies });
      const message = getProductLabelDirectPrintSuccessMessage(payload);
      setRowPrintFeedback((current) => ({
        ...current,
        [row.variantId]: {
          message,
          tone: "success",
        },
      }));
      success(message);
    } catch (printError) {
      const message = getProductLabelDirectPrintErrorMessage(printError);
      setRowPrintFeedback((current) => ({
        ...current,
        [row.variantId]: {
          message,
          tone: "error",
        },
      }));
      error(message);
    } finally {
      setPrintingState(null);
    }
  };

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Inventory</h1>
            <p className="muted-text">
              Search live stock by product, variant, SKU, or barcode, then open a variant for detail, adjustments,
              or stocktake.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/management/reordering">Reordering</Link>
            <Link to="/management/inventory">Inventory intel</Link>
            <Link to="/inventory/stocktakes">Stocktakes</Link>
            <Link to="/inventory/locations">Inventory by location</Link>
            <button type="button" onClick={() => void loadRows()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="filter-row">
          <label className="grow">
            Search
            <input
              data-testid="inventory-search-input"
              ref={searchInputRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || !looksLikeScannerInput(search)) {
                  return;
                }

                event.preventDefault();
                void (async () => {
                  try {
                    const exactMatch = await findExactInventoryMatch(search);
                    if (!exactMatch) {
                      error("No exact barcode or SKU match was found. Review the filtered list below.");
                      return;
                    }

                    navigate(`/inventory/${exactMatch.variantId}`);
                  } catch (loadError) {
                    error(loadError instanceof Error ? loadError.message : "Failed to resolve scanned inventory item");
                  }
                })();
              }}
              placeholder="product, variant, SKU, barcode"
            />
          </label>

          <label>
            Active
            <select value={active} onChange={(event) => setActive(event.target.value)}>
              <option value="1">Active</option>
              <option value="0">Inactive</option>
              <option value="">All</option>
            </select>
          </label>

          <label>
            Stock State
            <select value={stockState} onChange={(event) => setStockState(event.target.value as StockStateFilter)}>
              <option value="">All</option>
              <option value="low">Low stock</option>
              <option value="in_stock">In stock</option>
              <option value="negative">Negative</option>
              <option value="zero">Zero stock</option>
            </select>
          </label>

          <label>
            Sort
            <select value={sort} onChange={(event) => setSort(event.target.value as SortOption)}>
              <option value="productAsc">Product A-Z</option>
              <option value="onHandAsc">On Hand: Low to High</option>
              <option value="onHandDesc">On Hand: High to Low</option>
              <option value="skuAsc">SKU A-Z</option>
            </select>
          </label>

          <label>
            Page Size
            <select value={pageSize} onChange={(event) => setPageSize(event.target.value)}>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
            </select>
          </label>
        </div>

        <div className="metric-grid">
          <div className="metric-card">
            <span className="metric-label">Visible Variants</span>
            <strong className="metric-value">{visibleRows.length}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">In Stock</span>
            <strong className="metric-value">{stockSummary.inStock}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Low Stock</span>
            <strong className="metric-value">{stockSummary.low}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Zero Stock</span>
            <strong className="metric-value">{stockSummary.zero}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Negative Stock</span>
            <strong className="metric-value">{stockSummary.negative}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Visible Units On Hand</span>
            <strong className="metric-value">{totalUnits}</strong>
          </div>
        </div>

        <p className="muted-text">
          Low stock currently means on-hand stock greater than 0 and less than or equal to {lowStockThreshold}.
          Zero and negative rows need immediate review. Use reordering for buying decisions, inventory intel for slower
          stock, and the variant detail page for location counts, movements, adjustments, or a stocktake.
        </p>
        <p className="muted-text">
          Shortcut: press <kbd>/</kbd> to focus search. After a scanner enters a barcode or SKU, press Enter to jump straight into the exact variant detail.
        </p>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Variant</th>
                <th>SKU</th>
                <th>Barcode</th>
                <th>Retail</th>
                <th>On Hand</th>
                <th>Stock State</th>
                <th>Status</th>
                <th>Attention</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={10}>
                    {loading
                      ? "Loading inventory..."
                      : "No inventory rows match the current search and filters. Clear filters or search by product, SKU, or barcode."}
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => (
                  <tr
                    key={row.variantId}
                    data-testid={`inventory-row-${row.variantId}`}
                    className="clickable-row"
                    onClick={() => navigate(`/inventory/${row.variantId}`)}
                  >
                    <td>
                      <div className="table-primary">{row.productName}</div>
                      <div className="table-secondary">{row.brand || "-"}</div>
                    </td>
                    <td>{row.variantName || row.option || "-"}</td>
                    <td className="mono-text">{row.sku}</td>
                    <td className="mono-text">{row.barcode || "-"}</td>
                    <td>{formatMoney(row.retailPricePence)}</td>
                    <td className="numeric-cell">{row.onHand}</td>
                    <td>
                      <span className={getStockStateClass(row.onHand, lowStockThreshold)}>
                        {getStockStateLabel(row.onHand, lowStockThreshold)}
                      </span>
                    </td>
                    <td>
                      <span className={row.isActive ? "stock-badge stock-good" : "stock-badge stock-muted"}>
                        {row.isActive ? (row.onHand > 0 ? "In Stock" : "Out Of Stock") : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <div className="table-primary">{getAttentionSummary(row, lowStockThreshold)}</div>
                      <div className="table-secondary">
                        {row.onHand < 0 ? (
                          <Link
                            to={`/inventory/${row.variantId}?mode=count`}
                            onClick={(event) => event.stopPropagation()}
                          >
                            Open cycle count
                          </Link>
                        ) : row.onHand <= lowStockThreshold ? (
                          <Link
                            to="/management/reordering"
                            onClick={(event) => event.stopPropagation()}
                          >
                            Review reordering
                          </Link>
                        ) : (
                          "No urgent stock action"
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="inventory-row-actions">
                        <div className="inventory-row-actions__group">
                          {[1, 2, 3].map((copies) => {
                            const isPrinting = printingState?.variantId === row.variantId && printingState.copies === copies;
                            const isRowPrinting = printingState?.variantId === row.variantId;
                            return (
                              <button
                                key={copies}
                                type="button"
                                data-testid={`inventory-direct-print-${copies}-${row.variantId}`}
                                className={copies === 1 ? "button-link button-link-compact inventory-row-actions__print-primary" : "button-link button-link-compact"}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleDirectPrint(row, copies);
                                }}
                                disabled={isRowPrinting}
                              >
                                {isPrinting ? `Printing ${copies}...` : copies === 1 ? "Print label" : `Print ${copies}`}
                              </button>
                            );
                          })}
                        </div>
                        <div className="inventory-row-actions__group">
                          <button
                            type="button"
                            className="button-link button-link-compact"
                            onClick={(event) => {
                              event.stopPropagation();
                              navigate(`/inventory/${row.variantId}?mode=count`);
                            }}
                          >
                            Stocktake
                          </button>
                          <button
                            type="button"
                            className="button-link button-link-compact"
                            onClick={(event) => {
                              event.stopPropagation();
                              navigate(`/inventory/${row.variantId}`);
                            }}
                          >
                            Adjust stock
                          </button>
                          <Link
                            className="button-link button-link-compact"
                            data-testid={`inventory-open-label-page-${row.variantId}`}
                            to={`/inventory/${row.variantId}/label`}
                            onClick={(event) => event.stopPropagation()}
                          >
                            Label page
                          </Link>
                        </div>
                        {rowPrintFeedback[row.variantId] ? (
                          <div
                            className={`inventory-row-actions__feedback inventory-row-actions__feedback-${rowPrintFeedback[row.variantId].tone}`}
                            data-testid={`inventory-print-feedback-${row.variantId}`}
                          >
                            {rowPrintFeedback[row.variantId].message}
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
