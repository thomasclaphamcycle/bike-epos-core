import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { useAuth } from "../auth/AuthContext";
import {
  isWorkshopAwaitingApproval,
  isWorkshopReadyForCollection,
} from "../utils/workshopStatus";

type ReminderRow = {
  customerId: string;
  customerName: string;
  email: string | null;
  phone: string | null;
  latestWorkshopJobId: string;
  latestBikeDescription: string | null;
  daysSinceLastCompletedWorkshop: number;
  reminderStatus: "RECENT_COMPLETION" | "DUE_SOON" | "OVERDUE";
};

type RemindersResponse = {
  overdueCustomers: ReminderRow[];
  dueSoonCustomers: ReminderRow[];
};

type WorkshopJob = {
  id: string;
  status: string;
  executionStatus?: string | null;
  currentEstimateStatus?: string | null;
  scheduledDate: string | null;
  bikeDescription: string | null;
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

type QueueItem = {
  key: string;
  reason: "SERVICE_OVERDUE" | "SERVICE_DUE_SOON" | "WAITING_APPROVAL" | "READY_COLLECTION";
  label: string;
  customerId: string;
  customerName: string;
  email: string | null;
  phone: string | null;
  workshopJobId?: string;
  secondaryText: string;
  priority: number;
};

const reviewedKeyFor = (username: string | undefined) => `corepos.commQueue.reviewed.${username || "unknown"}`;

const formatCustomerName = (customer: WorkshopJob["customer"]) =>
  customer ? [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "-" : "-";

export const CustomerCommunicationQueuePage = () => {
  const { error } = useToasts();
  const { user } = useAuth();
  const [reminders, setReminders] = useState<RemindersResponse | null>(null);
  const [jobs, setJobs] = useState<WorkshopJob[]>([]);
  const [loading, setLoading] = useState(false);
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

  const loadQueue = async () => {
    setLoading(true);
    try {
      const [reminderPayload, workshopPayload] = await Promise.all([
        apiGet<RemindersResponse>("/api/reports/customers/reminders?dueSoonDays=30&overdueDays=60&lookbackDays=365&take=50"),
        apiGet<WorkshopDashboardResponse>("/api/workshop/dashboard?includeCancelled=false&limit=100"),
      ]);
      setReminders(reminderPayload);
      setJobs(workshopPayload.jobs || []);
    } catch (loadError) {
      setReminders(null);
      setJobs([]);
      error(loadError instanceof Error ? loadError.message : "Failed to load communication queue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const queueItems = useMemo<QueueItem[]>(() => {
    const items: QueueItem[] = [];

    for (const row of reminders?.overdueCustomers || []) {
      items.push({
        key: `overdue-${row.customerId}`,
        reason: "SERVICE_OVERDUE",
        label: "Service follow-up overdue",
        customerId: row.customerId,
        customerName: row.customerName,
        email: row.email,
        phone: row.phone,
        workshopJobId: row.latestWorkshopJobId,
        secondaryText: `${row.daysSinceLastCompletedWorkshop} days since last completed workshop job`,
        priority: 4,
      });
    }

    for (const row of reminders?.dueSoonCustomers || []) {
      items.push({
        key: `due-${row.customerId}`,
        reason: "SERVICE_DUE_SOON",
        label: "Service follow-up due soon",
        customerId: row.customerId,
        customerName: row.customerName,
        email: row.email,
        phone: row.phone,
        workshopJobId: row.latestWorkshopJobId,
        secondaryText: `${row.daysSinceLastCompletedWorkshop} days since last completed workshop job`,
        priority: 3,
      });
    }

    for (const job of jobs) {
      if (!job.customer) {
        continue;
      }
      if (isWorkshopAwaitingApproval(job)) {
        items.push({
          key: `approval-${job.id}`,
          reason: "WAITING_APPROVAL",
          label: "Estimate awaiting customer approval",
          customerId: job.customer.id,
          customerName: formatCustomerName(job.customer),
          email: job.customer.email,
          phone: job.customer.phone,
          workshopJobId: job.id,
          secondaryText: job.bikeDescription || "Workshop job awaiting approval",
          priority: 5,
        });
      }
      if (isWorkshopReadyForCollection(job)) {
        items.push({
          key: `ready-${job.id}`,
          reason: "READY_COLLECTION",
          label: "Ready for collection",
          customerId: job.customer.id,
          customerName: formatCustomerName(job.customer),
          email: job.customer.email,
          phone: job.customer.phone,
          workshopJobId: job.id,
          secondaryText: job.scheduledDate ? `Promised ${new Date(job.scheduledDate).toLocaleDateString()}` : (job.bikeDescription || "Workshop job ready"),
          priority: 2,
        });
      }
    }

    return items
      .filter((item, index, arr) => arr.findIndex((other) => other.key === item.key) === index)
      .filter((item) => (hideReviewed ? !reviewed[item.key] : true))
      .sort((left, right) => right.priority - left.priority || left.customerName.localeCompare(right.customerName));
  }, [hideReviewed, jobs, reminders, reviewed]);

  const grouped = useMemo(() => ({
    waitingApproval: queueItems.filter((item) => item.reason === "WAITING_APPROVAL"),
    overdue: queueItems.filter((item) => item.reason === "SERVICE_OVERDUE"),
    dueSoon: queueItems.filter((item) => item.reason === "SERVICE_DUE_SOON"),
    ready: queueItems.filter((item) => item.reason === "READY_COLLECTION"),
  }), [queueItems]);

  const markReviewed = (key: string) => {
    persistReviewed({ ...reviewed, [key]: true });
  };

  const renderRows = (rows: QueueItem[], emptyText: string) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Customer</th>
            <th>Reason</th>
            <th>Contact</th>
            <th>Detail</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5}>{emptyText}</td>
            </tr>
          ) : rows.map((row) => (
            <tr key={row.key}>
              <td><Link to={`/customers/${row.customerId}`}>{row.customerName}</Link></td>
              <td>{row.label}</td>
              <td>
                <div>{row.email || "-"}</div>
                <div className="table-secondary">{row.phone || "-"}</div>
              </td>
              <td>{row.secondaryText}</td>
              <td>
                <div className="actions-inline">
                  {row.workshopJobId ? <Link to={`/workshop/${row.workshopJobId}`}>Open job</Link> : null}
                  <Link to={`/customers/${row.customerId}/timeline`}>Timeline</Link>
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
            <h1>Customer Communication Queue</h1>
            <p className="muted-text">
              Internal communication queue built from service reminders and workshop customer-contact states. This does not send messages; it prioritizes who needs attention next.
            </p>
          </div>
          <div className="actions-inline">
            <label>
              <input type="checkbox" checked={hideReviewed} onChange={(event) => setHideReviewed(event.target.checked)} /> Hide reviewed
            </label>
            <Link to="/management">Back to management</Link>
            <button type="button" onClick={() => void loadQueue()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Awaiting Approval</span>
            <strong className="metric-value">{grouped.waitingApproval.length}</strong>
            <span className="dashboard-metric-detail">Workshop estimates awaiting customer response</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Overdue Follow-up</span>
            <strong className="metric-value">{grouped.overdue.length}</strong>
            <span className="dashboard-metric-detail">Past the reminder threshold</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Due Soon</span>
            <strong className="metric-value">{grouped.dueSoon.length}</strong>
            <span className="dashboard-metric-detail">Upcoming reminder candidates</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Ready Collection</span>
            <strong className="metric-value">{grouped.ready.length}</strong>
            <span className="dashboard-metric-detail">Jobs ready for collection follow-up</span>
          </div>
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <h2>Awaiting Approval</h2>
          {renderRows(grouped.waitingApproval, "No jobs currently await customer approval.")}
        </section>
        <section className="card">
          <h2>Overdue Follow-up</h2>
          {renderRows(grouped.overdue, "No overdue reminder items.")}
        </section>
        <section className="card">
          <h2>Due Soon</h2>
          {renderRows(grouped.dueSoon, "No due-soon reminder items.")}
        </section>
        <section className="card">
          <h2>Ready for Collection</h2>
          {renderRows(grouped.ready, "No ready-for-collection contact items.")}
          <div className="restricted-panel info-panel" style={{ marginTop: "12px" }}>
            Reviewed markers are stored locally in this browser for the current signed-in user.
          </div>
        </section>
      </div>
    </div>
  );
};
