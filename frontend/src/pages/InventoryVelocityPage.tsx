import { CSSProperties, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";

type VelocityClass = "FAST_MOVER" | "NORMAL" | "SLOW_MOVER" | "DEAD_STOCK";

type VelocityRow = {
  variantId: string;
  productName: string;
  sku: string;
  onHand: number;
  sales30Days: number;
  sales90Days: number;
  velocityClass: VelocityClass;
};

type VelocityResponse = {
  generatedAt: string;
  items: VelocityRow[];
};

const rowAccent: Record<VelocityClass, CSSProperties> = {
  FAST_MOVER: { backgroundColor: "rgba(84, 166, 74, 0.14)" },
  NORMAL: {},
  SLOW_MOVER: { backgroundColor: "rgba(214, 148, 34, 0.14)" },
  DEAD_STOCK: { backgroundColor: "rgba(194, 58, 58, 0.14)" },
};

const badgeClass: Record<VelocityClass, string> = {
  FAST_MOVER: "status-badge status-complete",
  NORMAL: "status-badge",
  SLOW_MOVER: "status-badge status-warning",
  DEAD_STOCK: "status-badge status-cancelled",
};

export const InventoryVelocityPage = () => {
  const { error } = useToasts();
  const [report, setReport] = useState<VelocityResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const loadReport = async () => {
    setLoading(true);
    try {
      const payload = await apiGet<VelocityResponse>("/api/reports/inventory-velocity");
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
  }, []);

  const summary = useMemo(() => ({
    fast: report?.items.filter((row) => row.velocityClass === "FAST_MOVER").length ?? 0,
    normal: report?.items.filter((row) => row.velocityClass === "NORMAL").length ?? 0,
    slow: report?.items.filter((row) => row.velocityClass === "SLOW_MOVER").length ?? 0,
    dead: report?.items.filter((row) => row.velocityClass === "DEAD_STOCK").length ?? 0,
  }), [report]);

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Inventory Velocity</h1>
            <p className="muted-text">
              Manager-facing stock movement report using 30-day sales, 90-day sales, and current on-hand stock.
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
            <span className="metric-label">Fast Movers</span>
            <strong className="metric-value">{summary.fast}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Normal</span>
            <strong className="metric-value">{summary.normal}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Slow Movers</span>
            <strong className="metric-value">{summary.slow}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Dead Stock</span>
            <strong className="metric-value">{summary.dead}</strong>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Velocity Classification</h2>
            <p className="muted-text">
              Fast mover: 10+ sold in 30 days. Normal: 3-9. Slow mover: 1-2. Dead stock: no sales in 90 days with stock on hand.
            </p>
          </div>
          <Link to="/inventory">Inventory</Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>SKU</th>
                <th>On Hand</th>
                <th>Sales (30d)</th>
                <th>Sales (90d)</th>
                <th>Velocity Class</th>
              </tr>
            </thead>
            <tbody>
              {report?.items.length ? report.items.map((row) => (
                <tr key={row.variantId} style={rowAccent[row.velocityClass]}>
                  <td>
                    <div className="table-primary">{row.productName}</div>
                    <div className="table-secondary">
                      <Link to={`/inventory/${row.variantId}`}>Open inventory item</Link>
                    </div>
                  </td>
                  <td className="mono-text">{row.sku}</td>
                  <td>{row.onHand}</td>
                  <td>{row.sales30Days}</td>
                  <td>{row.sales90Days}</td>
                  <td><span className={badgeClass[row.velocityClass]}>{row.velocityClass}</span></td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6}>{loading ? "Loading inventory velocity..." : "No inventory velocity rows available."}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
