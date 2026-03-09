import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";

type RangePreset = "30" | "90" | "365";

type VelocityRow = {
  productId: string;
  productName: string;
  currentOnHand: number;
  quantitySold: number;
  velocityPer30Days: number;
  sellThroughRate: number;
  lastSoldAt: string | null;
};

type VelocityResponse = {
  filters: {
    from: string;
    to: string;
    take: number;
    rangeDays: number;
  };
  summary: {
    trackedProductCount: number;
    productsWithSales: number;
    deadStockCount: number;
    totalOnHand: number;
  };
  products: VelocityRow[];
};

type Urgency = "Low" | "Reorder Soon" | "Reorder Now";

type SuggestionRow = VelocityRow & {
  targetStockQty: number;
  suggestedReorderQty: number;
  daysOfCover: number | null;
  urgency: Urgency;
};

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

const toSuggestionRow = (row: VelocityRow, rangeDays: number): SuggestionRow => {
  const dailyDemand = rangeDays > 0 ? row.quantitySold / rangeDays : 0;
  const targetCoverageDays = 30;
  const targetStockQty = Math.max(0, Math.ceil(dailyDemand * targetCoverageDays));
  const suggestedReorderQty = Math.max(0, targetStockQty - Math.max(0, row.currentOnHand));
  const daysOfCover = dailyDemand > 0 ? Number((row.currentOnHand / dailyDemand).toFixed(1)) : null;

  let urgency: Urgency = "Low";
  if (suggestedReorderQty > 0 && (row.currentOnHand <= 0 || (daysOfCover !== null && daysOfCover <= 7))) {
    urgency = "Reorder Now";
  } else if (suggestedReorderQty > 0 || (daysOfCover !== null && daysOfCover <= 14)) {
    urgency = "Reorder Soon";
  }

  return {
    ...row,
    targetStockQty,
    suggestedReorderQty,
    daysOfCover,
    urgency,
  };
};

const urgencyRank: Record<Urgency, number> = {
  "Reorder Now": 3,
  "Reorder Soon": 2,
  Low: 1,
};

export const ReorderSuggestionsPage = () => {
  const { error } = useToasts();

  const [rangePreset, setRangePreset] = useState<RangePreset>("90");
  const [report, setReport] = useState<VelocityResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const loadReport = async () => {
    setLoading(true);
    try {
      const today = new Date();
      const to = formatDateKey(today);
      const from = formatDateKey(shiftDays(today, -(Number(rangePreset) - 1)));
      const payload = await apiGet<VelocityResponse>(`/api/reports/inventory/velocity?from=${from}&to=${to}&take=100`);
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
  }, [rangePreset]);

  const suggestionRows = useMemo(() => {
    if (!report) {
      return [] as SuggestionRow[];
    }

    return report.products
      .map((row) => toSuggestionRow(row, report.filters.rangeDays))
      .filter((row) => row.quantitySold > 0 || row.currentOnHand <= 0)
      .sort((left, right) => (
        urgencyRank[right.urgency] - urgencyRank[left.urgency]
        || right.suggestedReorderQty - left.suggestedReorderQty
        || right.quantitySold - left.quantitySold
        || left.productName.localeCompare(right.productName)
      ));
  }, [report]);

  const reorderNowCount = suggestionRows.filter((row) => row.urgency === "Reorder Now").length;
  const reorderSoonCount = suggestionRows.filter((row) => row.urgency === "Reorder Soon").length;

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Reorder Suggestions</h1>
            <p className="muted-text">
              Manager-facing reorder suggestions derived from current on-hand and recent sales. This v1 uses a simple 30-day stock coverage heuristic and does not assume supplier lead times.
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
            <button type="button" onClick={() => void loadReport()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Reorder Now</span>
            <strong className="metric-value">{reorderNowCount}</strong>
            <span className="dashboard-metric-detail">Zero or critically low stock coverage</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Reorder Soon</span>
            <strong className="metric-value">{reorderSoonCount}</strong>
            <span className="dashboard-metric-detail">Low coverage with recent demand</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Candidates</span>
            <strong className="metric-value">{suggestionRows.length}</strong>
            <span className="dashboard-metric-detail">Sorted by urgency and shortfall</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Heuristic</span>
            <strong className="metric-value">30 days</strong>
            <span className="dashboard-metric-detail">Target stock coverage window</span>
          </div>
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>Suggested Reorder Candidates</h2>
            <Link to="/management">Back to management</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Urgency</th>
                  <th>On Hand</th>
                  <th>Sold</th>
                  <th>Velocity / 30d</th>
                  <th>Days Cover</th>
                  <th>Target Qty</th>
                  <th>Suggested Reorder</th>
                </tr>
              </thead>
              <tbody>
                {suggestionRows.length ? suggestionRows.map((row) => (
                  <tr key={row.productId}>
                    <td>{row.productName}</td>
                    <td>{row.urgency}</td>
                    <td>{row.currentOnHand}</td>
                    <td>{row.quantitySold}</td>
                    <td>{row.velocityPer30Days.toFixed(1)}</td>
                    <td>{row.daysOfCover === null ? "-" : row.daysOfCover.toFixed(1)}</td>
                    <td>{row.targetStockQty}</td>
                    <td>{row.suggestedReorderQty}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={8}>No reorder candidates for this range.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="muted-text">Suggested reorder quantity = 30-day target stock minus current on-hand, capped at zero.</p>
        </section>
      </div>
    </div>
  );
};
