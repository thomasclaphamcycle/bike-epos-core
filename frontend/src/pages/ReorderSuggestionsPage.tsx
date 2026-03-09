import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { SavedViewControls } from "../components/SavedViewControls";
import { useToasts } from "../components/ToastProvider";
import { ReorderSuggestionRow, reorderUrgencyRank, toReorderSuggestionRow } from "../utils/reordering";

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

export const ReorderSuggestionsPage = () => {
  const { error } = useToasts();

  const [rangePreset, setRangePreset] = useState<RangePreset>("90");
  const [report, setReport] = useState<VelocityResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const applySavedFilters = (filters: Record<string, string>) => {
    if (filters.rangePreset === "30" || filters.rangePreset === "90" || filters.rangePreset === "365") {
      setRangePreset(filters.rangePreset);
    }
  };

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
      return [] as ReorderSuggestionRow[];
    }

    return report.products
      .map((row) => toReorderSuggestionRow(row, report.filters.rangeDays))
      .filter((row) => row.quantitySold > 0 || row.currentOnHand <= 0)
      .sort((left, right) => (
        reorderUrgencyRank[right.urgency] - reorderUrgencyRank[left.urgency]
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

      <SavedViewControls
        pageKey="reordering"
        currentFilters={{ rangePreset }}
        onApplyFilters={applySavedFilters}
        defaultName={`Reordering ${rangePreset}d`}
      />

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
