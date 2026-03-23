import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { SavedViewControls } from "../components/SavedViewControls";
import { useToasts } from "../components/ToastProvider";
import { workshopRawStatusClass, workshopRawStatusLabel } from "../features/workshop/status";
import { type ReportSeverity, reportSeverityBadgeClass } from "../utils/reportSeverity";

type WorkshopDailyRow = {
  date: string;
  jobCount: number;
  revenuePence: number;
};

type RangePreset = "30" | "90" | "365";

type DurationMetric = {
  count: number;
  averageDays: number | null;
  medianDays: number | null;
};

type HoursMetric = {
  count: number;
  averageHours: number | null;
  medianHours: number | null;
};

type TechnicianThroughputRow = {
  technicianKey: string;
  staffId: string | null;
  staffName: string;
  completedJobs: number;
  activeJobs: number;
  waitingForApprovalJobs: number;
  waitingForPartsJobs: number;
  readyForCollectionJobs: number;
  averageCompletionDays: number | null;
};

type StalledJobRow = {
  jobId: string;
  customerName: string;
  bikeDescription: string | null;
  rawStatus: string;
  assignedStaffName: string | null;
  scheduledDate: string | null;
  scheduledStartAt: string | null;
  createdAt: string;
  updatedAt: string;
  ageDays: number;
  stageAgeDays: number | null;
  stageAgeBasis: "QUOTE_REQUESTED_AT" | "JOB_UPDATED_AT" | "JOB_CREATED_AT" | null;
  stallReason: string;
  severity: ReportSeverity;
};

type WorkshopAnalyticsResponse = {
  generatedAt: string;
  range: {
    from: string;
    to: string;
    dayCount: number;
  };
  limitations: string[];
  turnaround: {
    createdToCompleted: DurationMetric;
    createdToClosed: DurationMetric;
    approvalDecision: HoursMetric;
  };
  quoteConversion: {
    requestedCount: number;
    approvedCount: number;
    rejectedCount: number;
    pendingCount: number;
    supersededCount: number;
    conversionRate: number | null;
    decisionRate: number | null;
    pendingAverageAgeDays: number | null;
    oldestPendingAgeDays: number | null;
  };
  currentQueue: {
    openJobCount: number;
    dueTodayCount: number;
    overdueCount: number;
    unassignedCount: number;
    waitingForApprovalCount: number;
    waitingForPartsCount: number;
    pausedCount: number;
    readyForCollectionCount: number;
    byStatus: Record<string, number>;
  };
  technicianThroughput: {
    completedJobCount: number;
    activeAssignedJobCount: number;
    unassignedOpenJobCount: number;
    rows: TechnicianThroughputRow[];
  };
  stalledJobs: {
    openJobCount: number;
    stalledCount: number;
    olderThan14DaysCount: number;
    ageingBuckets: {
      zeroToTwoDays: number;
      threeToSevenDays: number;
      eightToFourteenDays: number;
      fifteenToThirtyDays: number;
      thirtyOnePlusDays: number;
    };
    rows: StalledJobRow[];
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

const formatDays = (value: number | null | undefined) =>
  value === null || value === undefined ? "-" : `${value.toFixed(1)}d`;

const formatHours = (value: number | null | undefined) =>
  value === null || value === undefined ? "-" : `${value.toFixed(1)}h`;

const formatPercent = (value: number | null | undefined) =>
  value === null || value === undefined ? "-" : `${value.toFixed(1)}%`;

const formatDateTime = (value: string | null | undefined) => {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }

  return parsed.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: value.includes("T") ? "short" : undefined,
  });
};

const stageAgeBasisLabel = (basis: StalledJobRow["stageAgeBasis"]) => {
  switch (basis) {
    case "QUOTE_REQUESTED_AT":
      return "quote age";
    case "JOB_UPDATED_AT":
      return "last update proxy";
    case "JOB_CREATED_AT":
      return "job age";
    default:
      return "age";
  }
};

export const WorkshopPerformancePage = () => {
  const { error } = useToasts();

  const [rangePreset, setRangePreset] = useState<RangePreset>("90");
  const [dailyRows, setDailyRows] = useState<WorkshopDailyRow[]>([]);
  const [analytics, setAnalytics] = useState<WorkshopAnalyticsResponse | null>(null);
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

    const [dailyResult, analyticsResult] = await Promise.allSettled([
      apiGet<WorkshopDailyRow[]>(`/api/reports/workshop/daily?from=${from}&to=${to}`),
      apiGet<WorkshopAnalyticsResponse>(`/api/reports/workshop/analytics?from=${from}&to=${to}`),
    ]);

    if (dailyResult.status === "fulfilled") {
      setDailyRows(dailyResult.value || []);
    } else {
      setDailyRows([]);
      error(dailyResult.reason instanceof Error ? dailyResult.reason.message : "Failed to load workshop daily report");
    }

    if (analyticsResult.status === "fulfilled") {
      setAnalytics(analyticsResult.value);
    } else {
      setAnalytics(null);
      error(analyticsResult.reason instanceof Error ? analyticsResult.reason.message : "Failed to load workshop analytics");
    }

    setLoading(false);
  };

  useEffect(() => {
    void loadMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangePreset]);

  const dailyTotals = useMemo(() => {
    const completedJobs = dailyRows.reduce((sum, row) => sum + row.jobCount, 0);
    const revenuePence = dailyRows.reduce((sum, row) => sum + row.revenuePence, 0);
    const averageJobsPerDay = dailyRows.length > 0 ? Number((completedJobs / dailyRows.length).toFixed(1)) : 0;
    return {
      completedJobs,
      revenuePence,
      averageJobsPerDay,
    };
  }, [dailyRows]);

  const currentQueueRows = useMemo(
    () => Object.entries(analytics?.currentQueue.byStatus ?? {})
      .filter(([, count]) => count > 0)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])),
    [analytics?.currentQueue.byStatus],
  );

  const ageingBuckets = analytics?.stalledJobs.ageingBuckets ?? {
    zeroToTwoDays: 0,
    threeToSevenDays: 0,
    eightToFourteenDays: 0,
    fifteenToThirtyDays: 0,
    thirtyOnePlusDays: 0,
  };

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Workshop Analytics</h1>
            <p className="muted-text">
              Manager-facing reporting for turnaround, quote conversion, technician load, and jobs that are slowing the workshop down.
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
            <strong className="metric-value">{analytics?.turnaround.createdToCompleted.count ?? 0}</strong>
            <span className="dashboard-metric-detail">Within selected range</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Avg Turnaround</span>
            <strong className="metric-value">{formatDays(analytics?.turnaround.createdToCompleted.averageDays)}</strong>
            <span className="dashboard-metric-detail">Created to completed</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Avg To Collection</span>
            <strong className="metric-value">{formatDays(analytics?.turnaround.createdToClosed.averageDays)}</strong>
            <span className="dashboard-metric-detail">Created to closed / collected</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Quote Approval Rate</span>
            <strong className="metric-value">{formatPercent(analytics?.quoteConversion.conversionRate)}</strong>
            <span className="dashboard-metric-detail">
              Decision rate {formatPercent(analytics?.quoteConversion.decisionRate)}
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Pending Quotes</span>
            <strong className="metric-value">{analytics?.quoteConversion.pendingCount ?? 0}</strong>
            <span className="dashboard-metric-detail">
              Oldest {formatDays(analytics?.quoteConversion.oldestPendingAgeDays)}
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Open Jobs</span>
            <strong className="metric-value">{analytics?.currentQueue.openJobCount ?? 0}</strong>
            <span className="dashboard-metric-detail">
              Due today {analytics?.currentQueue.dueTodayCount ?? 0} | Overdue {analytics?.currentQueue.overdueCount ?? 0}
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Waiting for Parts</span>
            <strong className="metric-value">{analytics?.currentQueue.waitingForPartsCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Current blocked bench work</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Stalled Jobs</span>
            <strong className="metric-value">{analytics?.stalledJobs.stalledCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Top follow-up list on this page</span>
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
            <div>
              <h2>Turnaround & Quote Decisions</h2>
              <p className="muted-text">
                Turnaround is grounded in actual job timestamps. Quote conversion is based on estimate versions requested during the selected range.
              </p>
            </div>
            <div className="actions-inline">
              <Link to="/management/workshop-ageing">Ageing detail</Link>
              <Link to="/workshop">Open workshop</Link>
            </div>
          </div>

          <div className="management-stat-grid">
            <div className="management-stat-card">
              <span className="metric-label">Created → Completed</span>
              <strong className="metric-value">{formatDays(analytics?.turnaround.createdToCompleted.averageDays)}</strong>
              <span className="dashboard-metric-detail">
                Median {formatDays(analytics?.turnaround.createdToCompleted.medianDays)}
              </span>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Created → Closed</span>
              <strong className="metric-value">{formatDays(analytics?.turnaround.createdToClosed.averageDays)}</strong>
              <span className="dashboard-metric-detail">
                Median {formatDays(analytics?.turnaround.createdToClosed.medianDays)}
              </span>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Approval Delay</span>
              <strong className="metric-value">{formatHours(analytics?.turnaround.approvalDecision.averageHours)}</strong>
              <span className="dashboard-metric-detail">
                Median {formatHours(analytics?.turnaround.approvalDecision.medianHours)}
              </span>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Quotes Requested</span>
              <strong className="metric-value">{analytics?.quoteConversion.requestedCount ?? 0}</strong>
              <span className="dashboard-metric-detail">
                Approved {analytics?.quoteConversion.approvedCount ?? 0} | Rejected {analytics?.quoteConversion.rejectedCount ?? 0}
              </span>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Value</th>
                  <th>Meaning</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Quotes requested</td>
                  <td>{analytics?.quoteConversion.requestedCount ?? 0}</td>
                  <td>Estimate versions sent to customers in the selected range.</td>
                </tr>
                <tr>
                  <td>Approved</td>
                  <td>{analytics?.quoteConversion.approvedCount ?? 0}</td>
                  <td>Quotes from that range that have been approved.</td>
                </tr>
                <tr>
                  <td>Rejected</td>
                  <td>{analytics?.quoteConversion.rejectedCount ?? 0}</td>
                  <td>Quotes from that range that were rejected.</td>
                </tr>
                <tr>
                  <td>Pending</td>
                  <td>{analytics?.quoteConversion.pendingCount ?? 0}</td>
                  <td>Still awaiting a decision.</td>
                </tr>
                <tr>
                  <td>Superseded</td>
                  <td>{analytics?.quoteConversion.supersededCount ?? 0}</td>
                  <td>Replaced quote versions kept for truthful history.</td>
                </tr>
                <tr>
                  <td>Approval rate</td>
                  <td>{formatPercent(analytics?.quoteConversion.conversionRate)}</td>
                  <td>Approved quotes as a share of quotes requested.</td>
                </tr>
                <tr>
                  <td>Pending quote age</td>
                  <td>{formatDays(analytics?.quoteConversion.pendingAverageAgeDays)}</td>
                  <td>Average age of quotes still waiting on a customer answer.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Technician Throughput</h2>
              <p className="muted-text">
                Uses the current assignment on each job. This is honest workload reporting, not per-line labour attribution.
              </p>
            </div>
            <Link to="/workshop/calendar">Calendar</Link>
          </div>

          <div className="management-stat-grid">
            <div className="management-stat-card">
              <span className="metric-label">Completed Jobs</span>
              <strong className="metric-value">{analytics?.technicianThroughput.completedJobCount ?? 0}</strong>
              <span className="dashboard-metric-detail">Attributed by current job assignee</span>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Assigned Active Load</span>
              <strong className="metric-value">{analytics?.technicianThroughput.activeAssignedJobCount ?? 0}</strong>
              <span className="dashboard-metric-detail">Open jobs with a named technician</span>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Unassigned Open Jobs</span>
              <strong className="metric-value">{analytics?.technicianThroughput.unassignedOpenJobCount ?? 0}</strong>
              <span className="dashboard-metric-detail">Still waiting for ownership</span>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Technician</th>
                  <th>Completed</th>
                  <th>Active Load</th>
                  <th>Waiting Approval</th>
                  <th>Waiting Parts</th>
                  <th>Ready</th>
                  <th>Avg Turnaround</th>
                </tr>
              </thead>
              <tbody>
                {(analytics?.technicianThroughput.rows ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={7}>No technician throughput data available for this range.</td>
                  </tr>
                ) : (
                  analytics?.technicianThroughput.rows.map((row) => (
                    <tr key={row.technicianKey}>
                      <td>{row.staffName}</td>
                      <td>{row.completedJobs}</td>
                      <td>{row.activeJobs}</td>
                      <td>{row.waitingForApprovalJobs}</td>
                      <td>{row.waitingForPartsJobs}</td>
                      <td>{row.readyForCollectionJobs}</td>
                      <td>{formatDays(row.averageCompletionDays)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Open Queue & Bottlenecks</h2>
              <p className="muted-text">
                Current queue pressure uses the live workshop board, while ageing buckets use job created date because stage-entry timestamps are still limited.
              </p>
            </div>
            <div className="actions-inline">
              <Link to="/management/capacity">Capacity</Link>
              <Link to="/management/workshop-ageing">Ageing detail</Link>
            </div>
          </div>

          <div className="management-stat-grid">
            <div className="management-stat-card">
              <span className="metric-label">Open Jobs</span>
              <strong className="metric-value">{analytics?.currentQueue.openJobCount ?? 0}</strong>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Due Today</span>
              <strong className="metric-value">{analytics?.currentQueue.dueTodayCount ?? 0}</strong>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Overdue</span>
              <strong className="metric-value">{analytics?.currentQueue.overdueCount ?? 0}</strong>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Waiting Approval</span>
              <strong className="metric-value">{analytics?.currentQueue.waitingForApprovalCount ?? 0}</strong>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Waiting Parts</span>
              <strong className="metric-value">{analytics?.currentQueue.waitingForPartsCount ?? 0}</strong>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Ready For Collection</span>
              <strong className="metric-value">{analytics?.currentQueue.readyForCollectionCount ?? 0}</strong>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Paused</span>
              <strong className="metric-value">{analytics?.currentQueue.pausedCount ?? 0}</strong>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Older Than 14 Days</span>
              <strong className="metric-value">{analytics?.stalledJobs.olderThan14DaysCount ?? 0}</strong>
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
                {currentQueueRows.length === 0 ? (
                  <tr>
                    <td colSpan={2}>No current workshop queue data available.</td>
                  </tr>
                ) : currentQueueRows.map(([status, count]) => (
                  <tr key={status}>
                    <td>
                      <span className={workshopRawStatusClass(status)}>{workshopRawStatusLabel(status)}</span>
                    </td>
                    <td>{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="age-bucket-grid">
            <div className="age-bucket-card">
              <span className="metric-label">0-2 days</span>
              <strong className="metric-value">{ageingBuckets.zeroToTwoDays}</strong>
            </div>
            <div className="age-bucket-card">
              <span className="metric-label">3-7 days</span>
              <strong className="metric-value">{ageingBuckets.threeToSevenDays}</strong>
            </div>
            <div className="age-bucket-card">
              <span className="metric-label">8-14 days</span>
              <strong className="metric-value">{ageingBuckets.eightToFourteenDays}</strong>
            </div>
            <div className="age-bucket-card">
              <span className="metric-label">15-30 days</span>
              <strong className="metric-value">{ageingBuckets.fifteenToThirtyDays}</strong>
            </div>
            <div className="age-bucket-card">
              <span className="metric-label">31+ days</span>
              <strong className="metric-value">{ageingBuckets.thirtyOnePlusDays}</strong>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Jobs Needing Management Follow-up</h2>
              <p className="muted-text">
                This list prioritises blocked, overdue, or ageing jobs that are most likely to create customer friction or throughput drag.
              </p>
            </div>
            <Link to="/management/workshop-ageing">Full ageing view</Link>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Status</th>
                  <th>Customer / Bike</th>
                  <th>Assignee</th>
                  <th>Age</th>
                  <th>Stall Age</th>
                  <th>Reason</th>
                  <th>Severity</th>
                </tr>
              </thead>
              <tbody>
                {(analytics?.stalledJobs.rows ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={8}>No stalled workshop jobs in the current live queue.</td>
                  </tr>
                ) : (
                  analytics?.stalledJobs.rows.map((row) => (
                    <tr key={row.jobId}>
                      <td><Link to={`/workshop/${row.jobId}`}>{row.jobId.slice(0, 8)}</Link></td>
                      <td><span className={workshopRawStatusClass(row.rawStatus)}>{workshopRawStatusLabel(row.rawStatus)}</span></td>
                      <td>
                        <strong>{row.customerName}</strong>
                        <div className="muted-text">{row.bikeDescription || "-"}</div>
                      </td>
                      <td>
                        {row.assignedStaffName || "Unassigned"}
                        <div className="muted-text">
                          {row.scheduledStartAt ? formatDateTime(row.scheduledStartAt) : formatDateTime(row.scheduledDate)}
                        </div>
                      </td>
                      <td>{row.ageDays}d</td>
                      <td>{row.stageAgeDays === null ? "-" : `${row.stageAgeDays}d · ${stageAgeBasisLabel(row.stageAgeBasis)}`}</td>
                      <td>{row.stallReason}</td>
                      <td><span className={reportSeverityBadgeClass[row.severity]}>{row.severity}</span></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Daily Completions</h2>
              <p className="muted-text">
                {dailyTotals.completedJobs} completed jobs and {formatMoney(dailyTotals.revenuePence)} workshop revenue in the selected range.
              </p>
            </div>
            <Link to="/management">Back to management</Link>
          </div>

          <div className="management-stat-grid">
            <div className="management-stat-card">
              <span className="metric-label">Completed Jobs</span>
              <strong className="metric-value">{dailyTotals.completedJobs}</strong>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Average / Day</span>
              <strong className="metric-value">{dailyTotals.averageJobsPerDay.toFixed(1)}</strong>
            </div>
            <div className="management-stat-card">
              <span className="metric-label">Revenue</span>
              <strong className="metric-value">{formatMoney(dailyTotals.revenuePence)}</strong>
            </div>
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
            <h2>Metric Notes</h2>
          </div>
          <ul>
            {(analytics?.limitations ?? []).map((item) => (
              <li key={item} className="muted-text">{item}</li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
};
