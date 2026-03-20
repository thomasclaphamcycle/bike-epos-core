import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { reorderUrgencyRank, toReorderSuggestionRow } from "../utils/reordering";
import {
  isWorkshopAwaitingApproval,
  isWorkshopWaitingForParts,
} from "../utils/workshopStatus";

type RangePreset = "30" | "90";

type VelocityRow = {
  productId: string;
  productName: string;
  currentOnHand: number;
  quantitySold: number;
  velocityPer30Days: number;
  lastSoldAt: string | null;
};

type VelocityResponse = {
  filters: {
    from: string;
    to: string;
    take: number;
    rangeDays: number;
  };
  products: VelocityRow[];
};

type WorkshopDashboardResponse = {
  jobs: Array<{
    id: string;
    status: string;
    executionStatus?: string | null;
    currentEstimateStatus?: string | null;
    scheduledDate: string | null;
    partsStatus?: "OK" | "UNALLOCATED" | "SHORT";
    customer: { firstName: string; lastName: string } | null;
  }>;
};

type PurchaseOrder = {
  id: string;
  status: "DRAFT" | "SENT" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";
  expectedAt: string | null;
  supplier: { name: string };
  totals: { quantityRemaining: number };
};

type PurchaseOrderListResponse = { purchaseOrders: PurchaseOrder[] };

type RefundRow = {
  id: string;
  saleId: string;
  totalPence: number;
  cashTenderPence: number;
  completedAt: string | null;
  customer: { name: string } | null;
};

type RefundListResponse = { refunds: RefundRow[] };

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

const formatCustomerName = (customer: { firstName: string; lastName: string } | null) =>
  customer ? [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "-" : "-";

export const AlertsCentrePage = () => {
  const { error } = useToasts();
  const [rangePreset, setRangePreset] = useState<RangePreset>("30");
  const [velocity, setVelocity] = useState<VelocityResponse | null>(null);
  const [workshop, setWorkshop] = useState<WorkshopDashboardResponse | null>(null);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [loading, setLoading] = useState(false);

  const loadAlerts = async () => {
    setLoading(true);
    const today = new Date();
    const to = formatDateKey(today);
    const from = formatDateKey(shiftDays(today, -(Number(rangePreset) - 1)));

    const [velocityResult, workshopResult, poResult, refundResult] = await Promise.allSettled([
      apiGet<VelocityResponse>(`/api/reports/inventory/velocity?from=${from}&to=${to}&take=50`),
      apiGet<WorkshopDashboardResponse>("/api/workshop/dashboard?limit=100"),
      apiGet<PurchaseOrderListResponse>("/api/purchase-orders?take=100&skip=0"),
      apiGet<RefundListResponse>(`/api/refunds?from=${from}&to=${to}`),
    ]);

    if (velocityResult.status === "fulfilled") {
      setVelocity(velocityResult.value);
    } else {
      setVelocity(null);
      error(velocityResult.reason instanceof Error ? velocityResult.reason.message : "Failed to load stock alerts");
    }

    if (workshopResult.status === "fulfilled") {
      setWorkshop(workshopResult.value);
    } else {
      setWorkshop(null);
      error(workshopResult.reason instanceof Error ? workshopResult.reason.message : "Failed to load workshop alerts");
    }

    if (poResult.status === "fulfilled") {
      setPurchaseOrders(poResult.value.purchaseOrders || []);
    } else {
      setPurchaseOrders([]);
      error(poResult.reason instanceof Error ? poResult.reason.message : "Failed to load purchasing alerts");
    }

    if (refundResult.status === "fulfilled") {
      setRefunds(refundResult.value.refunds || []);
    } else {
      setRefunds([]);
      error(refundResult.reason instanceof Error ? refundResult.reason.message : "Failed to load refund alerts");
    }

    setLoading(false);
  };

  useEffect(() => {
    void loadAlerts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangePreset]);

  const reorderSuggestions = useMemo(() => {
    if (!velocity) {
      return [];
    }
    return velocity.products
      .map((row) => toReorderSuggestionRow(row, velocity.filters.rangeDays))
      .filter((row) => row.currentOnHand <= 2 || row.urgency !== "Low")
      .sort((left, right) => (
        reorderUrgencyRank[right.urgency] - reorderUrgencyRank[left.urgency]
        || left.currentOnHand - right.currentOnHand
        || right.quantitySold - left.quantitySold
      ));
  }, [velocity]);

  const lowStockItems = reorderSuggestions.filter((row) => row.currentOnHand <= 2).slice(0, 10);
  const reorderNowItems = reorderSuggestions.filter((row) => row.urgency === "Reorder Now").slice(0, 10);
  const awaitingApproval = (workshop?.jobs || []).filter(isWorkshopAwaitingApproval);
  const waitingForParts = (workshop?.jobs || []).filter(isWorkshopWaitingForParts);
  const overduePurchaseOrders = purchaseOrders
    .filter((po) => po.status !== "RECEIVED" && po.status !== "CANCELLED")
    .filter((po) => po.expectedAt && new Date(po.expectedAt).getTime() < Date.now())
    .sort((left, right) => new Date(left.expectedAt || left.id).getTime() - new Date(right.expectedAt || right.id).getTime())
    .slice(0, 10);

  const averageRefundPence = refunds.length > 0
    ? Math.round(refunds.reduce((sum, refund) => sum + refund.totalPence, 0) / refunds.length)
    : 0;
  const refundAttention = refunds
    .filter((refund) => refund.totalPence >= averageRefundPence && refund.totalPence > 0)
    .sort((left, right) => right.totalPence - left.totalPence)
    .slice(0, 10);
  const totalAttentionCount = lowStockItems.length
    + reorderNowItems.length
    + awaitingApproval.length
    + waitingForParts.length
    + overduePurchaseOrders.length
    + refundAttention.length;

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Alerts Centre</h1>
            <p className="muted-text">
              Operational attention derived from current stock, workshop, purchasing, and refund data. Use it as a manager watchlist for trial walkthroughs and daily checks, not as a push-notification system.
            </p>
          </div>
          <div className="actions-inline">
            <label>
              Range
              <select value={rangePreset} onChange={(event) => setRangePreset(event.target.value as RangePreset)}>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </select>
            </label>
            <Link to="/management">Back to management</Link>
            <button type="button" onClick={() => void loadAlerts()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Low Stock Alerts</span>
            <strong className="metric-value">{lowStockItems.length}</strong>
            <span className="dashboard-metric-detail">Items with on-hand at 2 or below</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Reorder Now</span>
            <strong className="metric-value">{reorderNowItems.length}</strong>
            <span className="dashboard-metric-detail">Derived from recent demand and stock cover</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Workshop Attention</span>
            <strong className="metric-value">{awaitingApproval.length + waitingForParts.length}</strong>
            <span className="dashboard-metric-detail">Approval and parts-blocked jobs</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Purchasing Attention</span>
            <strong className="metric-value">{overduePurchaseOrders.length}</strong>
            <span className="dashboard-metric-detail">Overdue open purchase orders</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Refund Attention</span>
            <strong className="metric-value">{refundAttention.length}</strong>
            <span className="dashboard-metric-detail">Large refunds in range</span>
          </div>
        </div>
      </section>

      {!loading && totalAttentionCount === 0 ? (
        <section className="card">
          <p className="muted-text">
            Nothing in the current range needs urgent attention. Open reordering, workshop, or the operations summary if you want to review those areas manually.
          </p>
          <div className="actions-inline">
            <Link to="/management/reordering">Reordering</Link>
            <Link to="/workshop">Workshop</Link>
            <Link to="/management/summary">Operations summary</Link>
          </div>
        </section>
      ) : null}

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>Stock Alerts</h2>
            <Link to="/management/reordering">Open reordering</Link>
          </div>
          <div className="alert-grid">
            <div className="alert-panel">
              <h3>Low Stock</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>On Hand</th>
                      <th>Urgency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lowStockItems.length ? lowStockItems.map((row) => (
                      <tr key={row.productId}>
                        <td>{row.productName}</td>
                        <td>{row.currentOnHand}</td>
                        <td>{row.urgency}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={3}>No low-stock alerts in range. Open Inventory for a manual lookup if you still want to inspect stock.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="alert-panel">
              <h3>Reorder Now</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Suggested Qty</th>
                      <th>Days Cover</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reorderNowItems.length ? reorderNowItems.map((row) => (
                      <tr key={row.productId}>
                        <td>{row.productName}</td>
                        <td>{row.suggestedReorderQty}</td>
                        <td>{row.daysOfCover === null ? "-" : row.daysOfCover.toFixed(1)}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={3}>No reorder-now candidates in range. Open Reordering for the full buying list and open PO context.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Workshop Alerts</h2>
            <Link to="/workshop">Open workshop</Link>
          </div>
          <div className="alert-grid">
            <div className="alert-panel">
              <h3>Waiting for Approval</h3>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Job</th><th>Customer</th><th>Promised</th></tr></thead>
                  <tbody>
                    {awaitingApproval.length ? awaitingApproval.slice(0, 10).map((job) => (
                      <tr key={job.id}>
                        <td><Link to={`/workshop/${job.id}`}>{job.id.slice(0, 8)}</Link></td>
                        <td>{formatCustomerName(job.customer)}</td>
                        <td>{job.scheduledDate ? new Date(job.scheduledDate).toLocaleDateString() : "-"}</td>
                      </tr>
                    )) : <tr><td colSpan={3}>No jobs are waiting for approval. Open Workshop to review the wider live board.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="alert-panel">
              <h3>Waiting for Parts</h3>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Job</th><th>Customer</th><th>Parts Status</th></tr></thead>
                  <tbody>
                    {waitingForParts.length ? waitingForParts.slice(0, 10).map((job) => (
                      <tr key={job.id}>
                        <td><Link to={`/workshop/${job.id}`}>{job.id.slice(0, 8)}</Link></td>
                        <td>{formatCustomerName(job.customer)}</td>
                        <td>{job.partsStatus ?? job.status}</td>
                      </tr>
                    )) : <tr><td colSpan={3}>No jobs are currently blocked by parts. Open Workshop if you need to inspect jobs manually.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Purchasing & Refund Attention</h2>
            <Link to="/management/summary">Open ops summary</Link>
          </div>
          <div className="alert-grid">
            <div className="alert-panel">
              <h3>Overdue Purchase Orders</h3>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>PO</th><th>Supplier</th><th>Expected</th></tr></thead>
                  <tbody>
                    {overduePurchaseOrders.length ? overduePurchaseOrders.map((po) => (
                      <tr key={po.id}>
                        <td><Link to={`/purchasing/${po.id}`}>{po.id.slice(0, 8)}</Link></td>
                        <td>{po.supplier.name}</td>
                        <td>{po.expectedAt ? new Date(po.expectedAt).toLocaleDateString() : "-"}</td>
                      </tr>
                    )) : <tr><td colSpan={3}>No overdue purchase orders are visible. Open Purchasing to review open and partially received orders.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="alert-panel">
              <h3>Refund Attention</h3>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Refund</th><th>Customer</th><th>Total</th></tr></thead>
                  <tbody>
                    {refundAttention.length ? refundAttention.map((refund) => (
                      <tr key={refund.id}>
                        <td className="mono-text">{refund.id.slice(0, 8)}</td>
                        <td>{refund.customer?.name ?? "-"}</td>
                        <td>{formatMoney(refund.totalPence)}</td>
                      </tr>
                    )) : <tr><td colSpan={3}>No refund attention items in range. Open Cash Management if you want to review refunds directly.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
