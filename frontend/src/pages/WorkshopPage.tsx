import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useToasts } from "../components/ToastProvider";

const statusOptions = [
  "",
  "BOOKING_MADE",
  "BIKE_ARRIVED",
  "WAITING_FOR_APPROVAL",
  "APPROVED",
  "WAITING_FOR_PARTS",
  "ON_HOLD",
  "BIKE_READY",
  "COMPLETED",
  "CANCELLED",
] as const;

type DashboardJob = {
  id: string;
  status: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  scheduledDate: string | null;
  bikeDescription: string | null;
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
  jobs: DashboardJob[];
};

const statusButtonActions: Array<{ label: string; value: string }> = [
  { label: "In Progress", value: "IN_PROGRESS" },
  { label: "Awaiting Parts", value: "WAITING_FOR_PARTS" },
  { label: "Ready", value: "READY" },
  { label: "Collected", value: "COMPLETED" },
  { label: "Cancelled", value: "CANCELLED" },
];

const getCustomerName = (job: DashboardJob) => {
  if (!job.customer) {
    return "-";
  }
  return [job.customer.firstName, job.customer.lastName].filter(Boolean).join(" ") || "-";
};

const formatMoney = (pence: number | null) => {
  if (pence === null) {
    return "-";
  }
  return `£${(pence / 100).toFixed(2)}`;
};

const toStatusBadgeClass = (status: string) => {
  if (status === "CANCELLED") return "status-badge status-cancelled";
  if (status === "COMPLETED") return "status-badge status-complete";
  if (status === "BIKE_READY") return "status-badge status-ready";
  if (status === "WAITING_FOR_PARTS") return "status-badge status-warning";
  return "status-badge";
};

const toPartsStatus = (job: DashboardJob) => (job.status === "WAITING_FOR_PARTS" ? "SHORT" : "OK");

export const WorkshopPage = () => {
  const navigate = useNavigate();
  const { success, error } = useToasts();

  const [status, setStatus] = useState<(typeof statusOptions)[number]>("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);

  const [jobs, setJobs] = useState<DashboardJob[]>([]);
  const [loading, setLoading] = useState(false);

  const listQuery = useMemo(() => {
    const query = new URLSearchParams();
    query.set("limit", "100");
    query.set("includeCancelled", "true");
    if (status) {
      query.set("status", status);
    }
    if (debouncedSearch.trim()) {
      query.set("search", debouncedSearch.trim());
    }
    return query.toString();
  }, [status, debouncedSearch]);

  const loadJobs = async () => {
    setLoading(true);
    try {
      const payload = await apiGet<DashboardResponse>(`/api/workshop/dashboard?${listQuery}`);
      setJobs(payload.jobs || []);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load workshop jobs";
      error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listQuery]);

  const updateStatus = async (jobId: string, nextStatus: string) => {
    try {
      await apiPost(`/api/workshop/jobs/${encodeURIComponent(jobId)}/status`, {
        status: nextStatus,
      });
      success("Job status updated");
      await loadJobs();
    } catch (statusError) {
      const message = statusError instanceof Error ? statusError.message : "Failed to update status";
      error(message);
    }
  };

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <h1>Workshop Dashboard</h1>
          <button type="button" onClick={() => void loadJobs()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="filter-row">
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value as (typeof statusOptions)[number])}>
              {statusOptions.map((option) => (
                <option key={option} value={option}>
                  {option || "All"}
                </option>
              ))}
            </select>
          </label>

          <label className="grow">
            Search Job / Customer
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="search notes, customer, contact"
            />
          </label>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Title</th>
                <th>Status</th>
                <th>Promised</th>
                <th>Customer</th>
                <th>Totals</th>
                <th>Parts</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={8}>No jobs found.</td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.id} className="clickable-row" onClick={() => navigate(`/workshop/${job.id}`)}>
                    <td>{job.id.slice(0, 8)}</td>
                    <td>{job.bikeDescription || "-"}</td>
                    <td>
                      <span className={toStatusBadgeClass(job.status)}>{job.status}</span>
                    </td>
                    <td>{job.scheduledDate ? new Date(job.scheduledDate).toLocaleDateString() : "-"}</td>
                    <td>{getCustomerName(job)}</td>
                    <td>{formatMoney(job.sale?.totalPence ?? null)}</td>
                    <td>
                      <span className={toPartsStatus(job) === "SHORT" ? "parts-short" : "parts-ok"}>
                        {toPartsStatus(job)}
                      </span>
                    </td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <div className="action-wrap">
                        {statusButtonActions.map((action) => (
                          <button
                            key={action.value}
                            type="button"
                            onClick={() => {
                              void updateStatus(job.id, action.value);
                            }}
                          >
                            {action.label}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
