import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";

type ReminderStatus = "RECENT_COMPLETION" | "DUE_SOON" | "OVERDUE";

type ReminderCustomer = {
  customerId: string;
  customerName: string;
  email: string | null;
  phone: string | null;
  lastCompletedWorkshopAt: string;
  latestWorkshopJobId: string;
  latestBikeDescription: string | null;
  completedWorkshopJobsInWindow: number;
  activeWorkshopJobs: number;
  lastSaleAt: string | null;
  daysSinceLastCompletedWorkshop: number;
  reminderStatus: ReminderStatus;
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
    recentCompletionCount: number;
  };
  overdueCustomers: ReminderCustomer[];
  dueSoonCustomers: ReminderCustomer[];
  recentCompletedCustomers: ReminderCustomer[];
  customers: ReminderCustomer[];
};

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleDateString() : "-");

export const ServiceRemindersPage = () => {
  const { error } = useToasts();

  const [report, setReport] = useState<ReminderResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [dueSoonDays, setDueSoonDays] = useState("90");
  const [overdueDays, setOverdueDays] = useState("180");
  const [lookbackDays, setLookbackDays] = useState("365");

  const loadReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        dueSoonDays,
        overdueDays,
        lookbackDays,
        take: "50",
      });
      const payload = await apiGet<ReminderResponse>(`/api/reports/customers/reminders?${params.toString()}`);
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

  const renderRows = (rows: ReminderCustomer[], emptyText: string) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Customer</th>
            <th>Contact</th>
            <th>Last Completed Job</th>
            <th>Bike</th>
            <th>Days Since</th>
            <th>Open Jobs</th>
            <th>Last Sale</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7}>{emptyText}</td>
            </tr>
          ) : rows.map((row) => (
            <tr key={row.customerId}>
              <td>
                <div className="table-primary"><Link to={`/customers/${row.customerId}`}>{row.customerName}</Link></div>
                <div className="table-secondary">
                  <Link to={`/workshop/${row.latestWorkshopJobId}`}>Job {row.latestWorkshopJobId.slice(0, 8)}</Link>
                </div>
              </td>
              <td>
                <div>{row.email || "-"}</div>
                <div className="table-secondary">{row.phone || "-"}</div>
              </td>
              <td>{formatDate(row.lastCompletedWorkshopAt)}</td>
              <td>{row.latestBikeDescription || "-"}</td>
              <td>{row.daysSinceLastCompletedWorkshop}</td>
              <td>{row.activeWorkshopJobs}</td>
              <td>{formatDate(row.lastSaleAt)}</td>
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
            <h1>Service Reminders</h1>
            <p className="muted-text">
              Manager-facing follow-up queue derived from completed workshop jobs and recent customer activity. This is a practical outreach queue only; it does not automate messaging.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/management">Back to management</Link>
            <button type="button" onClick={() => void loadReport()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="filter-row">
          <label>
            Due Soon (days)
            <input value={dueSoonDays} onChange={(event) => setDueSoonDays(event.target.value)} inputMode="numeric" />
          </label>
          <label>
            Overdue (days)
            <input value={overdueDays} onChange={(event) => setOverdueDays(event.target.value)} inputMode="numeric" />
          </label>
          <label>
            Lookback (days)
            <input value={lookbackDays} onChange={(event) => setLookbackDays(event.target.value)} inputMode="numeric" />
          </label>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Reminder Candidates</span>
            <strong className="metric-value">{report?.summary.customerCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Completed workshop jobs in lookback window</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Overdue</span>
            <strong className="metric-value">{report?.summary.overdueCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Past the overdue threshold</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Due Soon</span>
            <strong className="metric-value">{report?.summary.dueSoonCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Past the due-soon threshold</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Recent Completions</span>
            <strong className="metric-value">{report?.summary.recentCompletionCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Freshly completed workshop jobs</span>
          </div>
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <h2>Overdue Follow-up</h2>
          {renderRows(report?.overdueCustomers ?? [], "No overdue service reminders.")}
        </section>

        <section className="card">
          <h2>Due Soon</h2>
          {renderRows(report?.dueSoonCustomers ?? [], "No due-soon reminder candidates.")}
        </section>

        <section className="card">
          <h2>Recent Completed Jobs</h2>
          {renderRows(report?.recentCompletedCustomers ?? [], "No recent workshop completions in the current lookback window.")}
          <div className="restricted-panel info-panel" style={{ marginTop: "12px" }}>
            Reminder status is derived from the number of days since the latest completed workshop job. It does not assume a formal maintenance schedule.
          </div>
        </section>
      </div>
    </div>
  );
};
