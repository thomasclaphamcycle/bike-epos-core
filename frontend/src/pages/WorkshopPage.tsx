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

type ViewMode = "board" | "list";
type DisplayBucket = "booked" | "inProgress" | "waitingParts" | "ready" | "completed";

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

const boardColumns: Array<{
  key: DisplayBucket;
  label: string;
  description: string;
}> = [
  { key: "booked", label: "Booked", description: "New and scheduled work" },
  { key: "inProgress", label: "In Progress", description: "Actively being worked" },
  { key: "waitingParts", label: "Waiting Parts", description: "Blocked on parts" },
  { key: "ready", label: "Ready", description: "Ready for collection or close-out" },
  { key: "completed", label: "Completed", description: "Collected or completed work" },
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
  if (status === "APPROVED" || status === "ON_HOLD" || status === "WAITING_FOR_APPROVAL") {
    return "status-badge status-info";
  }
  return "status-badge";
};

const toPartsStatus = (job: DashboardJob) => (job.status === "WAITING_FOR_PARTS" ? "SHORT" : "OK");

const toDisplayBucket = (job: DashboardJob): DisplayBucket | null => {
  switch (job.status) {
    case "BOOKING_MADE":
      return "booked";
    case "WAITING_FOR_PARTS":
      return "waitingParts";
    case "BIKE_READY":
      return "ready";
    case "COMPLETED":
      return "completed";
    case "CANCELLED":
      return null;
    default:
      return "inProgress";
  }
};

const getQuickActions = (job: DashboardJob): Array<{ label: string; value: string }> => {
  const bucket = toDisplayBucket(job);

  switch (bucket) {
    case "booked":
      return [
        { label: "Start Work", value: "IN_PROGRESS" },
        { label: "Cancel", value: "CANCELLED" },
      ];
    case "inProgress":
      return [
        { label: "Ready", value: "READY" },
        { label: "Cancel", value: "CANCELLED" },
      ];
    case "waitingParts":
      return [
        { label: "Resume", value: "IN_PROGRESS" },
        { label: "Ready", value: "READY" },
        { label: "Cancel", value: "CANCELLED" },
      ];
    case "ready":
      return [
        { label: "Complete", value: "COMPLETED" },
        { label: "Cancel", value: "CANCELLED" },
      ];
    case "completed":
    default:
      return [];
  }
};

export const WorkshopPage = () => {
  const navigate = useNavigate();
  const { success, error } = useToasts();

  const [viewMode, setViewMode] = useState<ViewMode>("board");
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

  const bucketedJobs = useMemo(
    () =>
      boardColumns.map((column) => ({
        ...column,
        jobs: jobs.filter((job) => toDisplayBucket(job) === column.key),
      })),
    [jobs],
  );

  const hiddenFromBoardCount = useMemo(
    () => jobs.filter((job) => toDisplayBucket(job) === null).length,
    [jobs],
  );

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Workshop Dashboard</h1>
            <p className="muted-text">
              Board buckets are frontend display groups over the existing workshop statuses.
            </p>
          </div>
          <div className="actions-inline">
            <div className="view-toggle">
              <button
                type="button"
                className={viewMode === "board" ? "primary" : undefined}
                onClick={() => setViewMode("board")}
              >
                Board
              </button>
              <button
                type="button"
                className={viewMode === "list" ? "primary" : undefined}
                onClick={() => setViewMode("list")}
              >
                List
              </button>
            </div>
            <button type="button" onClick={() => void loadJobs()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
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

        {viewMode === "board" ? (
          <>
            {hiddenFromBoardCount > 0 ? (
              <div className="restricted-panel">
                {hiddenFromBoardCount} job{hiddenFromBoardCount === 1 ? "" : "s"} currently hidden from the
                board because their raw status is not shown in the board columns. Use list view for the full raw
                status set.
              </div>
            ) : null}

            <div className="workshop-board">
              {boardColumns.map((column) => {
                const columnJobs = bucketedJobs.find((bucket) => bucket.key === column.key)?.jobs ?? [];

                return (
                  <section key={column.key} className="workshop-column">
                    <header className="workshop-column-header">
                      <div>
                        <h2>{column.label}</h2>
                        <p className="muted-text">{column.description}</p>
                      </div>
                      <span className="stock-badge stock-muted">{columnJobs.length}</span>
                    </header>

                    <div className="workshop-column-body">
                      {columnJobs.length === 0 ? (
                        <div className="workshop-empty-card">No jobs in this bucket.</div>
                      ) : (
                        columnJobs.map((job) => (
                          <article
                            key={job.id}
                            className="workshop-job-card"
                            onClick={() => navigate(`/workshop/${job.id}`)}
                          >
                            <div className="workshop-job-header">
                              <div>
                                <strong>{job.bikeDescription || "Workshop job"}</strong>
                                <div className="table-secondary mono-text">{job.id.slice(0, 8)}</div>
                              </div>
                              <span className={toStatusBadgeClass(job.status)}>{job.status}</span>
                            </div>

                            <div className="workshop-job-meta">
                              <span>Customer: {getCustomerName(job)}</span>
                              <span>
                                Promised: {job.scheduledDate ? new Date(job.scheduledDate).toLocaleDateString() : "-"}
                              </span>
                              <span>Value: {formatMoney(job.sale?.totalPence ?? null)}</span>
                              <span className={toPartsStatus(job) === "SHORT" ? "parts-short" : "parts-ok"}>
                                Parts: {toPartsStatus(job)}
                              </span>
                            </div>

                            {job.notes ? <p className="muted-text workshop-note-preview">{job.notes}</p> : null}

                            <div
                              className="action-wrap"
                              onClick={(event) => event.stopPropagation()}
                            >
                              {getQuickActions(job).length === 0 ? (
                                <span className="muted-text">No quick actions</span>
                              ) : (
                                getQuickActions(job).map((action) => (
                                  <button
                                    key={action.value}
                                    type="button"
                                    onClick={() => {
                                      void updateStatus(job.id, action.value);
                                    }}
                                  >
                                    {action.label}
                                  </button>
                                ))
                              )}
                            </div>
                          </article>
                        ))
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Title</th>
                  <th>Board Bucket</th>
                  <th>Raw Status</th>
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
                    <td colSpan={9}>No jobs found.</td>
                  </tr>
                ) : (
                  jobs.map((job) => (
                    <tr key={job.id} className="clickable-row" onClick={() => navigate(`/workshop/${job.id}`)}>
                      <td>{job.id.slice(0, 8)}</td>
                      <td>{job.bikeDescription || "-"}</td>
                      <td>{toDisplayBucket(job)?.replace(/([A-Z])/g, " $1").replace(/^./, (value) => value.toUpperCase()) || "-"}</td>
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
                          {getQuickActions(job).length === 0 ? (
                            <span className="muted-text">No actions</span>
                          ) : (
                            getQuickActions(job).map((action) => (
                              <button
                                key={action.value}
                                type="button"
                                onClick={() => {
                                  void updateStatus(job.id, action.value);
                                }}
                              >
                                {action.label}
                              </button>
                            ))
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
