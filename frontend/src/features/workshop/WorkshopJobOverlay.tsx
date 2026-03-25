import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../../api/client";
import { useToasts } from "../../components/ToastProvider";
import {
  getWorkshopTechnicianWorkflowSummary,
  workshopRawStatusClass,
  workshopRawStatusLabel,
} from "./status";

type WorkshopJobOverlayLine = {
  id: string;
  type: "LABOUR" | "PART";
  description: string;
  qty: number;
  unitPricePence: number;
  lineTotalPence: number;
  productName: string | null;
  variantName: string | null;
};

type WorkshopJobOverlayBike = {
  id: string;
  displayName: string;
  make: string | null;
  model: string | null;
  colour: string | null;
  frameNumber: string | null;
  serialNumber: string | null;
};

type WorkshopJobOverlayEstimate = {
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

type WorkshopJobOverlayResponse = {
  job: {
    id: string;
    status: string;
    customerId: string | null;
    customerName: string | null;
    bikeId: string | null;
    bikeDescription: string | null;
    bike: WorkshopJobOverlayBike | null;
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
  lines: WorkshopJobOverlayLine[];
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
  currentEstimate: WorkshopJobOverlayEstimate | null;
  estimateHistory: WorkshopJobOverlayEstimate[];
  hasApprovedEstimate: boolean;
};

type WorkshopJobOverlayNote = {
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

type WorkshopJobOverlayNotesResponse = {
  notes: WorkshopJobOverlayNote[];
};

type WorkshopJobOverlayAttachment = {
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

type WorkshopJobOverlayAttachmentsResponse = {
  workshopJobId: string;
  attachments: WorkshopJobOverlayAttachment[];
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
  customer: true,
  bike: true,
  jobDetails: true,
  planning: true,
  estimate: true,
  partsAllocation: true,
  notes: true,
  attachments: true,
};

export type WorkshopJobOverlaySummary = {
  id: string;
  rawStatus?: string | null;
  status: string;
  customerId?: string | null;
  customerName?: string | null;
  assignedStaffId?: string | null;
  customer?: {
    email?: string | null;
    phone?: string | null;
  } | null;
  bikeDescription?: string | null;
  assignedStaffName?: string | null;
  scheduledDate?: string | null;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  durationMinutes?: number | null;
  notes?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  finalizedBasketId?: string | null;
  sale?: {
    totalPence: number;
  } | null;
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

type WorkshopJobOverlayProps = {
  jobId: string;
  summary?: WorkshopJobOverlaySummary | null;
  onClose: () => void;
  fullJobPath?: string;
  technicianOptions?: Array<{
    id: string;
    name: string;
  }>;
  onJobChanged?: () => Promise<void> | void;
};

const formatMoney = (pence: number | null) => {
  if (pence === null) {
    return "-";
  }
  return `£${(pence / 100).toFixed(2)}`;
};

const formatDate = (value: string | null | undefined) => {
  if (!value) {
    return "Unscheduled";
  }
  return new Date(value).toLocaleDateString([], {
    day: "numeric",
    month: "short",
  });
};

const formatDateTime = (value: string | null | undefined) => {
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

const formatScheduleWindow = (
  startAt: string | null | undefined,
  endAt: string | null | undefined,
) => {
  if (!startAt) {
    return "Not timed";
  }

  const start = new Date(startAt);
  const end = endAt ? new Date(endAt) : null;

  const startLabel = start.toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  if (!end) {
    return startLabel;
  }

  const sameDay = start.toDateString() === end.toDateString();
  const endLabel = sameDay
    ? end.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : end.toLocaleString([], {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });

  return `${startLabel} -> ${endLabel}`;
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

const getOverlayCustomerName = (summary?: WorkshopJobOverlaySummary | null) =>
  summary?.customerName || "Customer pending";

const getNextStepHint = (summary?: WorkshopJobOverlaySummary | null) =>
  getWorkshopTechnicianWorkflowSummary({
    rawStatus: summary?.rawStatus || summary?.status || "BOOKING_MADE",
    partsStatus: summary?.partsSummary?.partsStatus,
    assignedStaffName: summary?.assignedStaffName || null,
    scheduledDate: summary?.scheduledDate || null,
    hasSale: Boolean(summary?.sale),
    hasBasket: Boolean(summary?.finalizedBasketId),
  }).nextStep;

const getUrgency = (scheduledDate: string | null | undefined, status: string | null | undefined) => {
  if (!scheduledDate || status === "COMPLETED" || status === "CANCELLED") {
    return null;
  }

  const scheduled = new Date(scheduledDate);
  const due = new Date(scheduled.getFullYear(), scheduled.getMonth(), scheduled.getDate()).getTime();
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

  if (due < todayStart) {
    return {
      label: "Overdue",
      className: "status-badge status-cancelled",
    };
  }

  if (due === todayStart) {
    return {
      label: "Due Today",
      className: "status-badge status-warning",
    };
  }

  return null;
};

type WorkshopNextActionCard = {
  title: string;
  body: string;
  highlights: string[];
};

type WorkshopOverlayQuickAction =
  | {
      kind: "status";
      label: string;
      value: string;
    }
  | {
      kind: "approval";
      label: string;
      value: "APPROVED";
    };

const getNextActionCard = ({
  status,
  workflowSummary,
  assignedStaffName,
  scheduledDate,
  scheduledStartAt,
  durationMinutes,
  partsSummary,
  estimate,
}: {
  status: string;
  workflowSummary: ReturnType<typeof getWorkshopTechnicianWorkflowSummary>;
  assignedStaffName: string | null;
  scheduledDate: string | null;
  scheduledStartAt: string | null;
  durationMinutes: number | null;
  partsSummary:
    | {
        partsStatus: "OK" | "UNALLOCATED" | "SHORT";
        missingQty: number;
        outstandingQty: number;
      }
    | null
    | undefined;
  estimate: WorkshopJobOverlayEstimate | null;
}): WorkshopNextActionCard => {
  const scheduleHighlight = scheduledStartAt
    ? `Timed for ${formatDateTime(scheduledStartAt)}`
    : scheduledDate
      ? `Promised ${formatDate(scheduledDate)}`
      : "No promised date set";
  const technicianHighlight = assignedStaffName
    ? `Assigned to ${assignedStaffName}`
    : "No technician assigned";

  switch (status) {
    case "WAITING_FOR_PARTS":
      return {
        title: "Resolve parts",
        body: workflowSummary.nextStep,
        highlights: [
          technicianHighlight,
          partsSummary?.missingQty ? `${partsSummary.missingQty} part item(s) still missing` : "Check incoming or substitute stock",
          scheduleHighlight,
        ],
      };
    case "WAITING_FOR_APPROVAL":
      return {
        title: "Review approval",
        body: workflowSummary.nextStep,
        highlights: [
          estimate?.requestedAt ? `Quote sent ${formatDateTime(estimate.requestedAt)}` : "Review the latest estimate before following up",
          technicianHighlight,
          scheduleHighlight,
        ],
      };
    case "BIKE_READY":
      return {
        title: "Prepare collection",
        body: workflowSummary.nextStep,
        highlights: [
          technicianHighlight,
          scheduleHighlight,
          "Confirm payment / handover path before the customer arrives",
        ],
      };
    case "APPROVED":
      return {
        title: assignedStaffName
          ? "Start bench work"
          : "Assign technician",
        body: workflowSummary.nextStep,
        highlights: [
          technicianHighlight,
          durationMinutes ? `${durationMinutes} min currently planned` : "Set an expected bench duration",
          scheduleHighlight,
        ],
      };
    case "BIKE_ARRIVED":
      return {
        title: partsSummary?.partsStatus === "SHORT"
          ? "Resolve stock blocker"
          : "Continue repair",
        body: workflowSummary.nextStep,
        highlights: [
          technicianHighlight,
          partsSummary?.partsStatus === "SHORT"
            ? `${partsSummary.outstandingQty || partsSummary.missingQty} item(s) still outstanding`
            : "Bench work is currently active",
          scheduleHighlight,
        ],
      };
    case "ON_HOLD":
      return {
        title: "Clear hold",
        body: workflowSummary.nextStep,
        highlights: [
          technicianHighlight,
          "Review why the job is paused before changing status",
          scheduleHighlight,
        ],
      };
    case "COMPLETED":
      return {
        title: "Review history",
        body: workflowSummary.nextStep,
        highlights: [
          technicianHighlight,
          "No further workshop action is expected",
          scheduleHighlight,
        ],
      };
    case "CANCELLED":
      return {
        title: "Keep unscheduled",
        body: workflowSummary.nextStep,
        highlights: [
          technicianHighlight,
          "Rebook as a new job if work needs to restart",
          scheduleHighlight,
        ],
      };
    default:
      return {
        title: assignedStaffName
          ? "Move to bench"
          : "Assign technician",
        body: workflowSummary.nextStep,
        highlights: [
          technicianHighlight,
          durationMinutes ? `${durationMinutes} min currently planned` : "No planned duration set",
          scheduleHighlight,
        ],
      };
  }
};

const getQuickOverlayAction = ({
  status,
  assignedStaffName,
}: {
  status: string;
  assignedStaffName: string | null;
}): WorkshopOverlayQuickAction | null => {
  switch (status) {
    case "BOOKING_MADE":
      return {
        kind: "status",
        label: assignedStaffName ? "Move to bench" : "Mark in progress",
        value: "BIKE_ARRIVED",
      };
    case "APPROVED":
      return {
        kind: "status",
        label: assignedStaffName ? "Start repair" : "Move onto bench",
        value: "BIKE_ARRIVED",
      };
    case "WAITING_FOR_APPROVAL":
      return {
        kind: "approval",
        label: "Mark approved",
        value: "APPROVED",
      };
    case "WAITING_FOR_PARTS":
      return {
        kind: "status",
        label: "Move back to bench",
        value: "BIKE_ARRIVED",
      };
    case "ON_HOLD":
      return {
        kind: "status",
        label: "Resume on bench",
        value: "BIKE_ARRIVED",
      };
    default:
      return null;
  }
};

export const WorkshopJobOverlay = ({
  jobId,
  summary,
  onClose,
  fullJobPath,
  technicianOptions = [],
  onJobChanged,
}: WorkshopJobOverlayProps) => {
  const { success, error } = useToasts();
  const [details, setDetails] = useState<WorkshopJobOverlayResponse | null>(null);
  const [notes, setNotes] = useState<WorkshopJobOverlayNote[]>([]);
  const [attachments, setAttachments] = useState<WorkshopJobOverlayAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [savingQuickAction, setSavingQuickAction] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [assignedStaffIdDraft, setAssignedStaffIdDraft] = useState("");
  const [collapsedSections, setCollapsedSections] = useState<Record<JobWorkspaceSectionKey, boolean>>(
    DEFAULT_JOB_WORKSPACE_COLLAPSED,
  );
  const savingAnyAction = savingAssignment || savingQuickAction;

  useEffect(() => {
    setCollapsedSections(DEFAULT_JOB_WORKSPACE_COLLAPSED);
    setActionError(null);
    setSavingAssignment(false);
    setSavingQuickAction(false);
  }, [jobId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    setAssignedStaffIdDraft(details?.job.assignedStaffId || summary?.assignedStaffId || "");
  }, [details?.job.assignedStaffId, summary?.assignedStaffId, jobId]);

  useEffect(() => {
    let cancelled = false;

    const loadOverlay = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [detailsResponse, notesResponse, attachmentsResponse] = await Promise.all([
          apiGet<WorkshopJobOverlayResponse>(`/api/workshop/jobs/${encodeURIComponent(jobId)}`),
          apiGet<WorkshopJobOverlayNotesResponse>(`/api/workshop/jobs/${encodeURIComponent(jobId)}/notes`),
          apiGet<WorkshopJobOverlayAttachmentsResponse>(`/api/workshop/jobs/${encodeURIComponent(jobId)}/attachments`),
        ]);

        if (cancelled) {
          return;
        }

        setDetails(detailsResponse);
        setNotes(notesResponse.notes || []);
        setAttachments(attachmentsResponse.attachments || []);
      } catch (overlayError) {
        if (cancelled) {
          return;
        }
        setLoadError(overlayError instanceof Error ? overlayError.message : "Failed to load workshop job");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadOverlay();
    return () => {
      cancelled = true;
    };
  }, [jobId, refreshKey]);

  const overlayJob = details?.job ?? null;
  const displayStatus = overlayJob?.status || summary?.rawStatus || summary?.status || "BOOKING_MADE";
  const displayCustomerName = overlayJob?.customerName || getOverlayCustomerName(summary);
  const displayBikeDescription = overlayJob?.bikeDescription || summary?.bikeDescription || "Workshop job";
  const displayPartsSummary = details?.partsOverview?.summary ?? summary?.partsSummary ?? null;
  const displayWorkflowSummary = getWorkshopTechnicianWorkflowSummary({
    rawStatus: displayStatus,
    partsStatus: displayPartsSummary?.partsStatus,
    assignedStaffName: overlayJob?.assignedStaffName || summary?.assignedStaffName || null,
    scheduledDate: overlayJob?.scheduledDate || summary?.scheduledDate || null,
    hasSale: Boolean(overlayJob?.sale || summary?.sale),
    hasBasket: Boolean(overlayJob?.finalizedBasketId || summary?.finalizedBasketId),
  });
  const urgency = getUrgency(overlayJob?.scheduledDate || summary?.scheduledDate, displayStatus);
  const lines = details?.lines ?? [];
  const labourLines = lines.filter((line) => line.type === "LABOUR");
  const partLines = lines.filter((line) => line.type === "PART");
  const openPath = fullJobPath || `/workshop/${jobId}`;
  const issueSummary = overlayJob?.notes || summary?.notes || null;
  const quickAction = getQuickOverlayAction({
    status: displayStatus,
    assignedStaffName: overlayJob?.assignedStaffName || summary?.assignedStaffName || null,
  });
  const canAssignTechnician = technicianOptions.length > 0 && !["COMPLETED", "CANCELLED"].includes(displayStatus);
  const hasAssignmentChange =
    (overlayJob?.assignedStaffId || summary?.assignedStaffId || "") !== assignedStaffIdDraft;
  const nextAction = getNextActionCard({
    status: displayStatus,
    workflowSummary: displayWorkflowSummary,
    assignedStaffName: overlayJob?.assignedStaffName || summary?.assignedStaffName || null,
    scheduledDate: overlayJob?.scheduledDate || summary?.scheduledDate || null,
    scheduledStartAt: overlayJob?.scheduledStartAt || summary?.scheduledStartAt || null,
    durationMinutes: overlayJob?.durationMinutes || summary?.durationMinutes || null,
    partsSummary: displayPartsSummary
      ? {
          partsStatus: displayPartsSummary.partsStatus,
          missingQty: displayPartsSummary.missingQty,
          outstandingQty: displayPartsSummary.outstandingQty,
        }
      : null,
    estimate: details?.currentEstimate || null,
  });

  const refreshOverlay = async () => {
    setRefreshKey((current) => current + 1);
    if (onJobChanged) {
      await onJobChanged();
    }
  };

  const refreshOverlayInBackground = () => {
    void refreshOverlay().catch((refreshError) => {
      const message = refreshError instanceof Error
        ? refreshError.message
        : "Assigned technician saved, but the workshop view did not refresh cleanly";
      setActionError(message);
      error(message);
    });
  };

  const saveAssignment = async () => {
    const currentAssignedStaffId = overlayJob?.assignedStaffId || summary?.assignedStaffId || "";
    const nextAssignedStaffId = assignedStaffIdDraft || "";

    if (savingAnyAction) {
      return;
    }

    if (!jobId) {
      const message = "Workshop job is unavailable for assignment.";
      setActionError(message);
      error(message);
      return;
    }

    if (currentAssignedStaffId === nextAssignedStaffId) {
      return;
    }

    setSavingAssignment(true);
    setActionError(null);

    try {
      await apiPost(`/api/workshop/jobs/${encodeURIComponent(jobId)}/assign`, {
        staffId: nextAssignedStaffId || null,
      });
      success(nextAssignedStaffId ? "Technician assigned" : "Technician cleared");
      refreshOverlayInBackground();
    } catch (assignmentError) {
      const message = assignmentError instanceof Error ? assignmentError.message : "Failed to update technician";
      setActionError(message);
      error(message);
    } finally {
      setSavingAssignment(false);
    }
  };

  const runQuickAction = async () => {
    if (!quickAction) {
      return;
    }

    if (savingAnyAction) {
      return;
    }

    setSavingQuickAction(true);
    setActionError(null);

    try {
      if (quickAction.kind === "approval") {
        await apiPost(`/api/workshop/jobs/${encodeURIComponent(jobId)}/approval`, {
          status: quickAction.value,
        });
        success("Quote marked approved");
      } else {
        await apiPost(`/api/workshop/jobs/${encodeURIComponent(jobId)}/status`, {
          status: quickAction.value,
        });
        success("Job status updated");
      }

      await refreshOverlay();
    } catch (nextActionError) {
      const message = nextActionError instanceof Error ? nextActionError.message : "Failed to update workshop job";
      setActionError(message);
      error(message);
    } finally {
      setSavingQuickAction(false);
    }
  };

  const toggleSection = (section: JobWorkspaceSectionKey) => {
    setCollapsedSections((current) => {
      const nextCollapsed = !current[section];
      return {
        customer: true,
        bike: true,
        jobDetails: true,
        planning: true,
        estimate: true,
        partsAllocation: true,
        notes: true,
        attachments: true,
        [section]: nextCollapsed,
      };
    });
  };

  const renderSection = (
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
        onClick={() => toggleSection(section)}
        aria-expanded={!collapsedSections[section]}
      >
        <span className="workshop-os-job-workspace-section__toggle-copy">
          <strong>{title}</strong>
          <span className="table-secondary">{description}</span>
        </span>
        <span className="button-link--inline">{collapsedSections[section] ? "Expand" : "Collapse"}</span>
      </button>

      {!collapsedSections[section] ? (
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
    <div
      className="workshop-os-modal-backdrop"
      onClick={onClose}
      aria-hidden="true"
    >
      <aside
        className="workshop-os-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Workshop job overlay"
      >
        <div className="workshop-os-drawer__primary">
          <div className="workshop-os-drawer__header">
            <div className="workshop-os-overlay-hero__title">
              <p className="ui-page-eyebrow">Job Card</p>
              <h2>{displayBikeDescription}</h2>
              <p className="table-secondary">
                {displayCustomerName} · <span className="mono-text">{jobId.slice(0, 8)}</span>
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close job card">
              Close
            </button>
          </div>

          <section className="workshop-os-overlay-hero">
            <div className="workshop-os-drawer__badges">
              <span className={workshopRawStatusClass(displayStatus)}>{workshopRawStatusLabel(displayStatus)}</span>
              <span className={displayWorkflowSummary.className}>{displayWorkflowSummary.label}</span>
              {urgency ? <span className={urgency.className}>{urgency.label}</span> : null}
              {displayPartsSummary ? (
                <span className={displayPartsSummary.partsStatus === "SHORT" ? "parts-short" : displayPartsSummary.partsStatus === "UNALLOCATED" ? "parts-attention" : "parts-ok"}>
                  Parts: {displayPartsSummary.partsStatus}
                </span>
              ) : null}
            </div>

            <div className="workshop-os-overlay-hero__facts">
              <div>
                <span className="metric-label">Customer</span>
                <strong>{displayCustomerName}</strong>
              </div>
              <div>
                <span className="metric-label">Promised</span>
                <strong>{formatDate(overlayJob?.scheduledDate || summary?.scheduledDate || null)}</strong>
              </div>
              <div>
                <span className="metric-label">Technician</span>
                <strong>{overlayJob?.assignedStaffName || summary?.assignedStaffName || "Unassigned"}</strong>
              </div>
              <div>
                <span className="metric-label">Timed slot</span>
                <strong>
                  {formatScheduleWindow(
                    overlayJob?.scheduledStartAt || summary?.scheduledStartAt || null,
                    overlayJob?.scheduledEndAt || summary?.scheduledEndAt || null,
                  )}
                </strong>
              </div>
            </div>

            {issueSummary ? (
              <div className="workshop-os-overlay-hero__issue">
                <span className="metric-label">Issue / summary</span>
                <p>{issueSummary}</p>
              </div>
            ) : null}
          </section>

          <section className="workshop-os-overlay-next-action">
            <div className="workshop-os-overlay-next-action__copy">
              <p className="ui-page-eyebrow">Next Action</p>
              <h3>{nextAction.title}</h3>
              <p className="table-secondary">{nextAction.body || getNextStepHint(summary)}</p>
            </div>
            {canAssignTechnician ? (
              <div className="workshop-os-overlay-next-action__controls">
                <label className="workshop-os-overlay-next-action__field">
                  <span className="metric-label">Technician</span>
                  <select
                    value={assignedStaffIdDraft}
                    onChange={(event) => setAssignedStaffIdDraft(event.target.value)}
                    disabled={savingAnyAction}
                  >
                    <option value="">Leave unassigned</option>
                    {technicianOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="workshop-os-overlay-next-action__buttons">
                  <button
                    type="button"
                    onClick={() => void saveAssignment()}
                    disabled={savingAnyAction || !hasAssignmentChange}
                  >
                    {savingAssignment
                      ? "Saving..."
                      : assignedStaffIdDraft
                        ? "Assign technician"
                        : "Clear technician"}
                  </button>
                  {quickAction ? (
                    <button
                      type="button"
                      className="primary"
                      onClick={() => void runQuickAction()}
                      disabled={savingAnyAction}
                    >
                      {savingQuickAction ? "Saving..." : quickAction.label}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : quickAction ? (
              <div className="workshop-os-overlay-next-action__buttons">
                <button
                  type="button"
                  className="primary"
                  onClick={() => void runQuickAction()}
                  disabled={savingAnyAction}
                >
                  {savingQuickAction ? "Saving..." : quickAction.label}
                </button>
              </div>
            ) : null}
            <div className="workshop-os-overlay-next-action__highlights">
              {displayWorkflowSummary.blockerLabel ? (
                <div className="workshop-os-overlay-next-action__highlight workshop-os-overlay-next-action__highlight--blocker">
                  <span className="metric-label">Current blocker</span>
                  <strong>{displayWorkflowSummary.blockerLabel}</strong>
                  <span className="table-secondary">{displayWorkflowSummary.detail}</span>
                </div>
              ) : null}
              {nextAction.highlights.map((highlight) => (
                <div key={highlight} className="workshop-os-overlay-next-action__highlight">
                  <span className="table-secondary">{highlight}</span>
                </div>
              ))}
            </div>
            {actionError ? (
              <div className="restricted-panel warning-panel">
                <strong>Unable to complete inline action</strong>
                <div className="table-secondary">{actionError}</div>
              </div>
            ) : null}
            <div className="workshop-os-drawer__actions">
              <Link to={openPath} className="button-link">
                Open full job page
              </Link>
            </div>
          </section>
        </div>

        <div className="workshop-os-drawer__details">
          {loading ? (
            <div className="workshop-os-empty-card">Loading job card…</div>
          ) : null}

          {loadError ? (
            <div className="restricted-panel warning-panel">
              <strong>Job card data is partially unavailable</strong>
              <div className="table-secondary">{loadError}</div>
            </div>
          ) : null}

          {renderSection(
          "planning",
          "Planning",
          "Timing, slot, and technician ownership.",
          <div className="workshop-os-job-workspace-section__stack">
            <div className="workshop-os-drawer__grid">
              <div>
                <span className="metric-label">Date</span>
                <strong>{formatDate(overlayJob?.scheduledDate || summary?.scheduledDate || null)}</strong>
              </div>
              <div>
                <span className="metric-label">Technician</span>
                <strong>{overlayJob?.assignedStaffName || summary?.assignedStaffName || "Unassigned"}</strong>
              </div>
              <div>
                <span className="metric-label">Slot</span>
                <strong>
                  {formatScheduleWindow(
                    overlayJob?.scheduledStartAt || summary?.scheduledStartAt || null,
                    overlayJob?.scheduledEndAt || summary?.scheduledEndAt || null,
                  )}
                </strong>
              </div>
              <div>
                <span className="metric-label">Duration</span>
                <strong>{overlayJob?.durationMinutes || summary?.durationMinutes ? `${overlayJob?.durationMinutes || summary?.durationMinutes} min` : "Not set"}</strong>
              </div>
            </div>
          </div>,
          )}

          {renderSection(
          "customer",
          "Customer",
          "Customer context and contact details.",
          <div className="workshop-os-job-workspace-section__stack">
            <div className="workshop-os-drawer__grid">
              <div>
                <span className="metric-label">Customer</span>
                <strong>{displayCustomerName}</strong>
              </div>
              <div>
                <span className="metric-label">Linked record</span>
                <strong>{overlayJob?.customerId || summary?.customerId ? "Linked" : "Not linked"}</strong>
              </div>
            </div>
            {summary?.customer?.email || summary?.customer?.phone ? (
              <div className="workshop-os-job-workspace-section__meta-list">
                {summary.customer?.email ? <span>Email: {summary.customer.email}</span> : null}
                {summary.customer?.phone ? <span>Phone: {summary.customer.phone}</span> : null}
              </div>
            ) : (
              <div className="workshop-os-empty-card">Customer contact details are available from the full job page when needed.</div>
            )}
          </div>,
          )}

          {renderSection(
          "bike",
          "Bike",
          "Bike record and identification details.",
          <div className="workshop-os-job-workspace-section__stack">
            <div className="workshop-os-drawer__grid">
              <div>
                <span className="metric-label">Bike summary</span>
                <strong>{displayBikeDescription}</strong>
              </div>
              <div>
                <span className="metric-label">Bike record</span>
                <strong>{overlayJob?.bike?.displayName || "Not linked"}</strong>
              </div>
            </div>
            {overlayJob?.bike ? (
              <div className="workshop-os-job-workspace-section__meta-list">
                {overlayJob.bike.make || overlayJob.bike.model ? <span>{overlayJob.bike.make || ""} {overlayJob.bike.model || ""}</span> : null}
                {overlayJob.bike.colour ? <span>Colour: {overlayJob.bike.colour}</span> : null}
                {overlayJob.bike.serialNumber ? <span>Serial: {overlayJob.bike.serialNumber}</span> : null}
                {overlayJob.bike.frameNumber ? <span>Frame: {overlayJob.bike.frameNumber}</span> : null}
              </div>
            ) : (
              <div className="workshop-os-empty-card">No bike record is linked to this job yet.</div>
            )}
          </div>,
          )}

          {renderSection(
          "jobDetails",
          "Job details",
          "Issue summary and key activity timestamps.",
          <div className="workshop-os-job-workspace-section__stack">
            <div className="workshop-os-drawer__grid">
              <div>
                <span className="metric-label">Created</span>
                <strong>{formatDateTime(overlayJob?.createdAt || summary?.createdAt || null)}</strong>
              </div>
              <div>
                <span className="metric-label">Updated</span>
                <strong>{formatDateTime(overlayJob?.updatedAt || summary?.updatedAt || null)}</strong>
              </div>
            </div>
            <div className="workshop-os-job-workspace-section__detail-card">
              <strong>Issue / summary</strong>
              <p className="muted-text">{issueSummary || "No issue summary has been captured yet."}</p>
            </div>
          </div>,
          )}

          {renderSection(
          "estimate",
          "Estimate",
          "Labour and parts totals stay grouped so the quote shape is easy to scan.",
          <div className="workshop-os-job-workspace-section__stack">
            {details?.currentEstimate ? (
              <>
                <div className="workshop-os-drawer__grid">
                  <div>
                    <span className="metric-label">Quote status</span>
                    <strong>{details.currentEstimate.status.replace(/_/g, " ")}</strong>
                  </div>
                  <div>
                    <span className="metric-label">Total</span>
                    <strong>{formatMoney(details.currentEstimate.subtotalPence)}</strong>
                  </div>
                  <div>
                    <span className="metric-label">Labour</span>
                    <strong>{formatMoney(details.currentEstimate.labourTotalPence)}</strong>
                  </div>
                  <div>
                    <span className="metric-label">Parts</span>
                    <strong>{formatMoney(details.currentEstimate.partsTotalPence)}</strong>
                  </div>
                </div>
                <div className="workshop-os-job-workspace-section__meta-list">
                  <span>{labourLines.length} labour line{labourLines.length === 1 ? "" : "s"}</span>
                  <span>{partLines.length} part line{partLines.length === 1 ? "" : "s"}</span>
                  {details.currentEstimate.requestedAt ? <span>Requested {formatDateTime(details.currentEstimate.requestedAt)}</span> : null}
                </div>
              </>
            ) : (
              <div className="workshop-os-empty-card">No live estimate yet.</div>
            )}
          </div>,
          )}

          {renderSection(
          "partsAllocation",
          "Parts allocation",
          "Keep stock readiness separate from the estimate itself.",
          <div className="workshop-os-job-workspace-section__stack">
            {displayPartsSummary ? (
              <div className="workshop-os-drawer__grid">
                <div>
                  <span className="metric-label">Required</span>
                  <strong>{displayPartsSummary.requiredQty}</strong>
                </div>
                <div>
                  <span className="metric-label">Allocated</span>
                  <strong>{displayPartsSummary.allocatedQty}</strong>
                </div>
                <div>
                  <span className="metric-label">Outstanding</span>
                  <strong>{displayPartsSummary.outstandingQty}</strong>
                </div>
                <div>
                  <span className="metric-label">Missing</span>
                  <strong>{displayPartsSummary.missingQty}</strong>
                </div>
              </div>
            ) : (
              <div className="workshop-os-empty-card">No parts allocation summary is available yet.</div>
            )}
          </div>,
          )}

          {renderSection(
          "notes",
          "Notes",
          "Internal and customer-visible notes stay grouped but separate from the issue summary.",
          <div className="workshop-os-job-workspace-section__stack">
            {notes.length ? (
              <div className="workshop-os-job-workspace-section__list">
                {notes.slice(0, 4).map((note) => (
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
          )}

          {renderSection(
          "attachments",
          "Attachments",
          "Photos and files stay separate so the drawer keeps a clean operational structure.",
          <div className="workshop-os-job-workspace-section__stack">
            {attachments.length ? (
              <div className="workshop-os-job-workspace-section__list">
                {attachments.slice(0, 4).map((attachment) => (
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
          )}
        </div>
      </aside>
    </div>
  );
};
