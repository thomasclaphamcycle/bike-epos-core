import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useToasts } from "../components/ToastProvider";
import { WorkshopCheckInModal } from "../features/workshop/WorkshopCheckInModal";
import {
  buildDashboardQuery,
  buildTechnicianOptions,
  buildWorkshopBoardSummary,
  buildWorkshopVisibleInsights,
  formatTimeRange,
  getCustomerName,
  getPartsClassName,
  getQuickActions,
  isOpenWorkshopDisplayStatus,
  matchesQuickFilter,
  quickFilters,
  statusOptions,
  type DashboardJob,
  type DashboardResponse,
  type QuickAction,
  type QuickFilterKey,
  type WorkshopBoardInsight,
} from "../features/workshop/operatingQueue";
import { workshopRawStatusClass, workshopRawStatusLabel } from "../features/workshop/status";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

const runPrimaryQueueAction = async (
  action: QuickAction,
  jobId: string,
  navigate: ReturnType<typeof useNavigate>,
  updateStatus: (jobId: string, nextStatus: string) => Promise<void>,
  updateApprovalStatus: (jobId: string, nextStatus: "WAITING_FOR_APPROVAL" | "APPROVED") => Promise<void>,
) => {
  if (action.kind === "navigate") {
    navigate(action.value);
    return;
  }

  if (action.kind === "approval") {
    await updateApprovalStatus(jobId, action.value as "WAITING_FOR_APPROVAL" | "APPROVED");
    return;
  }

  await updateStatus(jobId, action.value);
};

type QueueGroup = {
  key: string;
  title: string;
  description: string;
  emptyText: string;
  jobs: WorkshopBoardInsight[];
};

export const WorkshopQueuePage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { success, error } = useToasts();

  const [quickFilter, setQuickFilter] = useState<QuickFilterKey>("ALL");
  const [status, setStatus] = useState<(typeof statusOptions)[number]>("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [selectedTechnicianId, setSelectedTechnicianId] = useState("");
  const [jobs, setJobs] = useState<DashboardJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [isIntakeOpen, setIsIntakeOpen] = useState(false);
  const loadJobsRequestIdRef = useRef(0);

  const listQuery = useMemo(
    () => buildDashboardQuery({ status, search: debouncedSearch }),
    [status, debouncedSearch],
  );

  const loadJobs = async (queryString = listQuery) => {
    const requestId = ++loadJobsRequestIdRef.current;
    setLoading(true);
    try {
      const payload = await apiGet<DashboardResponse>(`/api/workshop/dashboard?${queryString}`);
      if (requestId !== loadJobsRequestIdRef.current) {
        return;
      }
      setJobs(payload.jobs || []);
    } catch (loadError) {
      if (requestId !== loadJobsRequestIdRef.current) {
        return;
      }
      error(loadError instanceof Error ? loadError.message : "Failed to load workshop jobs");
    } finally {
      if (requestId === loadJobsRequestIdRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => () => {
    loadJobsRequestIdRef.current += 1;
  }, []);

  useEffect(() => {
    void loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listQuery]);

  const technicianOptions = useMemo(
    () => buildTechnicianOptions(jobs, user),
    [jobs, user],
  );

  const visibleJobs = useMemo(
    () => jobs.filter((job) => {
      if (selectedTechnicianId && job.assignedStaffId !== selectedTechnicianId) {
        return false;
      }
      return matchesQuickFilter(job, quickFilter, user?.id);
    }),
    [jobs, quickFilter, selectedTechnicianId, user?.id],
  );

  const visibleInsights = useMemo(
    () => buildWorkshopVisibleInsights(visibleJobs),
    [visibleJobs],
  );

  const boardSummary = useMemo(
    () => buildWorkshopBoardSummary(visibleInsights),
    [visibleInsights],
  );

  const queueLanes = useMemo<QueueGroup[]>(
    () => [
      {
        key: "front-desk",
        title: "Front of house now",
        description: "Approval, collection, and customer-facing follow-up that needs action now.",
        emptyText: "Nothing needs immediate front-of-house follow-up.",
        jobs: visibleInsights.filter((entry) =>
          entry.displayStatus === "WAITING_FOR_APPROVAL" || entry.displayStatus === "BIKE_READY",
        ).slice(0, 6),
      },
      {
        key: "bench",
        title: "Bench now",
        description: "Jobs technicians can start, continue, or unblock next.",
        emptyText: "No active bench work is visible right now.",
        jobs: visibleInsights.filter((entry) =>
          entry.workflowSummary.stage === "READY_FOR_BENCH"
          || entry.workflowSummary.stage === "IN_REPAIR"
          || entry.workflowSummary.stage === "WAITING_FOR_PARTS",
        ).slice(0, 6),
      },
      {
        key: "planning",
        title: "Planning gaps",
        description: "Work missing a slot, a technician, or a stronger promise date.",
        emptyText: "Every visible job already has the basics in place.",
        jobs: visibleInsights.filter((entry) =>
          isOpenWorkshopDisplayStatus(entry.job.status)
          && (!entry.job.scheduledStartAt || !entry.job.assignedStaffId || !entry.job.scheduledDate),
        ).slice(0, 6),
      },
    ],
    [visibleInsights],
  );

  const actionGroups = useMemo<QueueGroup[]>(
    () => [
      {
        key: "approval",
        title: "Waiting for approval",
        description: "Jobs blocked on a customer decision.",
        emptyText: "No approvals are waiting right now.",
        jobs: visibleInsights.filter((entry) => entry.displayStatus === "WAITING_FOR_APPROVAL").slice(0, 5),
      },
      {
        key: "parts",
        title: "Waiting for parts",
        description: "Jobs blocked by stock, allocation, or supplier lead time.",
        emptyText: "No jobs are currently blocked on parts.",
        jobs: visibleInsights.filter((entry) =>
          entry.displayStatus === "WAITING_FOR_PARTS" || entry.partsStatus === "SHORT",
        ).slice(0, 5),
      },
      {
        key: "collection",
        title: "Ready for collection",
        description: "Completed bench work that should move into handover.",
        emptyText: "Nothing is currently ready for collection.",
        jobs: visibleInsights.filter((entry) => entry.displayStatus === "BIKE_READY").slice(0, 5),
      },
    ],
    [visibleInsights],
  );

  const updateStatus = async (jobId: string, nextStatus: string) => {
    try {
      await apiPost(`/api/workshop/jobs/${encodeURIComponent(jobId)}/status`, {
        status: nextStatus,
      });
      success("Job status updated");
      await loadJobs();
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
      await loadJobs();
    } catch (statusError) {
      error(statusError instanceof Error ? statusError.message : "Failed to update approval");
    }
  };

  const openBlankIntake = () => {
    setIsIntakeOpen(true);
  };

  const handleIntakeCreated = () => {
    setQuickFilter("ALL");
    setStatus("");
    setSearch("");
    setSelectedTechnicianId("");
    void loadJobs(buildDashboardQuery({}));
  };

  const handleRefresh = async () => {
    await loadJobs();
  };

  return (
    <div className="page-shell page-shell-workspace workshop-primary-page workshop-queue-page" data-testid="workshop-queue-page">
      <section className="workshop-primary-topbar">
        <div className="workshop-primary-title">
          <span className="ui-page-eyebrow">Workshop</span>
          <h1 className="ui-page-title">Queue</h1>
          <p className="ui-page-description muted-text">
            Keep the action queue execution-first: what needs customer follow-up, bench action, or handover next.
          </p>
        </div>

        <label className="workshop-primary-search">
          <span className="table-secondary">Search</span>
          <div className="workshop-primary-search__field">
            <span className="workshop-primary-search__icon" aria-hidden="true">
              ⌕
            </span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search customer, bike, job"
            />
          </div>
        </label>

        <div className="workshop-primary-actions">
          <div className="workshop-primary-view-toggle workshop-primary-view-toggle--links">
            <Link to="/workshop" className="button-link">Operating</Link>
            <Link to="/workshop/technician" className="button-link">Technician View</Link>
          </div>

          <div className="actions-inline workshop-primary-actions__toolbar">
            <button
              type="button"
              className="primary workshop-primary-new-job-button"
              onClick={openBlankIntake}
            >
              <span className="workshop-primary-new-job-button__icon" aria-hidden="true">
                +
              </span>
              <span>New Job</span>
            </button>

            <Link to="/workshop/collection" className="button-link">
              Collection Queue
            </Link>
          </div>
        </div>
      </section>

      <div className="workshop-primary-layout workshop-primary-layout--queue">
        <aside className="workshop-primary-filter-rail">
          <section className="workshop-primary-filter-card">
            <div className="workshop-primary-filter-card__header">
              <h2>Filters</h2>
              <span className="table-secondary">Keep the queue tight.</span>
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
              <span className="table-secondary">Operational groupings only.</span>
            </div>

            <div className="workshop-primary-filter-fields">
              <label>
                Technician
                <select value={selectedTechnicianId} onChange={(event) => setSelectedTechnicianId(event.target.value)}>
                  <option value="">All technicians</option>
                  {technicianOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
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

            <div className="workshop-primary-filter-actions">
              <button type="button" onClick={() => void handleRefresh()} disabled={loading}>
                {loading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </section>
        </aside>

        <div className="workshop-queue-main">
          <section className="workshop-primary-overview workshop-primary-overview--compact" data-testid="workshop-queue-overview">
            <div className="workshop-primary-summary-grid">
              <article className="workshop-primary-summary-card workshop-primary-summary-card--compact">
                <span className="metric-label">Waiting for approval</span>
                <strong>{boardSummary.waitingApprovalCount}</strong>
                <p className="muted-text">Customer decision still needed.</p>
              </article>
              <article className="workshop-primary-summary-card workshop-primary-summary-card--compact">
                <span className="metric-label">Active bench work</span>
                <strong>{boardSummary.activeBenchCount}</strong>
                <p className="muted-text">Ready for bench or already underway.</p>
              </article>
              <article className="workshop-primary-summary-card workshop-primary-summary-card--compact">
                <span className="metric-label">Blocked on parts</span>
                <strong>{boardSummary.waitingPartsCount}</strong>
                <p className="muted-text">Parts or allocation is holding progress.</p>
              </article>
              <article className="workshop-primary-summary-card workshop-primary-summary-card--compact workshop-primary-summary-card--ready">
                <span className="metric-label">Ready for collection</span>
                <strong>{boardSummary.readyCollectionCount}</strong>
                <p className="muted-text">Bike can move into handover.</p>
              </article>
              <article className="workshop-primary-summary-card workshop-primary-summary-card--compact">
                <span className="metric-label">Needs scheduling</span>
                <strong>{boardSummary.unscheduledCount}</strong>
                <p className="muted-text">Still missing a first timed slot.</p>
              </article>
              <article className="workshop-primary-summary-card workshop-primary-summary-card--compact">
                <span className="metric-label">Unassigned</span>
                <strong>{boardSummary.timedUnassignedCount}</strong>
                <p className="muted-text">Placed in time without an owner yet.</p>
              </article>
            </div>

            <div className="workshop-primary-route-strip">
              <button type="button" className="workshop-primary-route-link" onClick={openBlankIntake}>
                <strong>Fast intake</strong>
                <span>Start a new job without leaving the queue.</span>
              </button>
              <Link to="/workshop/technician" className="workshop-primary-route-link">
                <strong>Bench mode</strong>
                <span>Give technicians an execution-first view of assigned, blocked, and handoff work.</span>
              </Link>
              <Link to="/workshop/collection" className="workshop-primary-route-link">
                <strong>Collection queue</strong>
                <span>See which bikes are handover-ready and deposit-safe.</span>
              </Link>
              <Link to="/workshop" className="workshop-primary-route-link">
                <strong>Operating schedule</strong>
                <span>Go back to timed scheduling and capacity placement.</span>
              </Link>
            </div>

            <div className="workshop-primary-lane-grid">
              {queueLanes.map((lane) => (
                <article key={lane.key} className="workshop-primary-lane-card">
                  <div className="workshop-primary-lane-card__header">
                    <div>
                      <h2>{lane.title}</h2>
                      <p className="muted-text">{lane.description}</p>
                    </div>
                    <span className="stock-badge stock-muted">{lane.jobs.length}</span>
                  </div>

                  <div className="workshop-primary-lane-list">
                    {lane.jobs.length === 0 ? (
                      <div className="workshop-primary-lane-empty">{lane.emptyText}</div>
                    ) : lane.jobs.map((entry) => {
                      const primaryAction = getQuickActions(entry.job)[0] ?? null;
                      return (
                        <article key={entry.job.id} className="workshop-primary-lane-item workshop-primary-lane-item--queue">
                          <div className="workshop-primary-lane-item__heading">
                            <strong>{entry.job.bikeDescription || "Workshop job"}</strong>
                            <span className={entry.workflowSummary.className}>{entry.workflowSummary.label}</span>
                          </div>
                          <span>{getCustomerName(entry.job)}</span>
                          <span>
                            {entry.urgency?.label ?? formatTimeRange(entry.job)}
                            {entry.job.assignedStaffName ? ` · ${entry.job.assignedStaffName}` : ""}
                          </span>
                          <div className="actions-inline">
                            {primaryAction ? (
                              <button
                                type="button"
                                onClick={() => void runPrimaryQueueAction(
                                  primaryAction,
                                  entry.job.id,
                                  navigate,
                                  updateStatus,
                                  updateApprovalStatus,
                                )}
                              >
                                {primaryAction.label}
                              </button>
                            ) : null}
                            <Link to={`/workshop/${entry.job.id}`} className="button-link">
                              Open job
                            </Link>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="workshop-queue-action-grid">
            {actionGroups.map((group) => (
              <article key={group.key} className="workshop-queue-action-card">
                <div className="workshop-queue-action-card__header">
                  <div>
                    <h2>{group.title}</h2>
                    <p className="muted-text">{group.description}</p>
                  </div>
                  <span className="stock-badge stock-muted">{group.jobs.length}</span>
                </div>

                <div className="workshop-queue-action-list">
                  {group.jobs.length === 0 ? (
                    <div className="workshop-primary-lane-empty">{group.emptyText}</div>
                  ) : group.jobs.map((entry) => {
                    const primaryAction = getQuickActions(entry.job)[0] ?? null;
                    return (
                      <article key={entry.job.id} className="workshop-queue-action-item">
                        <div className="workshop-primary-lane-item__heading">
                          <strong>{entry.job.bikeDescription || "Workshop job"}</strong>
                          <span className={workshopRawStatusClass(entry.job)}>{workshopRawStatusLabel(entry.job)}</span>
                        </div>
                        <span>{getCustomerName(entry.job)}</span>
                        <div className="workshop-queue-action-item__meta">
                          <span>{entry.urgency?.label ?? formatTimeRange(entry.job)}</span>
                          <span className={getPartsClassName(entry.job)}>Parts: {entry.partsStatus}</span>
                        </div>
                        <div className="actions-inline">
                          {primaryAction ? (
                            <button
                              type="button"
                              onClick={() => void runPrimaryQueueAction(
                                primaryAction,
                                entry.job.id,
                                navigate,
                                updateStatus,
                                updateApprovalStatus,
                              )}
                            >
                              {primaryAction.label}
                            </button>
                          ) : null}
                          <Link to={`/workshop/${entry.job.id}`} className="button-link">
                            Open job
                          </Link>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </article>
            ))}
          </section>
        </div>
      </div>

      <WorkshopCheckInModal
        open={isIntakeOpen}
        onClose={() => setIsIntakeOpen(false)}
        onCreated={handleIntakeCreated}
      />
    </div>
  );
};
