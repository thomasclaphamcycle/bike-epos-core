import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { useAuth } from "../auth/AuthContext";

type SalesDailyRow = {
  date: string;
  saleCount: number;
  grossPence: number;
  refundsPence: number;
  netPence: number;
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
    notes: string | null;
    customer: {
      firstName: string;
      lastName: string;
    } | null;
  }>;
};

type InventoryRow = {
  variantId: string;
  sku: string;
  barcode: string | null;
  variantName: string | null;
  option: string | null;
  productName: string;
  brand: string | null;
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
  actorId: string | null;
  actorRole: string | null;
  createdAt: string;
};

type AuditResponse = {
  events: AuditEvent[];
};

const OPEN_WORKSHOP_STATUSES = new Set([
  "BOOKING_MADE",
  "BIKE_ARRIVED",
  "WAITING_FOR_APPROVAL",
  "APPROVED",
  "WAITING_FOR_PARTS",
  "ON_HOLD",
  "BIKE_READY",
  "IN_PROGRESS",
  "READY",
  "AWAITING_PARTS",
]);

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const formatDateKey = (value: Date) => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatCustomerName = (
  customer: { firstName: string; lastName: string } | null,
) => {
  if (!customer) {
    return "-";
  }
  return [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "-";
};

const isManagerPlus = (role: string | undefined) => role === "MANAGER" || role === "ADMIN";

export const DashboardPage = () => {
  const { user } = useAuth();
  const { error } = useToasts();

  const [salesSummary, setSalesSummary] = useState<SalesDailyRow | null>(null);
  const [workshopSummary, setWorkshopSummary] = useState<WorkshopDashboardResponse["summary"] | null>(null);
  const [workshopJobs, setWorkshopJobs] = useState<WorkshopDashboardResponse["jobs"]>([]);
  const [lowestStockRows, setLowestStockRows] = useState<InventoryRow[]>([]);
  const [recentActivity, setRecentActivity] = useState<AuditEvent[]>([]);
  const [activityNotice, setActivityNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canViewActivity = useMemo(() => isManagerPlus(user?.role), [user?.role]);

  const loadDashboard = async () => {
    setLoading(true);
    setActivityNotice(null);

    const today = formatDateKey(new Date());

    const requests = await Promise.allSettled([
      apiGet<SalesDailyRow[]>(`/api/reports/sales/daily?from=${today}&to=${today}`),
      apiGet<WorkshopDashboardResponse>("/api/workshop/dashboard?limit=6"),
      apiGet<InventorySearchResponse>("/api/inventory/on-hand/search?active=1&take=50&skip=0"),
      canViewActivity ? apiGet<AuditResponse>("/api/audit?limit=8") : Promise.resolve({ events: [] }),
    ]);

    const [salesResult, workshopResult, inventoryResult, auditResult] = requests;

    if (salesResult.status === "fulfilled") {
      setSalesSummary(salesResult.value[0] ?? {
        date: today,
        saleCount: 0,
        grossPence: 0,
        refundsPence: 0,
        netPence: 0,
      });
    } else {
      setSalesSummary(null);
      error(salesResult.reason instanceof Error ? salesResult.reason.message : "Failed to load sales summary");
    }

    if (workshopResult.status === "fulfilled") {
      const openJobs = (workshopResult.value.jobs || []).filter((job) =>
        OPEN_WORKSHOP_STATUSES.has(job.status),
      );
      setWorkshopSummary(workshopResult.value.summary);
      setWorkshopJobs(openJobs);
    } else {
      setWorkshopSummary(null);
      setWorkshopJobs([]);
      error(workshopResult.reason instanceof Error ? workshopResult.reason.message : "Failed to load workshop summary");
    }

    if (inventoryResult.status === "fulfilled") {
      const rows = [...(inventoryResult.value.rows || [])]
        .sort((a, b) => a.onHand - b.onHand || a.productName.localeCompare(b.productName))
        .slice(0, 8);
      setLowestStockRows(rows);
    } else {
      setLowestStockRows([]);
      error(inventoryResult.reason instanceof Error ? inventoryResult.reason.message : "Failed to load stock data");
    }

    if (!canViewActivity) {
      setRecentActivity([]);
      setActivityNotice("Recent system activity is available to MANAGER+ only.");
    } else if (auditResult.status === "fulfilled") {
      setRecentActivity(auditResult.value.events || []);
    } else {
      setRecentActivity([]);
      setActivityNotice("Recent system activity is currently unavailable.");
      error(auditResult.reason instanceof Error ? auditResult.reason.message : "Failed to load recent activity");
    }

    setLoading(false);
  };

  useEffect(() => {
    void loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewActivity]);

  const openWorkshopCount = useMemo(() => {
    if (!workshopSummary) {
      return workshopJobs.length;
    }

    return Object.entries(workshopSummary.byStatus || {}).reduce((sum, [status, count]) => (
      OPEN_WORKSHOP_STATUSES.has(status) ? sum + count : sum
    ), 0);
  }, [workshopJobs.length, workshopSummary]);

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Staff Dashboard</h1>
            <p className="muted-text">Operational overview for today across sales, workshop, stock, and activity.</p>
          </div>
          <button type="button" onClick={() => void loadDashboard()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Today's Sales</span>
            <strong className="metric-value">{salesSummary ? salesSummary.saleCount : "-"}</strong>
            <span className="dashboard-metric-detail">
              Gross {salesSummary ? formatMoney(salesSummary.grossPence) : "-"}
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Today's Refunds</span>
            <strong className="metric-value">{salesSummary ? formatMoney(salesSummary.refundsPence) : "-"}</strong>
            <span className="dashboard-metric-detail">
              Net {salesSummary ? formatMoney(salesSummary.netPence) : "-"}
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Open Workshop Jobs</span>
            <strong className="metric-value">{openWorkshopCount}</strong>
            <span className="dashboard-metric-detail">
              Due today {workshopSummary?.dueToday ?? 0} | Overdue {workshopSummary?.overdue ?? 0}
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Lowest Stock Rows</span>
            <strong className="metric-value">{lowestStockRows.length}</strong>
            <span className="dashboard-metric-detail">
              Active variants sorted by current on-hand only
            </span>
          </div>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>Quick Navigation</h2>
          </div>
          <div className="dashboard-link-grid">
            <Link className="button-link dashboard-link-card" to="/pos">Open POS</Link>
            <Link className="button-link dashboard-link-card" to="/workshop">Workshop Board</Link>
            <Link className="button-link dashboard-link-card" to="/inventory">Inventory</Link>
            <Link className="button-link dashboard-link-card" to="/customers">Customers</Link>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Open Workshop Jobs</h2>
            <Link to="/workshop">View all</Link>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Status</th>
                  <th>Promised</th>
                  <th>Customer</th>
                </tr>
              </thead>
              <tbody>
                {workshopJobs.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No open workshop jobs found.</td>
                  </tr>
                ) : (
                  workshopJobs.map((job) => (
                    <tr key={job.id}>
                      <td>
                        <Link to={`/workshop/${job.id}`}>{job.id.slice(0, 8)}</Link>
                      </td>
                      <td>{job.status}</td>
                      <td>{job.scheduledDate ? new Date(job.scheduledDate).toLocaleDateString() : "-"}</td>
                      <td>{formatCustomerName(job.customer)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Lowest Stock Items</h2>
            <Link to="/inventory">View inventory</Link>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Variant</th>
                  <th>SKU</th>
                  <th>On Hand</th>
                </tr>
              </thead>
              <tbody>
                {lowestStockRows.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No stock rows available.</td>
                  </tr>
                ) : (
                  lowestStockRows.map((row) => (
                    <tr key={row.variantId}>
                      <td>
                        <Link to={`/inventory/${row.variantId}`}>{row.productName}</Link>
                      </td>
                      <td>{row.variantName || row.option || "-"}</td>
                      <td className="mono-text">{row.sku}</td>
                      <td className="numeric-cell">{row.onHand}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="muted-text">Uses current on-hand data only. No reorder threshold logic is applied in v1.</p>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Recent System Activity</h2>
            {activityNotice ? <span className="muted-text">{activityNotice}</span> : null}
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
                    <td colSpan={4}>
                      {canViewActivity ? "No recent activity found." : "Activity is hidden for STAFF users."}
                    </td>
                  </tr>
                ) : (
                  recentActivity.map((event) => (
                    <tr key={event.id}>
                      <td>{new Date(event.createdAt).toLocaleString()}</td>
                      <td>{event.action}</td>
                      <td>
                        {event.entityType}
                        <div className="table-secondary mono-text">{event.entityId}</div>
                      </td>
                      <td>{event.actorRole || event.actorId || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};
