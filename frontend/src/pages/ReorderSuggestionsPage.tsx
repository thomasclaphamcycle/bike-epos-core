import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { ReportSeverity, reportSeverityBadgeClass } from "../utils/reportSeverity";

type ReorderSuggestionUrgency = "Reorder Now" | "Reorder Soon" | "On Order";

type OpenPurchaseOrderRow = {
  id: string;
  poNumber: string;
  status: "SENT" | "PARTIALLY_RECEIVED";
  expectedAt: string | null;
  supplierName: string;
  quantityRemaining: number;
};

type ReorderSuggestionRow = {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string | null;
  displayName: string;
  sku: string;
  currentOnHand: number;
  recentSalesQty: number;
  daysOfCover: number | null;
  targetStockQty: number;
  suggestedReorderQty: number;
  urgency: ReorderSuggestionUrgency;
  onOpenPurchaseOrders: number;
  openPurchaseOrders: OpenPurchaseOrderRow[];
  lastSoldAt: string | null;
};

type ReorderSuggestionsResponse = {
  generatedAt: string;
  heuristic: {
    lookbackDays: number;
    targetCoverageDays: number;
    description: string;
  };
  summary: {
    candidateCount: number;
    reorderNowCount: number;
    reorderSoonCount: number;
    onOrderCount: number;
    totalSuggestedQty: number;
  };
  items: ReorderSuggestionRow[];
};

const urgencyBadgeClass: Record<ReorderSuggestionUrgency, string> = {
  "Reorder Now": "status-badge status-warning",
  "Reorder Soon": "status-badge status-info",
  "On Order": "status-badge",
};

const reorderSeverity = (urgency: ReorderSuggestionUrgency): ReportSeverity => {
  if (urgency === "Reorder Now") {
    return "CRITICAL";
  }
  if (urgency === "Reorder Soon") {
    return "WARNING";
  }
  return "INFO";
};

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleDateString() : "-");

export const ReorderSuggestionsPage = () => {
  const { error } = useToasts();
  const [report, setReport] = useState<ReorderSuggestionsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const loadReport = async () => {
    setLoading(true);
    try {
      const payload = await apiGet<ReorderSuggestionsResponse>("/api/reports/inventory/reorder-suggestions?take=100");
      setReport(payload);
    } catch (loadError) {
      setReport(null);
      error(loadError instanceof Error ? loadError.message : "Failed to load reorder suggestions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const topActions = useMemo(
    () => report?.items.reduce((sum, row) => sum + (row.urgency === "Reorder Now" ? 1 : 0), 0) ?? 0,
    [report],
  );

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Reorder Suggestions</h1>
            <p className="muted-text">
              Practical variant-level buying suggestions using the last {report?.heuristic.lookbackDays ?? 30} days of sales,
              current on-hand stock, and open incoming purchase orders.
            </p>
          </div>
          <div className="actions-inline">
            <button type="button" onClick={() => void loadReport()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            <Link to="/purchasing">Purchasing</Link>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Reorder Now</span>
            <strong className="metric-value">{report?.summary.reorderNowCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Immediate buying decisions</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Reorder Soon</span>
            <strong className="metric-value">{report?.summary.reorderSoonCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Low remaining coverage</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Already On Order</span>
            <strong className="metric-value">{report?.summary.onOrderCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Open PO stock already inbound</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Suggested Units</span>
            <strong className="metric-value">{report?.summary.totalSuggestedQty ?? 0}</strong>
            <span className="dashboard-metric-detail">{topActions} high-priority lines</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Buy Next</h2>
            <p className="muted-text">
              {report?.heuristic.description ?? "Suggested reorder = recent demand minus current and incoming stock."}
            </p>
          </div>
          <Link to="/management">Back to management</Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>SKU</th>
                <th>On Hand</th>
                <th>Sold (30d)</th>
                <th>Open PO</th>
                <th>Suggested</th>
                <th>Status</th>
                <th>Severity</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {report?.items.length ? report.items.map((row) => {
                const firstOpenPo = row.openPurchaseOrders[0] ?? null;
                return (
                  <tr key={row.variantId}>
                    <td>
                      <div className="table-primary">{row.productName}</div>
                      <div className="table-secondary">
                        {row.variantName ? row.displayName : "Default variant"}
                        {row.daysOfCover !== null ? ` | ${row.daysOfCover.toFixed(1)} days cover` : ""}
                      </div>
                    </td>
                    <td className="mono-text">{row.sku || "-"}</td>
                    <td>{row.currentOnHand}</td>
                    <td>{row.recentSalesQty}</td>
                    <td>
                      <div>{row.onOpenPurchaseOrders}</div>
                      <div className="table-secondary">
                        {firstOpenPo ? `${firstOpenPo.poNumber} ${firstOpenPo.expectedAt ? `| due ${formatDate(firstOpenPo.expectedAt)}` : ""}` : "None"}
                      </div>
                    </td>
                    <td>{row.suggestedReorderQty}</td>
                    <td>
                      <span className={urgencyBadgeClass[row.urgency]}>{row.urgency}</span>
                    </td>
                    <td>
                      <span className={reportSeverityBadgeClass[reorderSeverity(row.urgency)]}>{reorderSeverity(row.urgency)}</span>
                    </td>
                    <td>
                      <div className="table-actions">
                        <Link to={`/inventory/${row.variantId}`}>Inventory</Link>
                        {firstOpenPo ? <Link to={`/purchasing/${firstOpenPo.id}`}>Open PO</Link> : <Link to="/purchasing">Purchasing</Link>}
                      </div>
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={9}>{loading ? "Loading reorder suggestions..." : "No reorder suggestions right now."}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="muted-text">
          Suggested quantity targets roughly {report?.heuristic.targetCoverageDays ?? 30} days of stock, using the last
          {` ${report?.heuristic.lookbackDays ?? 30} `}days of actual sales and subtracting current on-hand plus open PO quantity.
        </p>
      </section>
    </div>
  );
};
