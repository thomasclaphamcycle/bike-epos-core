import { CSSProperties, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { ReportSeverity, reportSeverityBadgeClass } from "../utils/reportSeverity";

type PricingExceptionType = "MISSING_RETAIL_PRICE" | "RETAIL_AT_OR_BELOW_COST" | "LOW_MARGIN";

type PricingExceptionRow = {
  variantId: string;
  productName: string;
  sku: string;
  cost: number | null;
  retailPrice: number;
  apparentMarginPence: number | null;
  apparentMarginPercent: number | null;
  exceptionType: PricingExceptionType;
};

type PricingExceptionsResponse = {
  generatedAt: string;
  thresholds: {
    lowMarginPercent: number;
  };
  summary: {
    missingRetailPriceCount: number;
    retailAtOrBelowCostCount: number;
    lowMarginCount: number;
  };
  items: PricingExceptionRow[];
};

const rowAccent: Record<PricingExceptionType, CSSProperties> = {
  MISSING_RETAIL_PRICE: { backgroundColor: "rgba(194, 58, 58, 0.1)" },
  RETAIL_AT_OR_BELOW_COST: { backgroundColor: "rgba(194, 58, 58, 0.14)" },
  LOW_MARGIN: { backgroundColor: "rgba(214, 148, 34, 0.14)" },
};

const badgeClass: Record<PricingExceptionType, string> = {
  MISSING_RETAIL_PRICE: "status-badge status-cancelled",
  RETAIL_AT_OR_BELOW_COST: "status-badge status-cancelled",
  LOW_MARGIN: "status-badge status-warning",
};

const exceptionLabel: Record<PricingExceptionType, string> = {
  MISSING_RETAIL_PRICE: "Missing retail price",
  RETAIL_AT_OR_BELOW_COST: "Retail at or below cost",
  LOW_MARGIN: "Low margin",
};

const pricingExceptionSeverity = (type: PricingExceptionType): ReportSeverity => {
  if (type === "LOW_MARGIN") {
    return "WARNING";
  }
  return "CRITICAL";
};

const formatMoney = (pence: number | null) => (pence === null ? "-" : `GBP ${(pence / 100).toFixed(2)}`);
const formatMargin = (pence: number | null, percent: number | null) =>
  (pence === null || percent === null ? "-" : `GBP ${(pence / 100).toFixed(2)} (${percent.toFixed(1)}%)`);

export const PricingExceptionsPage = () => {
  const { error } = useToasts();
  const [report, setReport] = useState<PricingExceptionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [exceptionFilter, setExceptionFilter] = useState<PricingExceptionType | "">("");

  const loadReport = async () => {
    setLoading(true);
    try {
      const payload = await apiGet<PricingExceptionsResponse>("/api/reports/pricing/exceptions");
      setReport(payload);
    } catch (loadError) {
      setReport(null);
      error(loadError instanceof Error ? loadError.message : "Failed to load pricing exceptions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleItems = useMemo(
    () => (exceptionFilter ? report?.items.filter((row) => row.exceptionType === exceptionFilter) ?? [] : report?.items ?? []),
    [exceptionFilter, report],
  );

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Pricing Exceptions</h1>
            <p className="muted-text">
              Manager-facing pricing and margin exception queue using current variant pricing plus the latest known purchasing cost where available.
            </p>
          </div>
          <div className="actions-inline">
            <button type="button" onClick={() => void loadReport()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            <Link to="/management">Management</Link>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Missing Retail</span>
            <strong className="metric-value">{report?.summary.missingRetailPriceCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Not ready for normal selling</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">At / Below Cost</span>
            <strong className="metric-value">{report?.summary.retailAtOrBelowCostCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Immediate pricing attention required</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Low Margin</span>
            <strong className="metric-value">{report?.summary.lowMarginCount ?? 0}</strong>
            <span className="dashboard-metric-detail">
              Below {report?.thresholds.lowMarginPercent ?? 20}% apparent margin
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Variants</span>
            <strong className="metric-value">{report?.items.length ?? 0}</strong>
            <span className="dashboard-metric-detail">Current exception rows</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Exception Queue</h2>
            <p className="muted-text">
              Priority order is missing retail first, then at-or-below-cost pricing, then low-margin lines worth review before the next buying decision.
            </p>
          </div>
          <div className="actions-inline">
            <label>
              Type
              <select value={exceptionFilter} onChange={(event) => setExceptionFilter(event.target.value as PricingExceptionType | "")}>
                <option value="">All exceptions</option>
                <option value="MISSING_RETAIL_PRICE">Missing retail price</option>
                <option value="RETAIL_AT_OR_BELOW_COST">Retail at or below cost</option>
                <option value="LOW_MARGIN">Low margin</option>
              </select>
            </label>
            <Link to="/management/product-data">Product data</Link>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>SKU</th>
                <th>Cost</th>
                <th>Retail</th>
                <th>Margin</th>
                <th>Exception Type</th>
                <th>Severity</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.length ? visibleItems.map((row) => (
                <tr key={`${row.variantId}-${row.exceptionType}`} style={rowAccent[row.exceptionType]}>
                  <td>
                    <div className="table-primary">{row.productName}</div>
                    <div className="table-secondary">Variant pricing check for current catalogue and purchasing data</div>
                  </td>
                  <td className="mono-text">{row.sku}</td>
                  <td>{formatMoney(row.cost)}</td>
                  <td>{formatMoney(row.retailPrice)}</td>
                  <td>{formatMargin(row.apparentMarginPence, row.apparentMarginPercent)}</td>
                  <td><span className={badgeClass[row.exceptionType]}>{exceptionLabel[row.exceptionType]}</span></td>
                  <td><span className={reportSeverityBadgeClass[pricingExceptionSeverity(row.exceptionType)]}>{pricingExceptionSeverity(row.exceptionType)}</span></td>
                  <td>
                    <div className="table-actions">
                      <Link to={`/inventory/${row.variantId}`}>Inventory</Link>
                      <Link to="/management/product-data">Product data</Link>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={8}>{loading ? "Loading pricing exceptions..." : "No pricing exceptions right now."}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
