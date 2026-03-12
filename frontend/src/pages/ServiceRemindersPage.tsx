import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { ReportSeverity, reportSeverityBadgeClass } from "../utils/reportSeverity";

type ReminderCandidateStatus = "PENDING" | "READY" | "DISMISSED";

type ReminderCandidateRow = {
  reminderCandidateId: string;
  customerId: string | null;
  customerName: string;
  workshopJobId: string;
  bikeDescription: string | null;
  completedAt: string | null;
  dueAt: string;
  status: ReminderCandidateStatus;
  sourceEvent: string;
  daysUntilDue: number;
  daysOverdue: number;
};

type ReminderResponse = {
  filters: {
    status: ReminderCandidateStatus | null;
    includeDismissed: boolean;
    take: number;
  };
  summary: {
    candidateCount: number;
    pendingCount: number;
    readyCount: number;
    dismissedCount: number;
    overdueCount: number;
  };
  items: ReminderCandidateRow[];
};

const reminderStatusBadgeClass: Record<ReminderCandidateStatus, string> = {
  PENDING: "status-badge status-info",
  READY: "status-badge status-warning",
  DISMISSED: "status-badge",
};

const reminderSeverity = (row: ReminderCandidateRow): ReportSeverity => {
  if (row.daysOverdue > 0) {
    return "CRITICAL";
  }
  if (row.status === "READY") {
    return "WARNING";
  }
  return "INFO";
};

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleDateString() : "-");

export const ServiceRemindersPage = () => {
  const { error } = useToasts();

  const [report, setReport] = useState<ReminderResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ReminderCandidateStatus | "">("");

  const loadReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ take: "100" });
      const payload = await apiGet<ReminderResponse>(`/api/reports/reminder-candidates?${params.toString()}`);
      setReport(payload);
    } catch (loadError) {
      setReport(null);
      error(loadError instanceof Error ? loadError.message : "Failed to load service reminders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleItems = statusFilter
    ? report?.items.filter((row) => row.status === statusFilter) ?? []
    : report?.items ?? [];

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Service Reminders</h1>
            <p className="muted-text">
              Internal visibility for reminder candidates created from completed workshop jobs. This page does not send messages or schedule delivery; it only shows reminder-ready groundwork.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/management">Back to management</Link>
            <button type="button" onClick={() => void loadReport()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Visible Candidates</span>
            <strong className="metric-value">{report?.summary.candidateCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Internal reminder-candidate rows</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Ready</span>
            <strong className="metric-value">{report?.summary.readyCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Due date reached</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Pending</span>
            <strong className="metric-value">{report?.summary.pendingCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Waiting for due date</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Overdue</span>
            <strong className="metric-value">{report?.summary.overdueCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Past due date and still open</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Reminder Candidate Queue</h2>
            <p className="muted-text">
              Candidates come from `workshop.job.completed` only. Delivery, scheduling, and customer-facing reminder workflows are still intentionally deferred.
            </p>
          </div>
          <div className="actions-inline">
            <label>
              Status
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as ReminderCandidateStatus | "")}
              >
                <option value="">All open statuses</option>
                <option value="READY">Ready</option>
                <option value="PENDING">Pending</option>
              </select>
            </label>
            <Link to="/customers">Customers</Link>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Last Workshop Job</th>
                <th>Completed At</th>
                <th>Due At</th>
                <th>Status</th>
                <th>Timing</th>
                <th>Severity</th>
                <th>Action / Link</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.length ? visibleItems.map((row) => (
                <tr key={row.reminderCandidateId}>
                  <td>
                    <div className="table-primary">
                      {row.customerId ? <Link to={`/customers/${row.customerId}`}>{row.customerName}</Link> : row.customerName}
                    </div>
                    <div className="table-secondary">{row.bikeDescription || "-"}</div>
                  </td>
                  <td>
                    <div className="table-primary">
                      <Link to={`/workshop/${row.workshopJobId}`}>Job {row.workshopJobId.slice(0, 8)}</Link>
                    </div>
                    <div className="table-secondary">{row.sourceEvent}</div>
                  </td>
                  <td>{formatDate(row.completedAt)}</td>
                  <td>{formatDate(row.dueAt)}</td>
                  <td><span className={reminderStatusBadgeClass[row.status]}>{row.status}</span></td>
                  <td>
                    {row.daysOverdue > 0
                      ? `${row.daysOverdue} day${row.daysOverdue === 1 ? "" : "s"} overdue`
                      : row.daysUntilDue > 0
                        ? `Due in ${row.daysUntilDue} day${row.daysUntilDue === 1 ? "" : "s"}`
                        : "Due now"}
                  </td>
                  <td><span className={reportSeverityBadgeClass[reminderSeverity(row)]}>{reminderSeverity(row)}</span></td>
                  <td>
                    <div className="table-actions">
                      {row.customerId ? <Link to={`/customers/${row.customerId}`}>Profile</Link> : null}
                      {row.customerId ? <Link to={`/customers/${row.customerId}/timeline`}>Timeline</Link> : null}
                      <Link to={`/workshop/${row.workshopJobId}`}>Job</Link>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={8}>{loading ? "Loading reminder candidates..." : "No reminder candidates available."}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
