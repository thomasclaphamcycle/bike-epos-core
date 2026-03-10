import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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

type StockStateFilter = "" | "negative" | "zero" | "positive";
type SortOption = "productAsc" | "onHandAsc" | "onHandDesc" | "skuAsc";

const getStockState = (onHand: number): StockStateFilter => {
  if (onHand < 0) {
    return "negative";
  }
  if (onHand === 0) {
    return "zero";
  }
  return "positive";
};

const getStockStateLabel = (onHand: number) => {
  if (onHand < 0) {
    return "Negative";
  }
  if (onHand === 0) {
    return "Zero";
  }
  return "Positive";
};

const getStockStateClass = (onHand: number) => {
  if (onHand < 0) {
    return "stock-badge stock-state-negative";
  }
  if (onHand === 0) {
    return "stock-badge stock-state-zero";
  }
  return "stock-badge stock-state-positive";
};

export const InventoryPage = () => {
  const navigate = useNavigate();
  const { error } = useToasts();

  const [search, setSearch] = useState("");
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

  const zeroOrNegativeCount = useMemo(
    () => visibleRows.filter((row) => row.onHand <= 0).length,
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
              <option value="negative">Negative</option>
              <option value="zero">Zero</option>
              <option value="positive">Positive</option>
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
            <span className="metric-label">Visible Units On Hand</span>
            <strong className="metric-value">{totalUnits}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Zero Or Negative Rows</span>
            <strong className="metric-value">{zeroOrNegativeCount}</strong>
          </div>
        </div>

        <p className="muted-text">
          Stock-state indicators use raw on-hand values only. No reorder-threshold logic is applied in v1.
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
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={8}>{loading ? "Loading inventory..." : "No inventory rows found."}</td>
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
