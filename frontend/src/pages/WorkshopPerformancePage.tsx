import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { SavedViewControls } from "../components/SavedViewControls";
import { useToasts } from "../components/ToastProvider";

type WorkshopDailyRow = {
  date: string;
  jobCount: number;
  revenuePence: number;
};

type RangePreset = "30" | "90" | "365";

type DashboardJob = {
  id: string;
  status: string;
  scheduledDate: string | null;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  partsStatus?: "OK" | "UNALLOCATED" | "SHORT";
};

type DashboardResponse = {
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
  awaitingApproval: number;
  waitingForParts: number;
  ready: number;
};

type WorkshopCapacityResponse = {
  generatedAt: string;
  lookbackDays: number;
  openJobCount: number;
  waitingForApprovalCount: number;
  waitingForPartsCount: number;
  readyForCollectionCount: number;
  completedJobsLast7Days: number;
  completedJobsLast30Days: number;
  averageCompletedPerDay: number;
  estimatedBacklogDays: number | null;
  averageCompletionDays: number | null;
  averageOpenJobAgeDays: number | null;
  longestOpenJobDays: number | null;
  ageingBuckets: {
    zeroToTwoDays: number;
    threeToSevenDays: number;
    eightToFourteenDays: number;
    fifteenPlusDays: number;
  };
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

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

const isWaitingForParts = (job: DashboardJob) =>
  job.status === "WAITING_FOR_PARTS" || job.partsStatus === "SHORT";

export const WorkshopPerformancePage = () => {
  const { error } = useToasts();

  const [rangePreset, setRangePreset] = useState<RangePreset>("90");
  const [dailyRows, setDailyRows] = useState<WorkshopDailyRow[]>([]);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [capacityReport, setCapacityReport] = useState<WorkshopCapacityResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const applySavedFilters = (filters: Record<string, string>) => {
    if (filters.rangePreset === "30" || filters.rangePreset === "90" || filters.rangePreset === "365") {
      setRangePreset(filters.rangePreset);
    }
  };

  const loadMetrics = async () => {
    setLoading(true);
    const today = new Date();
    const to = formatDateKey(today);
    const from = formatDateKey(shiftDays(today, -(Number(rangePreset) - 1)));

    const [dailyResult, dashboardResult, capacityResult] = await Promise.allSettled([
      apiGet<WorkshopDailyRow[]>(`/api/reports/workshop/daily?from=${from}&to=${to}`),
      apiGet<DashboardResponse>("/api/workshop/dashboard?limit=100"),
      apiGet<WorkshopCapacityResponse>("/api/reports/workshop/capacity"),
    ]);

    if (dailyResult.status === "fulfilled") {
      setDailyRows(dailyResult.value || []);
    } else {
      setDailyRows([]);
      error(dailyResult.reason instanceof Error ? dailyResult.reason.message : "Failed to load workshop daily report");
    }

    if (dashboardResult.status === "fulfilled") {
      setDashboard(dashboardResult.value);
    } else {
      setDashboard(null);
      error(dashboardResult.reason instanceof Error ? dashboardResult.reason.message : "Failed to load workshop dashboard");
    }

    if (capacityResult.status === "fulfilled") {
      setCapacityReport(capacityResult.value);
    } else {
      setCapacityReport(null);
      error(capacityResult.reason instanceof Error ? capacityResult.reason.message : "Failed to load workshop capacity");
    }

    setLoading(false);
  };

  useEffect(() => {
    void loadMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangePreset]);

  const totals = useMemo(() => {
    const completedJobs = dailyRows.reduce((sum, row) => sum + row.jobCount, 0);
    const revenuePence = dailyRows.reduce((sum, row) => sum + row.revenuePence, 0);
    const averageJobsPerDay = dailyRows.length > 0 ? Number((completedJobs / dailyRows.length).toFixed(1)) : 0;
    return {
      completedJobs,
      revenuePence,
      averageJobsPerDay,
    };
  }, [dailyRows]);

  const dashboardSummary = dashboard?.summary ?? null;
  const dashboardJobs = dashboard?.jobs ?? [];

  const awaitingApprovalCount = useMemo(
    () => dashboardJobs.filter((job) => job.status === "WAITING_FOR_APPROVAL").length,
    [dashboardJobs],
  );

  const waitingForPartsCount = useMemo(
    () => dashboardJobs.filter((job) => isWaitingForParts(job)).length,
    [dashboardJobs],
  );

  const openWorkloadCount = useMemo(() => {
    if (dashboardSummary?.byStatus) {
      return Object.entries(dashboardSummary.byStatus).reduce((sum, [status, count]) => (
        OPEN_STATUSES.has(status) ? sum + count : sum
      ), 0);
    }

    return dashboardJobs.filter((job) => OPEN_STATUSES.has(job.status)).length;
  }, [dashboardJobs, dashboardSummary]);

  const workloadRows = useMemo<WorkloadRow[]>(() => {
    const grouped = new Map<string, WorkloadRow>();

    for (const job of dashboardJobs) {
      if (job.status === "COMPLETED" || job.status === "CANCELLED") {
        continue;
      }

      const key = job.assignedStaffId ?? "unassigned";
      const label = job.assignedStaffName?.trim() || "Unassigned";
      const existing = grouped.get(key) ?? {
        key,
        label,
        openJobs: 0,
        awaitingApproval: 0,
        waitingForParts: 0,
        ready: 0,
      };

      existing.openJobs += 1;
      if (job.status === "WAITING_FOR_APPROVAL") {
        existing.awaitingApproval += 1;
      }
      if (isWaitingForParts(job)) {
        existing.waitingForParts += 1;
      }
      if (job.status === "BIKE_READY") {
        existing.ready += 1;
      }

      grouped.set(key, existing);
    }

    return Array.from(grouped.values()).sort((left, right) => (
      right.openJobs - left.openJobs || left.label.localeCompare(right.label)
    ));
  }, [dashboardJobs]);

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Workshop Performance</h1>
            <p className="muted-text">
              Manager-facing workshop throughput and backlog view built from the existing daily report and workshop dashboard.
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
            <button type="button" onClick={() => void loadMetrics()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Completed Jobs</span>
            <strong className="metric-value">{totals.completedJobs}</strong>
            <span className="dashboard-metric-detail">Within selected range</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Average Jobs / Day</span>
            <strong className="metric-value">{totals.averageJobsPerDay.toFixed(1)}</strong>
            <span className="dashboard-metric-detail">Based on daily completion rows</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Awaiting Approval</span>
            <strong className="metric-value">{awaitingApprovalCount}</strong>
            <span className="dashboard-metric-detail">Current open queue</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Waiting for Parts</span>
            <strong className="metric-value">{waitingForPartsCount}</strong>
            <span className="dashboard-metric-detail">Includes short-part jobs</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Open Workload</span>
            <strong className="metric-value">{openWorkloadCount}</strong>
            <span className="dashboard-metric-detail">
              Due today {dashboardSummary?.dueToday ?? 0} | Overdue {dashboardSummary?.overdue ?? 0}
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Workshop Revenue</span>
            <strong className="metric-value">{formatMoney(totals.revenuePence)}</strong>
            <span className="dashboard-metric-detail">Secondary metric from completed jobs</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Completed Last 7 Days</span>
            <strong className="metric-value">{capacityReport?.completedJobsLast7Days ?? 0}</strong>
            <span className="dashboard-metric-detail">Recent workshop throughput</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Avg Completion Time</span>
            <strong className="metric-value">
              {capacityReport?.averageCompletionDays === null || capacityReport?.averageCompletionDays === undefined
                ? "-"
                : `${capacityReport.averageCompletionDays.toFixed(1)}d`}
            </strong>
            <span className="dashboard-metric-detail">
              Backlog {capacityReport?.estimatedBacklogDays === null || capacityReport?.estimatedBacklogDays === undefined
                ? "-"
                : `${capacityReport.estimatedBacklogDays.toFixed(1)}d`}
            </span>
          </div>
        </div>
      </section>

      <SavedViewControls
        pageKey="workshop"
        currentFilters={{ rangePreset }}
        onApplyFilters={applySavedFilters}
        defaultName={`Workshop ${rangePreset}d`}
      />

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>Throughput Snapshot</h2>
          </div>
          <div className="management-stat-grid">
            <div className="management-stat-card">
              <span className="metric-label">Ready For Collection</span>
              <strong className="metric-value">{capacityReport?.readyForCollectionCount ?? 0}</strong>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Average Open Age</span>
              <strong className="metric-value">
                {capacityReport?.averageOpenJobAgeDays === null || capacityReport?.averageOpenJobAgeDays === undefined
                  ? "-"
                  : `${capacityReport.averageOpenJobAgeDays.toFixed(1)}d`}
              </strong>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Longest Open Job</span>
              <strong className="metric-value">
                {capacityReport?.longestOpenJobDays === null || capacityReport?.longestOpenJobDays === undefined
                  ? "-"
                  : `${capacityReport.longestOpenJobDays}d`}
              </strong>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Completions / Day</span>
              <strong className="metric-value">{capacityReport?.averageCompletedPerDay?.toFixed(1) ?? "0.0"}</strong>
            </div>
          </div>
          <p className="muted-text">
            This snapshot uses the same workshop job data as the live board and adds a simple throughput view for managers planning bench load and customer promises.
          </p>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Daily Completions</h2>
            <Link to="/management">Back to management</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Jobs Completed</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {dailyRows.length === 0 ? (
                  <tr>
                    <td colSpan={3}>No completed workshop jobs for this range.</td>
                  </tr>
                ) : (
                  [...dailyRows].reverse().map((row) => (
                    <tr key={row.date}>
                      <td>{row.date}</td>
                      <td>{row.jobCount}</td>
                      <td>{formatMoney(row.revenuePence)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Open Workload Summary</h2>
          </div>
          <div className="management-stat-grid">
            <div className="management-stat-card">
              <span className="metric-label">Awaiting Approval</span>
              <strong className="metric-value">{awaitingApprovalCount}</strong>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Waiting for Parts</span>
              <strong className="metric-value">{waitingForPartsCount}</strong>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Due Today</span>
              <strong className="metric-value">{dashboardSummary?.dueToday ?? 0}</strong>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Overdue</span>
              <strong className="metric-value">{dashboardSummary?.overdue ?? 0}</strong>
            </div>
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
                {dashboardSummary?.byStatus ? (
                  Object.entries(dashboardSummary.byStatus)
                    .filter(([, count]) => count > 0)
                    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
                    .map(([status, count]) => (
                      <tr key={status}>
                        <td>{status}</td>
                        <td>{count}</td>
                      </tr>
                    ))
                ) : (
                  <tr>
                    <td colSpan={2}>No workload summary available.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Staff Workload Snapshot</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Assignee</th>
                  <th>Open Jobs</th>
                  <th>Awaiting Approval</th>
                  <th>Waiting for Parts</th>
                  <th>Ready</th>
                </tr>
              </thead>
              <tbody>
                {workloadRows.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No active workload snapshot available.</td>
                  </tr>
                ) : (
                  workloadRows.map((row) => (
                    <tr key={row.key}>
                      <td>{row.label}</td>
                      <td>{row.openJobs}</td>
                      <td>{row.awaitingApproval}</td>
                      <td>{row.waitingForParts}</td>
                      <td>{row.ready}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="muted-text">Uses current assignment data only. Jobs without an assignee are grouped under Unassigned.</p>
        </section>
      </div>
    </div>
  );
};
