import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { ReportSeverity, reportSeverityBadgeClass } from "../utils/reportSeverity";

type ReminderStatus = "DUE_SOON" | "OVERDUE" | "RECENT_ACTIVITY";

type ReminderRow = {
  customerId: string;
  customerName: string;
  email: string | null;
  phone: string | null;
  contact: string | null;
  lastWorkshopJobDate: string;
  daysSinceLastWorkshopJob: number;
  reminderStatus: ReminderStatus;
  latestWorkshopJobId: string;
};

type ReminderResponse = {
  filters: {
    dueSoonDays: number;
    overdueDays: number;
    lookbackDays: number;
    take: number;
  };
  summary: {
    customerCount: number;
    overdueCount: number;
    dueSoonCount: number;
    recentActivityCount: number;
  };
  items: ReminderRow[];
};

const reminderBadgeClass: Record<ReminderStatus, string> = {
  OVERDUE: "status-badge status-cancelled",
  DUE_SOON: "status-badge status-warning",
  RECENT_ACTIVITY: "status-badge status-info",
};

const reminderSeverity = (status: ReminderStatus): ReportSeverity => {
  if (status === "OVERDUE") {
    return "CRITICAL";
  }
  if (status === "DUE_SOON") {
    return "WARNING";
  }
  return "INFO";
};

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleDateString() : "-");

export const CustomerRemindersPage = () => {
  const { error } = useToasts();
  const [report, setReport] = useState<ReminderResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ReminderStatus | "">("");

  const loadReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        dueSoonDays: "30",
        overdueDays: "60",
        lookbackDays: "365",
        take: "100",
      });
      const payload = await apiGet<ReminderResponse>(`/api/reports/customers/reminders?${params.toString()}`);
      setReport(payload);
    } catch (loadError) {
      setReport(null);
      error(loadError instanceof Error ? loadError.message : "Failed to load customer reminders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleItems = useMemo(
    () => (statusFilter ? report?.items.filter((row) => row.reminderStatus === statusFilter) ?? [] : report?.items ?? []),
    [report, statusFilter],
  );

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Customer Reminders</h1>
            <p className="muted-text">
              Practical follow-up queue built from completed workshop jobs and current customer contact details. This does not send messages; it shows who may need attention next.
            </p>
          </div>
          <div className="actions-inline">
            <button type="button" onClick={() => void loadReport()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            <Link to="/management">Management</Link>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Reminder Queue</span>
            <strong className="metric-value">{report?.summary.customerCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Completed workshop jobs in lookback window</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Overdue</span>
            <strong className="metric-value">{report?.summary.overdueCount ?? 0}</strong>
            <span className="dashboard-metric-detail">{report?.filters.overdueDays ?? 60}+ days since last job</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Due Soon</span>
            <strong className="metric-value">{report?.summary.dueSoonCount ?? 0}</strong>
            <span className="dashboard-metric-detail">
              {report?.filters.dueSoonDays ?? 30}-{((report?.filters.overdueDays ?? 60) - 1)} days since last job
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Recent Activity</span>
            <strong className="metric-value">{report?.summary.recentActivityCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Freshly completed workshop work</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <div>
            <h2>Follow-up Queue</h2>
            <p className="muted-text">
              Reminder status is a simple age-based heuristic from the latest completed workshop job, not a messaging workflow or service-plan engine.
            </p>
          </div>
          <div className="actions-inline">
            <label>
              Status
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as ReminderStatus | "")}>
                <option value="">All statuses</option>
                <option value="OVERDUE">Overdue</option>
                <option value="DUE_SOON">Due soon</option>
                <option value="RECENT_ACTIVITY">Recent activity</option>
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
                <th>Contact</th>
                <th>Last Workshop Date</th>
                <th>Days Since Last Job</th>
                <th>Reminder Status</th>
                <th>Severity</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.length ? visibleItems.map((row) => (
                <tr key={row.customerId}>
                  <td>
                    <div className="table-primary"><Link to={`/customers/${row.customerId}`}>{row.customerName}</Link></div>
                    <div className="table-secondary">
                      <Link to={`/customers/${row.customerId}/timeline`}>Customer timeline</Link>
                    </div>
                  </td>
                  <td>
                    <div>{row.contact || "-"}</div>
                    <div className="table-secondary">
                      {row.phone && row.email ? `${row.phone} | ${row.email}` : row.phone || row.email || "-"}
                    </div>
                  </td>
                  <td>{formatDate(row.lastWorkshopJobDate)}</td>
                  <td>{row.daysSinceLastWorkshopJob}</td>
                  <td><span className={reminderBadgeClass[row.reminderStatus]}>{row.reminderStatus}</span></td>
                  <td><span className={reportSeverityBadgeClass[reminderSeverity(row.reminderStatus)]}>{reminderSeverity(row.reminderStatus)}</span></td>
                  <td>
                    <div className="table-actions">
                      <Link to={`/customers/${row.customerId}`}>Profile</Link>
                      <Link to={`/workshop/${row.latestWorkshopJobId}`}>Last job</Link>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={7}>{loading ? "Loading customer reminders..." : "No customer reminders available."}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
