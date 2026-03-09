import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";

type RangePreset = "30" | "90" | "365";

type WorkshopDailyRow = {
  date: string;
  jobCount: number;
  revenuePence: number;
};

type DashboardJob = {
  id: string;
  status: string;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  partsStatus?: "OK" | "UNALLOCATED" | "SHORT";
};

type WorkshopDashboardResponse = {
  summary: {
    totalJobs: number;
    dueToday: number;
    overdue: number;
    byStatus: Record<string, number>;
  };
  jobs: DashboardJob[];
};

type WorkloadRow = {
  key: string;
  label: string;
  openJobs: number;
  waitingApproval: number;
  waitingParts: number;
  ready: number;
};

const formatDateKey = (value: Date) => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const shiftDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const OPEN_STATUSES = new Set([
  "BOOKING_MADE",
  "BIKE_ARRIVED",
  "WAITING_FOR_APPROVAL",
  "APPROVED",
  "WAITING_FOR_PARTS",
  "ON_HOLD",
  "BIKE_READY",
]);

const isWaitingParts = (job: DashboardJob) => job.status === "WAITING_FOR_PARTS" || job.partsStatus === "SHORT";

export const WorkshopCapacityPage = () => {
  const { error } = useToasts();

  const [rangePreset, setRangePreset] = useState<RangePreset>("90");
  const [dailyRows, setDailyRows] = useState<WorkshopDailyRow[]>([]);
  const [dashboard, setDashboard] = useState<WorkshopDashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const loadCapacity = async () => {
    setLoading(true);
    const today = new Date();
    const to = formatDateKey(today);
    const from = formatDateKey(shiftDays(today, -(Number(rangePreset) - 1)));

    const [dailyResult, dashboardResult] = await Promise.allSettled([
      apiGet<WorkshopDailyRow[]>(`/api/reports/workshop/daily?from=${from}&to=${to}`),
      apiGet<WorkshopDashboardResponse>("/api/workshop/dashboard?limit=100"),
    ]);

    if (dailyResult.status === "fulfilled") {
      setDailyRows(dailyResult.value || []);
    } else {
      setDailyRows([]);
      error(dailyResult.reason instanceof Error ? dailyResult.reason.message : "Failed to load workshop throughput");
    }

    if (dashboardResult.status === "fulfilled") {
      setDashboard(dashboardResult.value);
    } else {
      setDashboard(null);
      error(dashboardResult.reason instanceof Error ? dashboardResult.reason.message : "Failed to load workshop queue");
    }

    setLoading(false);
  };

  useEffect(() => {
    void loadCapacity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangePreset]);

  const completedJobs = dailyRows.reduce((sum, row) => sum + row.jobCount, 0);
  const averageJobsPerDay = dailyRows.length > 0 ? Number((completedJobs / dailyRows.length).toFixed(1)) : 0;

  const jobs = dashboard?.jobs ?? [];
  const openQueue = useMemo(
    () => jobs.filter((job) => OPEN_STATUSES.has(job.status)).length,
    [jobs],
  );
  const waitingApprovalCount = useMemo(
    () => jobs.filter((job) => job.status === "WAITING_FOR_APPROVAL").length,
    [jobs],
  );
  const waitingPartsCount = useMemo(
    () => jobs.filter((job) => isWaitingParts(job)).length,
    [jobs],
  );
  const backlogDays = averageJobsPerDay > 0 ? Number((openQueue / averageJobsPerDay).toFixed(1)) : null;

  const workloadRows = useMemo<WorkloadRow[]>(() => {
    const grouped = new Map<string, WorkloadRow>();

    for (const job of jobs) {
      if (!OPEN_STATUSES.has(job.status)) {
        continue;
      }

      const key = job.assignedStaffId ?? "unassigned";
      const label = job.assignedStaffName?.trim() || "Unassigned";
      const existing = grouped.get(key) ?? {
        key,
        label,
        openJobs: 0,
        waitingApproval: 0,
        waitingParts: 0,
        ready: 0,
      };

      existing.openJobs += 1;
      if (job.status === "WAITING_FOR_APPROVAL") {
        existing.waitingApproval += 1;
      }
      if (isWaitingParts(job)) {
        existing.waitingParts += 1;
      }
      if (job.status === "BIKE_READY") {
        existing.ready += 1;
      }

      grouped.set(key, existing);
    }

    return Array.from(grouped.values()).sort((left, right) => (
      right.openJobs - left.openJobs || left.label.localeCompare(right.label)
    ));
  }, [jobs]);

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Workshop Capacity</h1>
            <p className="muted-text">
              Manager-facing workshop capacity view built from current throughput and the live open queue. Backlog days are derived as open queue divided by average daily completions.
            </p>
          </div>
          <div className="actions-inline">
            <label>
              Range
              <select value={rangePreset} onChange={(event) => setRangePreset(event.target.value as RangePreset)}>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="365">Last 365 days</option>
              </select>
            </label>
            <button type="button" onClick={() => void loadCapacity()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Open Queue</span>
            <strong className="metric-value">{openQueue}</strong>
            <span className="dashboard-metric-detail">Current active workshop jobs</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Average Jobs / Day</span>
            <strong className="metric-value">{averageJobsPerDay.toFixed(1)}</strong>
            <span className="dashboard-metric-detail">Completed jobs over selected range</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Backlog Days</span>
            <strong className="metric-value">{backlogDays === null ? "-" : backlogDays.toFixed(1)}</strong>
            <span className="dashboard-metric-detail">
              {backlogDays === null ? "No throughput data available" : "Derived from queue / throughput"}
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Waiting Approval</span>
            <strong className="metric-value">{waitingApprovalCount}</strong>
            <span className="dashboard-metric-detail">Open estimate decisions</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Waiting Parts</span>
            <strong className="metric-value">{waitingPartsCount}</strong>
            <span className="dashboard-metric-detail">Parts-limited jobs</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Overdue</span>
            <strong className="metric-value">{dashboard?.summary.overdue ?? 0}</strong>
            <span className="dashboard-metric-detail">Based on current scheduled dates</span>
          </div>
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>Daily Throughput</h2>
            <Link to="/management">Back to management</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Jobs Completed</th>
                </tr>
              </thead>
              <tbody>
                {dailyRows.length ? [...dailyRows].reverse().map((row) => (
                  <tr key={row.date}>
                    <td>{row.date}</td>
                    <td>{row.jobCount}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={2}>No workshop throughput data for this range.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Queue Summary</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Jobs</th>
                </tr>
              </thead>
              <tbody>
                {dashboard?.summary.byStatus ? Object.entries(dashboard.summary.byStatus)
                  .filter(([, count]) => count > 0)
                  .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
                  .map(([status, count]) => (
                    <tr key={status}>
                      <td>{status}</td>
                      <td>{count}</td>
                    </tr>
                  )) : (
                  <tr>
                    <td colSpan={2}>No queue summary available.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Assignment Workload</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Assignee</th>
                  <th>Open Jobs</th>
                  <th>Waiting Approval</th>
                  <th>Waiting Parts</th>
                  <th>Ready</th>
                </tr>
              </thead>
              <tbody>
                {workloadRows.length ? workloadRows.map((row) => (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td>{row.openJobs}</td>
                    <td>{row.waitingApproval}</td>
                    <td>{row.waitingParts}</td>
                    <td>{row.ready}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5}>No assignment workload data available.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="muted-text">Jobs without assignment are grouped under Unassigned. Backlog days are not shown when average daily completions is zero.</p>
        </section>
      </div>
    </div>
  );
};
