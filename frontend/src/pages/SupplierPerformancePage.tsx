import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";

type RangePreset = "30" | "90" | "365";

type SupplierRow = {
  supplierId: string;
  supplierName: string;
  purchaseOrderCount: number;
  quantityOrdered: number;
  quantityReceived: number;
  quantityRemaining: number;
  orderedValuePence: number;
  receivedValuePence: number;
  fillRate: number;
  draftCount: number;
  sentCount: number;
  partiallyReceivedCount: number;
  receivedCount: number;
  cancelledCount: number;
  overdueOpenCount: number;
  latestPurchaseOrderAt: string | null;
};

type SupplierPerformanceResponse = {
  summary: {
    supplierCount: number;
    purchaseOrderCount: number;
    orderedValuePence: number;
    receivedValuePence: number;
    overdueOpenCount: number;
  };
  topSuppliers: SupplierRow[];
  suppliers: SupplierRow[];
  revenueContributionSupported: boolean;
  leadTimeSupported: boolean;
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

export const SupplierPerformancePage = () => {
  const { error } = useToasts();

  const [rangePreset, setRangePreset] = useState<RangePreset>("90");
  const [report, setReport] = useState<SupplierPerformanceResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const loadReport = async () => {
    setLoading(true);
    try {
      const today = new Date();
      const to = formatDateKey(today);
      const from = formatDateKey(shiftDays(today, -(Number(rangePreset) - 1)));
      const payload = await apiGet<SupplierPerformanceResponse>(`/api/reports/suppliers/performance?from=${from}&to=${to}&take=10`);
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
  }, [rangePreset]);

  const bestSupplier = useMemo(() => report?.topSuppliers[0] ?? null, [report]);

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Supplier Performance</h1>
            <p className="muted-text">
              Manager-facing supplier and purchasing summary built from existing suppliers, purchase orders, and receiving totals.
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
            <span className="metric-label">Suppliers Active In Range</span>
            <strong className="metric-value">{report?.summary.supplierCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Suppliers with purchase order activity</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Purchase Orders</span>
            <strong className="metric-value">{report?.summary.purchaseOrderCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Created in the selected range</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Ordered Value</span>
            <strong className="metric-value">{formatMoney(report?.summary.orderedValuePence ?? 0)}</strong>
            <span className="dashboard-metric-detail">Based on unit costs where present</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Top Supplier</span>
            <strong className="metric-value">{bestSupplier?.supplierName ?? "-"}</strong>
            <span className="dashboard-metric-detail">
              {bestSupplier ? `${bestSupplier.purchaseOrderCount} POs | ${formatMoney(bestSupplier.orderedValuePence)}` : "No data"}
            </span>
          </div>
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>Top Suppliers</h2>
            <Link to="/management">Back to management</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>POs</th>
                  <th>Ordered</th>
                  <th>Received</th>
                  <th>Fill Rate</th>
                  <th>Overdue Open</th>
                </tr>
              </thead>
              <tbody>
                {report?.topSuppliers.length ? report.topSuppliers.map((row) => (
                  <tr key={row.supplierId}>
                    <td>{row.supplierName}</td>
                    <td>{row.purchaseOrderCount}</td>
                    <td>{formatMoney(row.orderedValuePence)}</td>
                    <td>{formatMoney(row.receivedValuePence)}</td>
                    <td>{formatPercent(row.fillRate)}</td>
                    <td>{row.overdueOpenCount}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={6}>No supplier activity for this range.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Supplier Summary</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>POs</th>
                  <th>Qty Ordered</th>
                  <th>Qty Received</th>
                  <th>Qty Remaining</th>
                  <th>Latest PO</th>
                </tr>
              </thead>
              <tbody>
                {report?.suppliers.length ? report.suppliers.map((row) => (
                  <tr key={row.supplierId}>
                    <td>{row.supplierName}</td>
                    <td>{row.purchaseOrderCount}</td>
                    <td>{row.quantityOrdered}</td>
                    <td>{row.quantityReceived}</td>
                    <td>{row.quantityRemaining}</td>
                    <td>{row.latestPurchaseOrderAt ? new Date(row.latestPurchaseOrderAt).toLocaleString() : "-"}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={6}>No supplier summary available.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Receiving Activity Snapshot</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Draft</th>
                  <th>Sent</th>
                  <th>Part Received</th>
                  <th>Received</th>
                  <th>Cancelled</th>
                </tr>
              </thead>
              <tbody>
                {report?.suppliers.length ? report.suppliers.map((row) => (
                  <tr key={row.supplierId}>
                    <td>{row.supplierName}</td>
                    <td>{row.draftCount}</td>
                    <td>{row.sentCount}</td>
                    <td>{row.partiallyReceivedCount}</td>
                    <td>{row.receivedCount}</td>
                    <td>{row.cancelledCount}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={6}>No receiving activity available.</td>
                  </tr>
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
            Supplier revenue contribution and lead-time analytics are intentionally omitted in M90 v1 because the current branch does not link suppliers directly to sales revenue and does not store receipt timestamps robustly enough for honest lead-time metrics.
          </div>
        </section>
      </div>
    </div>
  );
};
