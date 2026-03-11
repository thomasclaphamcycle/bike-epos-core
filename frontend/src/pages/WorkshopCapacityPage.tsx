import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";

type WorkshopCapacityResponse = {
  generatedAt: string;
  lookbackDays: number;
  openJobCount: number;
  waitingForApprovalCount: number;
  waitingForPartsCount: number;
  completedJobsLast30Days: number;
  averageCompletedPerDay: number;
  estimatedBacklogDays: number | null;
  ageingBuckets: {
    zeroToTwoDays: number;
    threeToSevenDays: number;
    eightToFourteenDays: number;
    fifteenPlusDays: number;
  };
};

type AgeingRow = {
  label: string;
  count: number;
  actionPath: string;
  actionLabel: string;
};

const backlogBadgeClass = (backlogDays: number | null) => {
  if (backlogDays === null) {
    return "status-badge";
  }
  if (backlogDays >= 10) {
    return "status-badge status-cancelled";
  }
  if (backlogDays >= 5) {
    return "status-badge status-warning";
  }
  return "status-badge status-complete";
};

const backlogLabel = (backlogDays: number | null) => {
  if (backlogDays === null) {
    return "No throughput data";
  }
  if (backlogDays >= 10) {
    return "High pressure";
  }
  if (backlogDays >= 5) {
    return "Moderate pressure";
  }
  return "Manageable";
};

export const WorkshopCapacityPage = () => {
  const { error } = useToasts();
  const [report, setReport] = useState<WorkshopCapacityResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const loadReport = async () => {
    setLoading(true);
    try {
      const payload = await apiGet<WorkshopCapacityResponse>("/api/reports/workshop/capacity");
      setReport(payload);
    } catch (loadError) {
      setReport(null);
      error(loadError instanceof Error ? loadError.message : "Failed to load workshop capacity");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ageingRows = useMemo<AgeingRow[]>(() => ([
    {
      label: "0 to 2 days",
      count: report?.ageingBuckets.zeroToTwoDays ?? 0,
      actionPath: "/workshop",
      actionLabel: "Open workshop",
    },
    {
      label: "3 to 7 days",
      count: report?.ageingBuckets.threeToSevenDays ?? 0,
      actionPath: "/management/workshop-ageing",
      actionLabel: "Review ageing",
    },
    {
      label: "8 to 14 days",
      count: report?.ageingBuckets.eightToFourteenDays ?? 0,
      actionPath: "/management/workshop-ageing",
      actionLabel: "Review ageing",
    },
    {
      label: "15+ days",
      count: report?.ageingBuckets.fifteenPlusDays ?? 0,
      actionPath: "/management/workshop-ageing",
      actionLabel: "Escalate backlog",
    },
  ]), [report]);

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Workshop Capacity</h1>
            <p className="muted-text">
              Practical management view of workshop backlog, ageing, and recent completion throughput using current job statuses and the last {report?.lookbackDays ?? 30} days of completions.
            </p>
          </div>
          <div className="actions-inline">
            <button type="button" onClick={() => void loadReport()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            <Link to="/workshop">Workshop</Link>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Open Jobs</span>
            <strong className="metric-value">{report?.openJobCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Current active workshop backlog</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Waiting Approval</span>
            <strong className="metric-value">{report?.waitingForApprovalCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Jobs blocked on customer decision</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Waiting Parts</span>
            <strong className="metric-value">{report?.waitingForPartsCount ?? 0}</strong>
            <span className="dashboard-metric-detail">Jobs blocked on parts arrival</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Completed (30d)</span>
            <strong className="metric-value">{report?.completedJobsLast30Days ?? 0}</strong>
            <span className="dashboard-metric-detail">Recent throughput baseline</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Average / Day</span>
            <strong className="metric-value">{(report?.averageCompletedPerDay ?? 0).toFixed(1)}</strong>
            <span className="dashboard-metric-detail">Based on last 30 days</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Backlog Days</span>
            <strong className="metric-value">{report?.estimatedBacklogDays === null ? "-" : report?.estimatedBacklogDays.toFixed(1)}</strong>
            <span className="dashboard-metric-detail">
              <span className={backlogBadgeClass(report?.estimatedBacklogDays ?? null)}>
                {backlogLabel(report?.estimatedBacklogDays ?? null)}
              </span>
            </span>
          </div>
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Capacity Pressure</h2>
              <p className="muted-text">
                Use backlog days as the simple operating signal: open jobs divided by recent average completions per day.
              </p>
            </div>
            <Link to="/management/workshop">Workshop metrics</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Value</th>
                  <th>Use</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Open jobs</td>
                  <td>{report?.openJobCount ?? 0}</td>
                  <td>Gauge the size of the live queue.</td>
                </tr>
                <tr>
                  <td>Average completions per day</td>
                  <td>{(report?.averageCompletedPerDay ?? 0).toFixed(1)}</td>
                  <td>Use as the practical recent capacity baseline.</td>
                </tr>
                <tr>
                  <td>Estimated backlog days</td>
                  <td>{report?.estimatedBacklogDays === null ? "-" : report.estimatedBacklogDays.toFixed(1)}</td>
                  <td>Quick pressure read for booking promises and queue triage.</td>
                </tr>
                <tr>
                  <td>Blocked jobs</td>
                  <td>{(report?.waitingForApprovalCount ?? 0) + (report?.waitingForPartsCount ?? 0)}</td>
                  <td>Jobs needing follow-up before throughput can improve.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Open Job Ageing</h2>
              <p className="muted-text">
                Ageing uses job created date because exact stage-entry timestamps are not stored in the current workshop model.
              </p>
            </div>
            <Link to="/management/workshop-ageing">Ageing detail</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Age Bucket</th>
                  <th>Open Jobs</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {ageingRows.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td>{row.count}</td>
                    <td><Link to={row.actionPath}>{row.actionLabel}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Follow-up Focus</h2>
              <p className="muted-text">
                These are the operational queues most likely to reduce backlog quickly.
              </p>
            </div>
            <Link to="/workshop/bookings">Bookings</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Queue</th>
                  <th>Count</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Waiting for approval</td>
                  <td>{report?.waitingForApprovalCount ?? 0}</td>
                  <td><Link to="/workshop">Call customer / approve work</Link></td>
                </tr>
                <tr>
                  <td>Waiting for parts</td>
                  <td>{report?.waitingForPartsCount ?? 0}</td>
                  <td><Link to="/management/workshop-ageing">Chase blocked jobs</Link></td>
                </tr>
                <tr>
                  <td>All open work</td>
                  <td>{report?.openJobCount ?? 0}</td>
                  <td><Link to="/workshop">Rebalance workshop board</Link></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};
