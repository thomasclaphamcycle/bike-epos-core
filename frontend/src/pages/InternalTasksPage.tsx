import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useToasts } from "../components/ToastProvider";

type ReminderRow = {
  customerId: string;
  customerName: string;
  latestWorkshopJobId: string;
  daysSinceLastCompletedWorkshop: number;
};

type ReminderResponse = {
  overdueCustomers: ReminderRow[];
  dueSoonCustomers: ReminderRow[];
};

type WorkshopJob = {
  id: string;
  status: string;
  scheduledDate: string | null;
  bikeDescription: string | null;
  partsStatus?: "OK" | "UNALLOCATED" | "SHORT";
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
  } | null;
};

type WorkshopDashboardResponse = {
  jobs: WorkshopJob[];
};

type PurchaseOrder = {
  id: string;
  status: "DRAFT" | "SENT" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";
  expectedAt: string | null;
  supplier: {
    name: string;
  };
  totals: {
    quantityRemaining: number;
  };
};

type PurchaseOrderResponse = {
  purchaseOrders: PurchaseOrder[];
};

type TaskReason =
  | "WAITING_APPROVAL"
  | "WAITING_PARTS"
  | "READY_COLLECTION"
  | "OVERDUE_PURCHASE_ORDER"
  | "SERVICE_OVERDUE"
  | "SERVICE_DUE_SOON";

type TaskItem = {
  key: string;
  reason: TaskReason;
  label: string;
  detail: string;
  priority: number;
  customerId?: string;
  customerName?: string;
  workshopJobId?: string;
  purchaseOrderId?: string;
  supplierName?: string;
};

const reviewedKeyFor = (username: string | undefined) => `corepos.internalTasks.reviewed.${username || "unknown"}`;

const isManagerPlus = (role: string | undefined) => role === "MANAGER" || role === "ADMIN";

const formatCustomerName = (customer: WorkshopJob["customer"]) =>
  customer ? [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "-" : "-";

const daysOverdue = (value: string | null) => {
  if (!value) {
    return null;
  }
  const diffMs = Date.now() - new Date(value).getTime();
  return diffMs > 0 ? Math.floor(diffMs / 86_400_000) : null;
};

export const InternalTasksPage = () => {
  const { user } = useAuth();
  const { error } = useToasts();
  const [loading, setLoading] = useState(false);
  const [reminders, setReminders] = useState<ReminderResponse | null>(null);
  const [jobs, setJobs] = useState<WorkshopJob[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [hideReviewed, setHideReviewed] = useState(true);
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const stored = localStorage.getItem(reviewedKeyFor(user?.username));
      setReviewed(stored ? JSON.parse(stored) : {});
    } catch {
      setReviewed({});
    }
  }, [user?.username]);

  const persistReviewed = (next: Record<string, boolean>) => {
    setReviewed(next);
    localStorage.setItem(reviewedKeyFor(user?.username), JSON.stringify(next));
  };

  const loadTasks = async () => {
    setLoading(true);
    const manager = isManagerPlus(user?.role);
    const [workshopResult, purchasingResult, remindersResult] = await Promise.allSettled([
      apiGet<WorkshopDashboardResponse>("/api/workshop/dashboard?includeCancelled=false&limit=120"),
      apiGet<PurchaseOrderResponse>("/api/purchase-orders?take=150&skip=0"),
      manager
        ? apiGet<ReminderResponse>("/api/reports/customers/reminders?dueSoonDays=30&overdueDays=60&lookbackDays=365&take=50")
        : Promise.resolve<ReminderResponse | null>(null),
    ]);

    if (workshopResult.status === "fulfilled") {
      setJobs(workshopResult.value.jobs || []);
    } else {
      setJobs([]);
      error(workshopResult.reason instanceof Error ? workshopResult.reason.message : "Failed to load workshop tasks");
    }

    if (purchasingResult.status === "fulfilled") {
      setPurchaseOrders(purchasingResult.value.purchaseOrders || []);
    } else {
      setPurchaseOrders([]);
      error(purchasingResult.reason instanceof Error ? purchasingResult.reason.message : "Failed to load purchasing tasks");
    }

    if (remindersResult.status === "fulfilled") {
      setReminders(remindersResult.value);
    } else {
      setReminders(null);
      if (manager) {
        error(remindersResult.reason instanceof Error ? remindersResult.reason.message : "Failed to load reminder tasks");
      }
    }

    setLoading(false);
  };

  useEffect(() => {
    void loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  const taskItems = useMemo<TaskItem[]>(() => {
    const items: TaskItem[] = [];

    for (const job of jobs) {
      if (job.status === "WAITING_FOR_APPROVAL") {
        items.push({
          key: `approval-${job.id}`,
          reason: "WAITING_APPROVAL",
          label: "Estimate awaiting customer approval",
          detail: job.bikeDescription || "Workshop job requires customer approval",
          priority: 5,
          customerId: job.customer?.id,
          customerName: formatCustomerName(job.customer),
          workshopJobId: job.id,
        });
      }

      if (job.status === "WAITING_FOR_PARTS" || job.partsStatus === "SHORT") {
        items.push({
          key: `parts-${job.id}`,
          reason: "WAITING_PARTS",
          label: "Parts blocked job",
          detail: job.bikeDescription || "Workshop job is waiting for parts",
          priority: 5,
          customerId: job.customer?.id,
          customerName: formatCustomerName(job.customer),
          workshopJobId: job.id,
        });
      }

      if (job.status === "BIKE_READY") {
        items.push({
          key: `ready-${job.id}`,
          reason: "READY_COLLECTION",
          label: "Ready for collection",
          detail: job.scheduledDate ? `Promised ${new Date(job.scheduledDate).toLocaleDateString()}` : (job.bikeDescription || "Ready for customer handover"),
          priority: 3,
          customerId: job.customer?.id,
          customerName: formatCustomerName(job.customer),
          workshopJobId: job.id,
        });
      }
    }

    for (const po of purchaseOrders) {
      const overdue = daysOverdue(po.expectedAt);
      if (po.status !== "RECEIVED" && po.status !== "CANCELLED" && overdue !== null && overdue >= 0) {
        items.push({
          key: `po-${po.id}`,
          reason: "OVERDUE_PURCHASE_ORDER",
          label: "Overdue purchase order",
          detail: `${po.supplier.name} | ${po.totals.quantityRemaining} qty remaining`,
          priority: 4,
          purchaseOrderId: po.id,
          supplierName: po.supplier.name,
        });
      }
    }

    if (isManagerPlus(user?.role)) {
      for (const row of reminders?.overdueCustomers || []) {
        items.push({
          key: `service-overdue-${row.customerId}`,
          reason: "SERVICE_OVERDUE",
          label: "Service follow-up overdue",
          detail: `${row.daysSinceLastCompletedWorkshop} days since last completed job`,
          priority: 4,
          customerId: row.customerId,
          customerName: row.customerName,
          workshopJobId: row.latestWorkshopJobId,
        });
      }

      for (const row of reminders?.dueSoonCustomers || []) {
        items.push({
          key: `service-due-${row.customerId}`,
          reason: "SERVICE_DUE_SOON",
          label: "Service follow-up due soon",
          detail: `${row.daysSinceLastCompletedWorkshop} days since last completed job`,
          priority: 2,
          customerId: row.customerId,
          customerName: row.customerName,
          workshopJobId: row.latestWorkshopJobId,
        });
      }
    }

    return items
      .filter((item, index, rows) => rows.findIndex((candidate) => candidate.key === item.key) === index)
      .filter((item) => (hideReviewed ? !reviewed[item.key] : true))
      .sort((left, right) => right.priority - left.priority || left.label.localeCompare(right.label));
  }, [hideReviewed, jobs, purchaseOrders, reminders, reviewed, user?.role]);

  const grouped = useMemo(() => ({
    workshop: taskItems.filter((item) => ["WAITING_APPROVAL", "WAITING_PARTS", "READY_COLLECTION"].includes(item.reason)),
    purchasing: taskItems.filter((item) => item.reason === "OVERDUE_PURCHASE_ORDER"),
    reminders: taskItems.filter((item) => item.reason === "SERVICE_OVERDUE" || item.reason === "SERVICE_DUE_SOON"),
  }), [taskItems]);

  const markReviewed = (key: string) => {
    persistReviewed({ ...reviewed, [key]: true });
  };

  const renderRows = (rows: TaskItem[], emptyText: string) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Task</th>
            <th>Related</th>
            <th>Detail</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4}>{emptyText}</td>
            </tr>
          ) : rows.map((row) => (
            <tr key={row.key}>
              <td>
                <div className="table-primary">{row.label}</div>
                <div className="table-secondary">Priority {row.priority}</div>
              </td>
              <td>
                {row.customerName ? <div className="table-primary">{row.customerName}</div> : null}
                {row.supplierName ? <div className="table-primary">{row.supplierName}</div> : null}
                {row.workshopJobId ? <div className="table-secondary mono-text">Job {row.workshopJobId.slice(0, 8)}</div> : null}
                {row.purchaseOrderId ? <div className="table-secondary mono-text">PO {row.purchaseOrderId.slice(0, 8)}</div> : null}
              </td>
              <td>{row.detail}</td>
              <td>
                <div className="actions-inline">
                  {row.workshopJobId ? <Link to={`/workshop/${row.workshopJobId}`}>Open job</Link> : null}
                  {row.customerId ? <Link to={`/customers/${row.customerId}`}>Customer</Link> : null}
                  {row.purchaseOrderId ? <Link to={`/purchasing/${row.purchaseOrderId}`}>Open PO</Link> : null}
                  <button type="button" onClick={() => markReviewed(row.key)}>Mark reviewed</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Internal Tasks</h1>
            <p className="muted-text">
              Lightweight internal follow-up queue built from existing workshop, reminder, and purchasing signals. This is an operational view, not an assignments engine.
            </p>
          </div>
          <div className="actions-inline">
            <label>
              <input type="checkbox" checked={hideReviewed} onChange={(event) => setHideReviewed(event.target.checked)} /> Hide reviewed
            </label>
            <button type="button" onClick={() => void loadTasks()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Workshop Tasks</span>
            <strong className="metric-value">{grouped.workshop.length}</strong>
            <span className="dashboard-metric-detail">Approval, parts, and collection follow-up</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Purchasing Tasks</span>
            <strong className="metric-value">{grouped.purchasing.length}</strong>
            <span className="dashboard-metric-detail">Overdue open purchase orders</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Reminder Tasks</span>
            <strong className="metric-value">{grouped.reminders.length}</strong>
            <span className="dashboard-metric-detail">
              {isManagerPlus(user?.role) ? "Manager reminder follow-up items" : "Manager-only reminder queue"}
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Visible Tasks</span>
            <strong className="metric-value">{taskItems.length}</strong>
            <span className="dashboard-metric-detail">Current queue after local review filtering</span>
          </div>
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <h2>Workshop Follow-up</h2>
          {renderRows(grouped.workshop, "No workshop follow-up tasks are currently visible.")}
        </section>

        <section className="card">
          <h2>Purchasing Attention</h2>
          {renderRows(grouped.purchasing, "No overdue purchase order tasks are currently visible.")}
        </section>

        <section className="card">
          <h2>Reminder Follow-up</h2>
          {isManagerPlus(user?.role)
            ? renderRows(grouped.reminders, "No reminder tasks are currently visible.")
            : (
              <div className="restricted-panel info-panel">
                Reminder follow-up remains manager-only because it depends on the manager reminders report.
              </div>
            )}
        </section>
      </div>
    </div>
  );
};
