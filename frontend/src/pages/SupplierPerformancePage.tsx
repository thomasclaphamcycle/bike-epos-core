import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";

type SupplierRow = {
  supplierId: string;
  supplierName: string;
  purchaseOrderCount: number;
  openPurchaseOrderCount: number;
  partiallyReceivedCount: number;
  receivedPurchaseOrderCount: number;
  overdueOpenPurchaseOrderCount: number;
  totalOrderedQuantity: number;
  totalReceivedQuantity: number;
};

type SupplierPerformanceResponse = {
  generatedAt: string;
  summary: {
    supplierCount: number;
    purchaseOrderCount: number;
    openPurchaseOrderCount: number;
    overdueOpenPurchaseOrderCount: number;
    totalOrderedQuantity: number;
    totalReceivedQuantity: number;
  };
  suppliers: SupplierRow[];
};

export const SupplierPerformancePage = () => {
  const { error } = useToasts();
  const [report, setReport] = useState<SupplierPerformanceResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const loadReport = async () => {
    setLoading(true);
    try {
      const payload = await apiGet<SupplierPerformanceResponse>("/api/reports/suppliers/performance");
      setReport(payload);
    } catch (loadError) {
      setReport(null);
      error(loadError instanceof Error ? loadError.message : "Failed to load supplier performance");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const topOverdueSupplier = useMemo(
    () => report?.suppliers.find((row) => row.overdueOpenPurchaseOrderCount > 0) ?? report?.suppliers[0] ?? null,
    [report],
  );

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Supplier Performance</h1>
            <p className="muted-text">
              Practical manager view of supplier activity using current purchase order and receiving totals only.
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
            <span className="metric-label">Suppliers</span>
            <strong className="metric-value">{report?.summary.supplierCount ?? 0}</strong>
            <span className="dashboard-metric-detail">With purchase order history</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Open POs</span>
            <strong className="metric-value">{report?.summary.openPurchaseOrderCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Sent or partially received</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Overdue Open</span>
            <strong className="metric-value">{report?.summary.overdueOpenPurchaseOrderCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Expected date has passed</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Priority Supplier</span>
            <strong className="metric-value">{topOverdueSupplier?.supplierName ?? "-"}</strong>
            <span className="dashboard-metric-detail">
              {topOverdueSupplier
                ? `${topOverdueSupplier.overdueOpenPurchaseOrderCount} overdue | ${topOverdueSupplier.openPurchaseOrderCount} open`
                : "No supplier activity"}
            </span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Supplier Operations</h2>
            <p className="muted-text">
              Use this to decide who needs chasing, who is still receiving against open orders, and who is actively supplying stock.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/suppliers">Suppliers</Link>
            <Link to="/management">Management</Link>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Open POs</th>
                <th>Partially Received</th>
                <th>Received</th>
                <th>Overdue</th>
                <th>Total Ordered</th>
                <th>Total Received</th>
              </tr>
            </thead>
            <tbody>
              {report?.suppliers.length ? report.suppliers.map((row) => (
                <tr key={row.supplierId}>
                  <td>
                    <div className="table-primary">{row.supplierName}</div>
                    <div className="table-secondary">
                      {row.purchaseOrderCount} total POs | <Link to="/purchasing">Open purchasing</Link>
                    </div>
                  </td>
                  <td>{row.openPurchaseOrderCount}</td>
                  <td>{row.partiallyReceivedCount}</td>
                  <td>{row.receivedPurchaseOrderCount}</td>
                  <td>{row.overdueOpenPurchaseOrderCount}</td>
                  <td>{row.totalOrderedQuantity}</td>
                  <td>{row.totalReceivedQuantity}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={7}>{loading ? "Loading supplier performance..." : "No supplier performance rows available."}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
