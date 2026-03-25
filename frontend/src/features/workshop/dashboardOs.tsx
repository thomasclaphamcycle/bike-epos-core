import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { useToasts } from "../../components/ToastProvider";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { WorkshopSchedulerScreen } from "../../pages/WorkshopCalendarPage";
import {
  getWorkshopTechnicianWorkflowSummary,
  workshopRawStatusClass,
  workshopRawStatusLabel,
} from "./status";
import { WorkshopIntakeOverlay } from "./WorkshopIntakeOverlay";

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

type SurfaceMode = "calendar" | "board";
type BoardMode = "board" | "list";
type DisplayBucket = "booked" | "inProgress" | "waitingParts" | "ready" | "completed";
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

type WorkshopJobDrawerLine = {
  id: string;
  type: "LABOUR" | "PART";
  description: string;
  qty: number;
  unitPricePence: number;
  lineTotalPence: number;
  productName: string | null;
  variantName: string | null;
};

type WorkshopJobDrawerBike = {
  id: string;
  displayName: string;
  make: string | null;
  model: string | null;
  colour: string | null;
  frameNumber: string | null;
  serialNumber: string | null;
};

type WorkshopJobDrawerEstimate = {
  id: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  labourTotalPence: number;
  partsTotalPence: number;
  subtotalPence: number;
  lineCount: number;
  requestedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  customerQuote: {
    publicPath: string;
    expiresAt: string;
    status: "ACTIVE" | "EXPIRED";
  } | null;
};

type WorkshopJobDrawerResponse = {
  job: {
    id: string;
    status: string;
    customerId: string | null;
    customerName: string | null;
    bikeId: string | null;
    bikeDescription: string | null;
    bike: WorkshopJobDrawerBike | null;
    notes: string | null;
    assignedStaffId: string | null;
    assignedStaffName: string | null;
    scheduledDate: string | null;
    scheduledStartAt: string | null;
    scheduledEndAt: string | null;
    durationMinutes: number | null;
    depositRequiredPence: number;
    depositStatus: string;
    finalizedBasketId: string | null;
    sale: {
      id: string;
      totalPence: number;
      createdAt: string;
    } | null;
    completedAt: string | null;
    closedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  lines: WorkshopJobDrawerLine[];
  partsOverview: {
    summary: {
      requiredQty: number;
      allocatedQty: number;
      consumedQty: number;
      returnedQty: number;
      outstandingQty: number;
      missingQty: number;
      partsStatus: "OK" | "UNALLOCATED" | "SHORT";
    };
  } | null;
  currentEstimate: WorkshopJobDrawerEstimate | null;
  estimateHistory: WorkshopJobDrawerEstimate[];
  hasApprovedEstimate: boolean;
};

type WorkshopJobDrawerNote = {
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

type WorkshopJobDrawerNotesResponse = {
  notes: WorkshopJobDrawerNote[];
};

type WorkshopJobDrawerAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  fileSizeBytes: number;
  visibility: "INTERNAL" | "CUSTOMER";
  createdAt: string;
  isImage: boolean;
  uploadedByStaff: {
    id: string;
    username: string;
    name: string | null;
  } | null;
};

type WorkshopJobDrawerAttachmentsResponse = {
  workshopJobId: string;
  attachments: WorkshopJobDrawerAttachment[];
};

type JobWorkspaceSectionKey =
  | "customer"
  | "bike"
  | "jobDetails"
  | "planning"
  | "estimate"
  | "partsAllocation"
  | "notes"
  | "attachments";

const DEFAULT_JOB_WORKSPACE_COLLAPSED: Record<JobWorkspaceSectionKey, boolean> = {
  customer: false,
  bike: false,
  jobDetails: false,
  planning: true,
  estimate: true,
  partsAllocation: true,
  notes: true,
  attachments: true,
};

const quickFilters: Array<{
  key: QuickFilterKey;
  label: string;
  description: string;
}> = [
  { key: "ALL", label: "All", description: "Every live workshop job in the current queue." },
  { key: "MY_JOBS", label: "My Jobs", description: "Jobs assigned directly to you." },
  { key: "DUE_TODAY", label: "Due Today", description: "Promised today and needs front-of-house attention." },
  { key: "OVERDUE", label: "Overdue", description: "Promised date has already passed." },
  { key: "WAITING_FOR_PARTS", label: "Waiting for Parts", description: "Bench work is blocked on stock." },
  { key: "READY_FOR_COLLECTION", label: "Ready for Collection", description: "Ready to hand over or send to POS." },
];

const boardColumns: Array<{
  key: DisplayBucket;
  label: string;
  description: string;
  tone: "default" | "attention" | "ready" | "complete";
}> = [
  { key: "booked", label: "Booked", description: "Queued work that is booked in or waiting on a customer decision.", tone: "default" },
  { key: "inProgress", label: "In Progress", description: "Active bench work or jobs paused internally by the workshop.", tone: "default" },
  { key: "waitingParts", label: "Waiting for Parts", description: "Blocked on stock or supplier lead time.", tone: "attention" },
  { key: "ready", label: "Ready for Collection", description: "Bench work is done and handover can start.", tone: "ready" },
  { key: "completed", label: "Completed", description: "Collected jobs kept for lightweight context only.", tone: "complete" },
];

const getCustomerName = (job: DashboardJob) => {
  if (!job.customer) {
    return "Walk-in / not linked";
  }
  return [job.customer.firstName, job.customer.lastName].filter(Boolean).join(" ") || "Customer linked";
};

const formatMoney = (pence: number | null) => {
  if (pence === null) {
    return "-";
  }
  return `£${(pence / 100).toFixed(2)}`;
};

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

const formatFileSize = (bytes: number) => {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
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
    case "BOOKED":
    case "BIKE_ARRIVED":
    case "WAITING_FOR_APPROVAL":
      return "booked";
    case "WAITING_FOR_PARTS":
      return "waitingParts";
    case "READY_FOR_COLLECTION":
      return "ready";
    case "COMPLETED":
      return "completed";
    case "CANCELLED":
      return null;
    default:
      return partsStatus === "SHORT" ? "waitingParts" : "inProgress";
  }
};

const getNextStepHint = (job: DashboardJob) =>
  getWorkshopTechnicianWorkflowSummary({
    rawStatus: job.status,
    partsStatus: job.partsStatus,
    assignedStaffName: job.assignedStaffName,
    scheduledDate: job.scheduledDate,
    hasSale: Boolean(job.sale),
    hasBasket: Boolean(job.finalizedBasketId),
  }).nextStep;

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
        { label: "Ready for Collection", kind: "status", value: "READY_FOR_COLLECTION" },
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
      return toDisplayBucket(job) === "waitingParts";
    case "READY_FOR_COLLECTION":
      return toDisplayBucket(job) === "ready";
    default:
      return true;
  }
};

const getColumnToneClass = (tone: "default" | "attention" | "ready" | "complete") => {
  switch (tone) {
    case "attention":
      return "workshop-os-column workshop-os-column--attention";
    case "ready":
      return "workshop-os-column workshop-os-column--ready";
    case "complete":
      return "workshop-os-column workshop-os-column--complete";
    default:
      return "workshop-os-column";
  }
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

const getAgendaTitle = (job: DashboardJob) =>
  job.bikeDescription || getCustomerName(job);

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

export const WorkshopDashboardPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { success, error } = useToasts();

  const [surfaceMode, setSurfaceMode] = useState<SurfaceMode>("calendar");
  const [boardMode, setBoardMode] = useState<BoardMode>("board");
  const [quickFilter, setQuickFilter] = useState<QuickFilterKey>("ALL");
  const [status, setStatus] = useState<(typeof statusOptions)[number]>("");
  const [search, setSearch] = useState("");
  const [selectedTechnician, setSelectedTechnician] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [isIntakeOpen, setIsIntakeOpen] = useState(false);
  const [jobWorkspaceDetails, setJobWorkspaceDetails] = useState<WorkshopJobDrawerResponse | null>(null);
  const [jobWorkspaceNotes, setJobWorkspaceNotes] = useState<WorkshopJobDrawerNote[]>([]);
  const [jobWorkspaceAttachments, setJobWorkspaceAttachments] = useState<WorkshopJobDrawerAttachment[]>([]);
  const [jobWorkspaceLoading, setJobWorkspaceLoading] = useState(false);
  const [jobWorkspaceError, setJobWorkspaceError] = useState<string | null>(null);
  const [collapsedJobWorkspaceSections, setCollapsedJobWorkspaceSections] = useState<Record<JobWorkspaceSectionKey, boolean>>(
    DEFAULT_JOB_WORKSPACE_COLLAPSED,
  );
  const debouncedSearch = useDebouncedValue(search, 250);

  const [jobs, setJobs] = useState<DashboardJob[]>([]);
  const [staffingToday, setStaffingToday] = useState<DashboardResponse["staffingToday"] | null>(null);
  const [capacityToday, setCapacityToday] = useState<DashboardResponse["capacityToday"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [schedulerRefreshToken, setSchedulerRefreshToken] = useState(0);

  const listQuery = useMemo(
    () => buildDashboardQuery({ status, search: debouncedSearch }),
    [status, debouncedSearch],
  );

  const loadJobs = async (queryString = listQuery) => {
    setLoading(true);
    try {
      const payload = await apiGet<DashboardResponse>(`/api/workshop/dashboard?${queryString}`);
      setJobs(payload.jobs || []);
      setStaffingToday(payload.staffingToday ?? null);
      setCapacityToday(payload.capacityToday ?? null);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load workshop dashboard";
      error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listQuery]);

  useEffect(() => {
    if (!selectedJobId) {
      setJobWorkspaceDetails(null);
      setJobWorkspaceNotes([]);
      setJobWorkspaceAttachments([]);
      setJobWorkspaceLoading(false);
      setJobWorkspaceError(null);
      return undefined;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedJobId(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedJobId]);

  useEffect(() => {
    if (!selectedJobId) {
      return;
    }
    setCollapsedJobWorkspaceSections(DEFAULT_JOB_WORKSPACE_COLLAPSED);
  }, [selectedJobId]);

  useEffect(() => {
    if (!selectedJobId) {
      return undefined;
    }

    let cancelled = false;

    const loadJobWorkspace = async () => {
      setJobWorkspaceLoading(true);
      setJobWorkspaceError(null);
      try {
        const [details, notes, attachments] = await Promise.all([
          apiGet<WorkshopJobDrawerResponse>(`/api/workshop/jobs/${encodeURIComponent(selectedJobId)}`),
          apiGet<WorkshopJobDrawerNotesResponse>(`/api/workshop/jobs/${encodeURIComponent(selectedJobId)}/notes`),
          apiGet<WorkshopJobDrawerAttachmentsResponse>(`/api/workshop/jobs/${encodeURIComponent(selectedJobId)}/attachments`),
        ]);

        if (cancelled) {
          return;
        }

        setJobWorkspaceDetails(details);
        setJobWorkspaceNotes(notes.notes || []);
        setJobWorkspaceAttachments(attachments.attachments || []);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        setJobWorkspaceError(loadError instanceof Error ? loadError.message : "Failed to load job workspace");
      } finally {
        if (!cancelled) {
          setJobWorkspaceLoading(false);
        }
      }
    };

    void loadJobWorkspace();
    return () => {
      cancelled = true;
    };
  }, [selectedJobId]);

  useEffect(() => {
    if (!isIntakeOpen) {
      return undefined;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsIntakeOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isIntakeOpen]);

  const updateStatus = async (jobId: string, nextStatus: string) => {
    try {
      await apiPost(`/api/workshop/jobs/${encodeURIComponent(jobId)}/status`, {
        status: nextStatus,
      });
      success("Job status updated");
      await loadJobs();
      setSchedulerRefreshToken((current) => current + 1);
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
      setSchedulerRefreshToken((current) => current + 1);
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

  const technicianOptions = useMemo(() => {
    const optionMap = new Map<string, string>();

    staffingToday?.scheduledStaff.forEach((entry) => {
      optionMap.set(entry.staffId, entry.name);
    });

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
  }, [jobs, staffingToday?.scheduledStaff, user?.id, user?.name, user?.role, user?.username]);

  const defaultIntakeTechnicianId = useMemo(() => {
    if (selectedTechnician) {
      return selectedTechnician;
    }

    if (quickFilter === "MY_JOBS" && user?.id) {
      return user.id;
    }

    return "";
  }, [quickFilter, selectedTechnician, user?.id]);

  const visibleJobs = useMemo(() => (
    jobs.filter((job) => {
      if (!showCompleted && toDisplayBucket(job) === "completed") {
        return false;
      }
      if (selectedTechnician && job.assignedStaffId !== selectedTechnician) {
        return false;
      }
      return matchesQuickFilter(job, quickFilter, user?.id);
    })
  ), [jobs, quickFilter, selectedTechnician, showCompleted, user?.id]);

  const bucketedJobs = useMemo(
    () =>
      boardColumns
        .filter((column) => showCompleted || column.key !== "completed")
        .map((column) => ({
          ...column,
          jobs: visibleJobs.filter((job) => toDisplayBucket(job) === column.key).sort(compareJobs),
        })),
    [showCompleted, visibleJobs],
  );

  const queueSummary = useMemo(() => {
    const overdueCount = visibleJobs.filter((job) => getUrgency(job)?.label === "Overdue").length;
    const dueTodayCount = visibleJobs.filter((job) => getUrgency(job)?.label === "Due Today").length;
    const readyCount = visibleJobs.filter((job) => toDisplayBucket(job) === "ready").length;
    const partsBlockedCount = visibleJobs.filter((job) => toPartsStatus(job) === "SHORT").length;
    const assignedCount = visibleJobs.filter((job) => Boolean(job.assignedStaffId)).length;

    return {
      overdueCount,
      dueTodayCount,
      readyCount,
      partsBlockedCount,
      assignedCount,
    };
  }, [visibleJobs]);

  const agendaJobs = useMemo(
    () =>
      visibleJobs
        .filter((job) => job.scheduledDate && toDisplayBucket(job) !== "completed")
        .sort(compareJobs)
        .slice(0, 6),
    [visibleJobs],
  );

  const alertGroups = useMemo(() => {
    const approvalJobs = visibleJobs.filter((job) => job.status === "WAITING_FOR_APPROVAL");
    const partsJobs = visibleJobs.filter((job) => toDisplayBucket(job) === "waitingParts");
    const unassignedJobs = visibleJobs.filter(
      (job) => !job.assignedStaffId && toDisplayBucket(job) !== "completed" && toDisplayBucket(job) !== "ready",
    );
    const readyJobs = visibleJobs.filter((job) => toDisplayBucket(job) === "ready");

    return [
      {
        key: "approval",
        title: "Waiting on approval",
        tone: approvalJobs.length ? "warning" : "neutral",
        description: approvalJobs.length
          ? `${approvalJobs.length} quote${approvalJobs.length === 1 ? "" : "s"} still need customer sign-off.`
          : "No quotes are blocking the bench right now.",
        jobs: approvalJobs.slice(0, 3),
      },
      {
        key: "parts",
        title: "Waiting on parts",
        tone: partsJobs.length ? "warning" : "neutral",
        description: partsJobs.length
          ? `${partsJobs.length} job${partsJobs.length === 1 ? "" : "s"} are blocked on stock or supplier lead time.`
          : "No jobs are currently blocked on parts.",
        jobs: partsJobs.slice(0, 3),
      },
      {
        key: "unassigned",
        title: "Assignment gaps",
        tone: unassignedJobs.length ? "attention" : "neutral",
        description: unassignedJobs.length
          ? `${unassignedJobs.length} live job${unassignedJobs.length === 1 ? "" : "s"} still need a named technician.`
          : "Every visible live job already has an assigned owner.",
        jobs: unassignedJobs.slice(0, 3),
      },
      {
        key: "collection",
        title: "Ready to hand over",
        tone: readyJobs.length ? "ready" : "neutral",
        description: readyJobs.length
          ? `${readyJobs.length} bike${readyJobs.length === 1 ? "" : "s"} are ready for collection or POS handoff.`
          : "Nothing is waiting for collection right now.",
        jobs: readyJobs.slice(0, 3),
      },
    ];
  }, [visibleJobs]);

  const staffingWindow = staffingToday
    ? formatTradingWindow(staffingToday.summary.opensAt, staffingToday.summary.closesAt)
    : null;
  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? null,
    [jobs, selectedJobId],
  );
  const selectedJobWorkspaceJob = jobWorkspaceDetails?.job ?? null;
  const selectedJobWorkspaceBike = selectedJobWorkspaceJob?.bike ?? null;
  const selectedJobWorkspaceCustomerName = selectedJobWorkspaceJob?.customerName || (selectedJob ? getCustomerName(selectedJob) : "Customer pending");
  const selectedJobWorkspaceLines = jobWorkspaceDetails?.lines ?? [];
  const selectedJobWorkspaceLabourLines = selectedJobWorkspaceLines.filter((line) => line.type === "LABOUR");
  const selectedJobWorkspacePartLines = selectedJobWorkspaceLines.filter((line) => line.type === "PART");
  const selectedJobWorkspacePartsSummary = jobWorkspaceDetails?.partsOverview?.summary ?? selectedJob?.partsSummary ?? null;
  const selectedWorkflowSummary = selectedJob
    ? getWorkshopTechnicianWorkflowSummary({
        rawStatus: selectedJob.status,
        partsStatus: selectedJob.partsStatus,
        assignedStaffName: selectedJob.assignedStaffName,
        scheduledDate: selectedJob.scheduledDate,
        hasSale: Boolean(selectedJob.sale),
        hasBasket: Boolean(selectedJob.finalizedBasketId),
      })
    : null;
  const selectedQuickActions = selectedJob ? getQuickActions(selectedJob) : [];
  const activeFilter = quickFilters.find((filter) => filter.key === quickFilter) ?? quickFilters[0];
  const toggleJobWorkspaceSection = (section: JobWorkspaceSectionKey) => {
    setCollapsedJobWorkspaceSections((current) => ({
      ...current,
      [section]: !current[section],
    }));
  };

  const handleIntakeCreated = async (_jobId: string) => {
    setQuickFilter("ALL");
    setStatus("");
    setSearch("");
    setSelectedTechnician("");
    await loadJobs(buildDashboardQuery({}));
    setSchedulerRefreshToken((current) => current + 1);
    setSurfaceMode("calendar");
    setSelectedJobId(null);
  };

  const renderJobWorkspaceSection = (
    section: JobWorkspaceSectionKey,
    title: string,
    description: string,
    children: ReactNode,
    footerAction?: ReactNode,
  ) => (
    <section className="workshop-os-drawer__section workshop-os-job-workspace-section">
      <button
        type="button"
        className="workshop-os-job-workspace-section__toggle"
        onClick={() => toggleJobWorkspaceSection(section)}
        aria-expanded={!collapsedJobWorkspaceSections[section]}
      >
        <span className="workshop-os-job-workspace-section__toggle-copy">
          <strong>{title}</strong>
          <span className="table-secondary">{description}</span>
        </span>
        <span className="button-link--inline">{collapsedJobWorkspaceSections[section] ? "Expand" : "Collapse"}</span>
      </button>

      {!collapsedJobWorkspaceSections[section] ? (
        <div className="workshop-os-job-workspace-section__body">
          {children}
          {footerAction ? (
            <div className="workshop-os-job-workspace-section__footer">
              {footerAction}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );

  return (
    <div className="page-shell page-shell-workspace workshop-os-page">
      <section className="workshop-os-header">
        <div className="workshop-os-header__row">
          <div className="workshop-os-header__copy">
            <p className="ui-page-eyebrow">Workshop Operating Screen</p>
            <h1 className="ui-page-title">Workshop</h1>
            <p className="ui-page-description">
              Run the workshop from one place, with the timed scheduler as the default operating surface and the board still available as a secondary view when needed.
            </p>
          </div>
          <div className="workshop-os-header__actions">
            <button
              type="button"
              className="button-link"
              onClick={() => {
                setSelectedJobId(null);
                setIsIntakeOpen(true);
              }}
            >
              New Job
            </button>
            <Link to="/workshop/calendar" className="button-link">
              Open Standalone Calendar
            </Link>
            <button
              type="button"
              onClick={() => {
                void loadJobs();
                setSchedulerRefreshToken((current) => current + 1);
              }}
              disabled={loading}
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="workshop-os-surface-toggle" role="tablist" aria-label="Workshop view">
          <button
            type="button"
            role="tab"
            aria-selected={surfaceMode === "calendar"}
            className={surfaceMode === "calendar"
              ? "workshop-os-filter-chip workshop-os-filter-chip--active"
              : "workshop-os-filter-chip"}
            onClick={() => {
              setSelectedJobId(null);
              setSurfaceMode("calendar");
            }}
          >
            Operating Screen
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={surfaceMode === "board"}
            className={surfaceMode === "board"
              ? "workshop-os-filter-chip workshop-os-filter-chip--active"
              : "workshop-os-filter-chip"}
            onClick={() => setSurfaceMode("board")}
          >
            Board
          </button>
        </div>

        {surfaceMode === "board" ? (
          <>
            <div className="workshop-os-topbar">
              <label className="workshop-os-search">
                <span className="table-secondary">Search jobs, customers, or notes</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search customer, bike, notes"
                />
              </label>

              <div className="workshop-os-topbar__meta">
                <span className="stock-badge stock-muted">{visibleJobs.length} visible jobs</span>
                {capacityToday ? (
                  <span className={toCapacityBadgeClass(capacityToday.status)}>{capacityToday.label}</span>
                ) : null}
                {staffingToday?.summary.isClosed ? (
                  <span className="status-badge status-info">Store closed</span>
                ) : staffingWindow ? (
                  <span className="stock-badge stock-muted">Trading {staffingWindow}</span>
                ) : null}
              </div>
            </div>

            <div className="workshop-os-quick-filters" role="tablist" aria-label="Workshop quick filters">
              {quickFilters.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  role="tab"
                  aria-selected={quickFilter === filter.key}
                  className={quickFilter === filter.key
                    ? "workshop-os-filter-chip workshop-os-filter-chip--active"
                    : "workshop-os-filter-chip"}
                  onClick={() => setQuickFilter(filter.key)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </section>

      {surfaceMode === "calendar" ? (
        <WorkshopSchedulerScreen embedded refreshToken={schedulerRefreshToken} />
      ) : (
      <div className="workshop-os-layout">
        <aside className="workshop-os-sidebar">
          <section className="workshop-os-sidebar-card">
            <div className="workshop-os-sidebar-card__header">
              <h2>Filters</h2>
              <span className="table-secondary">Tighten the current workshop view.</span>
            </div>

            <div className="workshop-os-controls">
              <div className="workshop-os-saved-views">
                {quickFilters.map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    className={quickFilter === filter.key
                      ? "workshop-os-view-button workshop-os-view-button--active"
                      : "workshop-os-view-button"}
                    onClick={() => setQuickFilter(filter.key)}
                  >
                    <strong>{filter.label}</strong>
                    <span>{filter.description}</span>
                  </button>
                ))}
              </div>

              <div className="workshop-os-field-grid">
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

                <label>
                  Technician
                  <select value={selectedTechnician} onChange={(event) => setSelectedTechnician(event.target.value)}>
                    <option value="">Everyone</option>
                    {technicianOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={showCompleted}
                  onChange={(event) => setShowCompleted(event.target.checked)}
                />
                <span>Show completed column</span>
              </label>

              {surfaceMode === "board" ? (
                <div className="workshop-os-inline-actions">
                  <button
                    type="button"
                    className={boardMode === "board" ? "primary" : undefined}
                    onClick={() => setBoardMode("board")}
                  >
                    Board
                  </button>
                  <button
                    type="button"
                    className={boardMode === "list" ? "primary" : undefined}
                    onClick={() => setBoardMode("list")}
                  >
                    Queue List
                  </button>
                </div>
              ) : null}
            </div>
          </section>

        </aside>

        <section className="workshop-os-main">
          <section className="workshop-os-board-shell">
            <div className="workshop-os-board-header">
              <div>
                <h2>Live board</h2>
                <p className="muted-text">
                  {activeFilter.description}
                </p>
              </div>
              <div className="workshop-os-board-header__meta">
                <span className="stock-badge stock-muted">{visibleJobs.length} in view</span>
                {jobs.length !== visibleJobs.length ? (
                  <span className="table-secondary">{jobs.length - visibleJobs.length} hidden by controls</span>
                ) : null}
              </div>
            </div>

            {boardMode === "board" ? (
              <div className="workshop-os-board-scroll">
                <div className="workshop-os-board">
                  {bucketedJobs.map((column) => (
                    <section key={column.key} className={getColumnToneClass(column.tone)}>
                      <header className="workshop-os-column__header">
                        <div>
                          <h3>{column.label}</h3>
                          <p>{column.description}</p>
                        </div>
                        <span className="stock-badge stock-muted">{column.jobs.length}</span>
                      </header>

                      <div className="workshop-os-column__body">
                        {column.jobs.length === 0 ? (
                          <div className="workshop-os-empty-card">
                            {column.label} is clear right now.
                          </div>
                        ) : (
                          column.jobs.map((job) => {
                            const urgency = getUrgency(job);
                            const workflowSummary = getWorkshopTechnicianWorkflowSummary({
                              rawStatus: job.status,
                              partsStatus: job.partsStatus,
                              assignedStaffName: job.assignedStaffName,
                              scheduledDate: job.scheduledDate,
                              hasSale: Boolean(job.sale),
                              hasBasket: Boolean(job.finalizedBasketId),
                            });
                            const [primaryAction] = getQuickActions(job);

                            return (
                              <article
                                key={job.id}
                                className="workshop-os-job-card"
                                onClick={() => setSelectedJobId(job.id)}
                              >
                                <div className="workshop-os-job-card__header">
                                  <div className="workshop-os-job-card__identity">
                                    <strong>{job.bikeDescription || "Workshop job"}</strong>
                                    <div className="table-secondary">
                                      {getCustomerName(job)}
                                    </div>
                                  </div>
                                  <div className="workshop-os-job-card__signals">
                                    {urgency ? (
                                      <span className={`${urgency.className} workshop-os-job-card__signal--urgency`}>{urgency.label}</span>
                                    ) : null}
                                    <span className={getPartsClassName(job)}>{toPartsStatus(job)}</span>
                                  </div>
                                </div>

                                <div className="workshop-os-job-card__meta-strip">
                                  <span className="workshop-os-job-card__meta-pill">
                                    Due {formatDate(job.scheduledDate)}
                                  </span>
                                  <span className={workflowSummary.className}>{workflowSummary.label}</span>
                                  {job.status === "WAITING_FOR_APPROVAL" ? (
                                    <span className="status-badge status-warning">Approval needed</span>
                                  ) : null}
                                </div>

                                {workflowSummary.blockerLabel ? (
                                  <div className="workshop-os-job-card__blocker">
                                    <span className={workflowSummary.blockerClassName}>{workflowSummary.blockerLabel}</span>
                                    <span className="table-secondary">{workflowSummary.detail}</span>
                                  </div>
                                ) : null}

                                <div
                                  className="workshop-os-job-card__actions"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  {primaryAction ? (
                                    <button
                                      type="button"
                                      className="primary"
                                      onClick={() => {
                                        void runQuickAction(job.id, primaryAction);
                                      }}
                                    >
                                      {primaryAction.label}
                                    </button>
                                  ) : (
                                    <Link to={`/workshop/${job.id}`} className="button-link button-link--inline">
                                      Open Job
                                    </Link>
                                  )}
                                  <span className="table-secondary workshop-os-job-card__hint">Tap card for quick view</span>
                                </div>
                              </article>
                            );
                          })
                        )}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Bike / Customer</th>
                      <th>Workflow</th>
                      <th>Promised</th>
                      <th>Technician</th>
                      <th>Parts</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleJobs.length === 0 ? (
                      <tr>
                        <td colSpan={7}>No jobs match the current workshop controls.</td>
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
                          <tr key={job.id} className="clickable-row" onClick={() => setSelectedJobId(job.id)}>
                            <td>
                              <div className="table-primary mono-text">{job.id.slice(0, 8)}</div>
                              <div className="table-secondary">{workshopRawStatusLabel(job.status)}</div>
                            </td>
                            <td>
                              <div className="table-primary">{job.bikeDescription || "Workshop job"}</div>
                              <div className="table-secondary">{getCustomerName(job)}</div>
                            </td>
                            <td>
                              <div className="status-stack">
                                <span className={workflowSummary.className}>{workflowSummary.label}</span>
                                {getUrgency(job) ? (
                                  <span className={getUrgency(job)?.className}>{getUrgency(job)?.label}</span>
                                ) : null}
                              </div>
                            </td>
                            <td>{formatDate(job.scheduledDate)}</td>
                            <td>{job.assignedStaffName || "Unassigned"}</td>
                            <td className={getPartsClassName(job)}>{toPartsStatus(job)}</td>
                            <td onClick={(event) => event.stopPropagation()}>
                              <div className="actions-inline">
                                {primaryAction ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void runQuickAction(job.id, primaryAction);
                                    }}
                                  >
                                    {primaryAction.label}
                                  </button>
                                ) : null}
                                <button type="button" onClick={() => setSelectedJobId(job.id)}>
                                  Quick View
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="workshop-os-summary-grid">
            <article className="metric-card workshop-os-metric-card">
              <span className="metric-label">Overdue</span>
              <strong className="metric-value">{queueSummary.overdueCount}</strong>
            </article>
            <article className="metric-card workshop-os-metric-card">
              <span className="metric-label">Due Today</span>
              <strong className="metric-value">{queueSummary.dueTodayCount}</strong>
            </article>
            <article className="metric-card workshop-os-metric-card">
              <span className="metric-label">Ready</span>
              <strong className="metric-value">{queueSummary.readyCount}</strong>
            </article>
            <article className="metric-card workshop-os-metric-card">
              <span className="metric-label">Assigned</span>
              <strong className="metric-value">{queueSummary.assignedCount}</strong>
            </article>
          </div>
        </section>

        <aside className="workshop-os-rail">
          <section className="workshop-os-rail-card">
            <div className="workshop-os-sidebar-card__header">
              <h2>Today</h2>
              <span className="table-secondary">What is coming up next.</span>
            </div>
            {agendaJobs.length === 0 ? (
              <div className="workshop-os-empty-card">No scheduled jobs match the current view.</div>
            ) : (
              <div className="workshop-os-agenda-list">
                {agendaJobs.map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    className="workshop-os-agenda-item"
                    onClick={() => setSelectedJobId(job.id)}
                  >
                    <div>
                      <strong>{getAgendaTitle(job)}</strong>
                      <div className="table-secondary">{getCustomerName(job)}</div>
                    </div>
                    <div className="workshop-os-agenda-item__meta">
                      <span>{formatDate(job.scheduledDate)}</span>
                      {getUrgency(job) ? (
                        <span className={getUrgency(job)?.className}>{getUrgency(job)?.label}</span>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="workshop-os-rail-card">
            <div className="workshop-os-sidebar-card__header">
              <h2>Capacity</h2>
              <span className="table-secondary">Live cover and queue pressure.</span>
            </div>
            {capacityToday ? (
              <div className="workshop-os-capacity">
                <div className="workshop-os-capacity__topline">
                  <span className={toCapacityBadgeClass(capacityToday.status)}>{capacityToday.label}</span>
                  <span className="table-secondary">{capacityToday.explanation}</span>
                </div>
                <div className="workshop-os-capacity-grid">
                  <div>
                    <strong>{capacityToday.metrics.scheduledStaffCount}</strong>
                    <span>Workshop staff in</span>
                  </div>
                  <div>
                    <strong>{capacityToday.metrics.dueTodayJobs}</strong>
                    <span>Due today</span>
                  </div>
                  <div>
                    <strong>{capacityToday.metrics.overdueJobs}</strong>
                    <span>Overdue</span>
                  </div>
                  <div>
                    <strong>{capacityToday.metrics.activeWorkloadJobs}</strong>
                    <span>Live bench load</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="workshop-os-empty-card">Capacity data is not available yet.</div>
            )}
          </section>

          <section className="workshop-os-rail-card">
            <div className="workshop-os-sidebar-card__header">
              <h2>Team</h2>
              <span className="table-secondary">Staffing and rota context for today.</span>
            </div>
            {staffingToday ? (
              <div className="workshop-os-team">
                <div className="workshop-os-team__header">
                  <span className={
                    staffingToday.summary.coverageStatus === "closed"
                      ? "status-badge status-info"
                      : staffingToday.summary.coverageStatus === "thin" || staffingToday.summary.coverageStatus === "none"
                        ? "status-badge status-warning"
                        : "status-badge status-complete"
                  }>
                    {staffingToday.summary.coverageStatus === "closed"
                      ? "Closed"
                      : staffingToday.summary.coverageStatus === "thin"
                        ? "Thin cover"
                        : staffingToday.summary.coverageStatus === "none"
                          ? "No cover"
                          : "Covered"}
                  </span>
                  <span className="table-secondary">
                    {staffingToday.summary.isClosed
                      ? staffingToday.summary.closedReason || "Store closed today."
                      : staffingToday.context.usesOperationalRoleTags
                        ? "Using workshop-tagged rota cover."
                        : "Using broader rota cover until workshop tags are tightened."}
                  </span>
                </div>

                {staffingToday.scheduledStaff.length ? (
                  <div className="workshop-os-team-list">
                    {staffingToday.scheduledStaff.map((entry) => (
                      <span
                        key={`${entry.staffId}-${entry.shiftType}`}
                        className="stock-badge workshop-os-team-chip"
                        title={`${entry.name} · ${toShiftLabel(entry.shiftType)}${entry.note ? ` · ${entry.note}` : ""}`}
                      >
                        {entry.name} · {toShiftLabel(entry.shiftType)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="workshop-os-empty-card">No staff are scheduled in the current workshop filter.</div>
                )}

                {staffingToday.holidayStaff.length ? (
                  <div className="table-secondary">
                    On holiday: {staffingToday.holidayStaff.map((entry) => entry.name).join(", ")}.
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="workshop-os-empty-card">Staffing data is not available yet.</div>
            )}
          </section>

          <section className="workshop-os-rail-card">
            <div className="workshop-os-sidebar-card__header">
              <h2>Alerts</h2>
              <span className="table-secondary">Bottlenecks and handoff prompts.</span>
            </div>
            <div className="workshop-os-alert-list">
              {alertGroups.map((group) => (
                <article
                  key={group.key}
                  className={group.tone === "warning"
                    ? "workshop-os-alert workshop-os-alert--warning"
                    : group.tone === "ready"
                      ? "workshop-os-alert workshop-os-alert--ready"
                      : group.tone === "attention"
                        ? "workshop-os-alert workshop-os-alert--attention"
                        : "workshop-os-alert"}
                >
                  <strong>{group.title}</strong>
                  <p>{group.description}</p>
                  {group.jobs.length ? (
                    <div className="workshop-os-alert__jobs">
                      {group.jobs.map((job) => (
                        <button
                          key={job.id}
                          type="button"
                          className="workshop-os-alert__job"
                          onClick={() => setSelectedJobId(job.id)}
                        >
                          {getAgendaTitle(job)}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {group.key === "collection" && group.jobs.length ? (
                    <Link to="/workshop/collection" className="button-link">
                      Open Collection Queue
                    </Link>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        </aside>
      </div>
      )}

      {surfaceMode === "board" && selectedJob ? (
        <div
          className="workshop-os-drawer-backdrop"
          onClick={() => setSelectedJobId(null)}
          aria-hidden="true"
        >
          <aside
            className="workshop-os-drawer"
            onClick={(event) => event.stopPropagation()}
            aria-label="Workshop job workspace"
          >
            <div className="workshop-os-drawer__header">
              <div>
                <p className="ui-page-eyebrow">Job Workspace</p>
                <h2>{selectedJob.bikeDescription || "Workshop job"}</h2>
                <p className="table-secondary">
                  {getCustomerName(selectedJob)} · <span className="mono-text">{selectedJob.id.slice(0, 8)}</span>
                </p>
              </div>
              <button type="button" onClick={() => setSelectedJobId(null)} aria-label="Close job workspace">
                Close
              </button>
            </div>

            <div className="workshop-os-drawer__badges">
              <span className={workshopRawStatusClass(selectedJob.status)}>{workshopRawStatusLabel(selectedJob.status)}</span>
              {selectedWorkflowSummary ? (
                <span className={selectedWorkflowSummary.className}>{selectedWorkflowSummary.label}</span>
              ) : null}
              {getUrgency(selectedJob) ? (
                <span className={getUrgency(selectedJob)?.className}>{getUrgency(selectedJob)?.label}</span>
              ) : null}
              <span className={getPartsClassName(selectedJob)}>Parts: {toPartsStatus(selectedJob)}</span>
            </div>

            <div className="workshop-os-drawer__grid">
              <div>
                <span className="metric-label">Technician</span>
                <strong>{selectedJob.assignedStaffName || "Unassigned"}</strong>
              </div>
              <div>
                <span className="metric-label">Promised</span>
                <strong>{formatDate(selectedJob.scheduledDate)}</strong>
              </div>
              <div>
                <span className="metric-label">Value</span>
                <strong>{formatMoney(selectedJob.sale?.totalPence ?? null)}</strong>
              </div>
              <div>
                <span className="metric-label">Next step</span>
                <strong>{selectedWorkflowSummary?.nextStep || getNextStepHint(selectedJob)}</strong>
              </div>
            </div>

            {selectedWorkflowSummary?.blockerLabel ? (
              <div className="restricted-panel warning-panel">
                <strong>{selectedWorkflowSummary.blockerLabel}</strong>
                <div className="table-secondary">{selectedWorkflowSummary.detail}</div>
              </div>
            ) : null}

            {jobWorkspaceLoading ? (
              <div className="workshop-os-empty-card">Loading job workspace…</div>
            ) : null}

            {jobWorkspaceError ? (
              <div className="restricted-panel warning-panel">
                <strong>Job workspace data is partially unavailable</strong>
                <div className="table-secondary">{jobWorkspaceError}</div>
              </div>
            ) : null}

            {renderJobWorkspaceSection(
              "customer",
              "Customer",
              "Keep the linked customer context visible while you work the job.",
              <div className="workshop-os-job-workspace-section__stack">
                <div className="workshop-os-drawer__grid">
                  <div>
                    <span className="metric-label">Customer</span>
                    <strong>{selectedJobWorkspaceCustomerName}</strong>
                  </div>
                  <div>
                    <span className="metric-label">Linked record</span>
                    <strong>{selectedJobWorkspaceJob?.customerId ? "Linked" : "Not linked"}</strong>
                  </div>
                </div>
                {selectedJob.customer?.email || selectedJob.customer?.phone ? (
                  <div className="workshop-os-job-workspace-section__meta-list">
                    {selectedJob.customer?.email ? <span>Email: {selectedJob.customer.email}</span> : null}
                    {selectedJob.customer?.phone ? <span>Phone: {selectedJob.customer.phone}</span> : null}
                  </div>
                ) : (
                  <div className="workshop-os-empty-card">No customer contact details are loaded on this dashboard view yet.</div>
                )}
              </div>,
              selectedJob.customer?.id ? (
                <Link to={`/customers/${selectedJob.customer.id}`} className="button-link">
                  Open customer
                </Link>
              ) : (
                <Link to={`/workshop/${selectedJob.id}`} className="button-link">
                  Open full job
                </Link>
              ),
            )}

            {renderJobWorkspaceSection(
              "bike",
              "Bike",
              "Bike identity stays separate from customer and job notes.",
              <div className="workshop-os-job-workspace-section__stack">
                <div className="workshop-os-drawer__grid">
                  <div>
                    <span className="metric-label">Bike summary</span>
                    <strong>{selectedJobWorkspaceJob?.bikeDescription || selectedJob.bikeDescription || "Bike summary pending"}</strong>
                  </div>
                  <div>
                    <span className="metric-label">Linked bike</span>
                    <strong>{selectedJobWorkspaceBike?.displayName || "Not linked"}</strong>
                  </div>
                </div>
                {selectedJobWorkspaceBike ? (
                  <div className="workshop-os-job-workspace-section__meta-list">
                    {selectedJobWorkspaceBike.make || selectedJobWorkspaceBike.model ? (
                      <span>
                        {selectedJobWorkspaceBike.make || ""} {selectedJobWorkspaceBike.model || ""}
                      </span>
                    ) : null}
                    {selectedJobWorkspaceBike.colour ? <span>Colour: {selectedJobWorkspaceBike.colour}</span> : null}
                    {selectedJobWorkspaceBike.serialNumber ? <span>Serial: {selectedJobWorkspaceBike.serialNumber}</span> : null}
                    {selectedJobWorkspaceBike.frameNumber ? <span>Frame: {selectedJobWorkspaceBike.frameNumber}</span> : null}
                  </div>
                ) : (
                  <div className="workshop-os-empty-card">This job is currently using the freeform bike summary only.</div>
                )}
              </div>,
              <Link to={`/workshop/${selectedJob.id}`} className="button-link">
                Open bike on full job
              </Link>,
            )}

            {renderJobWorkspaceSection(
              "jobDetails",
              "Job details",
              "Issue and summary stay visible without forcing a step-based flow.",
              <div className="workshop-os-job-workspace-section__stack">
                <div className="workshop-os-drawer__grid">
                  <div>
                    <span className="metric-label">Created</span>
                    <strong>{formatDateTime(selectedJobWorkspaceJob?.createdAt ?? selectedJob.createdAt)}</strong>
                  </div>
                  <div>
                    <span className="metric-label">Updated</span>
                    <strong>{formatDateTime(selectedJobWorkspaceJob?.updatedAt ?? selectedJob.updatedAt)}</strong>
                  </div>
                </div>
                <div className="workshop-os-job-workspace-section__detail-card">
                  <span className="metric-label">Issue and summary</span>
                  <p className="muted-text">{selectedJobWorkspaceJob?.notes || selectedJob.notes || "No issue summary has been captured yet."}</p>
                </div>
              </div>,
              <Link to={`/workshop/${selectedJob.id}`} className="button-link">
                Edit job details
              </Link>,
            )}

            {renderJobWorkspaceSection(
              "planning",
              "Planning",
              "Keep due date and technician ownership easy to scan from the drawer.",
              <div className="workshop-os-job-workspace-section__stack">
                <div className="workshop-os-drawer__grid">
                  <div>
                    <span className="metric-label">Promised date</span>
                    <strong>{formatDate(selectedJobWorkspaceJob?.scheduledDate ?? selectedJob.scheduledDate)}</strong>
                  </div>
                  <div>
                    <span className="metric-label">Technician</span>
                    <strong>{selectedJobWorkspaceJob?.assignedStaffName || selectedJob.assignedStaffName || "Unassigned"}</strong>
                  </div>
                  <div>
                    <span className="metric-label">Timed slot</span>
                    <strong>
                      {selectedJobWorkspaceJob?.scheduledStartAt
                        ? `${formatDateTime(selectedJobWorkspaceJob.scheduledStartAt)} → ${formatDateTime(selectedJobWorkspaceJob.scheduledEndAt)}`
                        : "Not timed yet"}
                    </strong>
                  </div>
                  <div>
                    <span className="metric-label">Duration</span>
                    <strong>{selectedJobWorkspaceJob?.durationMinutes ? `${selectedJobWorkspaceJob.durationMinutes} min` : "Not set"}</strong>
                  </div>
                </div>
              </div>,
              <div className="workshop-os-drawer__actions">
                <Link to="/workshop/calendar" className="button-link">
                  Open calendar
                </Link>
                <Link to={`/workshop/${selectedJob.id}`} className="button-link">
                  Edit planning
                </Link>
              </div>,
            )}

            {renderJobWorkspaceSection(
              "estimate",
              "Estimate",
              "Labour and parts totals stay grouped so quoting work stays easy to scan.",
              <div className="workshop-os-job-workspace-section__stack">
                {jobWorkspaceDetails?.currentEstimate ? (
                  <>
                    <div className="workshop-os-drawer__grid">
                      <div>
                        <span className="metric-label">Quote status</span>
                        <strong>{jobWorkspaceDetails.currentEstimate.status.replace(/_/g, " ")}</strong>
                      </div>
                      <div>
                        <span className="metric-label">Total</span>
                        <strong>{formatMoney(jobWorkspaceDetails.currentEstimate.subtotalPence)}</strong>
                      </div>
                      <div>
                        <span className="metric-label">Labour</span>
                        <strong>{formatMoney(jobWorkspaceDetails.currentEstimate.labourTotalPence)}</strong>
                      </div>
                      <div>
                        <span className="metric-label">Parts</span>
                        <strong>{formatMoney(jobWorkspaceDetails.currentEstimate.partsTotalPence)}</strong>
                      </div>
                    </div>
                    <div className="workshop-os-job-workspace-section__meta-list">
                      <span>{selectedJobWorkspaceLabourLines.length} labour line{selectedJobWorkspaceLabourLines.length === 1 ? "" : "s"}</span>
                      <span>{selectedJobWorkspacePartLines.length} part line{selectedJobWorkspacePartLines.length === 1 ? "" : "s"}</span>
                      {jobWorkspaceDetails.currentEstimate.requestedAt ? (
                        <span>Requested {formatDateTime(jobWorkspaceDetails.currentEstimate.requestedAt)}</span>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="workshop-os-empty-card">No live estimate yet. Labour and parts can still be added from the full job page.</div>
                )}
              </div>,
              <Link to={`/workshop/${selectedJob.id}`} className="button-link">
                Open estimate workspace
              </Link>,
            )}

            {renderJobWorkspaceSection(
              "partsAllocation",
              "Parts allocation",
              "Keep stock readiness separate from the estimate itself.",
              <div className="workshop-os-job-workspace-section__stack">
                {selectedJobWorkspacePartsSummary ? (
                  <div className="workshop-os-drawer__grid">
                    <div>
                      <span className="metric-label">Required</span>
                      <strong>{selectedJobWorkspacePartsSummary.requiredQty}</strong>
                    </div>
                    <div>
                      <span className="metric-label">Allocated</span>
                      <strong>{selectedJobWorkspacePartsSummary.allocatedQty}</strong>
                    </div>
                    <div>
                      <span className="metric-label">Outstanding</span>
                      <strong>{selectedJobWorkspacePartsSummary.outstandingQty}</strong>
                    </div>
                    <div>
                      <span className="metric-label">Missing</span>
                      <strong>{selectedJobWorkspacePartsSummary.missingQty}</strong>
                    </div>
                  </div>
                ) : (
                  <div className="workshop-os-empty-card">No parts allocation summary is available for this job yet.</div>
                )}
              </div>,
              <Link to={`/workshop/${selectedJob.id}`} className="button-link">
                Manage parts
              </Link>,
            )}

            {renderJobWorkspaceSection(
              "notes",
              "Notes",
              "Internal and customer-safe notes stay grouped but independent from the job summary.",
              <div className="workshop-os-job-workspace-section__stack">
                {jobWorkspaceNotes.length ? (
                  <div className="workshop-os-job-workspace-section__list">
                    {jobWorkspaceNotes.slice(0, 4).map((note) => (
                      <article key={note.id} className="workshop-os-job-workspace-section__list-item">
                        <div className="workshop-os-job-workspace-section__list-meta">
                          <span className={note.visibility === "CUSTOMER" ? "status-badge status-info" : "stock-badge stock-muted"}>
                            {note.visibility === "CUSTOMER" ? "Customer visible" : "Internal"}
                          </span>
                          <span>{formatDateTime(note.createdAt)}</span>
                        </div>
                        <p className="muted-text">{note.note}</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="workshop-os-empty-card">No workshop notes have been added yet.</div>
                )}
              </div>,
              <Link to={`/workshop/${selectedJob.id}`} className="button-link">
                Manage notes
              </Link>,
            )}

            {renderJobWorkspaceSection(
              "attachments",
              "Attachments",
              "Photos and files stay separate so the drawer keeps a clean operational structure.",
              <div className="workshop-os-job-workspace-section__stack">
                {jobWorkspaceAttachments.length ? (
                  <div className="workshop-os-job-workspace-section__list">
                    {jobWorkspaceAttachments.slice(0, 4).map((attachment) => (
                      <article key={attachment.id} className="workshop-os-job-workspace-section__list-item">
                        <div className="workshop-os-job-workspace-section__list-meta">
                          <span className={attachment.visibility === "CUSTOMER" ? "status-badge status-info" : "stock-badge stock-muted"}>
                            {attachment.visibility === "CUSTOMER" ? "Customer visible" : "Internal"}
                          </span>
                          <span>{formatFileSize(attachment.fileSizeBytes)}</span>
                        </div>
                        <strong>{attachment.filename}</strong>
                        <p className="muted-text">{attachment.mimeType} · Added {formatDateTime(attachment.createdAt)}</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="workshop-os-empty-card">No attachments are on this job yet.</div>
                )}
              </div>,
              <Link to={`/workshop/${selectedJob.id}`} className="button-link">
                Manage attachments
              </Link>,
            )}

            <section className="workshop-os-drawer__section">
              <h3>Actions</h3>
              <div className="workshop-os-drawer__actions">
                {selectedQuickActions.map((action) => (
                  <button
                    key={`${action.kind}-${action.value}`}
                    type="button"
                    className={selectedQuickActions[0] === action ? "primary" : undefined}
                    onClick={() => {
                      void runQuickAction(selectedJob.id, action);
                    }}
                  >
                    {action.label}
                  </button>
                ))}
                <Link to={`/workshop/${selectedJob.id}`} className="button-link">
                  Open Full Job
                </Link>
              </div>
            </section>
          </aside>
        </div>
      ) : null}

      <WorkshopIntakeOverlay
        open={isIntakeOpen}
        technicianOptions={technicianOptions}
        defaultTechnicianId={defaultIntakeTechnicianId}
        onClose={() => setIsIntakeOpen(false)}
        onCreated={handleIntakeCreated}
      />
    </div>
  );
};
