import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useToasts } from "../components/ToastProvider";
import {
  DEFAULT_MANAGEMENT_WIDGET_ORDER,
  loadManagementWidgetPrefs,
  ManagementWidgetKey,
} from "../utils/dashboardPrefs";

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
    partsStatus?: "OK" | "UNALLOCATED" | "SHORT";
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

const WORKSHOP_OPEN_STATUSES = new Set([
  "BOOKING_MADE",
  "BIKE_ARRIVED",
  "WAITING_FOR_APPROVAL",
  "APPROVED",
  "WAITING_FOR_PARTS",
  "ON_HOLD",
  "BIKE_READY",
]);

export const ManagementDashboardPage = () => {
  const { user } = useAuth();
  const { error } = useToasts();

  const [salesSummary, setSalesSummary] = useState<SalesDailyRow | null>(null);
  const [workshopPayload, setWorkshopPayload] = useState<WorkshopDashboardResponse | null>(null);
  const [lowestStockRows, setLowestStockRows] = useState<InventoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [widgetPrefs, setWidgetPrefs] = useState(() => loadManagementWidgetPrefs(user?.id ?? ""));

  const loadDashboard = async () => {
    setLoading(true);
    const today = formatDateKey(new Date());

    const [salesResult, workshopResult, inventoryResult] = await Promise.allSettled([
      apiGet<SalesDailyRow[]>(`/api/reports/sales/daily?from=${today}&to=${today}`),
      apiGet<WorkshopDashboardResponse>("/api/workshop/dashboard?limit=50"),
      apiGet<InventorySearchResponse>("/api/inventory/on-hand/search?active=1&take=50&skip=0"),
    ]);

    if (salesResult.status === "fulfilled") {
      setSalesSummary(
        salesResult.value[0] ?? {
          date: today,
          saleCount: 0,
          grossPence: 0,
          refundsPence: 0,
          netPence: 0,
        },
      );
    } else {
      setSalesSummary(null);
      error(salesResult.reason instanceof Error ? salesResult.reason.message : "Failed to load sales summary");
    }

    if (workshopResult.status === "fulfilled") {
      setWorkshopPayload(workshopResult.value);
    } else {
      setWorkshopPayload(null);
      error(
        workshopResult.reason instanceof Error
          ? workshopResult.reason.message
          : "Failed to load workshop summary",
      );
    }

    if (inventoryResult.status === "fulfilled") {
      const rows = [...(inventoryResult.value.rows || [])]
        .sort((left, right) => left.onHand - right.onHand || left.productName.localeCompare(right.productName))
        .slice(0, 8);
      setLowestStockRows(rows);
    } else {
      setLowestStockRows([]);
      error(
        inventoryResult.reason instanceof Error
          ? inventoryResult.reason.message
          : "Failed to load inventory alerts",
      );
    }

    setLoading(false);
  };

  useEffect(() => {
    void loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ownerId = user?.id ?? "";
    setWidgetPrefs(loadManagementWidgetPrefs(ownerId));

    const onFocus = () => setWidgetPrefs(loadManagementWidgetPrefs(ownerId));
    const onStorage = () => setWidgetPrefs(loadManagementWidgetPrefs(ownerId));

    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
    };
  }, [user?.id]);

  const workshopSummary = workshopPayload?.summary ?? null;
  const workshopJobs = workshopPayload?.jobs ?? [];

  const awaitingApproval = useMemo(
    () => workshopJobs.filter((job) => job.status === "WAITING_FOR_APPROVAL"),
    [workshopJobs],
  );

  const waitingForParts = useMemo(
    () => workshopJobs.filter((job) => job.status === "WAITING_FOR_PARTS" || job.partsStatus === "SHORT"),
    [workshopJobs],
  );

  const openWorkshopCount = useMemo(() => {
    if (!workshopSummary) {
      return workshopJobs.length;
    }

    return Object.entries(workshopSummary.byStatus || {}).reduce((sum, [status, count]) => (
      WORKSHOP_OPEN_STATUSES.has(status) ? sum + count : sum
    ), 0);
  }, [workshopJobs.length, workshopSummary]);

  const sections = useMemo<Record<ManagementWidgetKey, React.ReactNode>>(() => ({
    sales: (
      <section className="card" key="sales">
        <div className="card-header-row">
          <h2>Sales Summary</h2>
          <Link to="/pos">Open POS</Link>
        </div>
        <div className="management-stat-grid">
          <div className="management-stat-card">
            <span className="metric-label">Net Revenue</span>
            <strong className="metric-value">{salesSummary ? formatMoney(salesSummary.netPence) : "-"}</strong>
          </div>
          <div className="management-stat-card">
            <span className="metric-label">Sales Count</span>
            <strong className="metric-value">{salesSummary ? salesSummary.saleCount : "-"}</strong>
          </div>
        </div>
      </section>
    ),
    workshop: (
      <section className="card" key="workshop">
        <div className="card-header-row">
          <h2>Workshop Summary</h2>
          <Link to="/workshop">View workshop</Link>
        </div>
        <div className="management-stat-grid">
          <div className="management-stat-card">
            <span className="metric-label">Awaiting Approval</span>
            <strong className="metric-value">{awaitingApproval.length}</strong>
          </div>
          <div className="management-stat-card">
            <span className="metric-label">Waiting for Parts</span>
            <strong className="metric-value">{waitingForParts.length}</strong>
          </div>
          <div className="management-stat-card">
            <span className="metric-label">Open Jobs</span>
            <strong className="metric-value">{openWorkshopCount}</strong>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Status</th>
                <th>Customer</th>
                <th>Promised</th>
              </tr>
            </thead>
            <tbody>
              {workshopJobs.slice(0, 8).length === 0 ? (
                <tr>
                  <td colSpan={4}>No workshop jobs available.</td>
                </tr>
              ) : (
                workshopJobs.slice(0, 8).map((job) => (
                  <tr key={job.id}>
                    <td><Link to={`/workshop/${job.id}`}>{job.id.slice(0, 8)}</Link></td>
                    <td>{job.status}</td>
                    <td>{formatCustomerName(job.customer)}</td>
                    <td>{job.scheduledDate ? new Date(job.scheduledDate).toLocaleDateString() : "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    ),
    inventory: (
      <section className="card" key="inventory">
        <div className="card-header-row">
          <h2>Inventory Alerts</h2>
          <div className="actions-inline">
            <Link to="/management/inventory">Velocity report</Link>
            <Link to="/inventory">View inventory</Link>
          </div>
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
                    <td><Link to={`/inventory/${row.variantId}`}>{row.productName}</Link></td>
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
    ),
    quickLinks: (
      <section className="card" key="quickLinks">
        <div className="card-header-row">
          <h2>Quick Links</h2>
          <Link to="/management/dashboard-settings">Dashboard settings</Link>
        </div>
        <div className="dashboard-link-grid">
          <Link className="button-link dashboard-link-card" to="/pos">POS</Link>
          <Link className="button-link dashboard-link-card" to="/workshop">Workshop</Link>
          <Link className="button-link dashboard-link-card" to="/inventory">Inventory</Link>
          <Link className="button-link dashboard-link-card" to="/management/inventory">Velocity</Link>
          <Link className="button-link dashboard-link-card" to="/management/exceptions">Exceptions</Link>
          <Link className="button-link dashboard-link-card" to="/customers">Customers</Link>
          <Link className="button-link dashboard-link-card" to="/suppliers">Suppliers</Link>
          <Link className="button-link dashboard-link-card" to="/purchasing">Purchasing</Link>
        </div>
      </section>
    ),
  }), [
    awaitingApproval.length,
    lowestStockRows,
    openWorkshopCount,
    salesSummary,
    waitingForParts.length,
    workshopJobs,
  ]);

  const orderedSections = widgetPrefs.order
    .filter((key) => DEFAULT_MANAGEMENT_WIDGET_ORDER.includes(key))
    .filter((key) => widgetPrefs.visible[key])
    .map((key) => sections[key]);

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Management Dashboard</h1>
            <p className="muted-text">
              Manager-focused daily overview across sales, workshop operations, and inventory risk.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/management/dashboard-settings">Customize widgets</Link>
            <button type="button" onClick={() => void loadDashboard()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Daily Revenue</span>
            <strong className="metric-value">{salesSummary ? formatMoney(salesSummary.netPence) : "-"}</strong>
            <span className="dashboard-metric-detail">
              Gross {salesSummary ? formatMoney(salesSummary.grossPence) : "-"}
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Today's Sales Count</span>
            <strong className="metric-value">{salesSummary ? salesSummary.saleCount : "-"}</strong>
            <span className="dashboard-metric-detail">
              Refunds {salesSummary ? formatMoney(salesSummary.refundsPence) : "-"}
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Workshop Workload</span>
            <strong className="metric-value">{openWorkshopCount}</strong>
            <span className="dashboard-metric-detail">
              Due today {workshopSummary?.dueToday ?? 0} | Overdue {workshopSummary?.overdue ?? 0}
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Low Stock Alerts</span>
            <strong className="metric-value">{lowestStockRows.length}</strong>
            <span className="dashboard-metric-detail">Lowest on-hand rows only</span>
          </div>
        </div>
      </section>

      <div className="dashboard-grid management-grid">
        {orderedSections.length > 0 ? orderedSections : (
          <section className="card">
            <p className="muted-text">
              All dashboard widgets are currently hidden. Use dashboard settings to restore them.
            </p>
          </section>
        )}
      </div>
    </div>
  );
};
