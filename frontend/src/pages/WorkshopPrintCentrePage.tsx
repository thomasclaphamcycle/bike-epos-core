import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useToasts } from "../components/ToastProvider";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { toBackendUrl } from "../utils/backendUrl";

type PrintJob = {
  id: string;
  status: string;
  scheduledDate: string | null;
  bikeDescription: string | null;
  createdAt: string;
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
  } | null;
};

type DashboardResponse = {
  jobs: PrintJob[];
};

const customerName = (job: PrintJob) =>
  job.customer ? [job.customer.firstName, job.customer.lastName].filter(Boolean).join(" ") || "-" : "-";

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const toStatusBadgeClass = (status: string) => {
  if (status === "COMPLETED") return "status-badge status-complete";
  if (status === "BIKE_READY") return "status-badge status-ready";
  if (status === "WAITING_FOR_APPROVAL" || status === "WAITING_FOR_PARTS") return "status-badge status-warning";
  if (status === "CANCELLED") return "status-badge status-cancelled";
  return "status-badge status-info";
};

export const WorkshopPrintCentrePage = () => {
  const { error } = useToasts();
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);

  const loadJobs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        includeCancelled: "true",
        limit: "100",
      });
      if (status) {
        params.set("status", status);
      }
      if (debouncedSearch.trim()) {
        params.set("search", debouncedSearch.trim());
      }
      const payload = await apiGet<DashboardResponse>(`/api/workshop/dashboard?${params.toString()}`);
      setJobs(payload.jobs || []);
    } catch (loadError) {
      setJobs([]);
      error(loadError instanceof Error ? loadError.message : "Failed to load printable workshop jobs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, status]);

  const summary = useMemo(() => ({
    jobsVisible: jobs.length,
    withSale: jobs.filter((job) => Boolean(job.sale)).length,
    readyCollection: jobs.filter((job) => job.status === "BIKE_READY").length,
    awaitingApproval: jobs.filter((job) => job.status === "WAITING_FOR_APPROVAL").length,
  }), [jobs]);

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Workshop Print Centre</h1>
            <p className="muted-text">
              Central access point for the workshop print outputs already supported by the system. This does not create new document formats; it helps staff find and print the ones that already exist.
            </p>
          </div>
          <div className="actions-inline">
            <Link to="/workshop">Back to workshop</Link>
            <button type="button" onClick={() => void loadJobs()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="filter-row">
          <label className="grow">
            Search
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Customer, phone, email"
            />
          </label>
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All visible statuses</option>
              <option value="BOOKING_MADE">Booking Made</option>
              <option value="WAITING_FOR_APPROVAL">Waiting For Approval</option>
              <option value="WAITING_FOR_PARTS">Waiting For Parts</option>
              <option value="BIKE_READY">Ready</option>
              <option value="COMPLETED">Completed</option>
            </select>
          </label>
        </div>

        <div className="dashboard-summary-grid">
          <div className="metric-card">
            <span className="metric-label">Visible Jobs</span>
            <strong className="metric-value">{summary.jobsVisible}</strong>
            <span className="dashboard-metric-detail">Current print-centre result set</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Printable Receipts</span>
            <strong className="metric-value">{summary.withSale}</strong>
            <span className="dashboard-metric-detail">Jobs with linked sale visibility</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Ready Collection</span>
            <strong className="metric-value">{summary.readyCollection}</strong>
            <span className="dashboard-metric-detail">Potential handover paperwork candidates</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Awaiting Approval</span>
            <strong className="metric-value">{summary.awaitingApproval}</strong>
            <span className="dashboard-metric-detail">Estimate decisions still pending</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header-row">
          <h2>Available Workshop Documents</h2>
          <div className="actions-inline">
            <Link to="/workshop/check-in">Open check-in</Link>
            <Link to="/workshop/collection">Open collection</Link>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Bike</th>
                <th>Sale</th>
                <th>Documents</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={6}>No workshop jobs matched the current print filter.</td>
                </tr>
              ) : jobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <div className="table-primary mono-text">{job.id.slice(0, 8)}</div>
                    <div className="table-secondary">
                      {job.scheduledDate ? new Date(job.scheduledDate).toLocaleDateString() : new Date(job.createdAt).toLocaleDateString()}
                    </div>
                  </td>
                  <td>
                    <div className="table-primary">{customerName(job)}</div>
                    <div className="table-secondary">{job.customer?.phone || job.customer?.email || "-"}</div>
                  </td>
                  <td><span className={toStatusBadgeClass(job.status)}>{job.status}</span></td>
                  <td>{job.bikeDescription || "-"}</td>
                  <td>
                    {job.sale ? (
                      <div>
                        <div className="table-primary mono-text">{job.sale.id.slice(0, 8)}</div>
                        <div className="table-secondary">{formatMoney(job.sale.totalPence)}</div>
                      </div>
                    ) : (
                      <span className="table-secondary">No linked sale</span>
                    )}
                  </td>
                  <td>
                    <div className="document-link-grid">
                      <Link to={`/workshop/${job.id}`}>Open job</Link>
                      <a href={toBackendUrl(`/workshop/${encodeURIComponent(job.id)}/print`)} target="_blank" rel="noreferrer">
                        Print job card
                      </a>
                      {job.sale ? (
                        <a href={toBackendUrl(`/sales/${encodeURIComponent(job.sale.id)}/receipt`)} target="_blank" rel="noreferrer">
                          Print receipt
                        </a>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="restricted-panel info-panel" style={{ marginTop: "12px" }}>
          Estimate and approval print visibility uses the existing workshop print page because estimate contents already live on the workshop job.
        </div>
      </section>
    </div>
  );
};
