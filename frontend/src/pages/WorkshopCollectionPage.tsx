import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";
import { useToasts } from "../components/ToastProvider";

type CollectionJob = {
  id: string;
  status: string;
  scheduledDate: string | null;
  bikeDescription: string | null;
  depositStatus: string;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
  } | null;
  sale: {
    id: string;
    totalPence: number;
    createdAt: string;
  } | null;
  noteCount?: number;
};

type DashboardResponse = {
  jobs: CollectionJob[];
};

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;
const customerName = (job: CollectionJob) =>
  job.customer ? [job.customer.firstName, job.customer.lastName].filter(Boolean).join(" ") || "-" : "-";

export const WorkshopCollectionPage = () => {
  const { success, error } = useToasts();
  const [jobs, setJobs] = useState<CollectionJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);

  const loadReadyJobs = async () => {
    setLoading(true);
    try {
      const payload = await apiGet<DashboardResponse>("/api/workshop/dashboard?status=BIKE_READY&includeCancelled=false&limit=100");
      setJobs(payload.jobs || []);
    } catch (loadError) {
      setJobs([]);
      error(loadError instanceof Error ? loadError.message : "Failed to load collection queue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReadyJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = useMemo(() => ({
    readyCount: jobs.length,
    withSaleCount: jobs.filter((job) => Boolean(job.sale)).length,
    unpaidOrUnpreparedCount: jobs.filter((job) => !job.sale).length,
    depositPaidCount: jobs.filter((job) => job.depositStatus === "PAID" || job.depositStatus === "NOT_REQUIRED").length,
  }), [jobs]);

  const confirmCollected = async (jobId: string) => {
    setCompletingId(jobId);
    try {
      await apiPost(`/api/workshop/jobs/${encodeURIComponent(jobId)}/status`, {
        status: "COMPLETED",
      });
      success("Collection confirmed");
      await loadReadyJobs();
    } catch (completeError) {
      error(completeError instanceof Error ? completeError.message : "Failed to confirm collection");
    } finally {
      setCompletingId(null);
    }
  };

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Workshop Collection</h1>
            <p className="muted-text">
              Internal ready-for-collection queue for final handover. This shows the readiness signals the current workshop and sale data already supports.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/workshop">Back to workshop</Link>
            <button type="button" onClick={() => void loadReadyJobs()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Ready For Collection</span>
            <strong className="metric-value">{summary.readyCount}</strong>
            <span className="dashboard-metric-detail">Jobs currently in BIKE_READY state</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Linked Sale Visible</span>
            <strong className="metric-value">{summary.withSaleCount}</strong>
            <span className="dashboard-metric-detail">Jobs already linked to a sale record</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Needs Invoice / Payment Check</span>
            <strong className="metric-value">{summary.unpaidOrUnpreparedCount}</strong>
            <span className="dashboard-metric-detail">No linked sale visible yet</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Deposit OK</span>
            <strong className="metric-value">{summary.depositPaidCount}</strong>
            <span className="dashboard-metric-detail">Deposit paid or not required</span>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Ready Queue</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Bike</th>
                <th>Promised</th>
                <th>Deposit</th>
                <th>Sale Visibility</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={6}>No jobs are currently ready for collection.</td>
                </tr>
              ) : jobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <div className="table-primary">{customerName(job)}</div>
                    <div className="table-secondary">{job.customer?.phone || job.customer?.email || "-"}</div>
                  </td>
                  <td>{job.bikeDescription || "-"}</td>
                  <td>{job.scheduledDate ? new Date(job.scheduledDate).toLocaleDateString() : "-"}</td>
                  <td>{job.depositStatus}</td>
                  <td>
                    {job.sale ? (
                      <div>
                        <div className="table-primary">Sale {job.sale.id.slice(0, 8)}</div>
                        <div className="table-secondary">{formatMoney(job.sale.totalPence)}</div>
                      </div>
                    ) : (
                      <span className="parts-short">No linked sale visible</span>
                    )}
                  </td>
                  <td>
                    <div className="actions-inline">
                      <Link to={`/workshop/${job.id}`}>Open job</Link>
                      {job.sale ? <Link to={`/pos?saleId=${encodeURIComponent(job.sale.id)}`}>Open sale</Link> : null}
                      <button
                        type="button"
                        onClick={() => void confirmCollected(job.id)}
                        disabled={completingId === job.id}
                      >
                        {completingId === job.id ? "Confirming..." : "Confirm collection"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="restricted-panel info-panel" style={{ marginTop: "12px" }}>
          This queue uses current workshop status and sale linkage only. If a linked sale is not visible yet, drill into the job before handover.
        </div>
      </section>
    </div>
  );
};
