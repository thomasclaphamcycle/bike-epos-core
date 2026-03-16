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

type SupplierCostHistoryRow = {
  supplierId: string;
  supplierName: string;
  variantId: string;
  productName: string;
  variantName: string | null;
  sku: string;
  currentUnitCostPence: number;
  currentRecordedAt: string;
  currentPurchaseOrderId: string;
  currentPurchaseOrderNumber: string;
  previousUnitCostPence: number | null;
  previousRecordedAt: string | null;
  previousPurchaseOrderId: string | null;
  previousPurchaseOrderNumber: string | null;
  supplierLinkCostPence: number | null;
  preferredSupplierLink: boolean;
  changePence: number | null;
};

type SupplierCostHistoryResponse = {
  generatedAt: string;
  summary: {
    trackedSupplierVariantCount: number;
    changedSupplierVariantCount: number;
    costIncreaseCount: number;
    costDecreaseCount: number;
    preferredSupplierLinkCount: number;
  };
  items: SupplierCostHistoryRow[];
};

const formatMoney = (pence: number | null) =>
  pence === null ? "-" : `£${(pence / 100).toFixed(2)}`;

export const SupplierPerformancePage = () => {
  const { error } = useToasts();
  const [report, setReport] = useState<SupplierPerformanceResponse | null>(null);
  const [costHistory, setCostHistory] = useState<SupplierCostHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const loadReport = async () => {
    setLoading(true);
    try {
      const [performancePayload, costHistoryPayload] = await Promise.all([
        apiGet<SupplierPerformanceResponse>("/api/reports/suppliers/performance"),
        apiGet<SupplierCostHistoryResponse>("/api/reports/suppliers/cost-history?take=8"),
      ]);
      setReport(performancePayload);
      setCostHistory(costHistoryPayload);
    } catch (loadError) {
      setReport(null);
      setCostHistory(null);
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
          <div className="metric-card">
            <span className="metric-label">Recent Cost Changes</span>
            <strong className="metric-value">{costHistory?.summary.changedSupplierVariantCount ?? 0}</strong>
            <span className="dashboard-metric-detail">
              Increases {costHistory?.summary.costIncreaseCount ?? 0} | Decreases {costHistory?.summary.costDecreaseCount ?? 0}
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

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Recent Supplier Cost History</h2>
            <p className="muted-text">
              Latest known PO cost against the previous recorded cost for the same supplier and variant, with the current supplier link shown for comparison.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/management/catalogue">Supplier links</Link>
            <Link to="/purchasing/receiving">Receiving workspace</Link>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Supplier / Variant</th>
                <th>Current Cost</th>
                <th>Previous Cost</th>
                <th>Change</th>
                <th>Supplier Link</th>
              </tr>
            </thead>
            <tbody>
              {costHistory?.items.length ? costHistory.items.map((row) => (
                <tr key={`${row.supplierId}:${row.variantId}`}>
                  <td>
                    <div className="table-primary">{row.supplierName}</div>
                    <div className="table-secondary">{row.productName} · {row.variantName || row.sku}</div>
                    <div className="table-secondary mono-text">{row.currentPurchaseOrderNumber}</div>
                  </td>
                  <td>
                    <div className="table-primary">{formatMoney(row.currentUnitCostPence)}</div>
                    <div className="table-secondary">{new Date(row.currentRecordedAt).toLocaleDateString()}</div>
                  </td>
                  <td>
                    <div className="table-primary">{formatMoney(row.previousUnitCostPence)}</div>
                    <div className="table-secondary">
                      {row.previousRecordedAt ? new Date(row.previousRecordedAt).toLocaleDateString() : "No earlier recorded cost"}
                    </div>
                  </td>
                  <td>
                    {row.changePence === null ? (
                      <span className="muted-text">No change recorded yet</span>
                    ) : (
                      <span className={row.changePence > 0 ? "movement-negative" : row.changePence < 0 ? "movement-positive" : ""}>
                        {formatMoney(row.changePence)}
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="table-primary">{formatMoney(row.supplierLinkCostPence)}</div>
                    <div className="table-secondary">
                      {row.preferredSupplierLink ? "Preferred supplier link" : "Active supplier link"}
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={5}>
                    {loading ? "Loading supplier cost history..." : "No supplier cost history is available yet. Receive purchase orders with recorded unit cost to build this view."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
