import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
  const navigate = useNavigate();

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

  const scrollToSchedulerPanel = (panelId: string) => {
    requestAnimationFrame(() => {
      document.getElementById(panelId)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
        inline: "nearest",
      });
    });
  };

  const statusStripItems = [
    {
      key: "waiting",
      label: "Waiting",
      value: boardSummary.waitingApprovalCount,
      tone: "default",
      isActive: status === "WAITING_FOR_APPROVAL",
      onClick: () => {
        setQuickFilter("ALL");
        setStatus((current) => (current === "WAITING_FOR_APPROVAL" ? "" : "WAITING_FOR_APPROVAL"));
      },
    },
    {
      key: "bench",
      label: "Bench",
      value: boardSummary.activeBenchCount,
      tone: "default",
      isActive: false,
      onClick: () => {
        void navigate("/workshop/queue");
      },
    },
    {
      key: "blocked",
      label: "Blocked",
      value: boardSummary.waitingPartsCount,
      tone: "caution",
      isActive: quickFilter === "WAITING_FOR_PARTS",
      onClick: () => {
        setStatus("");
        setQuickFilter((current) => (current === "WAITING_FOR_PARTS" ? "ALL" : "WAITING_FOR_PARTS"));
      },
    },
    {
      key: "ready",
      label: "Ready",
      value: boardSummary.readyCollectionCount,
      tone: "default",
      isActive: quickFilter === "READY_FOR_COLLECTION",
      onClick: () => {
        setStatus("");
        setQuickFilter((current) => (current === "READY_FOR_COLLECTION" ? "ALL" : "READY_FOR_COLLECTION"));
      },
    },
    {
      key: "needs-scheduling",
      label: "Needs scheduling",
      value: boardSummary.unscheduledCount,
      tone: "warning",
      isActive: false,
      onClick: () => {
        scrollToSchedulerPanel("workshop-needs-scheduling-panel");
      },
    },
    {
      key: "unassigned",
      label: "Unassigned",
      value: boardSummary.timedUnassignedCount,
      tone: "alert",
      isActive: false,
      onClick: () => {
        scrollToSchedulerPanel("workshop-unassigned-panel");
      },
    },
  ] as const;

  return (
    <div className="page-shell page-shell-workspace workshop-primary-page" data-testid="workshop-operating-page">
      <section className="workshop-primary-topbar">
        <div className="workshop-primary-title">
          <span className="ui-page-eyebrow">Workshop</span>
          <h1 className="ui-page-title">Workshop</h1>
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
        <div className="workshop-primary-status-strip" role="toolbar" aria-label="Workshop status summary">
          {statusStripItems.map((item, index) => (
            <div key={item.key} className="workshop-primary-status-strip__item">
              {index > 0 ? (
                <span className="workshop-primary-status-strip__separator" aria-hidden="true">
                  •
                </span>
              ) : null}
              <button
                type="button"
                className={[
                  "workshop-primary-status-strip__button",
                  `workshop-primary-status-strip__button--${item.tone}`,
                  item.isActive ? "workshop-primary-status-strip__button--active" : "",
                ].filter(Boolean).join(" ")}
                onClick={item.onClick}
              >
                <span className="workshop-primary-status-strip__label">{item.label}</span>
                <strong className="workshop-primary-status-strip__value">{item.value}</strong>
              </button>
            </div>
          ))}
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
