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
import { useAppConfig } from "../config/appConfig";
import { formatCurrencyFromPence } from "../utils/currency";

const formatPercent = (value: number) => `${value.toFixed(1)}%`;

const formatCount = (value: number, singular: string, plural: string) =>
  `${value} ${value === 1 ? singular : plural}`;

const formatRevenueShare = (valuePence: number, totalPence: number) => {
  if (totalPence <= 0) {
    return "—";
  }

  return formatPercent((valuePence / totalPence) * 100);
};

export const FinancialReportsPage = () => {
  const appConfig = useAppConfig();
  const { error } = useToasts();
  const [loading, setLoading] = useState(false);
  const [loadFailures, setLoadFailures] = useState<string[]>([]);
  const [monthlySales, setMonthlySales] = useState<FinancialMonthlySalesSummaryReport | null>(null);
  const [monthlyMargin, setMonthlyMargin] = useState<FinancialMonthlyMarginReport | null>(null);
  const [salesByCategory, setSalesByCategory] = useState<FinancialSalesByCategoryReport | null>(null);
  const currencyCode = appConfig.store.defaultCurrency;
  const formatMoney = (valuePence: number) => formatCurrencyFromPence(valuePence, currencyCode);

  const loadReports = async () => {
    setLoading(true);
    setLoadFailures([]);
    const [monthlySalesResult, monthlyMarginResult, salesByCategoryResult] = await Promise.allSettled([
      getFinancialMonthlySalesSummaryReport(),
      getFinancialMonthlyMarginReport(),
      getFinancialSalesByCategoryReport(),
    ]);
    const nextFailures: string[] = [];

    if (monthlySalesResult.status === "fulfilled") {
      setMonthlySales(monthlySalesResult.value);
    } else {
      setMonthlySales(null);
      nextFailures.push(monthlySalesResult.reason instanceof Error ? monthlySalesResult.reason.message : "Failed to load monthly sales");
    }

    if (monthlyMarginResult.status === "fulfilled") {
      setMonthlyMargin(monthlyMarginResult.value);
    } else {
      setMonthlyMargin(null);
      nextFailures.push(monthlyMarginResult.reason instanceof Error ? monthlyMarginResult.reason.message : "Failed to load monthly margin");
    }

    if (salesByCategoryResult.status === "fulfilled") {
      setSalesByCategory(salesByCategoryResult.value);
    } else {
      setSalesByCategory(null);
      nextFailures.push(salesByCategoryResult.reason instanceof Error ? salesByCategoryResult.reason.message : "Failed to load sales by category");
    }

    if (nextFailures.length) {
      setLoadFailures(nextFailures);
      error(nextFailures[0]);
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

    return `${formatMoney(monthlyMargin.costBasis.revenueWithoutCostBasisPence)} of revenue currently has no recorded cost basis.`;
  }, [monthlyMargin, currencyCode]);

  const filtersLabel = useMemo(
    () => monthlySales?.filters.label ?? monthlyMargin?.filters.label ?? salesByCategory?.filters.label ?? "Month to date",
    [monthlyMargin?.filters.label, monthlySales?.filters.label, salesByCategory?.filters.label],
  );

  const hasAnyData = Boolean(monthlySales || monthlyMargin || salesByCategory);

  const sortedCategoryRows = useMemo(() => (
    [...(salesByCategory?.categories ?? [])].sort((left, right) =>
      right.revenuePence - left.revenuePence
      || right.grossMarginPence - left.grossMarginPence
      || left.categoryName.localeCompare(right.categoryName))
  ), [salesByCategory?.categories]);

  const insightItems = useMemo(() => {
    const items: Array<{ label: string; detail: string }> = [];

    if (salesByCategory?.summary.topCategoryName) {
      items.push({
        label: "Top category",
        detail: `${salesByCategory.summary.topCategoryName} leads with ${formatMoney(salesByCategory.summary.topCategoryRevenuePence)} (${formatRevenueShare(
          salesByCategory.summary.topCategoryRevenuePence,
          salesByCategory.summary.revenuePence,
        )} of current-month revenue).`,
      });
    }

    if (monthlyMargin) {
      items.push({
        label: "Margin signal",
        detail: `${formatPercent(monthlyMargin.summary.grossMarginPercent)} gross margin on ${formatMoney(monthlyMargin.summary.revenuePence)} revenue month to date.`,
      });
    }

    if (monthlySales) {
      items.push({
        label: "Refund signal",
        detail: monthlySales.summary.refundCount > 0
          ? `${formatMoney(monthlySales.summary.refundsPence)} refunded across ${formatCount(monthlySales.summary.refundCount, "refund", "refunds")}.`
          : "No refunds have been recorded so far this month.",
      });
    }

    if (monthlyMargin) {
      items.push({
        label: "Cost coverage",
        detail: monthlyMargin.costBasis.revenueWithoutCostBasisPence > 0
          ? `${formatPercent(monthlyMargin.costBasis.knownCostCoveragePercent)} of revenue has known cost basis, with ${formatMoney(monthlyMargin.costBasis.revenueWithoutCostBasisPence)} still awaiting cost coverage.`
          : "All current-month revenue has a known recorded cost basis.",
      });
    }

    return items;
  }, [currencyCode, monthlyMargin, monthlySales, salesByCategory]);

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Financial Reports</h1>
            <p className="muted-text">
              Current-month financial summary for managers using live sales, refund, and cost data already recorded in CorePOS.
            </p>
            <p className="muted-text">{filtersLabel}</p>
          </div>
          <div className="actions-inline">
            <button type="button" onClick={() => void loadReports()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            <Link to="/dashboard">Dashboard</Link>
          </div>
        </div>
      </section>

      {loading && !hasAnyData ? (
        <div className="restricted-panel info-panel">Loading current-month financial reports...</div>
      ) : null}

      {loadFailures.length ? (
        <div className="restricted-panel info-panel">
          <strong>Some financial data is unavailable.</strong>
          <p className="muted-text">
            The page will show any sections that did load successfully and keep the rest clearly marked as unavailable.
          </p>
        </div>
      ) : null}

      {hasAnyData ? (
        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Month-to-Date Headline</h2>
              <p className="muted-text">The clearest top-line view of revenue, margin, and category mix.</p>
            </div>
          </div>
          <div className="dashboard-summary-grid">
            <div className="metric-card">
              <span className="metric-label">Revenue</span>
              <strong className="metric-value">
                {monthlySales ? formatMoney(monthlySales.summary.revenuePence) : monthlyMargin ? formatMoney(monthlyMargin.summary.revenuePence) : "—"}
              </strong>
              <span className="dashboard-metric-detail">Current-month net sales revenue.</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Gross Margin</span>
              <strong className="metric-value">{monthlyMargin ? formatMoney(monthlyMargin.summary.grossMarginPence) : "—"}</strong>
              <span className="dashboard-metric-detail">Revenue less known costs.</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Margin %</span>
              <strong className="metric-value">{monthlyMargin ? formatPercent(monthlyMargin.summary.grossMarginPercent) : "—"}</strong>
              <span className="dashboard-metric-detail">Gross margin as a share of revenue.</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Top Category</span>
              <strong className="metric-value">{salesByCategory?.summary.topCategoryName ?? "—"}</strong>
              <span className="dashboard-metric-detail">
                {salesByCategory?.summary.topCategoryName
                  ? `${formatMoney(salesByCategory.summary.topCategoryRevenuePence)} · ${formatRevenueShare(
                    salesByCategory.summary.topCategoryRevenuePence,
                    salesByCategory.summary.revenuePence,
                  )} share`
                  : "No category revenue recorded yet."}
              </span>
            </div>
          </div>
        </section>
      ) : null}

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
            <strong className="metric-value">{monthlySales ? formatMoney(monthlySales.summary.revenuePence) : "—"}</strong>
            <span className="dashboard-metric-detail">
              {monthlySales ? `Gross ${formatMoney(monthlySales.summary.grossSalesPence)} month to date.` : "Monthly sales summary unavailable."}
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
            <strong className="metric-value">{monthlySales ? formatMoney(monthlySales.summary.averageSaleValuePence) : "—"}</strong>
            <span className="dashboard-metric-detail">Revenue divided by completed sales.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Refunds</span>
            <strong className="metric-value">{monthlySales ? formatMoney(monthlySales.summary.refundsPence) : "—"}</strong>
            <span className="dashboard-metric-detail">
              {monthlySales ? formatCount(monthlySales.summary.refundCount, "refund", "refunds") : "Refund totals unavailable."}
            </span>
          </div>
        </div>
        {!monthlySales && !loading ? (
          <div className="restricted-panel info-panel">No monthly sales summary is available yet for this period.</div>
        ) : null}
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
            <strong className="metric-value">{monthlyMargin ? formatMoney(monthlyMargin.summary.revenuePence) : "—"}</strong>
            <span className="dashboard-metric-detail">Net of refunds for the current month.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">COGS</span>
            <strong className="metric-value">{monthlyMargin ? formatMoney(monthlyMargin.summary.cogsPence) : "—"}</strong>
            <span className="dashboard-metric-detail">Known recorded cost basis only.</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Gross Margin</span>
            <strong className="metric-value">{monthlyMargin ? formatMoney(monthlyMargin.summary.grossMarginPence) : "—"}</strong>
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
        {monthlyMargin ? (
          <div className="info-panel">
            <strong>Cost coverage</strong>
            <p className="muted-text">{costCoverageMessage}</p>
            {monthlyMargin.costBasis.notes.length ? (
              <ul>
                {monthlyMargin.costBasis.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : !loading ? (
          <div className="restricted-panel info-panel">No monthly margin summary is available yet for this period.</div>
        ) : null}
      </section>

      {insightItems.length ? (
        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Insights</h2>
              <p className="muted-text">Compact manager highlights derived directly from the live financial report responses.</p>
            </div>
          </div>
          <div className="dashboard-summary-grid">
            {insightItems.map((item) => (
              <div key={item.label} className="metric-card">
                <span className="metric-label">{item.label}</span>
                <span className="dashboard-metric-detail">{item.detail}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Sales by Category</h2>
            <p className="muted-text">Current-month category mix, sorted by highest revenue first for quick manager review.</p>
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
                ? formatMoney(salesByCategory.summary.topCategoryRevenuePence)
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
                <th>Share</th>
                <th>Revenue</th>
                <th>Gross Margin</th>
                <th>Margin %</th>
                <th>Net Quantity</th>
                <th>Cost Coverage</th>
              </tr>
            </thead>
            <tbody>
              {sortedCategoryRows.length ? sortedCategoryRows.map((row) => (
                <tr key={row.categoryName}>
                  <td>
                    <div className="table-primary">{row.categoryName}</div>
                    <div className="table-secondary">
                      {row.revenueWithoutCostBasisPence > 0
                        ? `${formatMoney(row.revenueWithoutCostBasisPence)} revenue missing cost basis`
                        : "Complete cost basis for this category."}
                    </div>
                  </td>
                  <td>{salesByCategory ? formatRevenueShare(row.revenuePence, salesByCategory.summary.revenuePence) : "—"}</td>
                  <td>{formatMoney(row.revenuePence)}</td>
                  <td>{formatMoney(row.grossMarginPence)}</td>
                  <td>{formatPercent(row.grossMarginPercent)}</td>
                  <td>{row.netQuantity}</td>
                  <td>{formatPercent(row.knownCostCoveragePercent)}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={7}>{loading ? "Loading category breakdown..." : "No category sales are available for the current month."}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {salesByCategory?.costBasis.notes.length ? (
          <div className="info-panel">
            <strong>Category cost notes</strong>
            <ul>
              {salesByCategory.costBasis.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {!hasAnyData && !loading ? (
        <div className="restricted-panel info-panel">
          No financial report data is available for the current month yet.
        </div>
      ) : null}
    </div>
  );
};
