import { CSSProperties, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";

type Severity = "CRITICAL" | "WARNING" | "INFO";
type IssueType = "NEGATIVE_STOCK" | "DEAD_STOCK" | "RETAIL_AT_OR_BELOW_COST" | "MISSING_RETAIL_PRICE";

type InvestigationItem = {
  variantId: string;
  productName: string;
  sku: string;
  issueType: IssueType;
  description: string;
  severity: Severity;
  link: string;
};

type InvestigationsResponse = {
  generatedAt: string;
  lookbackDays: number;
  summary: {
    total: number;
    negativeStockCount: number;
    deadStockCount: number;
    retailAtOrBelowCostCount: number;
    missingRetailPriceCount: number;
    critical: number;
    warning: number;
    info: number;
  };
  items: InvestigationItem[];
};

const rowAccent: Record<Severity, CSSProperties> = {
  CRITICAL: { backgroundColor: "rgba(194, 58, 58, 0.14)" },
  WARNING: { backgroundColor: "rgba(214, 148, 34, 0.14)" },
  INFO: {},
};

const badgeClass: Record<Severity, string> = {
  CRITICAL: "status-badge status-cancelled",
  WARNING: "status-badge status-warning",
  INFO: "status-badge",
};

const issueLabels: Record<IssueType, string> = {
  NEGATIVE_STOCK: "Negative Stock",
  DEAD_STOCK: "Dead Stock",
  RETAIL_AT_OR_BELOW_COST: "Retail At/Below Cost",
  MISSING_RETAIL_PRICE: "Missing Retail Price",
};

export const StockInvestigationsPage = () => {
  const { error } = useToasts();
  const [report, setReport] = useState<InvestigationsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<Severity | "">("");

  const loadReport = async () => {
    setLoading(true);
    try {
      const payload = await apiGet<InvestigationsResponse>("/api/reports/inventory/investigations");
      setReport(payload);
    } catch (loadError) {
      setReport(null);
      error(loadError instanceof Error ? loadError.message : "Failed to load stock investigations");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleItems = useMemo(
    () => (severityFilter ? report?.items.filter((item) => item.severity === severityFilter) ?? [] : report?.items ?? []),
    [report, severityFilter],
  );

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Stock Investigation Queue</h1>
            <p className="muted-text">
              Variant-level inventory and pricing anomalies that need manager review, using existing pricing and stock reporting logic.
            </p>
          </div>
          <div className="actions-inline">
            <button type="button" onClick={() => void loadReport()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            <Link to="/management/actions">Action Centre</Link>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Open Investigations</span>
            <strong className="metric-value">{report?.summary.total ?? 0}</strong>
            <span className="dashboard-metric-detail">Stock and pricing rows needing review</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Negative Stock</span>
            <strong className="metric-value">{report?.summary.negativeStockCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Immediate stock ledger mismatch</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Dead Stock</span>
            <strong className="metric-value">{report?.summary.deadStockCount ?? 0}</strong>
            <span className="dashboard-metric-detail">No completed sales in {report?.lookbackDays ?? 180} days</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Pricing Issues</span>
            <strong className="metric-value">{(report?.summary.retailAtOrBelowCostCount ?? 0) + (report?.summary.missingRetailPriceCount ?? 0)}</strong>
            <span className="dashboard-metric-detail">Retail/cost review required</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Investigation Rows</h2>
            <p className="muted-text">
              Use this queue for deeper review. The Action Centre links here for stock-focused follow-up without changing its grouped workflow.
            </p>
          </div>
          <div className="actions-inline">
            <label>
              Severity
              <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as Severity | "")}>
                <option value="">All severities</option>
                <option value="CRITICAL">Critical</option>
                <option value="WARNING">Warning</option>
                <option value="INFO">Info</option>
              </select>
            </label>
            <Link to="/management/pricing">Pricing Review</Link>
            <Link to="/inventory">Inventory</Link>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>SKU</th>
                <th>Issue</th>
                <th>Severity</th>
                <th>Link</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.length ? visibleItems.map((item) => (
                <tr key={`${item.variantId}-${item.issueType}`} style={rowAccent[item.severity]}>
                  <td>{item.productName}</td>
                  <td className="mono-text">{item.sku}</td>
                  <td>
                    <strong>{issueLabels[item.issueType]}</strong>
                    <div className="muted-text">{item.description}</div>
                  </td>
                  <td><span className={badgeClass[item.severity]}>{item.severity}</span></td>
                  <td><Link to={item.link}>Open</Link></td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={5}>{loading ? "Loading stock investigations..." : "No stock investigations right now."}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
