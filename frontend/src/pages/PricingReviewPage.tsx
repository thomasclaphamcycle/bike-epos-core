import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";

type VariantRow = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string | null;
  option: string | null;
  retailPricePence: number;
  costPricePence: number | null;
  isActive: boolean;
  product?: {
    id: string;
    name: string;
    brand: string | null;
  };
};

type VariantListResponse = {
  variants: VariantRow[];
};

type IssueType = "missingPrice" | "atOrBelowCost" | "lowMargin";

type PricingRow = {
  key: string;
  issue: IssueType;
  variant: VariantRow;
  marginPct: number | null;
};

const formatMoney = (pence: number | null) => (pence === null ? "-" : `£${(pence / 100).toFixed(2)}`);

const formatMargin = (marginPct: number | null) => (marginPct === null ? "-" : `${marginPct.toFixed(1)}%`);

const marginPctFor = (retailPence: number, costPence: number | null) => {
  if (costPence === null || retailPence <= 0) {
    return null;
  }
  return ((retailPence - costPence) / retailPence) * 100;
};

export const PricingReviewPage = () => {
  const { error } = useToasts();
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [issueFilter, setIssueFilter] = useState<IssueType | "">("");
  const [activeOnly, setActiveOnly] = useState(true);

  const loadVariants = async () => {
    setLoading(true);
    try {
      const activeParam = activeOnly ? "1" : "";
      const payload = await apiGet<VariantListResponse>(`/api/variants?take=250&skip=0${activeParam ? `&active=${activeParam}` : ""}`);
      setVariants(payload.variants || []);
    } catch (loadError) {
      setVariants([]);
      error(loadError instanceof Error ? loadError.message : "Failed to load pricing review queue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadVariants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOnly]);

  const rows = useMemo<PricingRow[]>(() => {
    const next: PricingRow[] = [];
    for (const variant of variants) {
      const marginPct = marginPctFor(variant.retailPricePence, variant.costPricePence);
      if (variant.retailPricePence <= 0) {
        next.push({ key: `${variant.id}-missing-price`, issue: "missingPrice", variant, marginPct });
      }
      if (variant.costPricePence !== null && variant.retailPricePence > 0 && variant.retailPricePence <= variant.costPricePence) {
        next.push({ key: `${variant.id}-below-cost`, issue: "atOrBelowCost", variant, marginPct });
      }
      if (
        variant.costPricePence !== null
        && variant.retailPricePence > variant.costPricePence
        && marginPct !== null
        && marginPct > 0
        && marginPct <= 10
      ) {
        next.push({ key: `${variant.id}-low-margin`, issue: "lowMargin", variant, marginPct });
      }
    }
    return next;
  }, [variants]);

  const filteredRows = useMemo(
    () => (issueFilter ? rows.filter((row) => row.issue === issueFilter) : rows),
    [issueFilter, rows],
  );

  const grouped = useMemo(() => ({
    missingPrice: filteredRows.filter((row) => row.issue === "missingPrice"),
    atOrBelowCost: filteredRows.filter((row) => row.issue === "atOrBelowCost"),
    lowMargin: filteredRows.filter((row) => row.issue === "lowMargin"),
  }), [filteredRows]);

  const renderRows = (items: PricingRow[], emptyLabel: string) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>Variant</th>
            <th>SKU</th>
            <th>Cost</th>
            <th>Retail</th>
            <th>Margin</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={7}>{emptyLabel}</td>
            </tr>
          ) : items.map((row) => (
            <tr key={row.key}>
              <td>
                <div className="table-primary">{row.variant.product?.name ?? "Unknown product"}</div>
                <div className="table-secondary">{row.variant.product?.brand ?? "-"}</div>
              </td>
              <td>{row.variant.option || row.variant.name || "-"}</td>
              <td className="mono-text">{row.variant.sku}</td>
              <td>{formatMoney(row.variant.costPricePence)}</td>
              <td>{formatMoney(row.variant.retailPricePence)}</td>
              <td>{formatMargin(row.marginPct)}</td>
              <td><Link to={`/inventory/${row.variant.id}`}>Inventory detail</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Pricing Review</h1>
            <p className="muted-text">
              Manager-facing pricing and margin exception queue built from current variant cost and retail price data. This is operational review, not a pricing engine.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/management">Back to management</Link>
            <button type="button" onClick={() => void loadVariants()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="filter-row">
          <label>
            Issue
            <select value={issueFilter} onChange={(event) => setIssueFilter(event.target.value as IssueType | "") }>
              <option value="">All issues</option>
              <option value="missingPrice">Missing retail price</option>
              <option value="atOrBelowCost">Retail at or below cost</option>
              <option value="lowMargin">Very low margin</option>
            </select>
          </label>
          <label>
            Scope
            <select value={activeOnly ? "active" : "all"} onChange={(event) => setActiveOnly(event.target.value === "active")}>
              <option value="active">Active variants only</option>
              <option value="all">All variants</option>
            </select>
          </label>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Missing Price</span>
            <strong className="metric-value">{grouped.missingPrice.length}</strong>
            <span className="dashboard-metric-detail">Variants not ready for normal selling</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">At / Below Cost</span>
            <strong className="metric-value">{grouped.atOrBelowCost.length}</strong>
            <span className="dashboard-metric-detail">Immediate pricing attention required</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Very Low Margin</span>
            <strong className="metric-value">{grouped.lowMargin.length}</strong>
            <span className="dashboard-metric-detail">Apparent margin at 10% or lower</span>
          </div>
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>Missing Retail Price</h2>
            <Link to="/management/product-data">Product data queue</Link>
          </div>
          {renderRows(grouped.missingPrice, "No missing-price variants match the current filter.")}
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Retail At Or Below Cost</h2>
            <Link to="/inventory">Inventory</Link>
          </div>
          {renderRows(grouped.atOrBelowCost, "No at-or-below-cost variants match the current filter.")}
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Very Low Margin</h2>
            <Link to="/management/product-data">Data completion</Link>
          </div>
          {renderRows(grouped.lowMargin, "No low-margin variants match the current filter.")}
        </section>
      </div>
    </div>
  );
};
