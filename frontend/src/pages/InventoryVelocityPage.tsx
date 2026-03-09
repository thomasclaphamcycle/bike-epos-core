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
  grossRevenuePence: number;
  velocityPer30Days: number;
  sellThroughRate: number;
  lastSoldAt: string | null;
};

type VelocityResponse = {
  summary: {
    trackedProductCount: number;
    productsWithSales: number;
    deadStockCount: number;
    totalOnHand: number;
  };
  fastMovingProducts: VelocityRow[];
  slowMovingProducts: VelocityRow[];
  deadStockCandidates: VelocityRow[];
  products: VelocityRow[];
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

const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

export const InventoryVelocityPage = () => {
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
      const payload = await apiGet<VelocityResponse>(`/api/reports/inventory/velocity?from=${from}&to=${to}&take=10`);
      setReport(payload);
    } catch (loadError) {
      setReport(null);
      error(loadError instanceof Error ? loadError.message : "Failed to load inventory velocity");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangePreset]);

  const fastest = useMemo(() => report?.fastMovingProducts[0] ?? null, [report]);

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Inventory Velocity</h1>
            <p className="muted-text">
              Manager-facing inventory movement signals derived from sales volume and current on-hand. This is practical velocity reporting, not forecasting.
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
            <span className="metric-label">Tracked Products</span>
            <strong className="metric-value">{report?.summary.trackedProductCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Products with stock or sales signals</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Products With Sales</span>
            <strong className="metric-value">{report?.summary.productsWithSales ?? 0}</strong>
            <span className="dashboard-metric-detail">In the selected range</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Dead Stock Candidates</span>
            <strong className="metric-value">{report?.summary.deadStockCount ?? 0}</strong>
            <span className="dashboard-metric-detail">On hand with zero sold units</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Fastest Product</span>
            <strong className="metric-value">{fastest?.productName ?? "-"}</strong>
            <span className="dashboard-metric-detail">
              {fastest ? `${fastest.quantitySold} sold | ${fastest.currentOnHand} on hand` : "No data"}
            </span>
          </div>
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>Fast-Moving Products</h2>
            <Link to="/management">Back to management</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Units Sold</th>
                  <th>On Hand</th>
                  <th>Velocity / 30d</th>
                  <th>Sell Through</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {report?.fastMovingProducts.length ? report.fastMovingProducts.map((row) => (
                  <tr key={row.productId}>
                    <td>{row.productName}</td>
                    <td>{row.quantitySold}</td>
                    <td>{row.currentOnHand}</td>
                    <td>{row.velocityPer30Days.toFixed(1)}</td>
                    <td>{formatPercent(row.sellThroughRate)}</td>
                    <td>{formatMoney(row.grossRevenuePence)}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={6}>No fast-moving products for this range.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Slow-Moving Products</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Units Sold</th>
                  <th>On Hand</th>
                  <th>Velocity / 30d</th>
                  <th>Sell Through</th>
                  <th>Last Sold</th>
                </tr>
              </thead>
              <tbody>
                {report?.slowMovingProducts.length ? report.slowMovingProducts.map((row) => (
                  <tr key={row.productId}>
                    <td>{row.productName}</td>
                    <td>{row.quantitySold}</td>
                    <td>{row.currentOnHand}</td>
                    <td>{row.velocityPer30Days.toFixed(1)}</td>
                    <td>{formatPercent(row.sellThroughRate)}</td>
                    <td>{row.lastSoldAt ? new Date(row.lastSoldAt).toLocaleString() : "-"}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={6}>No slow-moving products for this range.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Dead Stock Candidates</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>On Hand</th>
                  <th>Units Sold</th>
                  <th>Velocity / 30d</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {report?.deadStockCandidates.length ? report.deadStockCandidates.map((row) => (
                  <tr key={row.productId}>
                    <td>{row.productName}</td>
                    <td>{row.currentOnHand}</td>
                    <td>{row.quantitySold}</td>
                    <td>{row.velocityPer30Days.toFixed(1)}</td>
                    <td>{formatMoney(row.grossRevenuePence)}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5}>No dead stock candidates in this range.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="muted-text">Dead stock candidates are products with current on-hand and zero sold units in the selected range.</p>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Velocity Signals</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Units Sold</th>
                  <th>On Hand</th>
                  <th>Velocity / 30d</th>
                  <th>Sell Through</th>
                </tr>
              </thead>
              <tbody>
                {report?.products.length ? report.products.map((row) => (
                  <tr key={row.productId}>
                    <td>{row.productName}</td>
                    <td>{row.quantitySold}</td>
                    <td>{row.currentOnHand}</td>
                    <td>{row.velocityPer30Days.toFixed(1)}</td>
                    <td>{formatPercent(row.sellThroughRate)}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5}>No product velocity signals available.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};
