import {
  getWorkshopDisplayStatus,
  getWorkshopRawStatusValue,
  getWorkshopTechnicianWorkflowSummary,
} from "./status";

export const statusOptions = [
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

export type QuickFilterKey =
  | "ALL"
  | "MY_JOBS"
  | "DUE_TODAY"
  | "OVERDUE"
  | "WAITING_FOR_PARTS"
  | "READY_FOR_COLLECTION"
  | "COMPLETED";

export type QuickAction = {
  label: string;
  kind: "status" | "approval" | "navigate";
  value: string;
};

export type DashboardJob = {
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

export type DashboardResponse = {
  jobs: DashboardJob[];
};

export type TechnicianOption = {
  id: string;
  name: string;
};

export type WorkshopPartsStatus = "OK" | "UNALLOCATED" | "SHORT";

export type WorkshopBoardInsight = {
  job: DashboardJob;
  displayStatus: ReturnType<typeof getWorkshopDisplayStatus>;
  workflowSummary: ReturnType<typeof getWorkshopTechnicianWorkflowSummary>;
  urgency: ReturnType<typeof getUrgency>;
  partsStatus: WorkshopPartsStatus;
};

export type WorkshopBoardSummary = {
  waitingApprovalCount: number;
  activeBenchCount: number;
  waitingPartsCount: number;
  readyCollectionCount: number;
  unscheduledCount: number;
  timedUnassignedCount: number;
};

export const quickFilters: Array<{
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
  { key: "COMPLETED", label: "Completed", description: "Collected work kept visible for pickup context and recent closeout." },
];

export const buildDashboardQuery = (input: {
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

export const getCustomerName = (job: DashboardJob) =>
  job.customer
    ? [job.customer.firstName, job.customer.lastName].filter(Boolean).join(" ") || "Customer linked"
    : "Customer pending";

export const formatDate = (value: string | null) => {
  if (!value) {
    return "Unscheduled";
  }
  return new Date(value).toLocaleDateString([], {
    day: "numeric",
    month: "short",
  });
};

export const formatDateTime = (value: string | null) => {
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

export const formatTimeRange = (job: DashboardJob) => {
  if (!job.scheduledStartAt) {
    return job.scheduledDate ? `Due ${formatDate(job.scheduledDate)}` : "Needs scheduling";
  }

  const start = new Date(job.scheduledStartAt);
  const end = job.scheduledEndAt ? new Date(job.scheduledEndAt) : null;
  const startLabel = start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const endLabel = end ? end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  return `${formatDate(job.scheduledStartAt)} · ${startLabel}${endLabel ? `-${endLabel}` : ""}`;
};

export const toPartsStatus = (job: DashboardJob): WorkshopPartsStatus => {
  if (job.partsStatus) {
    return job.partsStatus;
  }
  return getWorkshopDisplayStatus(job) === "WAITING_FOR_PARTS" ? "SHORT" : "OK";
};

export const getPartsClassName = (job: DashboardJob) => {
  switch (toPartsStatus(job)) {
    case "SHORT":
      return "parts-short";
    case "UNALLOCATED":
      return "parts-attention";
    default:
      return "parts-ok";
  }
};

export const isOpenWorkshopDisplayStatus = (status: string | null | undefined) => {
  const displayStatus = getWorkshopDisplayStatus(status);
  return displayStatus !== "COMPLETED" && displayStatus !== "CANCELLED";
};

export const getUrgency = (job: DashboardJob) => {
  const displayStatus = getWorkshopDisplayStatus(job);

  if (!job.scheduledDate || displayStatus === "COMPLETED" || displayStatus === "CANCELLED") {
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

export const compareJobs = (left: DashboardJob, right: DashboardJob) => {
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

export const matchesQuickFilter = (
  job: DashboardJob,
  filter: QuickFilterKey,
  currentUserId: string | null | undefined,
) => {
  const displayStatus = getWorkshopDisplayStatus(job);

  switch (filter) {
    case "MY_JOBS":
      return Boolean(currentUserId) && job.assignedStaffId === currentUserId;
    case "DUE_TODAY":
      return getUrgency(job)?.label === "Due Today";
    case "OVERDUE":
      return getUrgency(job)?.label === "Overdue";
    case "WAITING_FOR_PARTS":
      return displayStatus === "WAITING_FOR_PARTS" || toPartsStatus(job) === "SHORT";
    case "READY_FOR_COLLECTION":
      return displayStatus === "BIKE_READY";
    case "COMPLETED":
      return displayStatus === "COMPLETED";
    default:
      return true;
  }
};

export const getQuickActions = (job: DashboardJob): QuickAction[] => {
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

export const buildTechnicianOptions = (
  jobs: DashboardJob[],
  user: { id?: string | null; name?: string | null; role?: string | null; username?: string | null } | null | undefined,
): TechnicianOption[] => {
  const optionMap = new Map<string, string>();

  jobs.forEach((job) => {
    if (job.assignedStaffId && job.assignedStaffName) {
      optionMap.set(job.assignedStaffId, job.assignedStaffName);
    }
  });

  if (user?.id) {
    optionMap.set(user.id, user.name || user.username || "Current user");
  }

  const options = Array.from(optionMap)
    .map(([id, name]) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name));

  if (user?.role === "STAFF") {
    return options.filter((option) => option.id === user.id);
  }

  return options;
};

export const buildWorkshopVisibleInsights = (visibleJobs: DashboardJob[]): WorkshopBoardInsight[] =>
  [...visibleJobs]
    .sort(compareJobs)
    .map((job) => ({
      job,
      displayStatus: getWorkshopDisplayStatus(job),
      workflowSummary: getWorkshopTechnicianWorkflowSummary({
        rawStatus: getWorkshopRawStatusValue(job) ?? job.status,
        partsStatus: job.partsStatus,
        assignedStaffName: job.assignedStaffName,
        scheduledDate: job.scheduledDate,
        hasSale: Boolean(job.sale),
        hasBasket: Boolean(job.finalizedBasketId),
      }),
      urgency: getUrgency(job),
      partsStatus: toPartsStatus(job),
    }));

export const buildWorkshopBoardSummary = (visibleInsights: WorkshopBoardInsight[]): WorkshopBoardSummary => ({
  waitingApprovalCount: visibleInsights.filter((entry) => entry.displayStatus === "WAITING_FOR_APPROVAL").length,
  activeBenchCount: visibleInsights.filter((entry) =>
    entry.workflowSummary.stage === "READY_FOR_BENCH" || entry.workflowSummary.stage === "IN_REPAIR",
  ).length,
  waitingPartsCount: visibleInsights.filter((entry) =>
    entry.displayStatus === "WAITING_FOR_PARTS" || entry.partsStatus === "SHORT",
  ).length,
  readyCollectionCount: visibleInsights.filter((entry) => entry.displayStatus === "BIKE_READY").length,
  unscheduledCount: visibleInsights.filter((entry) =>
    isOpenWorkshopDisplayStatus(entry.job.status) && !entry.job.scheduledStartAt,
  ).length,
  timedUnassignedCount: visibleInsights.filter((entry) =>
    isOpenWorkshopDisplayStatus(entry.job.status) && Boolean(entry.job.scheduledStartAt) && !entry.job.assignedStaffId,
  ).length,
});
