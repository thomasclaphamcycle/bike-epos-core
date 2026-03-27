import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiDelete, apiGet, apiPatch, apiPost } from "../../api/client";
import { useToasts } from "../../components/ToastProvider";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import {
  getWorkshopTechnicianWorkflowSummary,
  workshopRawStatusClass,
  workshopRawStatusLabel,
} from "./status";

type WorkshopJobOverlayLine = {
  id: string;
  type: "LABOUR" | "PART";
  productId: string | null;
  variantId: string | null;
  variantSku: string | null;
  description: string;
  qty: number;
  unitPricePence: number;
  lineTotalPence: number;
  productName: string | null;
  variantName: string | null;
};

type WorkshopJobOverlayLineMutationResponse = {
  line: WorkshopJobOverlayLine;
};

type WorkshopJobOverlayProductSearchRow = {
  id: string;
  productId: string;
  name: string;
  sku: string;
  barcode: string | null;
  pricePence: number;
};

type WorkshopJobOverlayProductSearchResponse = {
  rows: WorkshopJobOverlayProductSearchRow[];
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

type WorkshopJobOverlaySchedulePatchResponse = {
  job: {
    id: string;
    status: string;
    assignedStaffId: string | null;
    assignedStaffName: string | null;
    scheduledDate: string | null;
    scheduledStartAt: string | null;
    scheduledEndAt: string | null;
    durationMinutes: number | null;
    updatedAt: string;
  };
  idempotent: boolean;
};

type WorkshopJobOverlayStatusResponse = {
  job: {
    id: string;
    status: string;
    updatedAt: string;
    completedAt: string | null;
    cancelledAt?: string | null;
  };
  idempotent: boolean;
};

type WorkshopJobOverlayApprovalResponse = {
  estimate: WorkshopJobOverlayEstimate;
  job: {
    id: string;
    status: string;
  };
  idempotent: boolean;
};

type WorkshopJobOverlayAttachmentsResponse = {
  workshopJobId: string;
  attachments: WorkshopJobOverlayAttachment[];
};

type WorkshopJobOverlayDaySnapshotJob = {
  id: string;
  customerName: string | null;
  bikeDescription: string | null;
  summaryText: string;
  rawStatus: string;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
};

type WorkshopJobOverlayDaySnapshotResponse = {
  range: {
    timeZone: string;
  };
  days: Array<{
    date: string;
    weekday: string;
    opensAt: string | null;
    closesAt: string | null;
    isClosed: boolean;
    closedReason: string | null;
  }>;
  scheduledJobs: WorkshopJobOverlayDaySnapshotJob[];
  unassignedJobs: WorkshopJobOverlayDaySnapshotJob[];
  staff: Array<{
    id: string;
    name: string;
    dailyCapacity: Array<{
      date: string;
      totalMinutes: number;
      bookedMinutes: number;
      timeOffMinutes: number;
      availableMinutes: number;
    }>;
  }>;
};

const WORKSHOP_OVERLAY_TABS = [
  ["schedule", "Schedule"],
  ["work", "Work"],
  ["overview", "Overview"],
  ["activity", "Activity"],
] as const;

type WorkshopOverlayTab = (typeof WORKSHOP_OVERLAY_TABS)[number][0];

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
  initialTab?: WorkshopOverlayTab | null;
  timeZone?: string;
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

const parseWorkshopOverlayTab = (value: string | null | undefined): WorkshopOverlayTab | null => {
  switch (value) {
    case "schedule":
    case "work":
    case "overview":
    case "activity":
      return value;
    default:
      return null;
  }
};

const resolveWorkshopOverlayInitialTab = ({
  fullJobPath,
  initialTab,
}: {
  fullJobPath?: string | null;
  initialTab?: WorkshopOverlayTab | null;
}): WorkshopOverlayTab => {
  if (initialTab) {
    return initialTab;
  }

  if (fullJobPath) {
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
      const requestedTab = new URL(fullJobPath, origin).searchParams.get("tab");
      return parseWorkshopOverlayTab(requestedTab) ?? "schedule";
    } catch {
      return "schedule";
    }
  }

  return "schedule";
};

const parseMoneyToPence = (value: string) => {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.round(parsed * 100);
};

const formatPromiseDate = (value: string | null | undefined) => {
  if (!value) {
    return "Not set";
  }

  const dateKey = value.slice(0, 10);
  return new Date(`${dateKey}T12:00:00.000Z`).toLocaleDateString([], {
    day: "numeric",
    month: "short",
  });
};

const formatDateTime = (value: string | null | undefined, timeZone?: string) => {
  if (!value) {
    return "Not set";
  }
  return new Date(value).toLocaleString([], {
    ...(timeZone ? { timeZone } : {}),
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getTimeZoneParts = (value: Date, timeZone?: string) => {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    ...(timeZone ? { timeZone } : {}),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(value);
  const lookup = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    year: lookup("year"),
    month: lookup("month"),
    day: lookup("day"),
    hour: Number(lookup("hour") || "0"),
    minute: Number(lookup("minute") || "0"),
  };
};

const toDateInputValue = (isoValue: string | null | undefined, timeZone?: string) => {
  if (!isoValue) {
    return "";
  }

  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const parts = getTimeZoneParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const toTimeInputValue = (isoValue: string | null | undefined, timeZone?: string) => {
  if (!isoValue) {
    return "";
  }

  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const parts = getTimeZoneParts(date, timeZone);
  return `${`${parts.hour}`.padStart(2, "0")}:${`${parts.minute}`.padStart(2, "0")}`;
};

const buildScheduleIso = (dateKey: string, timeValue: string) => {
  if (!dateKey || !timeValue) {
    return null;
  }

  const date = new Date(`${dateKey}T${timeValue}:00`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
};

const minutesBetweenTimes = (startTime: string, endTime: string) => {
  if (!startTime || !endTime || !startTime.includes(":") || !endTime.includes(":")) {
    return null;
  }

  const [startHour, startMinute] = startTime.split(":").map((value) => Number(value));
  const [endHour, endMinute] = endTime.split(":").map((value) => Number(value));
  if (
    !Number.isInteger(startHour) ||
    !Number.isInteger(startMinute) ||
    !Number.isInteger(endHour) ||
    !Number.isInteger(endMinute)
  ) {
    return null;
  }

  return ((endHour * 60) + endMinute) - ((startHour * 60) + startMinute);
};

const formatScheduleWindow = (
  startAt: string | null | undefined,
  endAt: string | null | undefined,
  timeZone?: string,
) => {
  if (!startAt) {
    return "Not timed";
  }

  const start = new Date(startAt);
  const end = endAt ? new Date(endAt) : null;

  const startLabel = start.toLocaleString([], {
    ...(timeZone ? { timeZone } : {}),
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
        ...(timeZone ? { timeZone } : {}),
        hour: "2-digit",
        minute: "2-digit",
      })
    : end.toLocaleString([], {
        ...(timeZone ? { timeZone } : {}),
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });

  return `${startLabel} -> ${endLabel}`;
};

const formatDateKeyLabel = (dateKey: string, timeZone?: string) => {
  if (!dateKey) {
    return "No day selected";
  }

  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return dateKey;
  }

  return date.toLocaleDateString([], {
    ...(timeZone ? { timeZone } : {}),
    weekday: "short",
    day: "numeric",
    month: "short",
  });
};

const formatOptionalTime = (value: string | null | undefined, timeZone?: string) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toLocaleTimeString([], {
    ...(timeZone ? { timeZone } : {}),
    hour: "2-digit",
    minute: "2-digit",
  });
};

const toSnapshotJobDateKey = (
  job: Pick<WorkshopJobOverlayDaySnapshotJob, "scheduledStartAt">,
  timeZone?: string,
) => toDateInputValue(job.scheduledStartAt, timeZone);

const toSnapshotJobSortKey = (job: WorkshopJobOverlayDaySnapshotJob) => {
  const timestamp = job.scheduledStartAt ? new Date(job.scheduledStartAt).getTime() : Number.MAX_SAFE_INTEGER;
  if (Number.isNaN(timestamp)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return timestamp;
};

const getSnapshotJobHeading = (job: WorkshopJobOverlayDaySnapshotJob) =>
  job.bikeDescription || job.customerName || `Workshop job ${job.id.slice(0, 8)}`;

const getSnapshotJobSubline = (job: WorkshopJobOverlayDaySnapshotJob) => {
  const parts = [job.customerName, job.summaryText]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));

  return parts.join(" · ") || workshopRawStatusLabel(job.rawStatus);
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
    rawStatus: summary?.rawStatus || summary?.status || "BOOKED",
    partsStatus: summary?.partsSummary?.partsStatus,
    assignedStaffName: summary?.assignedStaffName || null,
    scheduledDate: summary?.scheduledDate || null,
    scheduledStartAt: summary?.scheduledStartAt || null,
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

type WorkshopOverlayStatusAction =
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

type WorkshopWorkflowAction = WorkshopOverlayQuickAction | WorkshopOverlayStatusAction;

type WorkshopOverviewMode = "planning" | "operational";

type WorkshopOverviewSignal = {
  label: string;
  detail: string;
  className: string;
};

const truncateText = (value: string, limit = 140) =>
  value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}...` : value;

const getApprovalSignal = ({
  status,
  estimate,
  timeZone,
}: {
  status: string;
  estimate: WorkshopJobOverlayEstimate | null;
  timeZone?: string;
}): WorkshopOverviewSignal => {
  if (status === "WAITING_FOR_APPROVAL" || estimate?.status === "PENDING_APPROVAL") {
    return {
      label: "Waiting for approval",
      detail: estimate?.requestedAt
        ? `Quote sent ${formatDateTime(estimate.requestedAt, timeZone)}.`
        : "Customer approval is still needed before bench work can move on.",
      className: "status-badge status-warning",
    };
  }

  if (estimate?.status === "APPROVED") {
    return {
      label: "Approved",
      detail: estimate.approvedAt
        ? `Approved ${formatDateTime(estimate.approvedAt, timeZone)}.`
        : "Customer approval is already in place.",
      className: "status-badge status-complete",
    };
  }

  if (estimate?.status === "REJECTED") {
    return {
      label: "Needs quote follow-up",
      detail: estimate.rejectedAt
        ? `Latest quote was declined ${formatDateTime(estimate.rejectedAt, timeZone)}.`
        : "The current quote needs revision before work continues.",
      className: "status-badge status-warning",
    };
  }

  return {
    label: "Not awaiting approval",
    detail: estimate
      ? "No customer approval blocker is active right now."
      : "This job is not currently waiting on a customer decision.",
    className: "status-badge status-info",
  };
};

const getPartsSignal = (
  partsSummary:
    | {
        requiredQty: number;
        allocatedQty: number;
        consumedQty: number;
        returnedQty: number;
        outstandingQty: number;
        missingQty: number;
        partsStatus: "OK" | "UNALLOCATED" | "SHORT";
      }
    | null
    | undefined,
): WorkshopOverviewSignal => {
  if (!partsSummary || partsSummary.requiredQty === 0) {
    return {
      label: "No parts planned",
      detail: "This job does not currently depend on workshop stock.",
      className: "status-badge",
    };
  }

  if (partsSummary.partsStatus === "SHORT") {
    return {
      label: "Waiting on parts",
      detail: partsSummary.missingQty
        ? `${partsSummary.missingQty} item(s) are still missing from stock.`
        : `${partsSummary.outstandingQty} item(s) are still outstanding.`,
      className: "status-badge status-warning",
    };
  }

  if (partsSummary.partsStatus === "UNALLOCATED") {
    return {
      label: "Parts to reserve",
      detail: `${partsSummary.outstandingQty} item(s) still need allocation to the job.`,
      className: "status-badge status-info",
    };
  }

  return {
    label: "All parts ready",
    detail: `${partsSummary.allocatedQty} allocated, ${partsSummary.consumedQty} already fitted.`,
    className: "status-badge status-complete",
  };
};

const getOverviewMode = ({
  status,
  assignedStaffName,
  scheduledDate,
  scheduledStartAt,
}: {
  status: string;
  assignedStaffName: string | null;
  scheduledDate: string | null;
  scheduledStartAt: string | null;
}): WorkshopOverviewMode => {
  const hasAssignment = Boolean(assignedStaffName);
  const hasBookingCommitment = Boolean(scheduledStartAt || scheduledDate);

  if (["WAITING_FOR_APPROVAL", "IN_PROGRESS", "WAITING_FOR_PARTS", "ON_HOLD", "READY_FOR_COLLECTION", "COMPLETED", "CANCELLED"].includes(status)) {
    return "operational";
  }

  if (["BOOKED", "BOOKING_MADE", "BIKE_ARRIVED", "APPROVED"].includes(status)) {
    return hasAssignment && hasBookingCommitment ? "operational" : "planning";
  }

  return hasAssignment && hasBookingCommitment ? "operational" : "planning";
};

const isSameWorkflowAction = (
  left: WorkshopWorkflowAction | null,
  right: WorkshopWorkflowAction | null,
) => Boolean(left && right && left.kind === right.kind && left.value === right.value);

const getPrimaryOverviewAction = ({
  status,
  assignedStaffName,
  hasSale,
  partsStatus,
}: {
  status: string;
  assignedStaffName: string | null;
  hasSale: boolean;
  partsStatus?: "OK" | "UNALLOCATED" | "SHORT" | null;
}): WorkshopWorkflowAction | null => {
  switch (status) {
    case "BOOKED":
    case "BIKE_ARRIVED":
      return {
        kind: "status",
        label: assignedStaffName ? "Move to bench" : "Mark in progress",
        value: "IN_PROGRESS",
      };
    case "WAITING_FOR_APPROVAL":
      return {
        kind: "approval",
        label: "Mark approved",
        value: "APPROVED",
      };
    case "WAITING_FOR_PARTS":
    case "ON_HOLD":
      return {
        kind: "status",
        label: "Resume bench work",
        value: "IN_PROGRESS",
      };
    case "IN_PROGRESS":
      return partsStatus === "SHORT"
        ? {
            kind: "status",
            label: "Mark waiting for parts",
            value: "WAITING_FOR_PARTS",
          }
        : null;
    case "READY_FOR_COLLECTION":
      return hasSale
        ? {
            kind: "status",
            label: "Complete collection",
            value: "COMPLETED",
          }
        : null;
    default:
      return null;
  }
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
  timeZone,
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
  timeZone?: string;
}): WorkshopNextActionCard => {
  const scheduleHighlight = scheduledStartAt
    ? `Scheduled slot ${formatDateTime(scheduledStartAt, timeZone)}`
    : scheduledDate
      ? `Promise date ${formatPromiseDate(scheduledDate)}`
      : "No promise date set";
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
          estimate?.requestedAt ? `Quote sent ${formatDateTime(estimate.requestedAt, timeZone)}` : "Review the latest estimate before following up",
          technicianHighlight,
          scheduleHighlight,
        ],
      };
    case "READY_FOR_COLLECTION":
      return {
        title: "Prepare collection",
        body: workflowSummary.nextStep,
        highlights: [
          technicianHighlight,
          scheduleHighlight,
          "Confirm payment / handover path before the customer arrives",
        ],
      };
    case "IN_PROGRESS":
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

type WorkshopJobOverlayScheduleDraft = {
  dateKey: string;
  startTime: string;
  endTime: string;
};

const createScheduleDraft = ({
  scheduledDate,
  scheduledStartAt,
  scheduledEndAt,
  timeZone,
}: {
  scheduledDate: string | null | undefined;
  scheduledStartAt: string | null | undefined;
  scheduledEndAt: string | null | undefined;
  timeZone?: string;
}): WorkshopJobOverlayScheduleDraft => ({
  dateKey:
    toDateInputValue(scheduledStartAt, timeZone)
    || scheduledDate?.slice(0, 10)
    || new Date().toISOString().slice(0, 10),
  startTime: toTimeInputValue(scheduledStartAt, timeZone) || "10:00",
  endTime: toTimeInputValue(scheduledEndAt, timeZone) || "11:00",
});

const getStatusProgressionActions = ({
  status,
  hasSale,
}: {
  status: string;
  hasSale: boolean;
}): WorkshopOverlayStatusAction[] => {
  switch (status) {
    case "BOOKED":
    case "BIKE_ARRIVED":
      return [
        { kind: "status", label: "Move to Bench", value: "IN_PROGRESS" },
        { kind: "status", label: "Pause Job", value: "ON_HOLD" },
        { kind: "status", label: "Cancel Job", value: "CANCELLED" },
      ];
    case "IN_PROGRESS":
      return [
        { kind: "status", label: "Waiting for Parts", value: "WAITING_FOR_PARTS" },
        { kind: "status", label: "Pause Job", value: "ON_HOLD" },
        { kind: "status", label: "Ready for Collection", value: "READY_FOR_COLLECTION" },
        { kind: "status", label: "Cancel Job", value: "CANCELLED" },
      ];
    case "WAITING_FOR_APPROVAL":
      return [
        { kind: "approval", label: "Mark Approved", value: "APPROVED" },
        { kind: "status", label: "Pause Job", value: "ON_HOLD" },
        { kind: "status", label: "Cancel Job", value: "CANCELLED" },
      ];
    case "WAITING_FOR_PARTS":
      return [
        { kind: "status", label: "Resume Bench Work", value: "IN_PROGRESS" },
        { kind: "status", label: "Pause Job", value: "ON_HOLD" },
        { kind: "status", label: "Cancel Job", value: "CANCELLED" },
      ];
    case "ON_HOLD":
      return [
        { kind: "status", label: "Resume Bench Work", value: "IN_PROGRESS" },
        { kind: "status", label: "Waiting for Parts", value: "WAITING_FOR_PARTS" },
        { kind: "status", label: "Cancel Job", value: "CANCELLED" },
      ];
    case "READY_FOR_COLLECTION":
      return hasSale
        ? [
            { kind: "status", label: "Complete Collection", value: "COMPLETED" },
          ]
        : [];
    default:
      return [];
  }
};

export const WorkshopJobOverlay = ({
  jobId,
  summary,
  onClose,
  fullJobPath,
  initialTab,
  timeZone,
  technicianOptions = [],
  onJobChanged,
}: WorkshopJobOverlayProps) => {
  const { success, error } = useToasts();
  const resolvedInitialTab = resolveWorkshopOverlayInitialTab({
    fullJobPath,
    initialTab,
  });
  const [details, setDetails] = useState<WorkshopJobOverlayResponse | null>(null);
  const [notes, setNotes] = useState<WorkshopJobOverlayNote[]>([]);
  const [attachments, setAttachments] = useState<WorkshopJobOverlayAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [savingQuickAction, setSavingQuickAction] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [addingPart, setAddingPart] = useState(false);
  const [addingLabour, setAddingLabour] = useState(false);
  const [savingLineId, setSavingLineId] = useState<string | null>(null);
  const [removingLineId, setRemovingLineId] = useState<string | null>(null);
  const [isEditingSchedule, setIsEditingSchedule] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [workError, setWorkError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState<WorkshopOverlayTab>(resolvedInitialTab);
  const [assignedStaffIdDraft, setAssignedStaffIdDraft] = useState("");
  const [partSearch, setPartSearch] = useState("");
  const [partResults, setPartResults] = useState<WorkshopJobOverlayProductSearchRow[]>([]);
  const [showPartComposer, setShowPartComposer] = useState(false);
  const [showLabourComposer, setShowLabourComposer] = useState(false);
  const [labourDescriptionDraft, setLabourDescriptionDraft] = useState("");
  const [labourPriceDraft, setLabourPriceDraft] = useState("");
  const [lineQtyDrafts, setLineQtyDrafts] = useState<Record<string, string>>({});
  const [scheduleDaySnapshot, setScheduleDaySnapshot] = useState<WorkshopJobOverlayDaySnapshotResponse | null>(null);
  const [loadingScheduleDaySnapshot, setLoadingScheduleDaySnapshot] = useState(false);
  const [scheduleDaySnapshotError, setScheduleDaySnapshotError] = useState<string | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState<WorkshopJobOverlayScheduleDraft>(() =>
    createScheduleDraft({
      scheduledDate: summary?.scheduledDate || null,
      scheduledStartAt: summary?.scheduledStartAt || null,
      scheduledEndAt: summary?.scheduledEndAt || null,
      timeZone,
    }),
  );
  const [collapsedSections, setCollapsedSections] = useState<Record<JobWorkspaceSectionKey, boolean>>(
    DEFAULT_JOB_WORKSPACE_COLLAPSED,
  );
  const debouncedPartSearch = useDebouncedValue(partSearch, 250);
  const savingAnyAction = savingAssignment || savingQuickAction || savingStatus || savingSchedule;
  const footerMessage = actionError
    || scheduleError
    || workError
    || loadError
    || (savingSchedule
      ? "Saving scheduled slot..."
      : savingAssignment
        ? "Saving technician assignment..."
        : savingQuickAction || savingStatus
          ? "Saving workflow update..."
          : addingPart
            ? "Adding part..."
            : addingLabour
              ? "Adding labour..."
              : savingLineId
                ? "Saving work line..."
                : removingLineId
                  ? "Removing work line..."
                  : null);
  const footerMessageTone =
    actionError || scheduleError || workError || loadError ? "error" : footerMessage ? "status" : "idle";

  useEffect(() => {
    setCollapsedSections(DEFAULT_JOB_WORKSPACE_COLLAPSED);
    setActionError(null);
    setScheduleError(null);
    setSavingAssignment(false);
    setSavingQuickAction(false);
    setSavingStatus(false);
    setSavingSchedule(false);
    setIsEditingSchedule(false);
    setAddingPart(false);
    setAddingLabour(false);
    setSavingLineId(null);
    setRemovingLineId(null);
    setWorkError(null);
    setPartSearch("");
    setPartResults([]);
    setShowPartComposer(false);
    setShowLabourComposer(false);
    setLabourDescriptionDraft("");
    setLabourPriceDraft("");
    setLineQtyDrafts({});
    setScheduleDaySnapshot(null);
    setLoadingScheduleDaySnapshot(false);
    setScheduleDaySnapshotError(null);
    setActiveTab(resolvedInitialTab);
  }, [jobId, resolvedInitialTab]);

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
    if (isEditingSchedule) {
      return;
    }

    setScheduleDraft(
      createScheduleDraft({
        scheduledDate: details?.job.scheduledDate || summary?.scheduledDate || null,
        scheduledStartAt: details?.job.scheduledStartAt || summary?.scheduledStartAt || null,
        scheduledEndAt: details?.job.scheduledEndAt || summary?.scheduledEndAt || null,
        timeZone,
      }),
    );
  }, [
    details?.job.scheduledDate,
    details?.job.scheduledStartAt,
    details?.job.scheduledEndAt,
    summary?.scheduledDate,
    summary?.scheduledStartAt,
    summary?.scheduledEndAt,
    timeZone,
    isEditingSchedule,
  ]);

  useEffect(() => {
    if (activeTab !== "schedule" || !scheduleDraft.dateKey) {
      return;
    }

    let cancelled = false;

    const loadScheduleDaySnapshot = async () => {
      setLoadingScheduleDaySnapshot(true);
      setScheduleDaySnapshotError(null);

      try {
        const payload = await apiGet<WorkshopJobOverlayDaySnapshotResponse>(
          `/api/workshop/calendar?from=${encodeURIComponent(scheduleDraft.dateKey)}&to=${encodeURIComponent(scheduleDraft.dateKey)}`,
        );

        if (!cancelled) {
          setScheduleDaySnapshot(payload);
        }
      } catch (loadSnapshotError) {
        if (!cancelled) {
          setScheduleDaySnapshot(null);
          setScheduleDaySnapshotError(
            loadSnapshotError instanceof Error
              ? loadSnapshotError.message
              : "Could not load the selected workshop day.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingScheduleDaySnapshot(false);
        }
      }
    };

    void loadScheduleDaySnapshot();

    return () => {
      cancelled = true;
    };
  }, [activeTab, scheduleDraft.dateKey]);

  useEffect(() => {
    setLineQtyDrafts(
      Object.fromEntries((details?.lines ?? []).map((line) => [line.id, `${line.qty}`])),
    );
  }, [details?.lines]);

  useEffect(() => {
    if (!showPartComposer || !debouncedPartSearch.trim()) {
      setPartResults([]);
      return;
    }

    let cancelled = false;

    const runSearch = async () => {
      try {
        const results = await apiGet<WorkshopJobOverlayProductSearchResponse>(
          `/api/products/search?q=${encodeURIComponent(debouncedPartSearch.trim())}`,
        );
        if (!cancelled) {
          setPartResults(Array.isArray(results.rows) ? results.rows : []);
        }
      } catch (searchError) {
        if (cancelled) {
          return;
        }
        const message = searchError instanceof Error ? searchError.message : "Product search failed";
        setWorkError(message);
        error(message);
      }
    };

    void runSearch();

    return () => {
      cancelled = true;
    };
  }, [debouncedPartSearch, error, showPartComposer]);

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
  const displayStatus = overlayJob?.status || summary?.rawStatus || summary?.status || "BOOKED";
  const displayCustomerName = overlayJob?.customerName || getOverlayCustomerName(summary);
  const displayBikeDescription = overlayJob?.bikeDescription || summary?.bikeDescription || "Workshop job";
  const displayPartsSummary = details?.partsOverview?.summary ?? summary?.partsSummary ?? null;
  const currentScheduleDraft = createScheduleDraft({
    scheduledDate: overlayJob?.scheduledDate || summary?.scheduledDate || null,
    scheduledStartAt: overlayJob?.scheduledStartAt || summary?.scheduledStartAt || null,
    scheduledEndAt: overlayJob?.scheduledEndAt || summary?.scheduledEndAt || null,
    timeZone,
  });
  const displayWorkflowSummary = getWorkshopTechnicianWorkflowSummary({
    rawStatus: displayStatus,
    partsStatus: displayPartsSummary?.partsStatus,
    assignedStaffName: overlayJob?.assignedStaffName || summary?.assignedStaffName || null,
    scheduledDate: overlayJob?.scheduledDate || summary?.scheduledDate || null,
    scheduledStartAt: overlayJob?.scheduledStartAt || summary?.scheduledStartAt || null,
    hasSale: Boolean(overlayJob?.sale || summary?.sale),
    hasBasket: Boolean(overlayJob?.finalizedBasketId || summary?.finalizedBasketId),
  });
  const urgency = getUrgency(overlayJob?.scheduledDate || summary?.scheduledDate, displayStatus);
  const lines = details?.lines ?? [];
  const labourLines = lines.filter((line) => line.type === "LABOUR");
  const partLines = lines.filter((line) => line.type === "PART");
  const labourTotalPence = labourLines.reduce((sum, line) => sum + line.lineTotalPence, 0);
  const partsTotalPence = partLines.reduce((sum, line) => sum + line.lineTotalPence, 0);
  const workTotalPence = lines.reduce((sum, line) => sum + line.lineTotalPence, 0);
  const openPath = fullJobPath || `/workshop/${jobId}`;
  const issueSummary = overlayJob?.notes || summary?.notes || null;
  const overviewMode = getOverviewMode({
    status: displayStatus,
    assignedStaffName: overlayJob?.assignedStaffName || summary?.assignedStaffName || null,
    scheduledDate: overlayJob?.scheduledDate || summary?.scheduledDate || null,
    scheduledStartAt: overlayJob?.scheduledStartAt || summary?.scheduledStartAt || null,
  });
  const approvalSignal = getApprovalSignal({
    status: displayStatus,
    estimate: details?.currentEstimate || null,
    timeZone,
  });
  const partsSignal = getPartsSignal(displayPartsSummary);
  const primaryAction = getPrimaryOverviewAction({
    status: displayStatus,
    assignedStaffName: overlayJob?.assignedStaffName || summary?.assignedStaffName || null,
    hasSale: Boolean(overlayJob?.sale || summary?.sale),
    partsStatus: displayPartsSummary?.partsStatus,
  });
  const secondaryActions = getStatusProgressionActions({
    status: displayStatus,
    hasSale: Boolean(overlayJob?.sale || summary?.sale),
  }).filter((action) =>
    !isSameWorkflowAction(action, primaryAction),
  );
  const canAssignTechnician = technicianOptions.length > 0 && !["COMPLETED", "CANCELLED"].includes(displayStatus);
  const hasAssignmentChange =
    (overlayJob?.assignedStaffId || summary?.assignedStaffId || "") !== assignedStaffIdDraft;
  const hasScheduleDraftChanges =
    scheduleDraft.dateKey !== currentScheduleDraft.dateKey
    || scheduleDraft.startTime !== currentScheduleDraft.startTime
    || scheduleDraft.endTime !== currentScheduleDraft.endTime;
  const hasTimedBooking = Boolean(overlayJob?.scheduledStartAt || summary?.scheduledStartAt);
  const canSaveScheduleDraft = !hasTimedBooking || hasScheduleDraftChanges;
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
    timeZone,
  });

  const refreshOverlay = async () => {
    setRefreshKey((current) => current + 1);
    if (onJobChanged) {
      await onJobChanged();
    }
  };

  const refreshOverlayInBackground = (setErrorState?: (message: string | null) => void) => {
    void refreshOverlay().catch((refreshError) => {
      const message = refreshError instanceof Error
        ? refreshError.message
        : "Workshop view refresh did not complete cleanly";
      if (setErrorState) {
        setErrorState(message);
      } else {
        setActionError(message);
      }
      error(message);
    });
  };

  const applyLineUpsert = (line: WorkshopJobOverlayLine) => {
    setDetails((current) => {
      if (!current) {
        return current;
      }

      const existingIndex = current.lines.findIndex((item) => item.id === line.id);
      const nextLines = existingIndex >= 0
        ? current.lines.map((item) => (item.id === line.id ? line : item))
        : [...current.lines, line];

      return {
        ...current,
        lines: nextLines,
        currentEstimate: null,
        hasApprovedEstimate: false,
      };
    });
    setLineQtyDrafts((current) => ({ ...current, [line.id]: `${line.qty}` }));
  };

  const applyLineRemoval = (lineId: string) => {
    setDetails((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        lines: current.lines.filter((line) => line.id !== lineId),
        currentEstimate: null,
        hasApprovedEstimate: false,
      };
    });
    setLineQtyDrafts((current) => {
      const next = { ...current };
      delete next[lineId];
      return next;
    });
  };

  const applyInlineStatusUpdate = ({
    status,
    completedAt,
    cancelledAt,
    estimate,
  }: {
    status: string;
    completedAt?: string | null;
    cancelledAt?: string | null;
    estimate?: WorkshopJobOverlayEstimate | null;
  }) => {
    setDetails((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        job: {
          ...current.job,
          status,
          ...(completedAt !== undefined ? { completedAt } : {}),
          ...(cancelledAt !== undefined ? { cancelledAt } : {}),
        },
        ...(estimate !== undefined ? { currentEstimate: estimate } : {}),
      };
    });
  };

  const updateScheduleDraftField = (
    field: keyof WorkshopJobOverlayScheduleDraft,
    value: string,
  ) => {
    setScheduleDraft((current) => ({
      ...current,
      [field]: value,
    }));
    setScheduleError(null);
    setIsEditingSchedule(true);
  };

  const saveSchedule = async () => {
    const scheduledStartAt = buildScheduleIso(scheduleDraft.dateKey, scheduleDraft.startTime);
    const scheduledEndAt = buildScheduleIso(scheduleDraft.dateKey, scheduleDraft.endTime);
    const durationMinutes = minutesBetweenTimes(scheduleDraft.startTime, scheduleDraft.endTime);

    if (savingAnyAction) {
      return;
    }

    if (!jobId) {
      const message = "Workshop job is unavailable for scheduling.";
      setScheduleError(message);
      error(message);
      return;
    }

    if (!scheduleDraft.dateKey) {
      setScheduleError("Choose a valid date.");
      return;
    }

    if (!scheduledStartAt || !scheduledEndAt) {
      setScheduleError("Choose a valid start and end time.");
      return;
    }

    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      setScheduleError("End time must be later than the start time.");
      return;
    }

    setSavingSchedule(true);
    setScheduleError(null);
    setActionError(null);

    try {
      const response = await apiPatch<WorkshopJobOverlaySchedulePatchResponse>(
        `/api/workshop/jobs/${encodeURIComponent(jobId)}/schedule`,
        {
          scheduledStartAt,
          scheduledEndAt,
          durationMinutes,
        },
      );

      setDetails((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          job: {
            ...current.job,
            status: response.job.status,
            assignedStaffId: response.job.assignedStaffId,
            assignedStaffName: response.job.assignedStaffName,
            scheduledDate: response.job.scheduledDate,
            scheduledStartAt: response.job.scheduledStartAt,
            scheduledEndAt: response.job.scheduledEndAt,
            durationMinutes: response.job.durationMinutes,
            updatedAt: response.job.updatedAt,
          },
        };
      });

      setScheduleDraft(
        createScheduleDraft({
          scheduledDate: response.job.scheduledDate,
          scheduledStartAt: response.job.scheduledStartAt,
          scheduledEndAt: response.job.scheduledEndAt,
          timeZone,
        }),
      );
      setIsEditingSchedule(false);
      setActiveTab("schedule");
      success(response.idempotent ? "Booking already matches." : "Booking updated.");
      refreshOverlayInBackground();
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Failed to update workshop schedule";
      setScheduleError(message);
      error(message);
    } finally {
      setSavingSchedule(false);
    }
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
    if (!primaryAction) {
      return;
    }

    if (savingAnyAction) {
      return;
    }

    setSavingQuickAction(true);
    setActionError(null);

    try {
      if (primaryAction.kind === "approval") {
        const response = await apiPost<WorkshopJobOverlayApprovalResponse>(`/api/workshop/jobs/${encodeURIComponent(jobId)}/approval`, {
          status: primaryAction.value,
        });
        applyInlineStatusUpdate({
          status: response.job.status,
          estimate: response.estimate,
        });
        success("Quote marked approved");
      } else {
        const response = await apiPost<WorkshopJobOverlayStatusResponse>(`/api/workshop/jobs/${encodeURIComponent(jobId)}/status`, {
          status: primaryAction.value,
        });
        applyInlineStatusUpdate({
          status: response.job.status,
          completedAt: response.job.completedAt,
          cancelledAt: response.job.cancelledAt,
        });
        success("Job status updated");
      }

      refreshOverlayInBackground();
    } catch (nextActionError) {
      const message = nextActionError instanceof Error ? nextActionError.message : "Failed to update workshop job";
      setActionError(message);
      error(message);
    } finally {
      setSavingQuickAction(false);
    }
  };

  const runSecondaryAction = async (action: WorkshopOverlayStatusAction) => {
    if (!jobId || savingAnyAction) {
      return;
    }

    setSavingStatus(true);
    setActionError(null);

    try {
      if (action.kind === "approval") {
        const response = await apiPost<WorkshopJobOverlayApprovalResponse>(`/api/workshop/jobs/${encodeURIComponent(jobId)}/approval`, {
          status: action.value,
        });
        applyInlineStatusUpdate({
          status: response.job.status,
          estimate: response.estimate,
        });
        success("Quote marked approved");
      } else {
        const response = await apiPost<WorkshopJobOverlayStatusResponse>(`/api/workshop/jobs/${encodeURIComponent(jobId)}/status`, {
          status: action.value,
        });
        applyInlineStatusUpdate({
          status: response.job.status,
          completedAt: response.job.completedAt,
          cancelledAt: response.job.cancelledAt,
        });
        success("Job status updated");
      }

      refreshOverlayInBackground();
    } catch (statusError) {
      const message = statusError instanceof Error ? statusError.message : "Failed to update workflow status";
      setActionError(message);
      error(message);
    } finally {
      setSavingStatus(false);
    }
  };

  const addPartLine = async (product: WorkshopJobOverlayProductSearchRow) => {
    if (!jobId || addingPart) {
      return;
    }

    setAddingPart(true);
    setWorkError(null);

    try {
      const response = await apiPost<WorkshopJobOverlayLineMutationResponse>(
        `/api/workshop/jobs/${encodeURIComponent(jobId)}/lines`,
        {
          type: "PART",
          productId: product.productId,
          variantId: product.id,
          description: product.name,
          qty: 1,
          unitPricePence: product.pricePence,
        },
      );

      applyLineUpsert(response.line);
      setPartSearch("");
      setPartResults([]);
      setShowPartComposer(false);
      success("Part line added");
      refreshOverlayInBackground(setWorkError);
    } catch (addError) {
      const message = addError instanceof Error ? addError.message : "Unable to add part line";
      setWorkError(message);
      error(message);
    } finally {
      setAddingPart(false);
    }
  };

  const addLabourLine = async () => {
    if (!jobId || addingLabour) {
      return;
    }

    const description = labourDescriptionDraft.trim();
    const unitPricePence = parseMoneyToPence(labourPriceDraft);

    if (!description) {
      setWorkError("Labour description is required.");
      return;
    }

    if (unitPricePence === null) {
      setWorkError("Enter a valid labour price in pounds.");
      return;
    }

    setAddingLabour(true);
    setWorkError(null);

    try {
      const response = await apiPost<WorkshopJobOverlayLineMutationResponse>(
        `/api/workshop/jobs/${encodeURIComponent(jobId)}/lines`,
        {
          type: "LABOUR",
          description,
          qty: 1,
          unitPricePence,
        },
      );

      applyLineUpsert(response.line);
      setLabourDescriptionDraft("");
      setLabourPriceDraft("");
      setShowLabourComposer(false);
      success("Labour line added");
      refreshOverlayInBackground(setWorkError);
    } catch (addError) {
      const message = addError instanceof Error ? addError.message : "Unable to add labour line";
      setWorkError(message);
      error(message);
    } finally {
      setAddingLabour(false);
    }
  };

  const saveLineQty = async (line: WorkshopJobOverlayLine) => {
    if (!jobId || savingLineId) {
      return;
    }

    const qtyDraft = Number(lineQtyDrafts[line.id] ?? `${line.qty}`);
    if (!Number.isInteger(qtyDraft) || qtyDraft <= 0) {
      setWorkError("Quantity must be a positive whole number.");
      return;
    }

    if (qtyDraft === line.qty) {
      return;
    }

    setSavingLineId(line.id);
    setWorkError(null);

    try {
      const response = await apiPatch<WorkshopJobOverlayLineMutationResponse>(
        `/api/workshop/jobs/${encodeURIComponent(jobId)}/lines/${encodeURIComponent(line.id)}`,
        { qty: qtyDraft },
      );
      applyLineUpsert(response.line);
      success("Line quantity updated");
      refreshOverlayInBackground(setWorkError);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Unable to update line quantity";
      setWorkError(message);
      error(message);
    } finally {
      setSavingLineId(null);
    }
  };

  const removeLine = async (line: WorkshopJobOverlayLine) => {
    if (!jobId || removingLineId) {
      return;
    }

    setRemovingLineId(line.id);
    setWorkError(null);

    try {
      await apiDelete(`/api/workshop/jobs/${encodeURIComponent(jobId)}/lines/${encodeURIComponent(line.id)}`);
      applyLineRemoval(line.id);
      success("Line removed");
      refreshOverlayInBackground(setWorkError);
    } catch (removeError) {
      const message = removeError instanceof Error ? removeError.message : "Unable to remove line";
      setWorkError(message);
      error(message);
    } finally {
      setRemovingLineId(null);
    }
  };

  const renderWorkSectionContent = () => (
    <div className="workshop-os-job-workspace-section__stack">
      <div className="workshop-os-job-workspace-work-summary">
        <div>
          <span className="metric-label">Labour</span>
          <strong>{formatMoney(labourTotalPence)}</strong>
        </div>
        <div>
          <span className="metric-label">Parts</span>
          <strong>{formatMoney(partsTotalPence)}</strong>
        </div>
        <div>
          <span className="metric-label">Total</span>
          <strong>{formatMoney(workTotalPence)}</strong>
        </div>
      </div>

      <div className="workshop-os-job-workspace-work-actions">
        <button
          type="button"
          onClick={() => {
            setShowPartComposer((current) => !current);
            setShowLabourComposer(false);
            setWorkError(null);
          }}
          disabled={addingPart || addingLabour}
        >
          + Add part
        </button>
        <button
          type="button"
          onClick={() => {
            setShowLabourComposer((current) => !current);
            setShowPartComposer(false);
            setWorkError(null);
          }}
          disabled={addingPart || addingLabour}
        >
          + Add labour
        </button>
      </div>

      {showPartComposer ? (
        <div className="workshop-os-job-workspace-composer">
          <label className="workshop-os-overlay-next-action__field">
            <span className="metric-label">Search part</span>
            <input
              type="search"
              value={partSearch}
              onChange={(event) => setPartSearch(event.target.value)}
              placeholder="Search product or SKU"
              disabled={addingPart}
            />
          </label>
          {partSearch.trim() ? (
            partResults.length ? (
              <div className="workshop-os-job-workspace-search-results">
                {partResults.slice(0, 6).map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    className="workshop-os-job-workspace-search-result"
                    onClick={() => void addPartLine(product)}
                    disabled={addingPart}
                  >
                    <strong>{product.name}</strong>
                    <span className="table-secondary">
                      {product.sku} · {formatMoney(product.pricePence)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="workshop-os-empty-card">No parts matched that search yet.</div>
            )
          ) : (
            <div className="workshop-os-empty-card">Start typing to search workshop parts.</div>
          )}
        </div>
      ) : null}

      {showLabourComposer ? (
        <div className="workshop-os-job-workspace-composer">
          <div className="workshop-os-job-workspace-composer__inputs">
            <label className="workshop-os-overlay-next-action__field">
              <span className="metric-label">Labour description</span>
              <input
                type="text"
                value={labourDescriptionDraft}
                onChange={(event) => setLabourDescriptionDraft(event.target.value)}
                placeholder="Workshop labour"
                disabled={addingLabour}
              />
            </label>
            <label className="workshop-os-overlay-next-action__field">
              <span className="metric-label">Unit price (£)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={labourPriceDraft}
                onChange={(event) => setLabourPriceDraft(event.target.value)}
                placeholder="25.00"
                disabled={addingLabour}
              />
            </label>
          </div>
          <div className="workshop-os-job-workspace-work-actions">
            <button type="button" className="primary" onClick={() => void addLabourLine()} disabled={addingLabour}>
              {addingLabour ? "Saving..." : "+ Add labour"}
            </button>
          </div>
        </div>
      ) : null}

      {workError ? (
        <div className="restricted-panel warning-panel">
          <strong>Unable to update work lines</strong>
          <div className="table-secondary">{workError}</div>
        </div>
      ) : null}

      {lines.length ? (
        <div className="workshop-os-job-workspace-lines">
          {labourLines.length ? (
            <div className="workshop-os-job-workspace-lines-group">
              <div className="workshop-os-job-workspace-lines-group__heading">
                <strong>Labour</strong>
                <span className="table-secondary">{labourLines.length} line{labourLines.length === 1 ? "" : "s"}</span>
              </div>
              {labourLines.map((line) => (
                <article key={line.id} className="workshop-os-job-workspace-line">
                  <div className="workshop-os-job-workspace-line__summary">
                    <strong>{line.description}</strong>
                    <span className="table-secondary">{formatMoney(line.unitPricePence)} each</span>
                  </div>
                  <div className="workshop-os-job-workspace-line__controls">
                    <label className="workshop-os-overlay-next-action__field workshop-os-job-workspace-line__qty-field">
                      <span className="metric-label">Qty</span>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={lineQtyDrafts[line.id] ?? `${line.qty}`}
                        onChange={(event) =>
                          setLineQtyDrafts((current) => ({ ...current, [line.id]: event.target.value }))
                        }
                        disabled={savingLineId === line.id || removingLineId === line.id}
                      />
                    </label>
                    <strong className="workshop-os-job-workspace-line__total">{formatMoney(line.lineTotalPence)}</strong>
                    <button
                      type="button"
                      onClick={() => void saveLineQty(line)}
                      disabled={
                        savingLineId === line.id
                        || removingLineId === line.id
                        || Number(lineQtyDrafts[line.id] ?? `${line.qty}`) === line.qty
                      }
                    >
                      {savingLineId === line.id ? "Saving..." : "Update qty"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeLine(line)}
                      disabled={savingLineId === line.id || removingLineId === line.id}
                    >
                      {removingLineId === line.id ? "Removing..." : "Remove"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}

          {partLines.length ? (
            <div className="workshop-os-job-workspace-lines-group">
              <div className="workshop-os-job-workspace-lines-group__heading">
                <strong>Parts</strong>
                <span className="table-secondary">{partLines.length} line{partLines.length === 1 ? "" : "s"}</span>
              </div>
              {partLines.map((line) => (
                <article key={line.id} className="workshop-os-job-workspace-line">
                  <div className="workshop-os-job-workspace-line__summary">
                    <strong>{line.productName || line.description}</strong>
                    <span className="table-secondary">
                      {[line.variantName, line.variantSku].filter(Boolean).join(" · ") || formatMoney(line.unitPricePence)}
                    </span>
                  </div>
                  <div className="workshop-os-job-workspace-line__controls">
                    <label className="workshop-os-overlay-next-action__field workshop-os-job-workspace-line__qty-field">
                      <span className="metric-label">Qty</span>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={lineQtyDrafts[line.id] ?? `${line.qty}`}
                        onChange={(event) =>
                          setLineQtyDrafts((current) => ({ ...current, [line.id]: event.target.value }))
                        }
                        disabled={savingLineId === line.id || removingLineId === line.id}
                      />
                    </label>
                    <strong className="workshop-os-job-workspace-line__total">{formatMoney(line.lineTotalPence)}</strong>
                    <button
                      type="button"
                      onClick={() => void saveLineQty(line)}
                      disabled={
                        savingLineId === line.id
                        || removingLineId === line.id
                        || Number(lineQtyDrafts[line.id] ?? `${line.qty}`) === line.qty
                      }
                    >
                      {savingLineId === line.id ? "Saving..." : "Update qty"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeLine(line)}
                      disabled={savingLineId === line.id || removingLineId === line.id}
                    >
                      {removingLineId === line.id ? "Removing..." : "Remove"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="workshop-os-empty-card">No labour or part lines have been added yet.</div>
      )}
    </div>
  );

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

  const assignedTechnicianLabel = overlayJob?.assignedStaffName || summary?.assignedStaffName || "Not assigned yet";
  const promiseDateLabel = formatPromiseDate(overlayJob?.scheduledDate || summary?.scheduledDate || null);
  const scheduleWindowLabel = formatScheduleWindow(
    overlayJob?.scheduledStartAt || summary?.scheduledStartAt || null,
    overlayJob?.scheduledEndAt || summary?.scheduledEndAt || null,
    timeZone,
  );
  const hasBookingCommitment = Boolean(overlayJob?.scheduledStartAt || summary?.scheduledStartAt || overlayJob?.scheduledDate || summary?.scheduledDate);
  const workValueLabel = details?.currentEstimate
    ? `Quoted ${formatMoney(details.currentEstimate.subtotalPence)}`
    : lines.length
      ? `Current work ${formatMoney(workTotalPence)}`
      : "No price yet";
  const workSummaryText = issueSummary
    ? truncateText(issueSummary, 120)
    : lines.length
      ? "Labour and parts lines are in place. Open Work for full line detail."
      : "No work summary has been added yet.";
  const planningSignals = [
    approvalSignal.label !== "Not awaiting approval" ? approvalSignal : null,
    partsSignal.label !== "No parts planned" ? partsSignal : null,
    urgency
      ? {
          label: urgency.label,
          detail: "The promise date already needs attention while this job is still being booked.",
          className: urgency.className,
        }
      : null,
  ].filter((signal): signal is WorkshopOverviewSignal => Boolean(signal));
  const collectionSignal = overlayJob?.sale
    ? {
        title: "Collection handoff",
        detail: "Sale is already linked for collection.",
      }
    : overlayJob?.finalizedBasketId
      ? {
          title: "Collection handoff",
          detail: "POS handoff basket is ready.",
        }
      : null;
  const scheduleDraftDurationMinutes = minutesBetweenTimes(scheduleDraft.startTime, scheduleDraft.endTime);
  const selectedScheduleDateKey = scheduleDraft.dateKey;
  const scheduleSnapshotTimeZone = scheduleDaySnapshot?.range.timeZone || timeZone;
  const selectedScheduleDay = scheduleDaySnapshot?.days.find((day) => day.date === selectedScheduleDateKey) ?? null;
  const scheduleDayCapacitySummary = useMemo(() => {
    if (!selectedScheduleDateKey || !scheduleDaySnapshot) {
      return null;
    }

    return scheduleDaySnapshot.staff.reduce(
      (totals, staffMember) => {
        const dayCapacity = staffMember.dailyCapacity.find((entry) => entry.date === selectedScheduleDateKey);
        if (!dayCapacity) {
          return totals;
        }

        return {
          totalMinutes: totals.totalMinutes + dayCapacity.totalMinutes,
          bookedMinutes: totals.bookedMinutes + dayCapacity.bookedMinutes,
          availableMinutes: totals.availableMinutes + dayCapacity.availableMinutes,
          timeOffMinutes: totals.timeOffMinutes + dayCapacity.timeOffMinutes,
        };
      },
      {
        totalMinutes: 0,
        bookedMinutes: 0,
        availableMinutes: 0,
        timeOffMinutes: 0,
      },
    );
  }, [scheduleDaySnapshot, selectedScheduleDateKey]);
  const selectedScheduleJobs = useMemo(
    () => (
      [...(scheduleDaySnapshot?.scheduledJobs ?? []), ...(scheduleDaySnapshot?.unassignedJobs ?? [])]
        .filter((job) => toSnapshotJobDateKey(job, scheduleSnapshotTimeZone) === selectedScheduleDateKey)
        .sort((left, right) =>
          toSnapshotJobSortKey(left) - toSnapshotJobSortKey(right)
          || (left.assignedStaffName || "").localeCompare(right.assignedStaffName || "")
          || getSnapshotJobHeading(left).localeCompare(getSnapshotJobHeading(right))
        )
    ),
    [scheduleDaySnapshot?.scheduledJobs, scheduleDaySnapshot?.unassignedJobs, scheduleSnapshotTimeZone, selectedScheduleDateKey],
  );
  const groupedScheduleJobs = useMemo(() => {
    const groups = new Map<string, WorkshopJobOverlayDaySnapshotJob[]>();

    selectedScheduleJobs.forEach((job) => {
      const key = job.assignedStaffName?.trim() || "Unassigned";
      const existing = groups.get(key) ?? [];
      existing.push(job);
      groups.set(key, existing);
    });

    return Array.from(groups.entries()).map(([label, jobs]) => ({
      label,
      jobs,
    }));
  }, [selectedScheduleJobs]);
  const currentJobScheduledDateKey =
    toDateInputValue(overlayJob?.scheduledStartAt || summary?.scheduledStartAt || null, scheduleSnapshotTimeZone)
    || null;
  const currentJobAppearsOnSelectedDay = currentJobScheduledDateKey === selectedScheduleDateKey;

  const renderOverviewHeader = () => (
    <section className="workshop-os-overview-header">
      <div className="workshop-os-overview-header__identity">
        <p className="ui-page-eyebrow">{overviewMode === "planning" ? "Planning Overview" : "Operational Overview"}</p>
        <h3>{displayBikeDescription}</h3>
        <p className="table-secondary">
          {displayCustomerName} · <span className="mono-text">{jobId.slice(0, 8)}</span>
        </p>
      </div>
      <div className="workshop-os-overview-header__signals">
        <span className={workshopRawStatusClass(displayStatus)}>{workshopRawStatusLabel(displayStatus)}</span>
        <span className={displayWorkflowSummary.className}>{displayWorkflowSummary.label}</span>
        {overviewMode === "planning" ? <span className="status-badge">Needs booking</span> : null}
        {urgency ? <span className={urgency.className}>{urgency.label}</span> : null}
      </div>
    </section>
  );

  const renderPlanningOverview = () => (
    <>
      <section className="workshop-os-overview-planning">
        <div className="workshop-os-overview-planning__copy">
          <p className="ui-page-eyebrow">Book This Job</p>
          <h3>{hasBookingCommitment || assignedTechnicianLabel !== "Not assigned yet" ? "Finish workshop booking" : "Set workshop booking"}</h3>
          <p className="table-secondary">
            Start with when the job is being booked and who owns it, then sense-check the work and likely price.
          </p>
        </div>
        <div className="workshop-os-overview-planning__actions">
          <button type="button" className="primary" onClick={() => setActiveTab("schedule")}>
            {hasBookingCommitment || assignedTechnicianLabel !== "Not assigned yet" ? "Finish booking details" : "Set booking details"}
          </button>
          <button type="button" onClick={() => setActiveTab("work")}>
            {lines.length || details?.currentEstimate ? "Review work and price" : "Add work details"}
          </button>
        </div>
        <div className="workshop-os-overview-planning__grid">
          <article className="workshop-os-overview-card">
            <span className="metric-label">When is this being booked?</span>
            <strong>{hasBookingCommitment ? scheduleWindowLabel : "Not booked into the workshop yet"}</strong>
            <p>{hasBookingCommitment ? `Promise ${promiseDateLabel}` : "Set a promise date or slot so the job can be placed on the board."}</p>
          </article>
          <article className="workshop-os-overview-card">
            <span className="metric-label">Who is doing it?</span>
            <strong>{assignedTechnicianLabel}</strong>
            <p>{assignedTechnicianLabel === "Not assigned yet" ? "Choose technician ownership before the job drops into normal bench flow." : "Assignment is in place, but booking detail may still need finishing."}</p>
          </article>
          <article className="workshop-os-overview-card">
            <span className="metric-label">What work and likely price?</span>
            <strong>{workValueLabel}</strong>
            <p>{workSummaryText}</p>
            <div className="workshop-os-overview-card__meta">
              {details?.currentEstimate?.lineCount
                ? <span>{details.currentEstimate.lineCount} quoted line{details.currentEstimate.lineCount === 1 ? "" : "s"}</span>
                : null}
              {lines.length ? <span>{lines.length} live work line{lines.length === 1 ? "" : "s"}</span> : null}
              {!lines.length && !details?.currentEstimate ? <span>Add labour or parts to shape the job.</span> : null}
            </div>
          </article>
        </div>
        {planningSignals.length ? (
          <div className="workshop-os-overview-planning__notes">
            {planningSignals.map((signal) => (
              <article key={`${signal.label}:${signal.detail}`} className="workshop-os-overview-note">
                <div className="workshop-os-overview-header__signals">
                  <span className={signal.className}>{signal.label}</span>
                </div>
                <p className="table-secondary">{signal.detail}</p>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </>
  );

  const renderOperationalOverview = () => (
    <>
      <section className="workshop-os-overlay-next-action">
        <div className="workshop-os-overlay-next-action__copy">
          <p className="ui-page-eyebrow">Next Action</p>
          <h3>{nextAction.title}</h3>
          <p className="table-secondary">{nextAction.body || getNextStepHint(summary)}</p>
        </div>
        {primaryAction ? (
          <div className="workshop-os-overlay-next-action__buttons">
            <button
              type="button"
              className="primary"
              onClick={() => void runQuickAction()}
              disabled={savingAnyAction}
            >
              {savingQuickAction ? "Saving..." : primaryAction.label}
            </button>
          </div>
        ) : null}
        {secondaryActions.length ? (
          <div className="workshop-os-overlay-next-action__secondary">
            <span className="metric-label">Other workflow actions</span>
            <div className="workshop-os-overlay-next-action__secondary-buttons">
              {secondaryActions.map((action) => (
                <button
                  key={`${action.kind}:${action.value}`}
                  type="button"
                  onClick={() => void runSecondaryAction(action)}
                  disabled={savingAnyAction}
                >
                  {savingStatus ? "Saving..." : action.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="workshop-os-overlay-next-action__highlights">
          <div className="workshop-os-overlay-next-action__highlight workshop-os-overlay-next-action__highlight--blocker">
            <span className="metric-label">Current blocker</span>
            <strong>{displayWorkflowSummary.blockerLabel}</strong>
            <span className="table-secondary">{displayWorkflowSummary.detail}</span>
          </div>
          <div className="workshop-os-overlay-next-action__highlight">
            <span className="metric-label">Approval</span>
            <strong>{approvalSignal.label}</strong>
            <span className="table-secondary">{approvalSignal.detail}</span>
          </div>
          <div className="workshop-os-overlay-next-action__highlight">
            <span className="metric-label">Parts</span>
            <strong>{partsSignal.label}</strong>
            <span className="table-secondary">{partsSignal.detail}</span>
          </div>
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
      </section>

      <section className="workshop-os-overview-operational">
        <article className="workshop-os-overview-card">
          <span className="metric-label">Who and when</span>
          <strong>{assignedTechnicianLabel}</strong>
          <p>{scheduleWindowLabel}</p>
          <div className="workshop-os-overview-card__meta">
            <span>Promise {promiseDateLabel}</span>
            {urgency ? <span>{urgency.label}</span> : null}
          </div>
        </article>
        <article className="workshop-os-overview-card">
          <span className="metric-label">Work summary</span>
          <strong>{workValueLabel}</strong>
          <p>{workSummaryText}</p>
          <div className="workshop-os-overview-card__meta">
            {details?.currentEstimate ? <span>{approvalSignal.label}</span> : null}
            {lines.length ? <span>{lines.length} live work line{lines.length === 1 ? "" : "s"}</span> : <span>No live work lines yet</span>}
          </div>
        </article>
        {collectionSignal ? (
          <article className="workshop-os-overview-card">
            <span className="metric-label">{collectionSignal.title}</span>
            <strong>{overlayJob?.sale ? formatMoney(overlayJob.sale.totalPence) : "Ready in POS"}</strong>
            <p>{collectionSignal.detail}</p>
          </article>
        ) : null}
      </section>
    </>
  );

  const renderOverviewTab = () => (
    <div className="workshop-os-modal__panel">
      {renderOverviewHeader()}
      {overviewMode === "planning" ? renderPlanningOverview() : renderOperationalOverview()}
    </div>
  );

  const renderWorkTab = () => (
    <div className="workshop-os-modal__panel">
      <section className="workshop-os-drawer__section workshop-os-job-workspace-section">
        <div className="workshop-os-job-workspace-section__toggle-copy">
          <strong>Work</strong>
          <span className="table-secondary">Parts and labour lines for the job, with quick add and quantity updates.</span>
        </div>
        <div className="workshop-os-job-workspace-section__body">
          {renderWorkSectionContent()}
        </div>
      </section>

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
    </div>
  );

  const renderScheduleTab = () => (
    <div className="workshop-os-modal__panel">
      <section className="workshop-os-drawer__section workshop-os-job-workspace-section">
        <div className="workshop-os-job-workspace-section__toggle-copy">
          <strong>Schedule</strong>
          <span className="table-secondary">Set the slot first, check the day, then assign the technician.</span>
        </div>
        <div className="workshop-os-job-workspace-section__body workshop-os-modal__schedule-stack">
          <div className="workshop-os-schedule-surface">
            <div className="workshop-os-schedule-surface__action-column">
              <div className="workshop-os-job-workspace-section__detail-card workshop-os-schedule-surface__card">
                <div className="workshop-os-schedule-surface__header">
                  <div>
                    <strong>Booking</strong>
                    <span className="table-secondary">Choose the workshop day and timed slot for this job.</span>
                  </div>
                  <div className="workshop-os-job-workspace-section__meta-list">
                    <span>{formatDateKeyLabel(selectedScheduleDateKey, scheduleSnapshotTimeZone)}</span>
                    <span>{scheduleDraftDurationMinutes ? `${scheduleDraftDurationMinutes} min` : "Pick a valid slot"}</span>
                  </div>
                </div>

                <div className="workshop-os-schedule-surface__inputs">
                  <label>
                    <span className="metric-label">Day</span>
                    <input
                      type="date"
                      value={scheduleDraft.dateKey}
                      onChange={(event) => updateScheduleDraftField("dateKey", event.target.value)}
                      disabled={savingSchedule}
                    />
                  </label>
                  <label>
                    <span className="metric-label">Start</span>
                    <input
                      type="time"
                      value={scheduleDraft.startTime}
                      onChange={(event) => updateScheduleDraftField("startTime", event.target.value)}
                      disabled={savingSchedule}
                    />
                  </label>
                  <label>
                    <span className="metric-label">End</span>
                    <input
                      type="time"
                      value={scheduleDraft.endTime}
                      onChange={(event) => updateScheduleDraftField("endTime", event.target.value)}
                      disabled={savingSchedule}
                    />
                  </label>
                </div>

                {scheduleError ? (
                  <div className="restricted-panel warning-panel">
                    {scheduleError}
                  </div>
                ) : null}

                <div className="workshop-os-schedule-surface__actions">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => void saveSchedule()}
                    disabled={savingSchedule || !canSaveScheduleDraft}
                  >
                    {savingSchedule ? "Confirming..." : "Confirm"}
                  </button>
                  <span className="table-secondary">
                    {hasTimedBooking
                      ? `Current slot: ${scheduleWindowLabel}`
                      : hasBookingCommitment
                        ? `Promise date: ${promiseDateLabel}`
                        : "No timed booking is saved yet."}
                  </span>
                </div>
              </div>

              <div className="workshop-os-job-workspace-section__detail-card workshop-os-schedule-surface__card">
                <div className="workshop-os-schedule-surface__header">
                  <div>
                    <strong>Assign technician</strong>
                    <span className="table-secondary">Set bench ownership once the booking slot looks right.</span>
                  </div>
                  <div className="workshop-os-job-workspace-section__meta-list">
                    <span>{assignedTechnicianLabel}</span>
                    <span>{displayWorkflowSummary.label}</span>
                  </div>
                </div>

                {canAssignTechnician ? (
                  <div className="workshop-os-modal__assignment-controls">
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
                    <div className="workshop-os-schedule-surface__actions">
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
                      <span className="table-secondary">
                        {assignedTechnicianLabel === "Not assigned yet"
                          ? "No technician is currently holding this booking."
                          : `Currently assigned to ${assignedTechnicianLabel}.`}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="workshop-os-empty-card">Technician assignment is not available for this job.</div>
                )}

                {actionError ? (
                  <div className="restricted-panel warning-panel">
                    <strong>Unable to complete scheduling action</strong>
                    <div className="table-secondary">{actionError}</div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="workshop-os-schedule-surface__reference-column">
              <div className="workshop-os-job-workspace-section__detail-card workshop-os-schedule-day-snapshot">
                <div className="workshop-os-schedule-surface__header">
                  <div>
                    <strong>Selected day snapshot</strong>
                    <span className="table-secondary">Check the shape of the day before you confirm the booking.</span>
                  </div>
                  <div className="workshop-os-job-workspace-section__meta-list">
                    <span>{formatDateKeyLabel(selectedScheduleDateKey, scheduleSnapshotTimeZone)}</span>
                    {selectedScheduleDay?.isClosed
                      ? <span>{selectedScheduleDay.closedReason || "Closed"}</span>
                      : selectedScheduleDay?.opensAt && selectedScheduleDay?.closesAt
                        ? <span>{selectedScheduleDay.opensAt} - {selectedScheduleDay.closesAt}</span>
                        : null}
                    {scheduleDayCapacitySummary?.totalMinutes
                      ? <span>{scheduleDayCapacitySummary.bookedMinutes} / {scheduleDayCapacitySummary.totalMinutes} mins booked</span>
                      : null}
                    <span>{selectedScheduleJobs.length} booked job{selectedScheduleJobs.length === 1 ? "" : "s"}</span>
                  </div>
                </div>

                <div className="table-secondary">
                  {currentJobAppearsOnSelectedDay
                    ? "This job is already on the selected day."
                    : "Existing jobs for the selected day are listed below."}
                </div>

                <div className="workshop-os-schedule-day-snapshot__body">
                  {loadingScheduleDaySnapshot ? (
                    <div className="workshop-os-empty-card">Loading selected day…</div>
                  ) : scheduleDaySnapshotError ? (
                    <div className="restricted-panel warning-panel">
                      {scheduleDaySnapshotError}
                    </div>
                  ) : selectedScheduleDay?.isClosed ? (
                    <div className="workshop-os-empty-card">
                      {selectedScheduleDay.closedReason || "Workshop is closed on the selected day."}
                    </div>
                  ) : groupedScheduleJobs.length === 0 ? (
                    <div className="workshop-os-empty-card">No jobs booked for this day yet.</div>
                  ) : (
                    <div className="workshop-os-schedule-day-snapshot__groups">
                      {groupedScheduleJobs.map((group) => (
                        <section key={group.label} className="workshop-os-schedule-day-snapshot__group">
                          <div className="workshop-os-schedule-day-snapshot__group-header">
                            <strong>{group.label}</strong>
                            <span className="stock-badge stock-muted">{group.jobs.length}</span>
                          </div>
                          <div className="workshop-os-job-workspace-section__list">
                            {group.jobs.map((job) => {
                              const isCurrentJob = job.id === jobId;
                              const timeLabel = [
                                formatOptionalTime(job.scheduledStartAt, scheduleSnapshotTimeZone) || "--:--",
                                formatOptionalTime(job.scheduledEndAt, scheduleSnapshotTimeZone) || "--:--",
                              ].join(" - ");

                              return (
                                <article
                                  key={job.id}
                                  className={`workshop-os-job-workspace-section__list-item${isCurrentJob ? " workshop-os-schedule-day-snapshot__item--current" : ""}`}
                                >
                                  <div className="workshop-os-schedule-day-snapshot__item-row">
                                    <div>
                                      <strong>{timeLabel}</strong>
                                      <p className="muted-text">{getSnapshotJobHeading(job)}</p>
                                    </div>
                                    <div className="workshop-os-overview-header__signals">
                                      {isCurrentJob ? <span className="status-badge status-info">This job</span> : null}
                                      <span className={workshopRawStatusClass(job.rawStatus)}>{workshopRawStatusLabel(job.rawStatus)}</span>
                                    </div>
                                  </div>
                                  <p className="muted-text">{getSnapshotJobSubline(job)}</p>
                                </article>
                              );
                            })}
                          </div>
                        </section>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );

  const renderActivityTab = () => (
    <div className="workshop-os-modal__panel">
      {renderSection(
        "jobDetails",
        "Activity",
        "Issue summary and key timestamps.",
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
        "notes",
        "Notes",
        "Internal and customer-visible notes.",
        <div className="workshop-os-job-workspace-section__stack">
          {notes.length ? (
            <div className="workshop-os-job-workspace-section__list">
              {notes.slice(0, 8).map((note) => (
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
        "Photos and files linked to this job.",
        <div className="workshop-os-job-workspace-section__stack">
          {attachments.length ? (
            <div className="workshop-os-job-workspace-section__list">
              {attachments.slice(0, 8).map((attachment) => (
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
        <div className="workshop-os-modal__header">
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
        </div>

        <div className="workshop-os-modal__tabs" role="tablist" aria-label="Workshop job workspace tabs">
          {WORKSHOP_OVERLAY_TABS.map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              className={`workshop-os-modal__tab${activeTab === tab ? " workshop-os-modal__tab--active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="workshop-os-modal__content">
          {loading ? (
            <div className="workshop-os-empty-card">Loading job card…</div>
          ) : null}

          {loadError ? (
            <div className="restricted-panel warning-panel">
              <strong>Job card data is partially unavailable</strong>
              <div className="table-secondary">{loadError}</div>
            </div>
          ) : null}
          {activeTab === "schedule" ? renderScheduleTab() : null}
          {activeTab === "work" ? renderWorkTab() : null}
          {activeTab === "overview" ? renderOverviewTab() : null}
          {activeTab === "activity" ? renderActivityTab() : null}
        </div>

        <div className="workshop-os-modal__footer">
          <div className={`workshop-os-modal__footer-message workshop-os-modal__footer-message--${footerMessageTone}`}>
            {footerMessage || <span aria-hidden="true"> </span>}
          </div>
          <div className="workshop-os-modal__footer-actions">
            <Link to={openPath} className="button-link">
              Open full job
            </Link>
          </div>
        </div>
      </aside>
    </div>
  );
};
