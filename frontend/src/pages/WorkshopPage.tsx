import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useToasts } from "../components/ToastProvider";
import { workshopRawStatusClass, workshopRawStatusLabel } from "../features/workshop/status";

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
type QuickAction = {
  label: string;
  kind: "status" | "approval" | "navigate";
  value: string;
};

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
  finalizedBasketId?: string | null;
  partsStatus?: "OK" | "UNALLOCATED" | "SHORT";
  partsSummary?: {
    requiredQty: number;
    allocatedQty: number;
    consumedQty: number;
    returnedQty: number;
    outstandingQty: number;
    missingQty: number;
    partsStatus: "OK" | "UNALLOCATED" | "SHORT";
  } | null;
};

type DashboardResponse = {
  staffingToday: {
    summary: {
      date: string;
      isClosed: boolean;
      closedReason: string | null;
      opensAt: string | null;
      closesAt: string | null;
      scheduledStaffCount: number;
      holidayStaffCount: number;
      totalScheduledStaffCount: number;
      totalHolidayStaffCount: number;
      coverageStatus: "closed" | "none" | "thin" | "covered";
    };
    context: {
      usesOperationalRoleTags: boolean;
      fallbackToBroadStaffing: boolean;
    };
    scheduledStaff: Array<{
      staffId: string;
      name: string;
      role: "STAFF" | "MANAGER" | "ADMIN";
      operationalRole: "WORKSHOP" | "SALES" | "ADMIN" | "MIXED" | null;
      shiftType: "FULL_DAY" | "HALF_DAY_AM" | "HALF_DAY_PM" | "HOLIDAY";
      note: string | null;
      source: "MANUAL" | "IMPORT" | "HOLIDAY_APPROVED";
    }>;
    holidayStaff: Array<{
      staffId: string;
      name: string;
      role: "STAFF" | "MANAGER" | "ADMIN";
      operationalRole: "WORKSHOP" | "SALES" | "ADMIN" | "MIXED" | null;
      shiftType: "FULL_DAY" | "HALF_DAY_AM" | "HALF_DAY_PM" | "HOLIDAY";
      note: string | null;
      source: "MANUAL" | "IMPORT" | "HOLIDAY_APPROVED";
    }>;
  };
  capacityToday: {
    status: "CLOSED" | "NO_COVER" | "LIGHT" | "NORMAL" | "BUSY" | "OVERLOADED";
    label: string;
    explanation: string;
    metrics: {
      scheduledStaffCount: number;
      totalScheduledStaffCount: number;
      dueTodayJobs: number;
      overdueJobs: number;
      openJobs: number;
      activeWorkloadJobs: number;
    };
  };
  jobs: DashboardJob[];
};

const boardColumns: Array<{
  key: DisplayBucket;
  label: string;
  description: string;
}> = [
  { key: "booked", label: "Booked", description: "Checked in or waiting for quote approval" },
  { key: "inProgress", label: "In Progress", description: "On the bench, approved, or paused safely" },
  { key: "waitingParts", label: "Waiting for Parts", description: "Blocked on stock or supplier lead time" },
  { key: "ready", label: "Ready for Collection", description: "Bench work is complete and handover can begin" },
  { key: "completed", label: "Collected", description: "Already handed over and out of the live queue" },
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

const formatDate = (value: string | null) => {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleDateString();
};

const formatTradingWindow = (opensAt: string | null, closesAt: string | null) => {
  if (!opensAt || !closesAt) {
    return null;
  }
  return `${opensAt}-${closesAt}`;
};

const toCapacityBadgeClass = (
  status: DashboardResponse["capacityToday"]["status"],
) => {
  switch (status) {
    case "CLOSED":
      return "status-badge status-info";
    case "NO_COVER":
    case "OVERLOADED":
      return "status-badge status-cancelled";
    case "BUSY":
      return "status-badge status-warning";
    case "LIGHT":
      return "status-badge status-complete";
    default:
      return "status-badge status-info";
  }
};

const toBucketLabel = (bucket: DisplayBucket | null) => {
  if (!bucket) {
    return "-";
  }

  switch (bucket) {
    case "booked":
      return "Booked";
    case "inProgress":
      return "In Progress";
    case "waitingParts":
      return "Waiting for Parts";
    case "ready":
      return "Ready for Collection";
    case "completed":
      return "Collected";
    default:
      return bucket;
  }
};

const toShiftLabel = (shiftType: "FULL_DAY" | "HALF_DAY_AM" | "HALF_DAY_PM" | "HOLIDAY") => {
  switch (shiftType) {
    case "FULL_DAY":
      return "Full day";
    case "HALF_DAY_AM":
      return "AM";
    case "HALF_DAY_PM":
      return "PM";
    case "HOLIDAY":
      return "Holiday";
    default:
      return shiftType;
  }
};

const toPartsStatus = (job: DashboardJob) => {
  if (job.partsStatus) {
    return job.partsStatus;
  }
  return job.status === "WAITING_FOR_PARTS" ? "SHORT" : "OK";
};

const getNextStepHint = (job: DashboardJob) => {
  switch (job.status) {
    case "BOOKING_MADE":
      return "Check-in is complete. Start work or send the quote for approval when needed.";
    case "WAITING_FOR_APPROVAL":
      return "Quote is pending. Pause bench work until the customer approves or the quote is revised.";
    case "BIKE_ARRIVED":
      return "Bike is on site and ready for bench work.";
    case "APPROVED":
      return "Quote is approved. Keep the job moving toward ready for collection.";
    case "WAITING_FOR_PARTS":
      return "Check the parts gap before promising collection.";
    case "ON_HOLD":
      return "Job is paused. Resolve the hold reason before resuming work.";
    case "BIKE_READY":
      return job.finalizedBasketId ? "Handoff is ready in the collection queue." : "Open the collection handoff when the customer arrives.";
    case "COMPLETED":
      return "Bike has been collected. Review only for any follow-up.";
    default:
      return "Open the job for full details and actions.";
  }
};

const getUrgency = (job: DashboardJob) => {
  if (!job.scheduledDate || job.status === "COMPLETED" || job.status === "CANCELLED") {
    return null;
  }

  const scheduled = new Date(job.scheduledDate);
  const due = new Date(scheduled.getFullYear(), scheduled.getMonth(), scheduled.getDate()).getTime();
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

  if (due < todayStart) {
    return {
      label: "Overdue",
      className: "status-badge status-cancelled",
      rank: 0,
    };
  }

  if (due === todayStart) {
    return {
      label: "Due Today",
      className: "status-badge status-warning",
      rank: 1,
    };
  }

  return {
    label: "Upcoming",
    className: "status-badge",
    rank: 2,
  };
};

const compareJobs = (left: DashboardJob, right: DashboardJob) => {
  const leftUrgency = getUrgency(left)?.rank ?? 3;
  const rightUrgency = getUrgency(right)?.rank ?? 3;
  if (leftUrgency !== rightUrgency) {
    return leftUrgency - rightUrgency;
  }

  const leftScheduled = left.scheduledDate ? new Date(left.scheduledDate).getTime() : Number.MAX_SAFE_INTEGER;
  const rightScheduled = right.scheduledDate ? new Date(right.scheduledDate).getTime() : Number.MAX_SAFE_INTEGER;
  if (leftScheduled !== rightScheduled) {
    return leftScheduled - rightScheduled;
  }

  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
};

const toDisplayBucket = (job: DashboardJob): DisplayBucket | null => {
  const partsStatus = toPartsStatus(job);
  switch (job.status) {
    case "BOOKING_MADE":
    case "WAITING_FOR_APPROVAL":
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
      return partsStatus === "SHORT" ? "waitingParts" : "inProgress";
  }
};

const getQuickActions = (job: DashboardJob): QuickAction[] => {
  switch (job.status) {
    case "BOOKING_MADE":
      return [
        { label: "Send Quote", kind: "approval", value: "WAITING_FOR_APPROVAL" },
        { label: "Start Work", kind: "status", value: "IN_PROGRESS" },
        { label: "Cancel", kind: "status", value: "CANCELLED" },
      ];
    case "WAITING_FOR_APPROVAL":
      return [
        { label: "Mark Quote Approved", kind: "approval", value: "APPROVED" },
        { label: "Cancel", kind: "status", value: "CANCELLED" },
      ];
    case "BIKE_ARRIVED":
    case "ON_HOLD":
      return [
        { label: "Send Quote", kind: "approval", value: "WAITING_FOR_APPROVAL" },
        { label: "Ready for Collection", kind: "status", value: "READY" },
        { label: "Cancel", kind: "status", value: "CANCELLED" },
      ];
    case "APPROVED":
      return [
        { label: "Ready for Collection", kind: "status", value: "READY" },
        { label: "Cancel", kind: "status", value: "CANCELLED" },
      ];
    case "WAITING_FOR_PARTS":
      return [
        { label: "Resume", kind: "status", value: "IN_PROGRESS" },
        { label: "Ready for Collection", kind: "status", value: "READY" },
        { label: "Cancel", kind: "status", value: "CANCELLED" },
      ];
    case "BIKE_READY":
      return [
        { label: "Collection Queue", kind: "navigate", value: "/workshop/collection" },
        { label: "Cancel", kind: "status", value: "CANCELLED" },
      ];
    default:
      return [];
  }
};

export const WorkshopPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { success, error } = useToasts();

  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const [status, setStatus] = useState<(typeof statusOptions)[number]>("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);

  const [jobs, setJobs] = useState<DashboardJob[]>([]);
  const [staffingToday, setStaffingToday] = useState<DashboardResponse["staffingToday"] | null>(null);
  const [capacityToday, setCapacityToday] = useState<DashboardResponse["capacityToday"] | null>(null);
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
      setStaffingToday(payload.staffingToday ?? null);
      setCapacityToday(payload.capacityToday ?? null);
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

  const updateApprovalStatus = async (
    jobId: string,
    nextStatus: "WAITING_FOR_APPROVAL" | "APPROVED",
  ) => {
    try {
      await apiPost(`/api/workshop/jobs/${encodeURIComponent(jobId)}/approval`, {
        status: nextStatus,
      });
      success(nextStatus === "APPROVED" ? "Quote marked approved" : "Quote marked pending approval");
      await loadJobs();
    } catch (statusError) {
      const message = statusError instanceof Error ? statusError.message : "Failed to update approval";
      error(message);
    }
  };

  const runQuickAction = async (jobId: string, action: QuickAction) => {
    if (action.kind === "approval") {
      await updateApprovalStatus(jobId, action.value as "WAITING_FOR_APPROVAL" | "APPROVED");
      return;
    }

    if (action.kind === "navigate") {
      navigate(action.value);
      return;
    }

    await updateStatus(jobId, action.value);
  };

  const bucketedJobs = useMemo(
    () =>
      boardColumns.map((column) => ({
        ...column,
        jobs: jobs.filter((job) => toDisplayBucket(job) === column.key).sort(compareJobs),
      })),
    [jobs],
  );

  const hiddenFromBoardCount = useMemo(
    () => jobs.filter((job) => toDisplayBucket(job) === null).length,
    [jobs],
  );

  const queueSummary = useMemo(() => {
    const overdueCount = jobs.filter((job) => getUrgency(job)?.label === "Overdue").length;
    const dueTodayCount = jobs.filter((job) => getUrgency(job)?.label === "Due Today").length;
    const readyCount = jobs.filter((job) => toDisplayBucket(job) === "ready").length;
    const partsBlockedCount = jobs.filter((job) => toPartsStatus(job) === "SHORT").length;

    return {
      overdueCount,
      dueTodayCount,
      readyCount,
      partsBlockedCount,
    };
  }, [jobs]);

  const staffingWindow = staffingToday
    ? formatTradingWindow(staffingToday.summary.opensAt, staffingToday.summary.closesAt)
    : null;
  const canManageStaffTags = user?.role === "MANAGER" || user?.role === "ADMIN";

  return (
    <div className="page-shell">
      <section className="card">
        <div className="card-header-row">
          <div>
            <h1>Workshop Dashboard</h1>
            <p className="muted-text">
              Track execution flow on the board or switch to list view for workflow detail, quote state, and queue search.
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

        {staffingToday ? (
          <section
            className={[
              "restricted-panel",
              "workshop-staffing-panel",
              staffingToday.summary.coverageStatus === "closed"
                ? "info-panel"
                : staffingToday.summary.coverageStatus === "thin" || staffingToday.summary.coverageStatus === "none"
                  ? "warning-panel"
                  : "info-panel",
            ].join(" ")}
          >
            <div className="workshop-staffing-header">
              <div>
                <strong>Workshop staffing today</strong>
                <div className="muted-text">
                  {staffingToday.summary.isClosed
                    ? staffingToday.summary.closedReason || "Store closed today."
                    : staffingToday.context.usesOperationalRoleTags
                      ? staffingWindow
                        ? `Using workshop role tags · Trading hours ${staffingWindow}.`
                        : "Using workshop role tags for today’s rota coverage."
                    : staffingWindow
                      ? `Using broader rota cover until workshop tags are set · Trading hours ${staffingWindow}.`
                      : "Using broader rota cover until workshop tags are set."}
                </div>
              </div>
              <div className="status-stack">
                <span
                  className={
                    staffingToday.summary.coverageStatus === "closed"
                      ? "status-badge status-info"
                      : staffingToday.summary.coverageStatus === "thin" || staffingToday.summary.coverageStatus === "none"
                        ? "status-badge status-warning"
                        : "status-badge status-info"
                  }
                >
                  {staffingToday.summary.coverageStatus === "closed"
                    ? "Closed"
                    : staffingToday.summary.coverageStatus === "thin"
                      ? "Thin cover"
                      : staffingToday.summary.coverageStatus === "none"
                        ? "No cover"
                        : "Covered"}
                </span>
                {staffingToday.summary.holidayStaffCount ? (
                  <span className="status-badge">
                    {staffingToday.summary.holidayStaffCount} on holiday
                  </span>
                ) : null}
                {staffingToday.context.usesOperationalRoleTags ? (
                  <span className="status-badge status-info">Workshop-tagged</span>
                ) : null}
              </div>
            </div>

            {staffingToday.summary.isClosed ? null : staffingToday.scheduledStaff.length ? (
              <div className="workshop-staffing-list">
                {staffingToday.scheduledStaff.map((entry) => (
                  <span
                    key={`${entry.staffId}-${entry.shiftType}`}
                    className="stock-badge workshop-staffing-chip"
                    title={`${entry.name} · ${toShiftLabel(entry.shiftType)}${entry.note ? ` · ${entry.note}` : ""}`}
                  >
                    {entry.name} · {toShiftLabel(entry.shiftType)}
                  </span>
                ))}
              </div>
            ) : (
              <div className="muted-text workshop-staffing-empty">
                No staff scheduled today.
              </div>
            )}

            {!staffingToday.summary.isClosed && staffingToday.context.fallbackToBroadStaffing ? (
              <div className="workshop-staffing-subline muted-text">
                Showing all scheduled staff because no workshop operational tags are set for today&apos;s rota.
                {canManageStaffTags ? (
                  <>
                    {" "}
                    <Link to="/management/staff">Tag staff roles</Link>.
                  </>
                ) : null}
              </div>
            ) : null}

            {staffingToday.holidayStaff.length ? (
              <div className="workshop-staffing-subline muted-text">
                On holiday: {staffingToday.holidayStaff.map((entry) => entry.name).join(", ")}.
              </div>
            ) : null}

            {staffingToday.context.usesOperationalRoleTags
              && staffingToday.summary.totalScheduledStaffCount > staffingToday.summary.scheduledStaffCount ? (
              <div className="workshop-staffing-subline muted-text">
                {staffingToday.summary.totalScheduledStaffCount - staffingToday.summary.scheduledStaffCount} other scheduled staff are outside the workshop tag filter.
              </div>
            ) : null}
          </section>
        ) : null}

        {capacityToday ? (
          <section
            className={[
              "restricted-panel",
              "workshop-capacity-panel",
              capacityToday.status === "CLOSED" || capacityToday.status === "NORMAL" || capacityToday.status === "LIGHT"
                ? "info-panel"
                : "warning-panel",
            ].join(" ")}
          >
            <div className="workshop-capacity-header">
              <div>
                <strong>Workshop capacity today</strong>
                <p className="muted-text workshop-capacity-copy">{capacityToday.explanation}</p>
              </div>
              <span className={toCapacityBadgeClass(capacityToday.status)}>
                {capacityToday.label}
              </span>
            </div>

            <div className="workshop-capacity-metrics">
              <div className="workshop-capacity-metric">
                <span className="table-secondary">Staff in today</span>
                <strong>{capacityToday.metrics.scheduledStaffCount}</strong>
              </div>
              <div className="workshop-capacity-metric">
                <span className="table-secondary">Jobs due today</span>
                <strong>{capacityToday.metrics.dueTodayJobs}</strong>
              </div>
              <div className="workshop-capacity-metric">
                <span className="table-secondary">Overdue</span>
                <strong>{capacityToday.metrics.overdueJobs}</strong>
              </div>
              <div className="workshop-capacity-metric">
                <span className="table-secondary">Active queue</span>
                <strong>{capacityToday.metrics.activeWorkloadJobs}</strong>
              </div>
            </div>

            {!staffingToday?.summary.isClosed
              && staffingToday?.context.usesOperationalRoleTags
              && capacityToday.metrics.totalScheduledStaffCount > capacityToday.metrics.scheduledStaffCount ? (
              <p className="muted-text workshop-capacity-copy">
                Capacity is based on workshop-tagged cover. {capacityToday.metrics.totalScheduledStaffCount - capacityToday.metrics.scheduledStaffCount} other scheduled staff are outside the workshop filter.
              </p>
            ) : null}
          </section>
        ) : null}

        <div className="filter-row">
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value as (typeof statusOptions)[number])}>
              {statusOptions.map((option) => (
                <option key={option} value={option}>
                  {option ? workshopRawStatusLabel(option) : "All"}
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

        <div className="dashboard-summary-grid workshop-summary-grid">
          <article className="metric-card">
            <span className="metric-label">Overdue Jobs</span>
            <strong>{queueSummary.overdueCount}</strong>
            <span className="dashboard-metric-detail">Promised date has already passed.</span>
          </article>
          <article className="metric-card">
            <span className="metric-label">Due Today</span>
            <strong>{queueSummary.dueTodayCount}</strong>
            <span className="dashboard-metric-detail">Useful front-desk follow-up list for today.</span>
          </article>
          <article className="metric-card">
            <span className="metric-label">Ready For Collection</span>
            <strong>{queueSummary.readyCount}</strong>
            <span className="dashboard-metric-detail">Bikes ready to hand over or send to collection.</span>
          </article>
          <article className="metric-card">
            <span className="metric-label">Parts Blocked</span>
            <strong>{queueSummary.partsBlockedCount}</strong>
            <span className="dashboard-metric-detail">Jobs that still need parts attention.</span>
          </article>
        </div>

        {viewMode === "board" ? (
          <>
            {hiddenFromBoardCount > 0 ? (
              <div className="restricted-panel">
                {hiddenFromBoardCount} job{hiddenFromBoardCount === 1 ? "" : "s"} currently sit outside the
                board buckets. Switch to list view to review every raw workflow state and find the next action.
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
                        <div className="workshop-empty-card">
                          {column.label} is clear right now. Move a job here from the board or use list view to work
                          from the full queue.
                        </div>
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
                              <div className="status-stack">
                                <span className={workshopRawStatusClass(job.status)}>{workshopRawStatusLabel(job.status)}</span>
                                {getUrgency(job) ? (
                                  <span className={getUrgency(job)?.className}>{getUrgency(job)?.label}</span>
                                ) : null}
                              </div>
                            </div>

                            <div className="workshop-job-meta">
                              <span>Customer: {getCustomerName(job)}</span>
                              <span>
                                Promised: {formatDate(job.scheduledDate)}
                              </span>
                              <span>Value: {formatMoney(job.sale?.totalPence ?? null)}</span>
                              <span
                                className={
                                  toPartsStatus(job) === "SHORT"
                                    ? "parts-short"
                                    : toPartsStatus(job) === "UNALLOCATED"
                                      ? "parts-attention"
                                      : "parts-ok"
                                }
                              >
                                Parts: {toPartsStatus(job)}
                              </span>
                            </div>

                            {job.notes ? <p className="muted-text workshop-note-preview">{job.notes}</p> : null}
                            {job.partsSummary?.missingQty ? (
                              <p className="muted-text workshop-note-preview">
                                Missing parts: {job.partsSummary.missingQty}
                              </p>
                            ) : null}
                            <p className="muted-text workshop-action-hint">{getNextStepHint(job)}</p>

                            <div
                              className="action-wrap"
                              onClick={(event) => event.stopPropagation()}
                            >
                              {getQuickActions(job).length === 0 ? (
                                <span className="muted-text">Open job for full actions</span>
                              ) : (
                                getQuickActions(job).map((action) => (
                                  <button
                                    key={`${action.kind}:${action.value}`}
                                    type="button"
                                    onClick={() => {
                                      void runQuickAction(job.id, action);
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
                  <th>Workflow Detail</th>
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
                    <td colSpan={9}>No jobs match the current filters.</td>
                  </tr>
                ) : (
                  jobs.map((job) => (
                    <tr key={job.id} className="clickable-row" onClick={() => navigate(`/workshop/${job.id}`)}>
                      <td>{job.id.slice(0, 8)}</td>
                      <td>{job.bikeDescription || "-"}</td>
                      <td>{toBucketLabel(toDisplayBucket(job))}</td>
                      <td>
                        <div className="status-stack">
                          <span className={workshopRawStatusClass(job.status)}>{workshopRawStatusLabel(job.status)}</span>
                          {getUrgency(job) ? (
                            <span className={getUrgency(job)?.className}>{getUrgency(job)?.label}</span>
                          ) : null}
                        </div>
                      </td>
                      <td>{formatDate(job.scheduledDate)}</td>
                      <td>{getCustomerName(job)}</td>
                      <td>{formatMoney(job.sale?.totalPence ?? null)}</td>
                      <td>
                        <span
                          className={
                            toPartsStatus(job) === "SHORT"
                              ? "parts-short"
                              : toPartsStatus(job) === "UNALLOCATED"
                                ? "parts-attention"
                                : "parts-ok"
                          }
                        >
                          {toPartsStatus(job)}
                        </span>
                        {job.partsSummary?.missingQty ? (
                          <div className="table-secondary">Missing {job.partsSummary.missingQty}</div>
                        ) : null}
                      </td>
                      <td onClick={(event) => event.stopPropagation()}>
                        <div className="action-wrap">
                          {getQuickActions(job).length === 0 ? (
                            <span className="muted-text">Open job for details</span>
                          ) : (
                            getQuickActions(job).map((action) => (
                              <button
                                key={`${action.kind}:${action.value}`}
                                type="button"
                                onClick={() => {
                                  void runQuickAction(job.id, action);
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
