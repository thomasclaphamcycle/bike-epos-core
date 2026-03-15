import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  getFinancialMonthlyMarginReport,
  getFinancialMonthlySalesSummaryReport,
  getFinancialSalesByCategoryReport,
  type FinancialMonthlyMarginReport,
  type FinancialMonthlySalesSummaryReport,
  type FinancialSalesByCategoryReport,
} from "../api/financialReports";
import { useToasts } from "../components/ToastProvider";

const formatCurrencyFromPence = (valuePence: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(valuePence / 100);

const formatPercent = (value: number) => `${value.toFixed(1)}%`;

const formatCount = (value: number, singular: string, plural: string) =>
  `${value} ${value === 1 ? singular : plural}`;

export const FinancialReportsPage = () => {
  const { error } = useToasts();
  const [loading, setLoading] = useState(false);
  const [monthlySales, setMonthlySales] = useState<FinancialMonthlySalesSummaryReport | null>(null);
  const [monthlyMargin, setMonthlyMargin] = useState<FinancialMonthlyMarginReport | null>(null);
  const [salesByCategory, setSalesByCategory] = useState<FinancialSalesByCategoryReport | null>(null);

  const loadReports = async () => {
    setLoading(true);
    const [monthlySalesResult, monthlyMarginResult, salesByCategoryResult] = await Promise.allSettled([
      getFinancialMonthlySalesSummaryReport(),
      getFinancialMonthlyMarginReport(),
      getFinancialSalesByCategoryReport(),
    ]);

    if (monthlySalesResult.status === "fulfilled") {
      setMonthlySales(monthlySalesResult.value);
    } else {
      setMonthlySales(null);
      error(monthlySalesResult.reason instanceof Error ? monthlySalesResult.reason.message : "Failed to load monthly sales");
    }

    if (monthlyMarginResult.status === "fulfilled") {
      setMonthlyMargin(monthlyMarginResult.value);
    } else {
      setMonthlyMargin(null);
      error(monthlyMarginResult.reason instanceof Error ? monthlyMarginResult.reason.message : "Failed to load monthly margin");
    }

    if (salesByCategoryResult.status === "fulfilled") {
      setSalesByCategory(salesByCategoryResult.value);
    } else {
      setSalesByCategory(null);
      error(salesByCategoryResult.reason instanceof Error ? salesByCategoryResult.reason.message : "Failed to load sales by category");
    }

    setLoading(false);
  };

  useEffect(() => {
    void loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const costCoverageMessage = useMemo(() => {
    if (!monthlyMargin?.costBasis.revenueWithoutCostBasisPence) {
      return "Cost coverage is complete for the current month so far.";
    }

    return `${formatCurrencyFromPence(monthlyMargin.costBasis.revenueWithoutCostBasisPence)} of revenue currently has no recorded cost basis.`;
  }, [monthlyMargin]);

  const categoryRows = salesByCategory?.categories ?? [];

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Financial Reports</h1>
            <p className="muted-text">
              Current-month financial summary for managers using live sales, refund, and cost data already recorded in CorePOS.
            </p>
          </div>
          <div className="actions-inline">
            <button type="button" onClick={() => void loadReports()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            <Link to="/dashboard">Dashboard</Link>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Monthly Sales</h2>
            <p className="muted-text">A simple owner-facing summary of current-month sales activity.</p>
          </div>
        </div>
        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Revenue</span>
            <strong className="metric-value">{monthlySales ? formatCurrencyFromPence(monthlySales.summary.revenuePence) : "—"}</strong>
            <span className="dashboard-metric-detail">
              {monthlySales ? `Gross ${formatCurrencyFromPence(monthlySales.summary.grossSalesPence)}` : "Monthly sales summary unavailable."}
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Transactions</span>
            <strong className="metric-value">{monthlySales ? `${monthlySales.summary.transactions}` : "—"}</strong>
            <span className="dashboard-metric-detail">
              {monthlySales ? formatCount(monthlySales.summary.transactions, "sale", "sales") : "Awaiting current-month sales data."}
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Average Sale</span>
            <strong className="metric-value">{monthlySales ? formatCurrencyFromPence(monthlySales.summary.averageSaleValuePence) : "—"}</strong>
            <span className="dashboard-metric-detail">Revenue divided by completed sales.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Refunds</span>
            <strong className="metric-value">{monthlySales ? formatCurrencyFromPence(monthlySales.summary.refundsPence) : "—"}</strong>
            <span className="dashboard-metric-detail">
              {monthlySales ? formatCount(monthlySales.summary.refundCount, "refund", "refunds") : "Refund totals unavailable."}
            </span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Monthly Margin</h2>
            <p className="muted-text">Gross margin is only calculated from known recorded costs. Missing costs are shown explicitly instead of estimated.</p>
          </div>
        </div>
        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Revenue</span>
            <strong className="metric-value">{monthlyMargin ? formatCurrencyFromPence(monthlyMargin.summary.revenuePence) : "—"}</strong>
            <span className="dashboard-metric-detail">Net of refunds for the current month.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">COGS</span>
            <strong className="metric-value">{monthlyMargin ? formatCurrencyFromPence(monthlyMargin.summary.cogsPence) : "—"}</strong>
            <span className="dashboard-metric-detail">Known recorded cost basis only.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Gross Margin</span>
            <strong className="metric-value">{monthlyMargin ? formatCurrencyFromPence(monthlyMargin.summary.grossMarginPence) : "—"}</strong>
            <span className="dashboard-metric-detail">Revenue less known costs.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Margin %</span>
            <strong className="metric-value">{monthlyMargin ? formatPercent(monthlyMargin.summary.grossMarginPercent) : "—"}</strong>
            <span className="dashboard-metric-detail">
              {monthlyMargin ? `${formatPercent(monthlyMargin.costBasis.knownCostCoveragePercent)} cost coverage` : "Coverage details unavailable."}
            </span>
          </div>
        </div>
        <div className="info-panel">
          <strong>Cost coverage</strong>
          <p className="muted-text">{monthlyMargin ? costCoverageMessage : "Cost coverage details are unavailable right now."}</p>
          {monthlyMargin?.costBasis.notes.length ? (
            <ul>
              {monthlyMargin.costBasis.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Sales by Category</h2>
            <p className="muted-text">Current-month category mix using the same live financial reporting dataset.</p>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Categories</span>
            <strong className="metric-value">{salesByCategory ? `${salesByCategory.summary.categoryCount}` : "—"}</strong>
            <span className="dashboard-metric-detail">Categories with current-month sales activity.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Top Category</span>
            <strong className="metric-value">{salesByCategory?.summary.topCategoryName ?? "—"}</strong>
            <span className="dashboard-metric-detail">
              {salesByCategory?.summary.topCategoryName
                ? formatCurrencyFromPence(salesByCategory.summary.topCategoryRevenuePence)
                : "No category revenue recorded yet."}
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Net Quantity</span>
            <strong className="metric-value">{salesByCategory ? `${salesByCategory.summary.netQuantity}` : "—"}</strong>
            <span className="dashboard-metric-detail">Units sold less refunded units.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Cost Coverage</span>
            <strong className="metric-value">{salesByCategory ? formatPercent(salesByCategory.summary.knownCostCoveragePercent) : "—"}</strong>
            <span className="dashboard-metric-detail">Revenue currently backed by known costs.</span>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Revenue</th>
                <th>Gross Margin</th>
                <th>Margin %</th>
                <th>Net Quantity</th>
                <th>Cost Coverage</th>
              </tr>
            </thead>
            <tbody>
              {categoryRows.length ? categoryRows.map((row) => (
                <tr key={row.categoryName}>
                  <td>{row.categoryName}</td>
                  <td>{formatCurrencyFromPence(row.revenuePence)}</td>
                  <td>{formatCurrencyFromPence(row.grossMarginPence)}</td>
                  <td>{formatPercent(row.grossMarginPercent)}</td>
                  <td>{row.netQuantity}</td>
                  <td>{formatPercent(row.knownCostCoveragePercent)}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6}>{loading ? "Loading category breakdown..." : "No category sales are available for the current month."}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
