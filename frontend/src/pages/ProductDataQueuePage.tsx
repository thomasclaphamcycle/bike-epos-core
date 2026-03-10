import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";

type VariantRow = {
  id: string;
  productId: string;
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

type IssueKey = "missingBarcode" | "missingCost" | "missingPrice" | "weakIdentity";

type QueueRow = {
  key: string;
  issue: IssueKey;
  severity: "Medium" | "High";
  label: string;
  variant: VariantRow;
};

const issueLabels: Record<IssueKey, string> = {
  missingBarcode: "Missing barcode",
  missingCost: "Missing cost",
  missingPrice: "Missing retail price",
  weakIdentity: "Weak variant naming",
};

export const ProductDataQueuePage = () => {
  const { error } = useToasts();
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [issueFilter, setIssueFilter] = useState<IssueKey | "">("");
  const [activeOnly, setActiveOnly] = useState(true);

  const loadVariants = async () => {
    setLoading(true);
    try {
      const activeParam = activeOnly ? "1" : "";
      const payload = await apiGet<VariantListResponse>(`/api/variants?take=250&skip=0${activeParam ? `&active=${activeParam}` : ""}`);
      setVariants(payload.variants || []);
    } catch (loadError) {
      setVariants([]);
      error(loadError instanceof Error ? loadError.message : "Failed to load product data queue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadVariants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOnly]);

  const rows = useMemo<QueueRow[]>(() => {
    const next: QueueRow[] = [];

    for (const variant of variants) {
      const productLabel = variant.product?.name ?? "Unknown product";
      if (!variant.barcode) {
        next.push({
          key: `${variant.id}-barcode`,
          issue: "missingBarcode",
          severity: "High",
          label: productLabel,
          variant,
        });
      }
      if (variant.costPricePence === null) {
        next.push({
          key: `${variant.id}-cost`,
          issue: "missingCost",
          severity: "High",
          label: productLabel,
          variant,
        });
      }
      if (variant.retailPricePence <= 0) {
        next.push({
          key: `${variant.id}-price`,
          issue: "missingPrice",
          severity: "High",
          label: productLabel,
          variant,
        });
      }
      if (!variant.name && !variant.option) {
        next.push({
          key: `${variant.id}-identity`,
          issue: "weakIdentity",
          severity: "Medium",
          label: productLabel,
          variant,
        });
      }
    }

    return next;
  }, [variants]);

  const filteredRows = useMemo(
    () => (issueFilter ? rows.filter((row) => row.issue === issueFilter) : rows),
    [issueFilter, rows],
  );

  const grouped = useMemo(() => ({
    missingBarcode: filteredRows.filter((row) => row.issue === "missingBarcode"),
    missingCost: filteredRows.filter((row) => row.issue === "missingCost"),
    missingPrice: filteredRows.filter((row) => row.issue === "missingPrice"),
    weakIdentity: filteredRows.filter((row) => row.issue === "weakIdentity"),
  }), [filteredRows]);

  const renderRows = (items: QueueRow[], emptyLabel: string) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Issue</th>
            <th>Product</th>
            <th>Variant</th>
            <th>SKU</th>
            <th>Severity</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={6}>{emptyLabel}</td>
            </tr>
          ) : items.map((row) => (
            <tr key={row.key}>
              <td>{issueLabels[row.issue]}</td>
              <td>
                <div className="table-primary">{row.label}</div>
                <div className="table-secondary">{row.variant.product?.brand ?? "-"}</div>
              </td>
              <td>{row.variant.option || row.variant.name || "-"}</td>
              <td className="mono-text">{row.variant.sku}</td>
              <td><span className={row.severity === "High" ? "status-badge status-warning" : "status-badge"}>{row.severity}</span></td>
              <td>
                <div className="actions-inline">
                  <Link to={`/inventory/${row.variant.id}`}>Inventory</Link>
                  <Link to="/purchasing">Purchasing</Link>
                </div>
              </td>
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
            <h1>Product Data Completion</h1>
            <p className="muted-text">
              Manager-facing queue for active variants that still need enough barcode, cost, price, or naming data to support confident selling and purchasing.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/management/catalogue">Catalogue</Link>
            <button type="button" onClick={() => void loadVariants()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="filter-row">
          <label>
            Issue type
            <select value={issueFilter} onChange={(event) => setIssueFilter(event.target.value as IssueKey | "") }>
              <option value="">All issues</option>
              <option value="missingBarcode">Missing barcode</option>
              <option value="missingCost">Missing cost</option>
              <option value="missingPrice">Missing price</option>
              <option value="weakIdentity">Weak variant naming</option>
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
            <span className="metric-label">Missing Barcode</span>
            <strong className="metric-value">{grouped.missingBarcode.length}</strong>
            <span className="dashboard-metric-detail">Operational lookup/readiness risk</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Missing Cost</span>
            <strong className="metric-value">{grouped.missingCost.length}</strong>
            <span className="dashboard-metric-detail">Weak purchasing margin visibility</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Missing Price</span>
            <strong className="metric-value">{grouped.missingPrice.length}</strong>
            <span className="dashboard-metric-detail">Not confidently sell-ready</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Weak Variant Identity</span>
            <strong className="metric-value">{grouped.weakIdentity.length}</strong>
            <span className="dashboard-metric-detail">Naming/option detail needs attention</span>
          </div>
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>Missing Barcode</h2>
            <Link to="/inventory">Inventory</Link>
          </div>
          {renderRows(grouped.missingBarcode, "No barcode-completion items match the current filter.")}
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Missing Cost</h2>
            <Link to="/purchasing">Purchasing</Link>
          </div>
          {renderRows(grouped.missingCost, "No cost-completion items match the current filter.")}
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Missing Price</h2>
            <Link to="/inventory">Inventory detail</Link>
          </div>
          {renderRows(grouped.missingPrice, "No price-completion items match the current filter.")}
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Weak Variant Naming</h2>
            <Link to="/management/catalogue">Catalogue</Link>
          </div>
          {renderRows(grouped.weakIdentity, "No naming-completion items match the current filter.")}
          <div className="restricted-panel info-panel" style={{ marginTop: "12px" }}>
            Supplier linkage is not modelled directly on variants in the current branch, so this queue focuses on the product and purchasing quality signals the existing data supports honestly.
          </div>
        </section>
      </div>
    </div>
  );
};
