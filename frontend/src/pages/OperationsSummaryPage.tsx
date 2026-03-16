import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";

type SalesDailyRow = {
  date: string;
  saleCount: number;
  grossPence: number;
  refundsPence: number;
  netPence: number;
};

type RefundRow = {
  id: string;
  totalPence: number;
  completedAt: string | null;
  customer: { name: string } | null;
};

type RefundListResponse = {
  refunds: RefundRow[];
};

type WorkshopDashboardResponse = {
  summary: {
    totalJobs: number;
    dueToday: number;
    overdue: number;
    byStatus: Record<string, number>;
  };
  jobs: Array<{
    id: string;
    status: string;
    scheduledDate: string | null;
    partsStatus?: "OK" | "UNALLOCATED" | "SHORT";
    customer: { firstName: string; lastName: string } | null;
  }>;
};

type PurchaseOrder = {
  id: string;
  status: "DRAFT" | "SENT" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";
  expectedAt: string | null;
  createdAt: string;
  supplier: { name: string };
  totals: {
    quantityRemaining: number;
  };
};

type PurchaseOrderListResponse = {
  purchaseOrders: PurchaseOrder[];
};

type InventoryRow = {
  variantId: string;
  productName: string;
  option: string | null;
  onHand: number;
};

type InventorySearchResponse = {
  rows: InventoryRow[];
};

type AuditEvent = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorRole: string | null;
  actorId: string | null;
  createdAt: string;
};

type AuditResponse = {
  events: AuditEvent[];
};

type ActionItem = {
  label: string;
  count: number;
  link: string;
  detail: string;
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const formatDateKey = (value: Date) => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatLabel = (value: string) =>
  value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const OPEN_PO_STATUSES = new Set(["DRAFT", "SENT", "PARTIALLY_RECEIVED"]);
const WORKSHOP_IN_PROGRESS_STATUSES = new Set([
  "BOOKING_MADE",
  "BIKE_ARRIVED",
  "WAITING_FOR_APPROVAL",
  "APPROVED",
  "WAITING_FOR_PARTS",
  "ON_HOLD",
]);

export const OperationsSummaryPage = () => {
  const { error } = useToasts();

  const [salesRow, setSalesRow] = useState<SalesDailyRow | null>(null);
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [workshopDashboard, setWorkshopDashboard] = useState<WorkshopDashboardResponse | null>(null);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [lowestStockRows, setLowestStockRows] = useState<InventoryRow[]>([]);
  const [recentActivity, setRecentActivity] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const loadSummary = async () => {
    setLoading(true);
    try {
      const today = formatDateKey(new Date());
      const [salesResult, refundResult, workshopResult, purchasingResult, inventoryResult, activityResult] = await Promise.allSettled([
        apiGet<SalesDailyRow[]>(`/api/reports/sales/daily?from=${today}&to=${today}`),
        apiGet<RefundListResponse>(`/api/refunds?from=${today}&to=${today}`),
        apiGet<WorkshopDashboardResponse>("/api/workshop/dashboard?limit=50"),
        apiGet<PurchaseOrderListResponse>("/api/purchase-orders?take=100&skip=0"),
        apiGet<InventorySearchResponse>("/api/inventory/on-hand/search?active=1&take=50&skip=0"),
        apiGet<AuditResponse>("/api/audit?limit=8"),
      ]);

      if (salesResult.status === "fulfilled") {
        setSalesRow(salesResult.value[0] ?? {
          date: today,
          saleCount: 0,
          grossPence: 0,
          refundsPence: 0,
          netPence: 0,
        });
      } else {
        setSalesRow(null);
        error(salesResult.reason instanceof Error ? salesResult.reason.message : "Failed to load sales summary");
      }

      if (refundResult.status === "fulfilled") {
        setRefunds(refundResult.value.refunds || []);
      } else {
        setRefunds([]);
        error(refundResult.reason instanceof Error ? refundResult.reason.message : "Failed to load refund summary");
      }

      if (workshopResult.status === "fulfilled") {
        setWorkshopDashboard(workshopResult.value);
      } else {
        setWorkshopDashboard(null);
        error(workshopResult.reason instanceof Error ? workshopResult.reason.message : "Failed to load workshop summary");
      }

      if (purchasingResult.status === "fulfilled") {
        setPurchaseOrders(purchasingResult.value.purchaseOrders || []);
      } else {
        setPurchaseOrders([]);
        error(purchasingResult.reason instanceof Error ? purchasingResult.reason.message : "Failed to load purchasing summary");
      }

      if (inventoryResult.status === "fulfilled") {
        setLowestStockRows(
          [...(inventoryResult.value.rows || [])]
            .sort((left, right) => left.onHand - right.onHand || left.productName.localeCompare(right.productName))
            .slice(0, 8),
        );
      } else {
        setLowestStockRows([]);
        error(inventoryResult.reason instanceof Error ? inventoryResult.reason.message : "Failed to load low stock attention");
      }

      if (activityResult.status === "fulfilled") {
        setRecentActivity(activityResult.value.events || []);
      } else {
        setRecentActivity([]);
        error(activityResult.reason instanceof Error ? activityResult.reason.message : "Failed to load recent activity");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const waitingForApprovalCount = useMemo(
    () => workshopDashboard?.jobs.filter((job) => job.status === "WAITING_FOR_APPROVAL").length ?? 0,
    [workshopDashboard],
  );

  const waitingForPartsCount = useMemo(
    () => workshopDashboard?.jobs.filter((job) => job.status === "WAITING_FOR_PARTS" || job.partsStatus === "SHORT").length ?? 0,
    [workshopDashboard],
  );

  const openPurchaseOrders = useMemo(
    () => purchaseOrders.filter((po) => OPEN_PO_STATUSES.has(po.status)),
    [purchaseOrders],
  );

  const overduePurchaseOrders = useMemo(
    () => openPurchaseOrders.filter((po) => po.expectedAt && new Date(po.expectedAt).getTime() < Date.now()),
    [openPurchaseOrders],
  );

  const lowStockCount = lowestStockRows.filter((row) => row.onHand <= 2).length;
  const criticalStockCount = lowestStockRows.filter((row) => row.onHand <= 0).length;
  const workshopInProgressCount = useMemo(
    () => workshopDashboard?.jobs.filter((job) => WORKSHOP_IN_PROGRESS_STATUSES.has(job.status)).length ?? 0,
    [workshopDashboard],
  );
  const bikesReadyCount = useMemo(
    () => workshopDashboard?.jobs.filter((job) => job.status === "BIKE_READY").length ?? 0,
    [workshopDashboard],
  );

  const actionItems = useMemo<ActionItem[]>(() => [
    {
      label: "Awaiting approval",
      count: waitingForApprovalCount,
      link: "/workshop",
      detail: "Workshop jobs ready for approval follow-up",
    },
    {
      label: "Waiting for parts",
      count: waitingForPartsCount,
      link: "/management/capacity",
      detail: "Jobs blocked by missing or short parts",
    },
    {
      label: "Overdue purchase orders",
      count: overduePurchaseOrders.length,
      link: "/management/purchasing",
      detail: "Open POs past expected date",
    },
    {
      label: "Low stock attention",
      count: lowStockCount,
      link: "/management/reordering",
      detail: "Lowest on-hand items worth reviewing tomorrow",
    },
  ].filter((item) => item.count > 0), [lowStockCount, overduePurchaseOrders.length, waitingForApprovalCount, waitingForPartsCount]);

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Operations Summary</h1>
            <p className="muted-text">
              Daily manager snapshot across sales, refunds, workshop, purchasing, stock risk, and recent activity. Use it as the control-centre view before opening a working queue.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/management">Back to management</Link>
            <button type="button" onClick={() => void loadSummary()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Today's Sales</span>
            <strong className="metric-value">{salesRow ? salesRow.saleCount : "-"}</strong>
            <span className="dashboard-metric-detail">{salesRow ? formatMoney(salesRow.netPence) : "-"}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Today's Refunds</span>
            <strong className="metric-value">{refunds.length}</strong>
            <span className="dashboard-metric-detail">{formatMoney(refunds.reduce((sum, refund) => sum + refund.totalPence, 0))}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Workshop In Progress</span>
            <strong className="metric-value">{workshopInProgressCount}</strong>
            <span className="dashboard-metric-detail">Ready {bikesReadyCount} | Due today {workshopDashboard?.summary.dueToday ?? 0}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Low Stock Attention</span>
            <strong className="metric-value">{lowStockCount}</strong>
            <span className="dashboard-metric-detail">Critical {criticalStockCount}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Open Purchase Orders</span>
            <strong className="metric-value">{openPurchaseOrders.length}</strong>
            <span className="dashboard-metric-detail">Overdue {overduePurchaseOrders.length}</span>
          </div>
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>Daily Snapshot</h2>
          </div>
          <div className="management-stat-grid">
            <div className="management-stat-card">
              <span className="metric-label">Gross Sales</span>
              <strong className="metric-value">{formatMoney(salesRow?.grossPence ?? 0)}</strong>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Refunds Posted</span>
              <strong className="metric-value">{formatMoney(salesRow?.refundsPence ?? 0)}</strong>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Awaiting Approval</span>
              <strong className="metric-value">{waitingForApprovalCount}</strong>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Waiting for Parts</span>
              <strong className="metric-value">{waitingForPartsCount}</strong>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Bikes Ready</span>
              <strong className="metric-value">{bikesReadyCount}</strong>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Open Action Items For Tomorrow</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Count</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {actionItems.length === 0 ? (
                  <tr>
                    <td colSpan={3}>No carried-forward action items detected from current data.</td>
                  </tr>
                ) : (
                  actionItems.map((item) => (
                    <tr key={item.label}>
                      <td><Link to={item.link}>{item.label}</Link></td>
                      <td>{item.count}</td>
                      <td>{item.detail}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Recent Operational Activity</h2>
              <p className="muted-text">
                Latest audit events across sales, workshop, inventory, and admin actions so a manager can verify what changed recently.
              </p>
            </div>
            <Link to="/management/activity">Open full activity</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Actor</th>
                </tr>
              </thead>
              <tbody>
                {recentActivity.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No recent audit events are visible. Open the activity screen for wider filters or older history.</td>
                  </tr>
                ) : (
                  recentActivity.map((event) => (
                    <tr key={event.id}>
                      <td>{new Date(event.createdAt).toLocaleString()}</td>
                      <td>{formatLabel(event.action)}</td>
                      <td>
                        <div className="table-primary">{formatLabel(event.entityType)}</div>
                        <div className="table-secondary mono-text">{event.entityId}</div>
                      </td>
                      <td>{[event.actorRole, event.actorId].filter(Boolean).join(" / ") || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Recent Refunds</h2>
            <Link to="/management/refunds">Open refunds oversight</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Refund</th>
                  <th>Customer</th>
                  <th>Total</th>
                  <th>Completed</th>
                </tr>
              </thead>
              <tbody>
                {refunds.slice(0, 8).length === 0 ? (
                  <tr>
                    <td colSpan={4}>No refunds posted today.</td>
                  </tr>
                ) : (
                  refunds.slice(0, 8).map((refund) => (
                    <tr key={refund.id}>
                      <td className="mono-text">{refund.id.slice(0, 8)}</td>
                      <td>{refund.customer?.name ?? "-"}</td>
                      <td>{formatMoney(refund.totalPence)}</td>
                      <td>{refund.completedAt ? new Date(refund.completedAt).toLocaleString() : "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Purchasing & Stock Attention</h2>
            <Link to="/management/purchasing">Open purchasing action centre</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Supplier / Product</th>
                  <th>Type</th>
                  <th>Attention</th>
                </tr>
              </thead>
              <tbody>
                {overduePurchaseOrders.slice(0, 4).map((po) => (
                  <tr key={po.id}>
                    <td>{po.supplier.name}</td>
                    <td>Purchase order</td>
                    <td>{po.status} | Remaining {po.totals.quantityRemaining}</td>
                  </tr>
                ))}
                {lowestStockRows.slice(0, 4).map((row) => (
                  <tr key={row.variantId}>
                    <td>{row.productName}</td>
                    <td>Low stock</td>
                    <td>On hand {row.onHand} | <Link to={`/inventory/${row.variantId}`}>Open inventory</Link></td>
                  </tr>
                ))}
                {overduePurchaseOrders.length === 0 && lowestStockRows.length === 0 ? (
                  <tr>
                    <td colSpan={3}>No purchasing or stock attention items found.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};
