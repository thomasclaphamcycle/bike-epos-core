import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useToasts } from "../components/ToastProvider";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import {
  WorkshopSchedulerScreen,
  type CalendarViewMode,
  shiftWorkshopAnchorDateKey,
  workshopTodayDateKey,
} from "./WorkshopCalendarPage";
import {
  getWorkshopTechnicianWorkflowSummary,
  workshopRawStatusClass,
  workshopRawStatusLabel,
} from "../features/workshop/status";
import { WorkshopCheckInModal } from "../features/workshop/WorkshopCheckInModal";

const statusOptions = [
  "",
  "BOOKED",
  "BIKE_ARRIVED",
  "IN_PROGRESS",
  "WAITING_FOR_APPROVAL",
  "WAITING_FOR_PARTS",
  "ON_HOLD",
  "READY_FOR_COLLECTION",
  "COMPLETED",
  "CANCELLED",
] as const;

type SurfaceMode = "week" | "day" | "list";
type QuickFilterKey =
  | "ALL"
  | "MY_JOBS"
  | "DUE_TODAY"
  | "OVERDUE"
  | "WAITING_FOR_PARTS"
  | "READY_FOR_COLLECTION";

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
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  durationMinutes: number | null;
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
  assignedStaffId?: string | null;
  assignedStaffName?: string | null;
  partsStatus?: "OK" | "UNALLOCATED" | "SHORT";
};

type DashboardResponse = {
  jobs: DashboardJob[];
};

type TechnicianOption = {
  id: string;
  name: string;
};

const quickFilters: Array<{
  key: QuickFilterKey;
  label: string;
  description: string;
}> = [
  { key: "ALL", label: "All", description: "Everything currently in the workshop queue." },
  { key: "MY_JOBS", label: "My Jobs", description: "Jobs assigned directly to you." },
  { key: "DUE_TODAY", label: "Due Today", description: "Promised today and needs front-of-house attention." },
  { key: "OVERDUE", label: "Overdue", description: "Promised date has already passed." },
  { key: "WAITING_FOR_PARTS", label: "Waiting for Parts", description: "Bench work is blocked on stock." },
  { key: "READY_FOR_COLLECTION", label: "Bike Ready", description: "Bench work is complete and handover can start." },
];

const buildDashboardQuery = (input: {
  status?: string;
  search?: string;
}) => {
  const query = new URLSearchParams();
  query.set("limit", "100");
  query.set("includeCancelled", "true");
  if (input.status) {
    query.set("status", input.status);
  }
  if (input.search?.trim()) {
    query.set("search", input.search.trim());
  }
  return query.toString();
};

const getCustomerName = (job: DashboardJob) =>
  job.customer
    ? [job.customer.firstName, job.customer.lastName].filter(Boolean).join(" ") || "Customer linked"
    : "Customer pending";

const formatDate = (value: string | null) => {
  if (!value) {
    return "Unscheduled";
  }
  return new Date(value).toLocaleDateString([], {
    day: "numeric",
    month: "short",
  });
};

const formatDateTime = (value: string | null) => {
  if (!value) {
    return "Not set";
  }
  return new Date(value).toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatTimeRange = (job: DashboardJob) => {
  if (!job.scheduledStartAt) {
    return job.scheduledDate ? `Due ${formatDate(job.scheduledDate)}` : "Needs scheduling";
  }

  const start = new Date(job.scheduledStartAt);
  const end = job.scheduledEndAt ? new Date(job.scheduledEndAt) : null;
  const startLabel = start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const endLabel = end ? end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  return `${formatDate(job.scheduledStartAt)} · ${startLabel}${endLabel ? `-${endLabel}` : ""}`;
};

const toPartsStatus = (job: DashboardJob) => {
  if (job.partsStatus) {
    return job.partsStatus;
  }
  return job.status === "WAITING_FOR_PARTS" ? "SHORT" : "OK";
};

const getPartsClassName = (job: DashboardJob) => {
  switch (toPartsStatus(job)) {
    case "SHORT":
      return "parts-short";
    case "UNALLOCATED":
      return "parts-attention";
    default:
      return "parts-ok";
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

  const leftScheduled = left.scheduledStartAt
    ? new Date(left.scheduledStartAt).getTime()
    : left.scheduledDate
      ? new Date(left.scheduledDate).getTime()
      : Number.MAX_SAFE_INTEGER;
  const rightScheduled = right.scheduledStartAt
    ? new Date(right.scheduledStartAt).getTime()
    : right.scheduledDate
      ? new Date(right.scheduledDate).getTime()
      : Number.MAX_SAFE_INTEGER;

  if (leftScheduled !== rightScheduled) {
    return leftScheduled - rightScheduled;
  }

  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
};

const matchesQuickFilter = (
  job: DashboardJob,
  filter: QuickFilterKey,
  currentUserId: string | null | undefined,
) => {
  switch (filter) {
    case "MY_JOBS":
      return Boolean(currentUserId) && job.assignedStaffId === currentUserId;
    case "DUE_TODAY":
      return getUrgency(job)?.label === "Due Today";
    case "OVERDUE":
      return getUrgency(job)?.label === "Overdue";
    case "WAITING_FOR_PARTS":
      return job.status === "WAITING_FOR_PARTS" || toPartsStatus(job) === "SHORT";
    case "READY_FOR_COLLECTION":
      return job.status === "READY_FOR_COLLECTION";
    default:
      return true;
  }
};

const getQuickActions = (job: DashboardJob): QuickAction[] => {
  switch (job.status) {
    case "BOOKED":
    case "BIKE_ARRIVED":
      return [
        { label: "Send Quote", kind: "approval", value: "WAITING_FOR_APPROVAL" },
        { label: "Move to Bench", kind: "status", value: "IN_PROGRESS" },
      ];
    case "WAITING_FOR_APPROVAL":
      return [
        { label: "Mark Approved", kind: "approval", value: "APPROVED" },
      ];
    case "IN_PROGRESS":
      return [
        { label: "Waiting for Parts", kind: "status", value: "WAITING_FOR_PARTS" },
        { label: "Bike Ready", kind: "status", value: "READY_FOR_COLLECTION" },
      ];
    case "WAITING_FOR_PARTS":
      return [
        { label: "Resume Bench Work", kind: "status", value: "IN_PROGRESS" },
      ];
    case "ON_HOLD":
      return [
        { label: "Resume Bench Work", kind: "status", value: "IN_PROGRESS" },
        { label: "Waiting for Parts", kind: "status", value: "WAITING_FOR_PARTS" },
      ];
    case "READY_FOR_COLLECTION":
      return [
        { label: "Collection Queue", kind: "navigate", value: "/workshop/collection" },
      ];
    default:
      return [
        { label: "Open Job", kind: "navigate", value: `/workshop/${job.id}` },
      ];
  }
};

export const WorkshopPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { success, error } = useToasts();

  const [surfaceMode, setSurfaceMode] = useState<SurfaceMode>("week");
  const [anchorDateKey, setAnchorDateKey] = useState(workshopTodayDateKey());
  const [quickFilter, setQuickFilter] = useState<QuickFilterKey>("ALL");
  const [status, setStatus] = useState<(typeof statusOptions)[number]>("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [selectedTechnicianId, setSelectedTechnicianId] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [jobs, setJobs] = useState<DashboardJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [schedulerRefreshToken, setSchedulerRefreshToken] = useState(0);
  const [isIntakeOpen, setIsIntakeOpen] = useState(false);
  const [postCreateJobId, setPostCreateJobId] = useState<string | null>(null);
  const [selectedListJobId, setSelectedListJobId] = useState<string | null>(null);

  const listQuery = useMemo(
    () => buildDashboardQuery({ status, search: debouncedSearch }),
    [status, debouncedSearch],
  );

  const loadJobs = async (queryString = listQuery) => {
    setLoading(true);
    try {
      const payload = await apiGet<DashboardResponse>(`/api/workshop/dashboard?${queryString}`);
      setJobs(payload.jobs || []);
    } catch (loadError) {
      error(loadError instanceof Error ? loadError.message : "Failed to load workshop jobs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listQuery]);

  useEffect(() => {
    if (surfaceMode !== "list") {
      setSelectedListJobId(null);
    }
  }, [surfaceMode]);

  const technicianOptions = useMemo(() => {
    const optionMap = new Map<string, string>();

    jobs.forEach((job) => {
      if (job.assignedStaffId && job.assignedStaffName) {
        optionMap.set(job.assignedStaffId, job.assignedStaffName);
      }
    });

    if (user?.id) {
      optionMap.set(user.id, user.name || user.username);
    }

    const options = Array.from(optionMap)
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name));

    if (user?.role === "STAFF") {
      return options.filter((option) => option.id === user.id);
    }

    return options;
  }, [jobs, user?.id, user?.name, user?.role, user?.username]);

  const visibleJobs = useMemo(
    () => jobs.filter((job) => {
      if (!showCompleted && job.status === "COMPLETED") {
        return false;
      }
      if (selectedTechnicianId && job.assignedStaffId !== selectedTechnicianId) {
        return false;
      }
      return matchesQuickFilter(job, quickFilter, user?.id);
    }),
    [jobs, quickFilter, selectedTechnicianId, showCompleted, user?.id],
  );

  useEffect(() => {
    if (selectedListJobId && !visibleJobs.some((job) => job.id === selectedListJobId)) {
      setSelectedListJobId(null);
    }
  }, [selectedListJobId, visibleJobs]);

  const visibleJobIds = useMemo(
    () => new Set(visibleJobs.map((job) => job.id)),
    [visibleJobs],
  );

  const needsSchedulingJobs = useMemo(
    () => visibleJobs
      .filter((job) => !job.scheduledStartAt && job.status !== "COMPLETED" && job.status !== "CANCELLED")
      .sort(compareJobs)
      .slice(0, 6),
    [visibleJobs],
  );

  const listAlerts = useMemo(() => {
    const approval = visibleJobs.filter((job) => job.status === "WAITING_FOR_APPROVAL").length;
    const parts = visibleJobs.filter((job) => job.status === "WAITING_FOR_PARTS" || toPartsStatus(job) === "SHORT").length;
    const ready = visibleJobs.filter((job) => job.status === "READY_FOR_COLLECTION").length;

    return [
      { key: "approval", label: "Waiting for approval", count: approval, tone: approval ? "status-warning" : "status-badge" },
      { key: "parts", label: "Waiting for parts", count: parts, tone: parts ? "status-warning" : "status-badge" },
      { key: "ready", label: "Ready for collection", count: ready, tone: ready ? "status-complete" : "status-badge" },
    ];
  }, [visibleJobs]);

  const selectedListJob = useMemo(
    () => visibleJobs.find((job) => job.id === selectedListJobId) ?? null,
    [selectedListJobId, visibleJobs],
  );

  const selectedListWorkflow = selectedListJob
    ? getWorkshopTechnicianWorkflowSummary({
        rawStatus: selectedListJob.status,
        partsStatus: selectedListJob.partsStatus,
        assignedStaffName: selectedListJob.assignedStaffName,
        scheduledDate: selectedListJob.scheduledDate,
        hasSale: Boolean(selectedListJob.sale),
        hasBasket: Boolean(selectedListJob.finalizedBasketId),
      })
    : null;

  const selectedListActions = selectedListJob ? getQuickActions(selectedListJob) : [];
  const effectiveCalendarView: CalendarViewMode = surfaceMode === "day" ? "day" : "week";

  const handleRefresh = async () => {
    await loadJobs();
    setSchedulerRefreshToken((current) => current + 1);
  };

  const updateStatus = async (jobId: string, nextStatus: string) => {
    try {
      await apiPost(`/api/workshop/jobs/${encodeURIComponent(jobId)}/status`, {
        status: nextStatus,
      });
      success("Job status updated");
      await handleRefresh();
    } catch (statusError) {
      error(statusError instanceof Error ? statusError.message : "Failed to update status");
    }
  };

  const updateApprovalStatus = async (jobId: string, nextStatus: "WAITING_FOR_APPROVAL" | "APPROVED") => {
    try {
      await apiPost(`/api/workshop/jobs/${encodeURIComponent(jobId)}/approval`, {
        status: nextStatus,
      });
      success(nextStatus === "APPROVED" ? "Quote marked approved" : "Quote marked pending approval");
      await handleRefresh();
    } catch (statusError) {
      error(statusError instanceof Error ? statusError.message : "Failed to update approval");
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

  const handleIntakeCreated = (jobId: string) => {
    setQuickFilter("ALL");
    setStatus("");
    setSearch("");
    setSelectedTechnicianId("");
    setAnchorDateKey(workshopTodayDateKey());
    setSurfaceMode("week");
    setSelectedListJobId(null);
    setPostCreateJobId(jobId);
    setSchedulerRefreshToken((current) => current + 1);
    void loadJobs(buildDashboardQuery({}));
  };

  return (
    <div className="page-shell page-shell-workspace workshop-primary-page">
      <section className="workshop-primary-topbar">
        <div className="workshop-primary-title">
          <h1 className="ui-page-title">Workshop</h1>
        </div>

        <label className="workshop-primary-search">
          <span className="table-secondary">Search</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search customer, bike, job"
          />
        </label>

        <div className="workshop-primary-actions">
          <div className="workshop-primary-view-toggle" role="tablist" aria-label="Workshop view">
            {(["week", "day", "list"] as SurfaceMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={surfaceMode === mode}
                className={surfaceMode === mode ? "workshop-os-filter-chip workshop-os-filter-chip--active" : "workshop-os-filter-chip"}
                onClick={() => setSurfaceMode(mode)}
              >
                {mode === "week" ? "Week" : mode === "day" ? "Day" : "List"}
              </button>
            ))}
          </div>

          <div className="actions-inline">
            <button type="button" className="primary" onClick={() => setIsIntakeOpen(true)}>
              New Job
            </button>
            <button
              type="button"
              onClick={() => setAnchorDateKey(shiftWorkshopAnchorDateKey(anchorDateKey, effectiveCalendarView, -1))}
            >
              {effectiveCalendarView === "week" ? "Previous Week" : "Previous Day"}
            </button>
            <button
              type="button"
              onClick={() => setAnchorDateKey(workshopTodayDateKey())}
              disabled={anchorDateKey === workshopTodayDateKey()}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setAnchorDateKey(shiftWorkshopAnchorDateKey(anchorDateKey, effectiveCalendarView, 1))}
            >
              {effectiveCalendarView === "week" ? "Next Week" : "Next Day"}
            </button>
          </div>
        </div>
      </section>

      <div className="workshop-primary-layout">
        <aside className="workshop-primary-filter-rail">
          <section className="workshop-primary-filter-card">
            <div className="workshop-primary-filter-card__header">
              <h2>Filters</h2>
              <span className="table-secondary">Keep the workshop view tight.</span>
            </div>

            <div className="workshop-primary-filter-list">
              {quickFilters.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  className={quickFilter === filter.key
                    ? "workshop-primary-filter-button workshop-primary-filter-button--active"
                    : "workshop-primary-filter-button"}
                  onClick={() => setQuickFilter(filter.key)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </section>

          <section className="workshop-primary-filter-card">
            <div className="workshop-primary-filter-card__header">
              <h2>Context</h2>
              <span className="table-secondary">Supporting constraints and scheduler controls.</span>
            </div>

            <div className="workshop-primary-filter-fields">
              <label>
                Technician
                <select value={selectedTechnicianId} onChange={(event) => setSelectedTechnicianId(event.target.value)}>
                  <option value="">Everyone</option>
                  {technicianOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
                </select>
              </label>

              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={showCompleted}
                  onChange={(event) => setShowCompleted(event.target.checked)}
                />
                <span>Show completed</span>
              </label>
            </div>

            <div className="workshop-primary-filter-actions">
              <button type="button" onClick={() => void handleRefresh()} disabled={loading}>
                {loading ? "Refreshing..." : "Refresh"}
              </button>
              <Link to="/workshop/calendar" className="button-link">
                Standalone Calendar
              </Link>
            </div>

            <details className="workshop-primary-advanced-filters">
              <summary>
                <span>Advanced filters</span>
                <span className="table-secondary">
                  {status ? workshopRawStatusLabel(status) : "Optional"}
                </span>
              </summary>

              <div className="workshop-primary-filter-fields workshop-primary-filter-fields--advanced">
                <label>
                  Raw status
                  <select value={status} onChange={(event) => setStatus(event.target.value as (typeof statusOptions)[number])}>
                    {statusOptions.map((option) => (
                      <option key={option} value={option}>
                        {option ? workshopRawStatusLabel(option) : "All raw states"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </details>
          </section>
        </aside>

        <section className="workshop-primary-surface">
          {surfaceMode === "list" ? (
            <div className="workshop-primary-list-layout">
              <section className="workshop-primary-list-surface">
                <div className="workshop-primary-surface-header">
                  <div>
                    <h2>List view</h2>
                    <p className="muted-text">
                      A lower-friction fallback when you need a queue summary instead of the timed scheduler.
                    </p>
                  </div>
                  <div className="table-secondary">
                    {visibleJobs.length} visible job{visibleJobs.length === 1 ? "" : "s"}
                  </div>
                </div>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Bike / Customer</th>
                        <th>Technician</th>
                        <th>Status</th>
                        <th>Parts</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleJobs.length === 0 ? (
                        <tr>
                          <td colSpan={6}>No jobs match the current workshop controls.</td>
                        </tr>
                      ) : (
                        [...visibleJobs].sort(compareJobs).map((job) => {
                          const workflowSummary = getWorkshopTechnicianWorkflowSummary({
                            rawStatus: job.status,
                            partsStatus: job.partsStatus,
                            assignedStaffName: job.assignedStaffName,
                            scheduledDate: job.scheduledDate,
                            hasSale: Boolean(job.sale),
                            hasBasket: Boolean(job.finalizedBasketId),
                          });
                          const primaryAction = getQuickActions(job)[0];

                          return (
                            <tr
                              key={job.id}
                              className="clickable-row"
                              onClick={() => setSelectedListJobId(job.id)}
                            >
                              <td>
                                <div className="table-primary">{formatTimeRange(job)}</div>
                                <div className="table-secondary">{job.durationMinutes ? `${job.durationMinutes} min` : "Open duration"}</div>
                              </td>
                              <td>
                                <div className="table-primary">{job.bikeDescription || "Workshop job"}</div>
                                <div className="table-secondary">{getCustomerName(job)}</div>
                              </td>
                              <td>{job.assignedStaffName || "Unassigned"}</td>
                              <td>
                                <div className="status-stack">
                                  <span className={workflowSummary.className}>{workflowSummary.label}</span>
                                  {getUrgency(job) ? (
                                    <span className={getUrgency(job)?.className}>{getUrgency(job)?.label}</span>
                                  ) : null}
                                </div>
                              </td>
                              <td className={getPartsClassName(job)}>{toPartsStatus(job)}</td>
                              <td onClick={(event) => event.stopPropagation()}>
                                {primaryAction ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void runQuickAction(job.id, primaryAction);
                                    }}
                                  >
                                    {primaryAction.label}
                                  </button>
                                ) : (
                                  <Link to={`/workshop/${job.id}`} className="button-link">
                                    Open job
                                  </Link>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <aside className="workshop-primary-context-rail">
                <section className="workshop-primary-context-card">
                  <div className="workshop-primary-context-card__header">
                    <h2>{selectedListJob ? "Selected job" : "Selection"}</h2>
                    <span className="table-secondary">
                      {selectedListJob ? "Open the full job when deeper editing is needed." : "Choose a job from the list."}
                    </span>
                  </div>

                  {selectedListJob ? (
                    <div className="workshop-primary-selection">
                      <strong>{selectedListJob.bikeDescription || "Workshop job"}</strong>
                      <span className="table-secondary">{getCustomerName(selectedListJob)}</span>
                      <div className="workshop-primary-selection__badges">
                        <span className={workshopRawStatusClass(selectedListJob.status)}>{workshopRawStatusLabel(selectedListJob.status)}</span>
                        {selectedListWorkflow ? (
                          <span className={selectedListWorkflow.className}>{selectedListWorkflow.label}</span>
                        ) : null}
                        {getUrgency(selectedListJob) ? (
                          <span className={getUrgency(selectedListJob)?.className}>{getUrgency(selectedListJob)?.label}</span>
                        ) : null}
                        <span className={getPartsClassName(selectedListJob)}>Parts: {toPartsStatus(selectedListJob)}</span>
                      </div>
                      <div className="workshop-primary-selection__meta">
                        <div>
                          <span className="metric-label">Timing</span>
                          <strong>{formatTimeRange(selectedListJob)}</strong>
                        </div>
                        <div>
                          <span className="metric-label">Technician</span>
                          <strong>{selectedListJob.assignedStaffName || "Unassigned"}</strong>
                        </div>
                        <div>
                          <span className="metric-label">Next step</span>
                          <strong>{selectedListWorkflow?.nextStep || "Open job"}</strong>
                        </div>
                        <div>
                          <span className="metric-label">Updated</span>
                          <strong>{formatDateTime(selectedListJob.updatedAt)}</strong>
                        </div>
                      </div>
                      <div className="actions-inline">
                        {selectedListActions.map((action) => (
                          <button
                            key={`${action.kind}-${action.value}`}
                            type="button"
                            className={selectedListActions[0] === action ? "primary" : undefined}
                            onClick={() => {
                              void runQuickAction(selectedListJob.id, action);
                            }}
                          >
                            {action.label}
                          </button>
                        ))}
                        <Link to={`/workshop/${selectedListJob.id}`} className="button-link">
                          Open full job
                        </Link>
                      </div>
                    </div>
                  ) : (
                    <div className="workshop-scheduler-empty">
                      Select a job to see the current schedule context and the next likely action.
                    </div>
                  )}
                </section>

                <section className="workshop-primary-context-card">
                  <div className="workshop-primary-context-card__header">
                    <h2>Needs scheduling</h2>
                    <span className="stock-badge stock-muted">{needsSchedulingJobs.length}</span>
                  </div>

                  <div className="workshop-primary-context-list">
                    {needsSchedulingJobs.length === 0 ? (
                      <div className="workshop-scheduler-empty">Every visible job already has a timed slot.</div>
                    ) : needsSchedulingJobs.map((job) => (
                      <button
                        key={job.id}
                        type="button"
                        className="workshop-primary-context-item"
                        onClick={() => {
                          setSurfaceMode("week");
                        }}
                      >
                        <strong>{job.bikeDescription || "Workshop job"}</strong>
                        <span>{getCustomerName(job)}</span>
                        <span>{job.scheduledDate ? `Due ${formatDate(job.scheduledDate)}` : "No promised date"}</span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="workshop-primary-context-card">
                  <div className="workshop-primary-context-card__header">
                    <h2>Signals</h2>
                    <span className="table-secondary">Queue pressure at a glance.</span>
                  </div>

                  <div className="workshop-primary-alert-grid">
                    {listAlerts.map((alert) => (
                      <div key={alert.key} className="workshop-primary-alert-chip">
                        <span className={alert.tone}>{alert.label}</span>
                        <strong>{alert.count}</strong>
                      </div>
                    ))}
                  </div>
                </section>
              </aside>
            </div>
          ) : (
            <WorkshopSchedulerScreen
              embedded
              showToolbar={false}
              refreshToken={schedulerRefreshToken}
              view={surfaceMode}
              anchorDateKey={anchorDateKey}
              weekRangeMode="operational"
              onChangeAnchorDateKey={setAnchorDateKey}
              technicianId={selectedTechnicianId}
              onTechnicianIdChange={setSelectedTechnicianId}
              visibleJobIds={visibleJobIds}
              requestedOverlayJobId={postCreateJobId}
              onRequestedOverlayJobHandled={() => setPostCreateJobId(null)}
            />
          )}
        </section>
      </div>

      <WorkshopCheckInModal
        open={isIntakeOpen}
        onClose={() => setIsIntakeOpen(false)}
        onCreated={handleIntakeCreated}
      />
    </div>
  );
};
