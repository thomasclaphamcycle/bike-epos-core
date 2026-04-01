import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useToasts } from "../components/ToastProvider";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import {
  getWorkshopDisplayStatus,
  getWorkshopRawStatusValue,
  getWorkshopTechnicianWorkflowSummary,
  workshopRawStatusClass,
  workshopRawStatusLabel,
} from "../features/workshop/status";

type BenchScope = "MINE" | "TEAM";
type BenchFocusFilter = "ALL" | "ACTIONABLE" | "TODAY" | "BLOCKED" | "HANDOFF";
type WorkshopPartsStatus = "OK" | "UNALLOCATED" | "SHORT";
type BenchBucket = "ACTIONABLE" | "TODAY" | "BLOCKED" | "QUEUE" | "HANDOFF";

type DashboardJob = {
  id: string;
  status: string;
  bikeDescription: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  scheduledDate: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  durationMinutes: number | null;
  depositRequiredPence: number;
  depositStatus: string;
  finalizedBasketId: string | null;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  noteCount: number;
  lastNoteAt: string | null;
  partsStatus?: WorkshopPartsStatus;
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
};

type DashboardResponse = {
  jobs: DashboardJob[];
};

type WorkshopNote = {
  id: string;
  visibility: "INTERNAL" | "CUSTOMER";
  note: string;
  createdAt: string;
  authorStaff: {
    id: string;
    username: string;
    name: string | null;
  } | null;
};

type WorkshopNotesResponse = {
  notes: WorkshopNote[];
};

type BenchAction = {
  label: string;
  kind: "status" | "approval" | "assign" | "navigate";
  value: string;
  tone?: "primary" | "secondary";
};

type BenchPresentation = {
  job: DashboardJob;
  workflowSummary: ReturnType<typeof getWorkshopTechnicianWorkflowSummary>;
  partsStatus: WorkshopPartsStatus;
  isMine: boolean;
  isToday: boolean;
  isOverdue: boolean;
  bucket: BenchBucket;
  scheduleLabel: string;
  activityLabel: string;
  handoffLabel: string | null;
  attentionLabel: string | null;
  attentionClassName: string;
  stagePriority: number;
  scheduledTimestamp: number;
};

type BenchSection = {
  key: BenchBucket;
  title: string;
  description: string;
  emptyText: string;
  jobs: BenchPresentation[];
};

const focusFilters: Array<{
  key: BenchFocusFilter;
  label: string;
  description: string;
}> = [
  { key: "ALL", label: "All work", description: "Everything in the current bench scope." },
  { key: "ACTIONABLE", label: "Actionable", description: "Jobs a technician can genuinely move forward now." },
  { key: "TODAY", label: "Booked today", description: "Promised today or already overdue." },
  { key: "BLOCKED", label: "Blocked", description: "Waiting on approval, parts, or a deliberate hold." },
  { key: "HANDOFF", label: "Handoff", description: "Bench work complete and ready for front desk collection flow." },
];

const getLondonDateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const lookup = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${lookup("year")}-${lookup("month")}-${lookup("day")}`;
};

const toDateKey = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return getLondonDateKey(parsed);
};

const formatCustomerName = (job: DashboardJob) =>
  job.customer
    ? [job.customer.firstName, job.customer.lastName].filter(Boolean).join(" ") || "Customer linked"
    : "Customer pending";

const formatShortDateTime = (value: string | null | undefined) => {
  if (!value) {
    return "Not recorded";
  }

  return new Date(value).toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatScheduleLabel = (job: DashboardJob) => {
  if (job.scheduledStartAt) {
    const start = new Date(job.scheduledStartAt);
    const end = job.scheduledEndAt ? new Date(job.scheduledEndAt) : null;
    const startLabel = start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const endLabel = end ? end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    return `${start.toLocaleDateString([], { day: "numeric", month: "short" })} · ${startLabel}${endLabel ? `-${endLabel}` : ""}`;
  }

  if (job.scheduledDate) {
    return `Due ${new Date(job.scheduledDate).toLocaleDateString([], { day: "numeric", month: "short" })}`;
  }

  return "Not scheduled";
};

const truncateText = (value: string | null | undefined, maxLength: number) => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 1)}…`;
};

const getPartsStatus = (job: DashboardJob): WorkshopPartsStatus => {
  if (job.partsStatus) {
    return job.partsStatus;
  }

  return getWorkshopDisplayStatus(job) === "WAITING_FOR_PARTS" ? "SHORT" : "OK";
};

const getPartsBadgeClassName = (partsStatus: WorkshopPartsStatus) => {
  switch (partsStatus) {
    case "SHORT":
      return "status-badge status-warning";
    case "UNALLOCATED":
      return "status-badge status-info";
    default:
      return "status-badge";
  }
};

const getAttentionBadge = (isToday: boolean, isOverdue: boolean, partsStatus: WorkshopPartsStatus) => {
  if (isOverdue) {
    return {
      label: "Overdue",
      className: "status-badge status-cancelled",
    };
  }

  if (isToday) {
    return {
      label: "Today",
      className: "status-badge status-warning",
    };
  }

  if (partsStatus === "SHORT") {
    return {
      label: "Parts short",
      className: "status-badge status-warning",
    };
  }

  if (partsStatus === "UNALLOCATED") {
    return {
      label: "Parts unallocated",
      className: "status-badge status-info",
    };
  }

  return null;
};

const isOpenWorkshopJob = (status: string | null | undefined) => {
  const displayStatus = getWorkshopDisplayStatus(status);
  return displayStatus !== "COMPLETED" && displayStatus !== "CANCELLED";
};

const stagePriority: Record<string, number> = {
  IN_REPAIR: 0,
  READY_FOR_BENCH: 1,
  AWAITING_APPROVAL: 2,
  WAITING_FOR_PARTS: 3,
  PAUSED: 4,
  READY_FOR_COLLECTION: 5,
  QUEUED: 6,
  COLLECTED: 7,
  CANCELLED: 8,
};

const createBenchPresentation = (
  job: DashboardJob,
  currentUserId: string | null | undefined,
  todayKey: string,
): BenchPresentation => {
  const workflowSummary = getWorkshopTechnicianWorkflowSummary({
    rawStatus: getWorkshopRawStatusValue(job) ?? job.status,
    partsStatus: job.partsStatus,
    assignedStaffName: job.assignedStaffName,
    scheduledDate: job.scheduledDate,
    scheduledStartAt: job.scheduledStartAt,
    hasSale: Boolean(job.sale),
    hasBasket: Boolean(job.finalizedBasketId),
  });
  const partsStatus = getPartsStatus(job);
  const scheduleDateKey = toDateKey(job.scheduledStartAt ?? job.scheduledDate);
  const scheduledTimestamp = job.scheduledStartAt
    ? new Date(job.scheduledStartAt).getTime()
    : job.scheduledDate
      ? new Date(job.scheduledDate).getTime()
      : Number.MAX_SAFE_INTEGER;
  const isOverdue = Boolean(scheduleDateKey && scheduleDateKey < todayKey && isOpenWorkshopJob(job.status));
  const isToday = Boolean(scheduleDateKey && scheduleDateKey === todayKey && isOpenWorkshopJob(job.status));
  const isBlocked = workflowSummary.stage === "AWAITING_APPROVAL"
    || workflowSummary.stage === "WAITING_FOR_PARTS"
    || workflowSummary.stage === "PAUSED";
  const isReadyForCollection = workflowSummary.stage === "READY_FOR_COLLECTION";
  const isActionable = workflowSummary.stage === "READY_FOR_BENCH"
    || workflowSummary.stage === "IN_REPAIR"
    || (!job.assignedStaffId && workflowSummary.stage === "QUEUED");
  const handoffLabel = isReadyForCollection
    ? job.sale
      ? "Sale already linked"
      : job.finalizedBasketId
        ? "POS basket ready"
        : job.depositRequiredPence > 0 && job.depositStatus !== "PAID"
          ? "Deposit still outstanding"
          : job.depositStatus === "PAID"
            ? "Deposit already covered"
            : "Counter handoff still needed"
    : null;
  const bucket: BenchBucket = isReadyForCollection
    ? "HANDOFF"
    : isBlocked
      ? "BLOCKED"
      : isActionable
        ? "ACTIONABLE"
        : isToday || isOverdue
          ? "TODAY"
          : "QUEUE";
  const attention = getAttentionBadge(isToday, isOverdue, partsStatus);

  return {
    job,
    workflowSummary,
    partsStatus,
    isMine: Boolean(currentUserId) && job.assignedStaffId === currentUserId,
    isToday,
    isOverdue,
    bucket,
    scheduleLabel: formatScheduleLabel(job),
    activityLabel: job.noteCount > 0
      ? `Last internal note ${formatShortDateTime(job.lastNoteAt)}`
      : "No internal progress note yet",
    handoffLabel,
    attentionLabel: attention?.label ?? null,
    attentionClassName: attention?.className ?? "status-badge",
    stagePriority: stagePriority[workflowSummary.stage] ?? 9,
    scheduledTimestamp,
  };
};

const compareBenchPresentations = (left: BenchPresentation, right: BenchPresentation) => {
  if (left.isOverdue !== right.isOverdue) {
    return left.isOverdue ? -1 : 1;
  }

  if (left.isToday !== right.isToday) {
    return left.isToday ? -1 : 1;
  }

  if (left.stagePriority !== right.stagePriority) {
    return left.stagePriority - right.stagePriority;
  }

  if (left.scheduledTimestamp !== right.scheduledTimestamp) {
    return left.scheduledTimestamp - right.scheduledTimestamp;
  }

  return new Date(right.job.updatedAt).getTime() - new Date(left.job.updatedAt).getTime();
};

const matchesFocusFilter = (presentation: BenchPresentation, focusFilter: BenchFocusFilter) => {
  switch (focusFilter) {
    case "ACTIONABLE":
      return presentation.bucket === "ACTIONABLE";
    case "TODAY":
      return presentation.isToday || presentation.isOverdue;
    case "BLOCKED":
      return presentation.bucket === "BLOCKED";
    case "HANDOFF":
      return presentation.bucket === "HANDOFF";
    default:
      return true;
  }
};

const getBenchActions = (
  presentation: BenchPresentation,
  currentUserId: string | null | undefined,
): BenchAction[] => {
  const actions: BenchAction[] = [];
  const isAssignedToSomeone = Boolean(presentation.job.assignedStaffId);

  if (!isAssignedToSomeone && currentUserId && isOpenWorkshopJob(presentation.job.status)) {
    actions.push({
      label: "Assign to me",
      kind: "assign",
      value: currentUserId,
      tone: "primary",
    });
  }

  switch (presentation.workflowSummary.stage) {
    case "AWAITING_APPROVAL":
      actions.push(
        { label: "Record approval", kind: "approval", value: "APPROVED", tone: "primary" },
        { label: "Pause", kind: "status", value: "ON_HOLD" },
      );
      break;
    case "READY_FOR_BENCH":
      if (isAssignedToSomeone) {
        actions.push(
          { label: "Start work", kind: "status", value: "IN_PROGRESS", tone: "primary" },
          { label: "Waiting on approval", kind: "approval", value: "WAITING_FOR_APPROVAL" },
        );
      }
      break;
    case "IN_REPAIR":
      actions.push(
        { label: "Bike ready", kind: "status", value: "READY_FOR_COLLECTION", tone: "primary" },
        { label: "Waiting on parts", kind: "status", value: "WAITING_FOR_PARTS" },
        { label: "Pause", kind: "status", value: "ON_HOLD" },
      );
      break;
    case "WAITING_FOR_PARTS":
      actions.push(
        { label: "Resume work", kind: "status", value: "IN_PROGRESS", tone: "primary" },
      );
      break;
    case "PAUSED":
      actions.push(
        { label: "Resume work", kind: "status", value: "IN_PROGRESS", tone: "primary" },
        { label: "Waiting on parts", kind: "status", value: "WAITING_FOR_PARTS" },
      );
      break;
    case "READY_FOR_COLLECTION":
      actions.push(
        { label: "Collection queue", kind: "navigate", value: "/workshop/collection", tone: "primary" },
      );
      break;
    default:
      break;
  }

  return actions.filter((action, index, rows) =>
    rows.findIndex((candidate) => candidate.kind === action.kind && candidate.value === action.value) === index
    && !(action.kind === "approval" && action.value === "WAITING_FOR_APPROVAL" && presentation.workflowSummary.stage !== "READY_FOR_BENCH"),
  );
};

const actionTestId = (jobId: string, action: BenchAction) =>
  `workshop-technician-action-${jobId}-${action.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

export const WorkshopTechnicianPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { success, error } = useToasts();
  const [scopeMode, setScopeMode] = useState<BenchScope>("MINE");
  const [focusFilter, setFocusFilter] = useState<BenchFocusFilter>("ALL");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [jobs, setJobs] = useState<DashboardJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedNotes, setSelectedNotes] = useState<WorkshopNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [runningActionKey, setRunningActionKey] = useState<string | null>(null);
  const loadJobsRequestIdRef = useRef(0);
  const loadNotesRequestIdRef = useRef(0);
  const todayKey = getLondonDateKey();

  useEffect(() => {
    if (user?.role === "STAFF") {
      setScopeMode("MINE");
      return;
    }

    if (user && !user.isTechnician) {
      setScopeMode((current) => (current === "MINE" ? "TEAM" : current));
    }
  }, [user]);

  const assignedTo = useMemo(() => {
    if (!user?.id) {
      return null;
    }

    if (user.role === "STAFF") {
      return user.id;
    }

    return scopeMode === "MINE" ? user.id : null;
  }, [scopeMode, user?.id, user?.role]);

  const dashboardQuery = useMemo(() => {
    const query = new URLSearchParams();
    query.set("limit", "120");
    query.set("includeCancelled", "false");
    if (debouncedSearch.trim()) {
      query.set("search", debouncedSearch.trim());
    }
    if (assignedTo) {
      query.set("assignedTo", assignedTo);
    }
    return query.toString();
  }, [assignedTo, debouncedSearch]);

  const loadDashboard = async (queryString = dashboardQuery) => {
    const requestId = ++loadJobsRequestIdRef.current;
    setLoading(true);

    try {
      const payload = await apiGet<DashboardResponse>(`/api/workshop/dashboard?${queryString}`);
      if (requestId !== loadJobsRequestIdRef.current) {
        return;
      }
      setJobs(Array.isArray(payload.jobs) ? payload.jobs : []);
    } catch (loadError) {
      if (requestId !== loadJobsRequestIdRef.current) {
        return;
      }
      error(loadError instanceof Error ? loadError.message : "Failed to load technician workflow");
    } finally {
      if (requestId === loadJobsRequestIdRef.current) {
        setLoading(false);
      }
    }
  };

  const loadSelectedJobNotes = async (jobId: string) => {
    const requestId = ++loadNotesRequestIdRef.current;
    setNotesLoading(true);

    try {
      const payload = await apiGet<WorkshopNotesResponse>(`/api/workshop/jobs/${encodeURIComponent(jobId)}/notes`);
      if (requestId !== loadNotesRequestIdRef.current) {
        return;
      }
      setSelectedNotes(Array.isArray(payload.notes) ? payload.notes : []);
    } catch (loadError) {
      if (requestId !== loadNotesRequestIdRef.current) {
        return;
      }
      error(loadError instanceof Error ? loadError.message : "Failed to load workshop notes");
    } finally {
      if (requestId === loadNotesRequestIdRef.current) {
        setNotesLoading(false);
      }
    }
  };

  useEffect(() => () => {
    loadJobsRequestIdRef.current += 1;
    loadNotesRequestIdRef.current += 1;
  }, []);

  useEffect(() => {
    void loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardQuery]);

  const presentations = useMemo(
    () => jobs
      .filter((job) => isOpenWorkshopJob(job.status))
      .map((job) => createBenchPresentation(job, user?.id, todayKey))
      .sort(compareBenchPresentations),
    [jobs, todayKey, user?.id],
  );

  const visiblePresentations = useMemo(
    () => presentations.filter((presentation) => matchesFocusFilter(presentation, focusFilter)),
    [focusFilter, presentations],
  );

  const sections = useMemo<BenchSection[]>(
    () => [
      {
        key: "ACTIONABLE",
        title: "Actionable now",
        description: "Jobs a technician can start, continue, or finish without hunting through admin detail.",
        emptyText: "No actionable bench work matches the current technician scope.",
        jobs: visiblePresentations.filter((presentation) => presentation.bucket === "ACTIONABLE"),
      },
      {
        key: "TODAY",
        title: "Booked today",
        description: "Promised today or already overdue, but not currently blocked or handed back.",
        emptyText: "No today-focused work is visible right now.",
        jobs: visiblePresentations.filter((presentation) => presentation.bucket === "TODAY"),
      },
      {
        key: "BLOCKED",
        title: "Blocked",
        description: "Waiting on customer approval, missing parts, or a deliberate pause.",
        emptyText: "Nothing in this technician scope is currently blocked.",
        jobs: visiblePresentations.filter((presentation) => presentation.bucket === "BLOCKED"),
      },
      {
        key: "QUEUE",
        title: "Queued next",
        description: "Useful backlog that is not urgent today, but still belongs in the technician workflow.",
        emptyText: "No queued follow-on work is visible.",
        jobs: visiblePresentations.filter((presentation) => presentation.bucket === "QUEUE"),
      },
      {
        key: "HANDOFF",
        title: "Hand back",
        description: "Bench work is done. These jobs need the front-desk collection flow, not more bench time.",
        emptyText: "Nothing is waiting for handback or collection.",
        jobs: visiblePresentations.filter((presentation) => presentation.bucket === "HANDOFF"),
      },
    ],
    [visiblePresentations],
  );

  const summary = useMemo(() => {
    const actionableCount = presentations.filter((presentation) => presentation.bucket === "ACTIONABLE").length;
    const todayCount = presentations.filter((presentation) => presentation.isToday || presentation.isOverdue).length;
    const blockedCount = presentations.filter((presentation) => presentation.bucket === "BLOCKED").length;
    const handoffCount = presentations.filter((presentation) => presentation.bucket === "HANDOFF").length;
    const unassignedCount = presentations.filter((presentation) => !presentation.job.assignedStaffId).length;

    return {
      visibleCount: presentations.length,
      actionableCount,
      todayCount,
      blockedCount,
      handoffCount,
      unassignedCount,
    };
  }, [presentations]);

  const fallbackSelectedJobId = useMemo(
    () => sections.find((section) => section.jobs.length > 0)?.jobs[0]?.job.id ?? null,
    [sections],
  );

  useEffect(() => {
    if (!selectedJobId || !visiblePresentations.some((presentation) => presentation.job.id === selectedJobId)) {
      setSelectedJobId(fallbackSelectedJobId);
    }
  }, [fallbackSelectedJobId, selectedJobId, visiblePresentations]);

  const selectedPresentation = useMemo(
    () => visiblePresentations.find((presentation) => presentation.job.id === selectedJobId) ?? null,
    [selectedJobId, visiblePresentations],
  );

  useEffect(() => {
    setNoteDraft("");

    if (!selectedPresentation) {
      setSelectedNotes([]);
      return;
    }

    void loadSelectedJobNotes(selectedPresentation.job.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPresentation?.job.id]);

  const internalNotes = useMemo(
    () => [...selectedNotes]
      .filter((note) => note.visibility === "INTERNAL")
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
    [selectedNotes],
  );

  const selectedActions = selectedPresentation
    ? getBenchActions(selectedPresentation, user?.id)
    : [];

  const runAction = async (presentation: BenchPresentation, action: BenchAction) => {
    const nextActionKey = `${presentation.job.id}:${action.kind}:${action.value}`;
    setRunningActionKey(nextActionKey);

    try {
      if (action.kind === "navigate") {
        navigate(action.value);
        return;
      }

      if (action.kind === "approval") {
        await apiPost(`/api/workshop/jobs/${encodeURIComponent(presentation.job.id)}/approval`, {
          status: action.value,
        });
        success(action.value === "APPROVED" ? "Approval recorded" : "Approval state updated");
      } else if (action.kind === "assign") {
        await apiPost(`/api/workshop/jobs/${encodeURIComponent(presentation.job.id)}/assign`, {
          staffId: action.value,
        });
        success("Job assigned");
      } else {
        await apiPost(`/api/workshop/jobs/${encodeURIComponent(presentation.job.id)}/status`, {
          status: action.value,
        });
        success("Workshop status updated");
      }

      await loadDashboard();
      if (selectedJobId === presentation.job.id) {
        await loadSelectedJobNotes(presentation.job.id);
      }
    } catch (actionError) {
      error(actionError instanceof Error ? actionError.message : "Failed to update technician workflow");
    } finally {
      setRunningActionKey(null);
    }
  };

  const addInternalNote = async (event: FormEvent) => {
    event.preventDefault();

    if (!selectedPresentation) {
      return;
    }

    if (!noteDraft.trim()) {
      error("Internal note text is required.");
      return;
    }

    setSavingNote(true);
    try {
      await apiPost(`/api/workshop/jobs/${encodeURIComponent(selectedPresentation.job.id)}/notes`, {
        visibility: "INTERNAL",
        note: noteDraft.trim(),
      });
      setNoteDraft("");
      success("Bench note added");
      await Promise.all([
        loadDashboard(),
        loadSelectedJobNotes(selectedPresentation.job.id),
      ]);
    } catch (noteError) {
      error(noteError instanceof Error ? noteError.message : "Failed to add bench note");
    } finally {
      setSavingNote(false);
    }
  };

  const scopeLabel = user?.role === "STAFF"
    ? "My bench"
    : scopeMode === "MINE"
      ? "My bench"
      : "Team bench";
  const currentTechnicianName = user?.name || user?.username || "Current technician";

  return (
    <div className="page-shell page-shell-workspace workshop-technician-page" data-testid="workshop-technician-page">
      <section className="workshop-technician-topbar">
        <div className="workshop-technician-topbar__title">
          <span className="ui-page-eyebrow">Workshop bench mode</span>
          <h1 className="ui-page-title">Technician workflow</h1>
          <p className="ui-page-description">
            Execution-first workshop view for assigned jobs, blocked work, today&apos;s promises, and fast bench updates without front-desk clutter.
          </p>
        </div>

        <label className="workshop-technician-search">
          <span className="table-secondary">Search</span>
          <div className="workshop-technician-search__field">
            <span className="workshop-technician-search__icon" aria-hidden="true">
              ⌕
            </span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search bike, customer, technician, note"
            />
          </div>
        </label>

        <div className="workshop-technician-controls">
          {user?.role !== "STAFF" ? (
            <div className="workshop-technician-scope-toggle" role="tablist" aria-label="Technician scope">
              {(["MINE", "TEAM"] as BenchScope[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={scopeMode === mode}
                  className={scopeMode === mode ? "workshop-technician-scope-toggle__button workshop-technician-scope-toggle__button--active" : "workshop-technician-scope-toggle__button"}
                  onClick={() => setScopeMode(mode)}
                >
                  {mode === "MINE" ? "My bench" : "Team bench"}
                </button>
              ))}
            </div>
          ) : null}

          <div className="actions-inline workshop-technician-controls__actions">
            <button type="button" onClick={() => void loadDashboard()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            <Link to="/workshop" className="button-link">
              Workshop board
            </Link>
          </div>
        </div>
      </section>

      <section className="workshop-technician-summary" data-testid="workshop-technician-summary">
        <article className="workshop-technician-summary-card">
          <span className="metric-label">{scopeLabel}</span>
          <strong>{summary.visibleCount}</strong>
          <p className="muted-text">
            {scopeMode === "TEAM"
              ? "Open jobs visible to the current bench view."
              : `Jobs currently assigned to ${currentTechnicianName}.`}
          </p>
        </article>
        <article className="workshop-technician-summary-card">
          <span className="metric-label">Actionable now</span>
          <strong>{summary.actionableCount}</strong>
          <p className="muted-text">Work that can be started, resumed, or finished without an extra desk step.</p>
        </article>
        <article className="workshop-technician-summary-card">
          <span className="metric-label">Booked today</span>
          <strong>{summary.todayCount}</strong>
          <p className="muted-text">Promises for today or overdue work that should not disappear into the background.</p>
        </article>
        <article className="workshop-technician-summary-card">
          <span className="metric-label">Blocked</span>
          <strong>{summary.blockedCount}</strong>
          <p className="muted-text">Approval, parts, or hold states that the bench needs to call out truthfully.</p>
        </article>
        <article className="workshop-technician-summary-card workshop-technician-summary-card--ready">
          <span className="metric-label">Ready to hand back</span>
          <strong>{summary.handoffCount}</strong>
          <p className="muted-text">Bench work complete and ready for the counter collection flow.</p>
        </article>
        <article className="workshop-technician-summary-card">
          <span className="metric-label">Needs owner</span>
          <strong>{summary.unassignedCount}</strong>
          <p className="muted-text">Open jobs still lacking a named technician in the current view.</p>
        </article>
      </section>

      <div className="workshop-technician-route-strip">
        <Link to="/workshop" className="workshop-technician-route-link">
          <strong>Workshop board</strong>
          <span>Return to the broader front-desk and scheduling view.</span>
        </Link>
        <Link to="/workshop/calendar" className="workshop-technician-route-link">
          <strong>Full calendar</strong>
          <span>Open the scheduler when bench work needs a planning decision.</span>
        </Link>
        <Link to="/workshop/collection" className="workshop-technician-route-link">
          <strong>Collection queue</strong>
          <span>Handoff-ready jobs belong here once the bench work is complete.</span>
        </Link>
        <Link to="/tasks" className="workshop-technician-route-link">
          <strong>Internal tasks</strong>
          <span>Keep the broader purchasing and reminder queue separate from bench execution.</span>
        </Link>
      </div>

      <div className="workshop-technician-layout">
        <section className="workshop-technician-main">
          <div className="workshop-technician-focus-filter" role="tablist" aria-label="Technician focus">
            {focusFilters.map((filter) => (
              <button
                key={filter.key}
                type="button"
                role="tab"
                aria-selected={focusFilter === filter.key}
                className={focusFilter === filter.key
                  ? "workshop-technician-focus-filter__button workshop-technician-focus-filter__button--active"
                  : "workshop-technician-focus-filter__button"}
                onClick={() => setFocusFilter(filter.key)}
              >
                <strong>{filter.label}</strong>
                <span>{filter.description}</span>
              </button>
            ))}
          </div>

          {sections.map((section) => (
            <section
              key={section.key}
              className="workshop-technician-section"
              data-testid={`workshop-technician-section-${section.key.toLowerCase()}`}
            >
              <div className="workshop-technician-section__header">
                <div>
                  <h2>{section.title}</h2>
                  <p className="muted-text">{section.description}</p>
                </div>
                <span className="stock-badge stock-muted">{section.jobs.length}</span>
              </div>

              {section.jobs.length === 0 ? (
                <div className="workshop-technician-empty">{section.emptyText}</div>
              ) : (
                <div className="workshop-technician-card-grid">
                  {section.jobs.map((presentation) => {
                    const quickActions = getBenchActions(presentation, user?.id).slice(0, 2);
                    const cardIsSelected = presentation.job.id === selectedJobId;
                    return (
                      <article
                        key={presentation.job.id}
                        className={cardIsSelected
                          ? "workshop-technician-card workshop-technician-card--selected"
                          : "workshop-technician-card"}
                        data-testid={`workshop-technician-card-${presentation.job.id}`}
                      >
                        <button
                          type="button"
                          className="workshop-technician-card__focus"
                          onClick={() => setSelectedJobId(presentation.job.id)}
                        >
                          <div className="workshop-technician-card__topline">
                            <strong>{presentation.job.bikeDescription || "Workshop job"}</strong>
                            <span className={presentation.workflowSummary.className}>{presentation.workflowSummary.label}</span>
                          </div>

                          <span className="workshop-technician-card__customer">{formatCustomerName(presentation.job)}</span>

                          <div className="workshop-technician-card__badges">
                            <span className={workshopRawStatusClass(presentation.job)}>{workshopRawStatusLabel(presentation.job)}</span>
                            {presentation.attentionLabel ? (
                              <span className={presentation.attentionClassName}>{presentation.attentionLabel}</span>
                            ) : null}
                            {presentation.partsStatus !== "OK" ? (
                              <span className={getPartsBadgeClassName(presentation.partsStatus)}>
                                Parts: {presentation.partsStatus}
                              </span>
                            ) : null}
                          </div>

                          <div className="workshop-technician-card__meta">
                            <div>
                              <span className="metric-label">When</span>
                              <strong>{presentation.scheduleLabel}</strong>
                            </div>
                            <div>
                              <span className="metric-label">Owner</span>
                              <strong>{presentation.job.assignedStaffName || "Unassigned"}</strong>
                            </div>
                            <div>
                              <span className="metric-label">Blocker</span>
                              <strong>{presentation.workflowSummary.blockerLabel}</strong>
                            </div>
                            <div>
                              <span className="metric-label">Activity</span>
                              <strong>{presentation.activityLabel}</strong>
                            </div>
                          </div>

                          <p className="workshop-technician-card__detail">
                            {truncateText(presentation.workflowSummary.nextStep, 148)
                              ?? truncateText(presentation.job.notes, 148)
                              ?? "Open the job for deeper editing when the bench needs more than a quick progress update."}
                          </p>
                        </button>

                        <div className="workshop-technician-card__actions">
                          {quickActions.map((action) => {
                            const currentActionKey = `${presentation.job.id}:${action.kind}:${action.value}`;
                            return (
                              <button
                                key={`${action.kind}-${action.value}`}
                                type="button"
                                className={action.tone === "primary" ? "primary" : undefined}
                                data-testid={actionTestId(presentation.job.id, action)}
                                disabled={runningActionKey === currentActionKey}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void runAction(presentation, action);
                                }}
                              >
                                {runningActionKey === currentActionKey ? "Working..." : action.label}
                              </button>
                            );
                          })}

                          <Link to={`/workshop/${presentation.job.id}`} className="button-link">
                            Open job
                          </Link>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          ))}
        </section>

        <aside className="workshop-technician-detail" data-testid="workshop-technician-detail">
          <div className="workshop-technician-detail__header">
            <div>
              <span className="table-secondary">Bench detail</span>
              <h2>{selectedPresentation?.job.bikeDescription || "Select a job"}</h2>
            </div>
            {selectedPresentation ? (
              <Link to={`/workshop/${selectedPresentation.job.id}`} className="button-link">
                Open full job
              </Link>
            ) : null}
          </div>

          {selectedPresentation ? (
            <>
              <div className="workshop-technician-detail__customer">
                <strong>{formatCustomerName(selectedPresentation.job)}</strong>
                <span>{selectedPresentation.job.customer?.phone || selectedPresentation.job.customer?.email || "No direct contact on file"}</span>
              </div>

              <div className="workshop-technician-detail__badges">
                <span className={workshopRawStatusClass(selectedPresentation.job)}>{workshopRawStatusLabel(selectedPresentation.job)}</span>
                <span className={selectedPresentation.workflowSummary.className}>{selectedPresentation.workflowSummary.label}</span>
                {selectedPresentation.attentionLabel ? (
                  <span className={selectedPresentation.attentionClassName}>{selectedPresentation.attentionLabel}</span>
                ) : null}
                {selectedPresentation.partsStatus !== "OK" ? (
                  <span className={getPartsBadgeClassName(selectedPresentation.partsStatus)}>
                    Parts: {selectedPresentation.partsStatus}
                  </span>
                ) : null}
              </div>

              <div className="workshop-technician-detail__summary">
                <div>
                  <span className="metric-label">When</span>
                  <strong>{selectedPresentation.scheduleLabel}</strong>
                </div>
                <div>
                  <span className="metric-label">Owner</span>
                  <strong>{selectedPresentation.job.assignedStaffName || "Unassigned"}</strong>
                </div>
                <div>
                  <span className="metric-label">Next step</span>
                  <strong>{selectedPresentation.workflowSummary.nextStep}</strong>
                </div>
                <div>
                  <span className="metric-label">Progress notes</span>
                  <strong>{selectedPresentation.job.noteCount} saved</strong>
                </div>
              </div>

              {selectedPresentation.handoffLabel ? (
                <div className="workshop-technician-detail__signal">
                  <strong>Handoff state</strong>
                  <span>{selectedPresentation.handoffLabel}</span>
                </div>
              ) : null}

              {selectedPresentation.job.notes ? (
                <div className="workshop-technician-detail__signal">
                  <strong>Job note</strong>
                  <span>{selectedPresentation.job.notes}</span>
                </div>
              ) : null}

              <div className="workshop-technician-detail__actions">
                {selectedActions.map((action) => {
                  const currentActionKey = `${selectedPresentation.job.id}:${action.kind}:${action.value}`;
                  return (
                    <button
                      key={`${action.kind}-${action.value}`}
                      type="button"
                      className={action.tone === "primary" ? "primary" : undefined}
                      data-testid={`${actionTestId(selectedPresentation.job.id, action)}-detail`}
                      disabled={runningActionKey === currentActionKey}
                      onClick={() => {
                        void runAction(selectedPresentation, action);
                      }}
                    >
                      {runningActionKey === currentActionKey ? "Working..." : action.label}
                    </button>
                  );
                })}
              </div>

              <form className="workshop-technician-note-form" data-testid="workshop-technician-note-form" onSubmit={(event) => void addInternalNote(event)}>
                <div className="workshop-technician-note-form__header">
                  <div>
                    <h3>Quick progress note</h3>
                    <p className="muted-text">Internal-only update for the bench, without dropping into the full job page.</p>
                  </div>
                </div>
                <textarea
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  placeholder="Example: stripped drivetrain, waiting on rear mech hanger confirmation"
                  rows={4}
                />
                <div className="actions-inline">
                  <button type="submit" className="primary" disabled={savingNote}>
                    {savingNote ? "Saving..." : "Save internal note"}
                  </button>
                </div>
              </form>

              <section className="workshop-technician-notes">
                <div className="workshop-technician-notes__header">
                  <h3>Recent internal notes</h3>
                  <span className="table-secondary">{internalNotes.length}</span>
                </div>

                {notesLoading ? (
                  <div className="workshop-technician-empty">Loading notes…</div>
                ) : internalNotes.length === 0 ? (
                  <div className="workshop-technician-empty">No internal progress notes yet for this job.</div>
                ) : (
                  <div className="workshop-technician-note-list">
                    {internalNotes.slice(0, 5).map((note) => (
                      <article key={note.id} className="workshop-technician-note-list__item">
                        <div className="workshop-technician-note-list__meta">
                          <strong>{note.authorStaff?.name || note.authorStaff?.username || "Workshop staff"}</strong>
                          <span>{formatShortDateTime(note.createdAt)}</span>
                        </div>
                        <p>{note.note}</p>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : (
            <div className="workshop-technician-empty">
              No job is currently selected. Pick a card from the technician workflow to see context, actions, and recent bench notes.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
