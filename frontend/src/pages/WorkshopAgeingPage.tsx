import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";

type DashboardJob = {
  id: string;
  status: string;
  scheduledDate: string | null;
  createdAt: string;
  updatedAt: string;
  partsStatus?: "OK" | "UNALLOCATED" | "SHORT";
  customer: {
    firstName: string;
    lastName: string;
  } | null;
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

const OPEN_STATUSES = new Set([
  "BOOKED",
  "IN_PROGRESS",
  "WAITING_FOR_APPROVAL",
  "WAITING_FOR_PARTS",
  "ON_HOLD",
  "READY_FOR_COLLECTION",
]);

const dayDiff = (value: string) => Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000));

const customerName = (customer: DashboardJob["customer"]) =>
  customer ? [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "-" : "-";

const ageBucketLabel = (days: number) => {
  if (days <= 2) {
    return "0-2 days";
  }
  if (days <= 7) {
    return "3-7 days";
  }
  if (days <= 14) {
    return "8-14 days";
  }
  if (days <= 30) {
    return "15-30 days";
  }
  return "31+ days";
};

export const WorkshopAgeingPage = () => {
  const { error } = useToasts();
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const payload = await apiGet<DashboardResponse>("/api/workshop/dashboard?limit=200&includeCancelled=false");
      setDashboard(payload);
    } catch (loadError) {
      error(loadError instanceof Error ? loadError.message : "Failed to load workshop ageing view");
      setDashboard(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openJobs = useMemo(
    () => (dashboard?.jobs ?? []).filter((job) => OPEN_STATUSES.has(job.status)),
    [dashboard?.jobs],
  );

  const jobsByAgeBucket = useMemo(() => {
    const buckets = new Map<string, number>([
      ["0-2 days", 0],
      ["3-7 days", 0],
      ["8-14 days", 0],
      ["15-30 days", 0],
      ["31+ days", 0],
    ]);

    for (const job of openJobs) {
      const key = ageBucketLabel(dayDiff(job.createdAt));
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }

    return Array.from(buckets.entries()).map(([label, count]) => ({ label, count }));
  }, [openJobs]);

  const awaitingApproval = useMemo(
    () => openJobs
      .filter((job) => job.status === "WAITING_FOR_APPROVAL")
      .sort((left, right) => dayDiff(right.updatedAt) - dayDiff(left.updatedAt)),
    [openJobs],
  );

  const waitingForParts = useMemo(
    () => openJobs
      .filter((job) => job.status === "WAITING_FOR_PARTS" || job.partsStatus === "SHORT")
      .sort((left, right) => dayDiff(right.updatedAt) - dayDiff(left.updatedAt)),
    [openJobs],
  );

  const oldestOpenJobs = useMemo(
    () => [...openJobs].sort((left, right) => dayDiff(right.createdAt) - dayDiff(left.createdAt)).slice(0, 20),
    [openJobs],
  );

  const averageOpenAge = useMemo(
    () => openJobs.length > 0
      ? Number((openJobs.reduce((sum, job) => sum + dayDiff(job.createdAt), 0) / openJobs.length).toFixed(1))
      : 0,
    [openJobs],
  );

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Workshop Ageing & SLA</h1>
            <p className="muted-text">
              Manager-facing open-job ageing view. Job age uses created date. Waiting-stage duration uses the last job update as an honest proxy because exact stage-entry timestamps are not currently stored.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/management">Back to management</Link>
            <button type="button" onClick={() => void loadDashboard()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Open Jobs</span>
            <strong className="metric-value">{openJobs.length}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Average Open Age</span>
            <strong className="metric-value">{averageOpenAge.toFixed(1)}d</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Awaiting Approval</span>
            <strong className="metric-value">{awaitingApproval.length}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Waiting For Parts</span>
            <strong className="metric-value">{waitingForParts.length}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Overdue</span>
            <strong className="metric-value">{dashboard?.summary.overdue ?? 0}</strong>
          </div>
        </div>
      </section>

      <div className="dashboard-grid analytics-grid">
        <section className="card">
          <div className="card-header-row">
            <h2>Open Jobs By Age</h2>
            <Link to="/management/workshop">Workshop metrics</Link>
          </div>
          <div className="age-bucket-grid">
            {jobsByAgeBucket.map((bucket) => (
              <div key={bucket.label} className="age-bucket-card">
                <span className="metric-label">{bucket.label}</span>
                <strong className="metric-value">{bucket.count}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Oldest Open Jobs</h2>
            <Link to="/workshop">Open workshop</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Status</th>
                  <th>Customer</th>
                  <th>Age</th>
                  <th>Scheduled</th>
                </tr>
              </thead>
              <tbody>
                {oldestOpenJobs.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No open workshop jobs.</td>
                  </tr>
                ) : oldestOpenJobs.map((job) => (
                  <tr key={job.id}>
                    <td><Link to={`/workshop/${job.id}`}>{job.id.slice(0, 8)}</Link></td>
                    <td>{job.status}</td>
                    <td>{customerName(job.customer)}</td>
                    <td>{dayDiff(job.createdAt)}d</td>
                    <td>{job.scheduledDate ? new Date(job.scheduledDate).toLocaleDateString() : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Waiting For Approval</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Customer</th>
                  <th>Job Age</th>
                  <th>Status Age Proxy</th>
                </tr>
              </thead>
              <tbody>
                {awaitingApproval.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No jobs currently waiting for approval.</td>
                  </tr>
                ) : awaitingApproval.map((job) => (
                  <tr key={job.id}>
                    <td><Link to={`/workshop/${job.id}`}>{job.id.slice(0, 8)}</Link></td>
                    <td>{customerName(job.customer)}</td>
                    <td>{dayDiff(job.createdAt)}d</td>
                    <td>{dayDiff(job.updatedAt)}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted-text">Status age proxy uses the last job update timestamp because exact stage-entry timestamps are not stored yet.</p>
        </section>

        <section className="card">
          <div className="card-header-row">
            <h2>Waiting For Parts</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Customer</th>
                  <th>Job Age</th>
                  <th>Status Age Proxy</th>
                  <th>Parts Status</th>
                </tr>
              </thead>
              <tbody>
                {waitingForParts.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No jobs currently waiting for parts.</td>
                  </tr>
                ) : waitingForParts.map((job) => (
                  <tr key={job.id}>
                    <td><Link to={`/workshop/${job.id}`}>{job.id.slice(0, 8)}</Link></td>
                    <td>{customerName(job.customer)}</td>
                    <td>{dayDiff(job.createdAt)}d</td>
                    <td>{dayDiff(job.updatedAt)}d</td>
                    <td>{job.partsStatus ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted-text">Waiting-for-parts includes explicit waiting status and short-part jobs from current parts allocation signals.</p>
        </section>
      </div>
    </div>
  );
};
