import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { SavedViewControls } from "../components/SavedViewControls";
import { useToasts } from "../components/ToastProvider";

type SalesDailyRow = {
  date: string;
  saleCount: number;
  grossPence: number;
  refundsPence: number;
  netPence: number;
};

type RangePreset = "30" | "90" | "365";

type RollupRow = {
  key: string;
  label: string;
  saleCount: number;
  grossPence: number;
  refundsPence: number;
  netPence: number;
  averageBasketPence: number;
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const formatDateKey = (value: Date) => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const shiftDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const startOfIsoWeek = (value: Date) => {
  const date = new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date;
};

const rollupRows = (
  rows: SalesDailyRow[],
  mode: "week" | "month",
): RollupRow[] => {
  const byKey = new Map<string, RollupRow>();

  for (const row of rows) {
    const date = new Date(`${row.date}T00:00:00.000Z`);
    let key: string;
    let label: string;

    if (mode === "week") {
      const weekStart = startOfIsoWeek(date);
      key = weekStart.toISOString().slice(0, 10);
      label = `Week of ${key}`;
    } else {
      const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
      key = `${date.getUTCFullYear()}-${month}`;
      label = key;
    }

    const existing = byKey.get(key);
    if (existing) {
      existing.saleCount += row.saleCount;
      existing.grossPence += row.grossPence;
      existing.refundsPence += row.refundsPence;
      existing.netPence += row.netPence;
      existing.averageBasketPence = existing.saleCount > 0 ? Math.round(existing.grossPence / existing.saleCount) : 0;
      continue;
    }

    byKey.set(key, {
      key,
      label,
      saleCount: row.saleCount,
      grossPence: row.grossPence,
      refundsPence: row.refundsPence,
      netPence: row.netPence,
      averageBasketPence: row.saleCount > 0 ? Math.round(row.grossPence / row.saleCount) : 0,
    });
  }

  return Array.from(byKey.values()).sort((left, right) => right.key.localeCompare(left.key));
};

export const SalesAnalyticsPage = () => {
  const { error } = useToasts();

  const [rangePreset, setRangePreset] = useState<RangePreset>("90");
  const [rows, setRows] = useState<SalesDailyRow[]>([]);
  const [loading, setLoading] = useState(false);

  const applySavedFilters = (filters: Record<string, string>) => {
    if (filters.rangePreset === "30" || filters.rangePreset === "90" || filters.rangePreset === "365") {
      setRangePreset(filters.rangePreset);
    }
  };

  const loadAnalytics = async () => {
    setLoading(true);
    try {
      const today = new Date();
      const to = formatDateKey(today);
      const from = formatDateKey(shiftDays(today, -(Number(rangePreset) - 1)));
      const payload = await apiGet<SalesDailyRow[]>(`/api/reports/sales/daily?from=${from}&to=${to}`);
      setRows(payload || []);
    } catch (loadError) {
      setRows([]);
      const message = loadError instanceof Error ? loadError.message : "Failed to load sales analytics";
      error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangePreset]);

  const totals = useMemo(() => {
    const saleCount = rows.reduce((sum, row) => sum + row.saleCount, 0);
    const grossPence = rows.reduce((sum, row) => sum + row.grossPence, 0);
    const refundsPence = rows.reduce((sum, row) => sum + row.refundsPence, 0);
    const netPence = rows.reduce((sum, row) => sum + row.netPence, 0);
    const averageBasketPence = saleCount > 0 ? Math.round(grossPence / saleCount) : 0;
    return {
      saleCount,
      grossPence,
      refundsPence,
      netPence,
      averageBasketPence,
    };
  }, [rows]);

  const bestDay = useMemo(() => {
    if (rows.length === 0) {
      return null;
    }
    return [...rows].sort((left, right) => right.netPence - left.netPence || right.saleCount - left.saleCount)[0];
  }, [rows]);

  const weeklyRows = useMemo(() => rollupRows(rows, "week"), [rows]);
  const monthlyRows = useMemo(() => rollupRows(rows, "month"), [rows]);

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Sales Analytics</h1>
            <p className="muted-text">
              Manager-facing revenue trends derived from the daily sales report. No chart library or new analytics backend is used in v1.
            </p>
          </div>
          <div className="actions-inline">
            <label>
              Range
              <select value={rangePreset} onChange={(event) => setRangePreset(event.target.value as RangePreset)}>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="365">Last 365 days</option>
              </select>
            </label>
            <button type="button" onClick={() => void loadAnalytics()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Net Revenue</span>
            <strong className="metric-value">{formatMoney(totals.netPence)}</strong>
            <span className="dashboard-metric-detail">Gross {formatMoney(totals.grossPence)}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Sales Count</span>
            <strong className="metric-value">{totals.saleCount}</strong>
            <span className="dashboard-metric-detail">Refunds {formatMoney(totals.refundsPence)}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Average Basket</span>
            <strong className="metric-value">{formatMoney(totals.averageBasketPence)}</strong>
            <span className="dashboard-metric-detail">Derived from gross revenue / sale count</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Best Day</span>
            <strong className="metric-value">{bestDay ? formatMoney(bestDay.netPence) : "-"}</strong>
            <span className="dashboard-metric-detail">{bestDay ? bestDay.date : "No data"}</span>
          </div>
        </div>
      </section>

      <SavedViewControls
        pageKey="sales"
        currentFilters={{ rangePreset }}
        onApplyFilters={applySavedFilters}
        defaultName={`Sales ${rangePreset}d`}
      />

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>Daily Revenue</h2>
            <Link to="/management">Back to management</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Sales</th>
                  <th>Gross</th>
                  <th>Refunds</th>
                  <th>Net</th>
                  <th>Average Basket</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No sales data for this range.</td>
                  </tr>
                ) : (
                  [...rows].reverse().map((row) => (
                    <tr key={row.date}>
                      <td>{row.date}</td>
                      <td>{row.saleCount}</td>
                      <td>{formatMoney(row.grossPence)}</td>
                      <td>{formatMoney(row.refundsPence)}</td>
                      <td>{formatMoney(row.netPence)}</td>
                      <td>{row.saleCount > 0 ? formatMoney(Math.round(row.grossPence / row.saleCount)) : "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Weekly Rollup</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Sales</th>
                  <th>Gross</th>
                  <th>Refunds</th>
                  <th>Net</th>
                  <th>Average Basket</th>
                </tr>
              </thead>
              <tbody>
                {weeklyRows.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No weekly rollup available.</td>
                  </tr>
                ) : (
                  weeklyRows.map((row) => (
                    <tr key={row.key}>
                      <td>{row.label}</td>
                      <td>{row.saleCount}</td>
                      <td>{formatMoney(row.grossPence)}</td>
                      <td>{formatMoney(row.refundsPence)}</td>
                      <td>{formatMoney(row.netPence)}</td>
                      <td>{formatMoney(row.averageBasketPence)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Monthly Rollup</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Sales</th>
                  <th>Gross</th>
                  <th>Refunds</th>
                  <th>Net</th>
                  <th>Average Basket</th>
                </tr>
              </thead>
              <tbody>
                {monthlyRows.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No monthly rollup available.</td>
                  </tr>
                ) : (
                  monthlyRows.map((row) => (
                    <tr key={row.key}>
                      <td>{row.label}</td>
                      <td>{row.saleCount}</td>
                      <td>{formatMoney(row.grossPence)}</td>
                      <td>{formatMoney(row.refundsPence)}</td>
                      <td>{formatMoney(row.netPence)}</td>
                      <td>{formatMoney(row.averageBasketPence)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Scope Notes</h2>
          </div>
          <div className="restricted-panel info-panel">
            Revenue by category, product, and service is intentionally not included in M86 v1 because the current branch does not expose a clean manager-ready backend breakdown for those dimensions. This milestone stays additive by reusing the existing daily sales report only.
          </div>
        </section>
      </div>
    </div>
  );
};
