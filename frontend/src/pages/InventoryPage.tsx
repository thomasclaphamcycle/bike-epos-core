import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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

export const InventoryPage = () => {
  const navigate = useNavigate();
  const { error } = useToasts();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [active, setActive] = useState("1");
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

  const totalUnits = useMemo(
    () => rows.reduce((sum, row) => sum + row.onHand, 0),
    [rows],
  );

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Inventory</h1>
            <p className="muted-text">Search live stock by product, variant, SKU, or barcode.</p>
          </div>
          <button type="button" onClick={() => void loadRows()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
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
            <strong className="metric-value">{rows.length}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Visible Units On Hand</span>
            <strong className="metric-value">{totalUnits}</strong>
          </div>
        </div>

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
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7}>{loading ? "Loading inventory..." : "No inventory rows found."}</td>
                </tr>
              ) : (
                rows.map((row) => (
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
