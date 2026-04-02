import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useToasts } from "../components/ToastProvider";
import { WorkshopCheckInModal } from "../features/workshop/WorkshopCheckInModal";
import {
  buildDashboardQuery,
  buildTechnicianOptions,
  buildWorkshopBoardSummary,
  buildWorkshopVisibleInsights,
  type DashboardJob,
  type DashboardResponse,
  matchesQuickFilter,
  quickFilters,
  statusOptions,
  type QuickFilterKey,
} from "../features/workshop/operatingQueue";
import { workshopRawStatusLabel } from "../features/workshop/status";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import {
  getWorkshopOperationalWeekStartDateKey,
  shiftWorkshopAnchorDateKey,
  shiftWorkshopVisibleWindowDateKey,
  WorkshopSchedulerScreen,
  workshopTodayDateKey,
  type CalendarViewMode,
} from "./WorkshopCalendarPage";
import { type WorkshopCheckInScheduleDraft } from "./WorkshopCheckInPage";

export const WorkshopPage = () => {
  const { user } = useAuth();
  const { error } = useToasts();

  const [view, setView] = useState<CalendarViewMode>("week");
  const [anchorDateKey, setAnchorDateKey] = useState(getWorkshopOperationalWeekStartDateKey());
  const [quickFilter, setQuickFilter] = useState<QuickFilterKey>("ALL");
  const [status, setStatus] = useState<(typeof statusOptions)[number]>("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [selectedTechnicianId, setSelectedTechnicianId] = useState("");
  const [jobs, setJobs] = useState<DashboardJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [schedulerRefreshToken, setSchedulerRefreshToken] = useState(0);
  const [isIntakeOpen, setIsIntakeOpen] = useState(false);
  const [intakeScheduleDraft, setIntakeScheduleDraft] = useState<WorkshopCheckInScheduleDraft | null>(null);
  const [postCreateJobId, setPostCreateJobId] = useState<string | null>(null);
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

  const visibleJobIds = useMemo(
    () => new Set(visibleJobs.map((job) => job.id)),
    [visibleJobs],
  );

  const currentTodayAnchorDateKey =
    view === "week" ? getWorkshopOperationalWeekStartDateKey() : workshopTodayDateKey();

  const handleRefresh = async () => {
    await loadJobs();
    setSchedulerRefreshToken((current) => current + 1);
  };

  const handleIntakeCreated = (jobId: string) => {
    setQuickFilter("ALL");
    setStatus("");
    setSearch("");
    setSelectedTechnicianId("");
    setAnchorDateKey(getWorkshopOperationalWeekStartDateKey());
    setView("week");
    setPostCreateJobId(jobId);
    setSchedulerRefreshToken((current) => current + 1);
    void loadJobs(buildDashboardQuery({}));
  };

  const closeIntake = () => {
    setIsIntakeOpen(false);
    setIntakeScheduleDraft(null);
  };

  const openBlankIntake = () => {
    setIntakeScheduleDraft(null);
    setIsIntakeOpen(true);
  };

  const handleCreateAtScheduleSlot = (draft: WorkshopCheckInScheduleDraft) => {
    setIntakeScheduleDraft(draft);
    setIsIntakeOpen(true);
  };

  return (
    <div className="page-shell page-shell-workspace workshop-primary-page" data-testid="workshop-operating-page">
      <section className="workshop-primary-topbar">
        <div className="workshop-primary-title">
          <span className="ui-page-eyebrow">Workshop</span>
          <h1 className="ui-page-title">Operating</h1>
          <p className="ui-page-description muted-text">
            Place work in time, keep capacity clear, and resolve scheduling gaps without the rest of the queue competing for attention.
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
          <div className="workshop-primary-view-toggle" role="tablist" aria-label="Workshop schedule view">
            {(["week", "day"] as CalendarViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={view === mode}
                className={view === mode ? "workshop-os-filter-chip workshop-os-filter-chip--active" : "workshop-os-filter-chip"}
                onClick={() => setView(mode)}
              >
                {mode === "week" ? "Week" : "Day"}
              </button>
            ))}
          </div>

          <div className="actions-inline workshop-primary-actions__toolbar">
            <Link to="/workshop/queue" className="button-link">
              Queue
            </Link>

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

            <div className="actions-inline workshop-primary-actions__calendar-nav">
              <button
                type="button"
                onClick={() => setAnchorDateKey(shiftWorkshopAnchorDateKey(anchorDateKey, view, -1))}
              >
                {view === "week" ? "Previous Week" : "Previous Day"}
              </button>
              {view === "week" ? (
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setAnchorDateKey(shiftWorkshopVisibleWindowDateKey(anchorDateKey, view, "operational", -1))}
                >
                  - Day
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setAnchorDateKey(currentTodayAnchorDateKey)}
                disabled={anchorDateKey === currentTodayAnchorDateKey}
              >
                Today
              </button>
              {view === "week" ? (
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setAnchorDateKey(shiftWorkshopVisibleWindowDateKey(anchorDateKey, view, "operational", 1))}
                >
                  + Day
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setAnchorDateKey(shiftWorkshopAnchorDateKey(anchorDateKey, view, 1))}
              >
                {view === "week" ? "Next Week" : "Next Day"}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section
        className="workshop-primary-overview workshop-primary-overview--compact"
        data-testid="workshop-operating-overview"
      >
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
            <span className="metric-label">Timed but unassigned</span>
            <strong>{boardSummary.timedUnassignedCount}</strong>
            <p className="muted-text">Placed in time without an owner yet.</p>
          </article>
        </div>
      </section>

      <div className="workshop-primary-layout">
        <aside className="workshop-primary-filter-rail">
          <section className="workshop-primary-filter-card">
            <div className="workshop-primary-filter-card__header">
              <h2>Filters</h2>
              <span className="table-secondary">Keep the schedule tight.</span>
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
              <span className="table-secondary">Planning controls only.</span>
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

        <section className="workshop-primary-surface">
          <WorkshopSchedulerScreen
            embedded
            showToolbar={false}
            refreshToken={schedulerRefreshToken}
            view={view}
            anchorDateKey={anchorDateKey}
            weekRangeMode="operational"
            onChangeAnchorDateKey={setAnchorDateKey}
            technicianId={selectedTechnicianId}
            onTechnicianIdChange={setSelectedTechnicianId}
            visibleJobIds={visibleJobIds}
            requestedOverlayJobId={postCreateJobId}
            onRequestedOverlayJobHandled={() => setPostCreateJobId(null)}
            onRequestCreateAtSlot={handleCreateAtScheduleSlot}
            showTimeOffRailPanel={false}
          />
        </section>
      </div>

      <WorkshopCheckInModal
        open={isIntakeOpen}
        onClose={closeIntake}
        onCreated={handleIntakeCreated}
        initialScheduleDraft={intakeScheduleDraft}
      />
    </div>
  );
};
