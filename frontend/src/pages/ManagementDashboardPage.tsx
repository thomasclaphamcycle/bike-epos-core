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
import {
  isWorkshopActiveExecution,
  isWorkshopAwaitingApproval,
  isWorkshopReadyForCollection,
  isWorkshopWaitingForParts,
} from "../utils/workshopStatus";

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
    executionStatus?: string | null;
    currentEstimateStatus?: string | null;
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

type InventoryValueSnapshotResponse = {
  summary: {
    variantCount: number;
    positiveStockVariantCount: number;
    zeroOrNegativeStockVariantCount: number;
    totalOnHand: number;
    totalValuePence: number;
    countMissingCost: number;
    topValueVariantId: string | null;
    topValueProductName: string | null;
    topValuePence: number;
  };
};

type SupplierCostHistoryResponse = {
  summary: {
    trackedSupplierVariantCount: number;
    changedSupplierVariantCount: number;
    costIncreaseCount: number;
    costDecreaseCount: number;
    preferredSupplierLinkCount: number;
  };
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

const formatStatusLabel = (value: string) =>
  value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export const ManagementDashboardPage = () => {
  const { user } = useAuth();
  const { error } = useToasts();

  const [salesSummary, setSalesSummary] = useState<SalesDailyRow | null>(null);
  const [workshopPayload, setWorkshopPayload] = useState<WorkshopDashboardResponse | null>(null);
  const [lowestStockRows, setLowestStockRows] = useState<InventoryRow[]>([]);
  const [recentActivity, setRecentActivity] = useState<AuditEvent[]>([]);
  const [inventoryValue, setInventoryValue] = useState<InventoryValueSnapshotResponse | null>(null);
  const [supplierCostHistory, setSupplierCostHistory] = useState<SupplierCostHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [widgetPrefs, setWidgetPrefs] = useState(() => loadManagementWidgetPrefs(user?.id ?? ""));

  const loadDashboard = async () => {
    setLoading(true);
    const today = formatDateKey(new Date());

    const [salesResult, workshopResult, inventoryResult, activityResult, inventoryValueResult, supplierCostResult] = await Promise.allSettled([
      apiGet<SalesDailyRow[]>(`/api/reports/sales/daily?from=${today}&to=${today}`),
      apiGet<WorkshopDashboardResponse>("/api/workshop/dashboard?limit=50"),
      apiGet<InventorySearchResponse>("/api/inventory/on-hand/search?active=1&take=50&skip=0"),
      apiGet<AuditResponse>("/api/audit?limit=8"),
      apiGet<InventoryValueSnapshotResponse>("/api/reports/inventory/value-snapshot"),
      apiGet<SupplierCostHistoryResponse>("/api/reports/suppliers/cost-history?take=5"),
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

    if (activityResult.status === "fulfilled") {
      setRecentActivity(activityResult.value.events || []);
    } else {
      setRecentActivity([]);
      error(
        activityResult.reason instanceof Error
          ? activityResult.reason.message
          : "Failed to load recent activity",
      );
    }

    if (inventoryValueResult.status === "fulfilled") {
      setInventoryValue(inventoryValueResult.value);
    } else {
      setInventoryValue(null);
      error(
        inventoryValueResult.reason instanceof Error
          ? inventoryValueResult.reason.message
          : "Failed to load inventory valuation snapshot",
      );
    }

    if (supplierCostResult.status === "fulfilled") {
      setSupplierCostHistory(supplierCostResult.value);
    } else {
      setSupplierCostHistory(null);
      error(
        supplierCostResult.reason instanceof Error
          ? supplierCostResult.reason.message
          : "Failed to load supplier cost history",
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
    () => workshopJobs.filter(isWorkshopAwaitingApproval),
    [workshopJobs],
  );

  const waitingForParts = useMemo(
    () => workshopJobs.filter(isWorkshopWaitingForParts),
    [workshopJobs],
  );

  const activeWorkshopCount = useMemo(
    () => workshopJobs.filter(isWorkshopActiveExecution).length,
    [workshopJobs],
  );

  const bikeReadyCount = useMemo(
    () => workshopJobs.filter(isWorkshopReadyForCollection).length,
    [workshopJobs],
  );

  const criticalStockCount = useMemo(
    () => lowestStockRows.filter((row) => row.onHand <= 0).length,
    [lowestStockRows],
  );

  const sections = useMemo<Record<ManagementWidgetKey, React.ReactNode>>(() => ({
    sales: (
      <section className="card" key="sales">
        <div className="card-header-row">
          <div>
            <h2>Sales Summary</h2>
            <p className="muted-text">Today&apos;s trading pace and net result so far.</p>
          </div>
          <Link to="/pos">Open POS</Link>
        </div>
        <div className="management-stat-grid">
          <div className="management-stat-card">
            <span className="metric-label">Net Revenue</span>
            <strong className="metric-value">{salesSummary ? formatMoney(salesSummary.netPence) : "-"}</strong>
            <span className="dashboard-metric-detail">
              Gross {salesSummary ? formatMoney(salesSummary.grossPence) : "-"}
            </span>
          </div>
          <div className="management-stat-card">
            <span className="metric-label">Sales Count</span>
            <strong className="metric-value">{salesSummary ? salesSummary.saleCount : "-"}</strong>
            <span className="dashboard-metric-detail">
              Refunds {salesSummary ? formatMoney(salesSummary.refundsPence) : "-"}
            </span>
          </div>
        </div>
      </section>
    ),
    workshop: (
      <section className="card" key="workshop">
        <div className="card-header-row">
          <div>
            <h2>Workshop Summary</h2>
            <p className="muted-text">Open jobs, blockers, and ready-to-collect bikes.</p>
          </div>
          <Link to="/workshop">View workshop</Link>
        </div>
        <div className="management-stat-grid">
          <div className="management-stat-card">
            <span className="metric-label">In Progress</span>
            <strong className="metric-value">{activeWorkshopCount}</strong>
          </div>
          <div className="management-stat-card">
            <span className="metric-label">Awaiting Approval</span>
            <strong className="metric-value">{awaitingApproval.length}</strong>
          </div>
          <div className="management-stat-card">
            <span className="metric-label">Waiting for Parts</span>
            <strong className="metric-value">{waitingForParts.length}</strong>
          </div>
          <div className="management-stat-card">
            <span className="metric-label">Ready To Collect</span>
            <strong className="metric-value">{bikeReadyCount}</strong>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Status</th>
                <th>Parts</th>
                <th>Customer</th>
                <th>Promised</th>
              </tr>
            </thead>
            <tbody>
              {workshopJobs.slice(0, 8).length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    No workshop jobs are visible. Start from Workshop check-in for a new bike or open Workshop to review the live board.
                  </td>
                </tr>
              ) : (
                workshopJobs.slice(0, 8).map((job) => (
                  <tr key={job.id}>
                    <td><Link to={`/workshop/${job.id}`}>{job.id.slice(0, 8)}</Link></td>
                    <td>{formatStatusLabel(job.status)}</td>
                    <td>{job.partsStatus ? formatStatusLabel(job.partsStatus) : "-"}</td>
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
          <div>
            <h2>Inventory Alerts</h2>
            <p className="muted-text">Lowest stock rows first, with zero and negative stock treated as the immediate risk.</p>
          </div>
          <div className="actions-inline">
            <Link to="/management/reordering">Reordering</Link>
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
                  <td colSpan={4}>
                    No low-stock rows are visible. Open Inventory for a manual lookup or Reordering for the broader buying view.
                  </td>
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
        <p className="muted-text">
          Critical rows here mean zero or negative stock. Open Reordering for buying guidance and Inventory Intel for slower-moving stock.
        </p>
      </section>
    ),
    quickLinks: (
      <section className="card" key="quickLinks">
        <div className="card-header-row">
          <div>
            <h2>Common Manager Routes</h2>
            <p className="muted-text">
              Use these links for the most common trial walkthroughs and daily manager checks.
            </p>
          </div>
          <Link to="/management/dashboard-settings">Dashboard settings</Link>
        </div>
        <div className="dashboard-link-grid">
          <Link className="button-link dashboard-link-card" to="/management/actions">Review action centre</Link>
          <Link className="button-link dashboard-link-card" to="/management/reminders">Review reminders</Link>
          <Link className="button-link dashboard-link-card" to="/management/investigations">Check investigations</Link>
          <Link className="button-link dashboard-link-card" to="/management/product-data">Clean up product data</Link>
          <Link className="button-link dashboard-link-card" to="/management/catalogue">Open supplier catalogue</Link>
          <Link className="button-link dashboard-link-card" to="/management/hire">Open bike hire desk</Link>
          <Link className="button-link dashboard-link-card" to="/pos">Open POS</Link>
          <Link className="button-link dashboard-link-card" to="/workshop">Open workshop board</Link>
          <Link className="button-link dashboard-link-card" to="/inventory">Search inventory</Link>
          <Link className="button-link dashboard-link-card" to="/management/inventory">Review stock velocity</Link>
          <Link className="button-link dashboard-link-card" to="/management/exceptions">Review exceptions</Link>
          <Link className="button-link dashboard-link-card" to="/customers">Open customers</Link>
          <Link className="button-link dashboard-link-card" to="/suppliers">Open suppliers</Link>
          <Link className="button-link dashboard-link-card" to="/purchasing">Open purchasing</Link>
        </div>
      </section>
    ),
  }), [
    awaitingApproval.length,
    lowestStockRows,
    salesSummary,
    activeWorkshopCount,
    bikeReadyCount,
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
              Manager start page for the day&apos;s sales, workshop blockers, and stock risk. Use it to decide what needs attention next, then jump straight into the linked working screen.
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
            <strong className="metric-value">{activeWorkshopCount}</strong>
            <span className="dashboard-metric-detail">
              Ready {bikeReadyCount} | Overdue {workshopSummary?.overdue ?? 0}
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Low Stock Alerts</span>
            <strong className="metric-value">{lowestStockRows.length}</strong>
            <span className="dashboard-metric-detail">Critical {criticalStockCount} | Low list {lowestStockRows.length}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Inventory Value</span>
            <strong className="metric-value">{formatMoney(inventoryValue?.summary.totalValuePence ?? 0)}</strong>
            <span className="dashboard-metric-detail">
              Missing costs {inventoryValue?.summary.countMissingCost ?? 0}
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Supplier Cost Changes</span>
            <strong className="metric-value">{supplierCostHistory?.summary.changedSupplierVariantCount ?? 0}</strong>
            <span className="dashboard-metric-detail">
              Increases {supplierCostHistory?.summary.costIncreaseCount ?? 0}
            </span>
          </div>
        </div>
      </section>

      <div className="dashboard-grid management-grid">
        {orderedSections.length > 0 ? orderedSections : (
          <section className="card">
            <p className="muted-text">
              All dashboard widgets are currently hidden. Open dashboard settings to restore the manager overview cards for this account.
            </p>
            <div className="actions-inline">
              <Link to="/management/dashboard-settings">Open dashboard settings</Link>
            </div>
          </section>
        )}
      </div>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Recent Operational Activity</h2>
            <p className="muted-text">
              Latest audit events across sales, workshop, inventory, and admin actions. Use it to confirm what just changed before drilling into the full activity view.
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
                  <td colSpan={4}>No recent audit events are visible. Open the activity view for wider filters or older history.</td>
                </tr>
              ) : (
                recentActivity.map((event) => (
                  <tr key={event.id}>
                    <td>{new Date(event.createdAt).toLocaleString()}</td>
                    <td>{formatStatusLabel(event.action)}</td>
                    <td>
                      <div className="table-primary">{formatStatusLabel(event.entityType)}</div>
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
    </div>
  );
};
