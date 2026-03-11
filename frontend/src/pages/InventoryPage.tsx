import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiGet } from "../api/client";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useToasts } from "../components/ToastProvider";

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
const LOW_STOCK_THRESHOLD = 3;

type StockStateFilter = "" | "negative" | "zero" | "low" | "in_stock";
type SortOption = "productAsc" | "onHandAsc" | "onHandDesc" | "skuAsc";

const getStockState = (onHand: number): StockStateFilter => {
  if (onHand < 0) {
    return "negative";
  }
  if (onHand === 0) {
    return "zero";
  }
  if (onHand <= LOW_STOCK_THRESHOLD) {
    return "low";
  }
  return "in_stock";
};

const getStockStateLabel = (onHand: number) => {
  if (onHand < 0) {
    return "Negative";
  }
  if (onHand === 0) {
    return "Zero Stock";
  }
  if (onHand <= LOW_STOCK_THRESHOLD) {
    return "Low Stock";
  }
  return "In Stock";
};

const getStockStateClass = (onHand: number) => {
  if (onHand < 0) {
    return "stock-badge stock-state-negative";
  }
  if (onHand === 0) {
    return "stock-badge stock-state-zero";
  }
  if (onHand <= LOW_STOCK_THRESHOLD) {
    return "stock-badge stock-state-low";
  }
  return "stock-badge stock-state-positive";
};

export const InventoryPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { error } = useToasts();

  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [active, setActive] = useState("1");
  const [stockState, setStockState] = useState<StockStateFilter>("");
  const [sort, setSort] = useState<SortOption>("productAsc");
  const [pageSize, setPageSize] = useState("100");

  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [loading, setLoading] = useState(false);

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

  useEffect(() => {
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

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
      return getStockState(row.onHand) === stockState;
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
  }, [rows, sort, stockState]);

  const totalUnits = useMemo(
    () => visibleRows.reduce((sum, row) => sum + row.onHand, 0),
    [visibleRows],
  );

  const stockSummary = useMemo(
    () => ({
      inStock: visibleRows.filter((row) => row.onHand > LOW_STOCK_THRESHOLD).length,
      low: visibleRows.filter((row) => row.onHand > 0 && row.onHand <= LOW_STOCK_THRESHOLD).length,
      zero: visibleRows.filter((row) => row.onHand === 0).length,
      negative: visibleRows.filter((row) => row.onHand < 0).length,
    }),
    [visibleRows],
  );

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Inventory</h1>
            <p className="muted-text">Search live stock by product, variant, SKU, or barcode.</p>
          </div>
          <div className="actions-inline">
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
              value={search}
              onChange={(event) => setSearch(event.target.value)}
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
          Low stock currently means on-hand stock greater than 0 and less than or equal to {LOW_STOCK_THRESHOLD}. No per-product reorder threshold is applied in v1.
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
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={9}>{loading ? "Loading inventory..." : "No inventory rows found."}</td>
                </tr>
              ) : (
                visibleRows.map((row) => (
                  <tr
                    key={row.variantId}
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
                      <span className={getStockStateClass(row.onHand)}>
                        {getStockStateLabel(row.onHand)}
                      </span>
                    </td>
                    <td>
                      <span className={row.isActive ? "stock-badge stock-good" : "stock-badge stock-muted"}>
                        {row.isActive ? (row.onHand > 0 ? "In Stock" : "Out Of Stock") : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <div className="actions-inline">
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
