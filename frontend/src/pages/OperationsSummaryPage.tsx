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

const OPEN_PO_STATUSES = new Set(["DRAFT", "SENT", "PARTIALLY_RECEIVED"]);

export const OperationsSummaryPage = () => {
  const { error } = useToasts();

  const [salesRow, setSalesRow] = useState<SalesDailyRow | null>(null);
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [workshopDashboard, setWorkshopDashboard] = useState<WorkshopDashboardResponse | null>(null);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [lowestStockRows, setLowestStockRows] = useState<InventoryRow[]>([]);
  const [loading, setLoading] = useState(false);

  const loadSummary = async () => {
    setLoading(true);
    try {
      const today = formatDateKey(new Date());
      const [salesResult, refundResult, workshopResult, purchasingResult, inventoryResult] = await Promise.allSettled([
        apiGet<SalesDailyRow[]>(`/api/reports/sales/daily?from=${today}&to=${today}`),
        apiGet<RefundListResponse>(`/api/refunds?from=${today}&to=${today}`),
        apiGet<WorkshopDashboardResponse>("/api/workshop/dashboard?limit=50"),
        apiGet<PurchaseOrderListResponse>("/api/purchase-orders?take=100&skip=0"),
        apiGet<InventorySearchResponse>("/api/inventory/on-hand/search?active=1&take=50&skip=0"),
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
              Daily manager snapshot across sales, refunds, workshop, purchasing, and low-stock attention. This is a control-centre view, not a scheduler or notification system.
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
            <span className="metric-label">Open Workshop Queue</span>
            <strong className="metric-value">{workshopDashboard?.summary.totalJobs ?? 0}</strong>
            <span className="dashboard-metric-detail">Due today {workshopDashboard?.summary.dueToday ?? 0}</span>
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
                    <td>On hand {row.onHand}</td>
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
