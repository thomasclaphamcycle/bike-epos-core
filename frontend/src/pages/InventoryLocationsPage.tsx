import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

type LocationRow = {
  id: string;
  name: string;
  isDefault: boolean;
};

type InventoryLocationRow = {
  variantId: string;
  productId: string;
  productName: string;
  brand: string | null;
  sku: string;
  barcode: string | null;
  variantName: string | null;
  isActive: boolean;
  totalOnHand: number;
  locations: Array<{
    id: string;
    name: string;
    isDefault: boolean;
    onHand: number;
  }>;
};

type InventoryLocationSummaryResponse = {
  summary: {
    variantCount: number;
    locationCount: number;
    totalOnHand: number;
    zeroStockVariants: number;
    negativeStockVariants: number;
  };
  locations: LocationRow[];
  rows: InventoryLocationRow[];
};

type StockStateFilter = "" | "negative" | "zero" | "positive";

const getStockState = (value: number): StockStateFilter => {
  if (value < 0) {
    return "negative";
  }
  if (value === 0) {
    return "zero";
  }
  return "positive";
};

const getStockStateClass = (value: number) => {
  if (value < 0) {
    return "stock-badge stock-state-negative";
  }
  if (value === 0) {
    return "stock-badge stock-state-zero";
  }
  return "stock-badge stock-state-positive";
};

export const InventoryLocationsPage = () => {
  const { error } = useToasts();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [active, setActive] = useState("1");
  const [locationId, setLocationId] = useState("");
  const [stockState, setStockState] = useState<StockStateFilter>("");
  const [payload, setPayload] = useState<InventoryLocationSummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedSearch.trim()) {
      params.set("q", debouncedSearch.trim());
    }
    if (active) {
      params.set("active", active);
    }
    if (locationId) {
      params.set("locationId", locationId);
    }
    params.set("take", "150");
    return params.toString();
  }, [active, debouncedSearch, locationId]);

  const loadRows = async () => {
    setLoading(true);
    try {
      const next = await apiGet<InventoryLocationSummaryResponse>(`/api/reports/inventory/location-summary?${query}`);
      setPayload(next);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load inventory by location";
      error(message);
      setPayload(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const rows = useMemo(() => {
    const source = payload?.rows ?? [];
    return source.filter((row) => {
      if (!stockState) {
        return true;
      }
      return getStockState(row.totalOnHand) === stockState;
    });
  }, [payload?.rows, stockState]);

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Inventory By Location</h1>
            <p className="muted-text">
              Location-aware stock view built from the current stock ledger. This is an operational visibility page, not a warehouse transfer tool.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/inventory">Back to inventory</Link>
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
            Location
            <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              <option value="">All locations</option>
              {(payload?.locations ?? []).map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}{location.isDefault ? " (default)" : ""}
                </option>
              ))}
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
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Visible Variants</span>
            <strong className="metric-value">{rows.length}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Visible Locations</span>
            <strong className="metric-value">{payload?.summary.locationCount ?? 0}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Zero Stock Variants</span>
            <strong className="metric-value">{rows.filter((row) => row.totalOnHand === 0).length}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Negative Stock Variants</span>
            <strong className="metric-value">{rows.filter((row) => row.totalOnHand < 0).length}</strong>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <h2>Location-aware stock rows</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Variant</th>
                <th>SKU</th>
                <th>Total On Hand</th>
                <th>Per Location</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5}>{loading ? "Loading stock..." : "No location-aware stock rows found."}</td>
                </tr>
              ) : rows.map((row) => (
                <tr key={row.variantId}>
                  <td>
                    <Link to={`/inventory/${row.variantId}`}>{row.productName}</Link>
                    <div className="table-secondary">{row.brand || "-"}</div>
                  </td>
                  <td>{row.variantName || "-"}</td>
                  <td className="mono-text">{row.sku}</td>
                  <td>
                    <span className={getStockStateClass(row.totalOnHand)}>{row.totalOnHand}</span>
                  </td>
                  <td>
                    <div className="location-chip-list">
                      {row.locations.map((location) => (
                        <span key={location.id} className="location-chip">
                          <strong>{location.name}</strong>
                          <span>{location.onHand}</span>
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
