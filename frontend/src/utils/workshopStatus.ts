type WorkshopStatusLike = {
  status?: string | null;
  executionStatus?: string | null;
  currentEstimateStatus?: string | null;
  partsStatus?: string | null;
};

const LEGACY_EXECUTION_STATUS_MAP: Record<string, string> = {
  BIKE_ARRIVED: "IN_PROGRESS",
  WAITING_FOR_APPROVAL: "PAUSED",
  APPROVED: "READY_FOR_WORK",
  ON_HOLD: "PAUSED",
  BIKE_READY: "READY_FOR_COLLECTION",
  READY: "READY_FOR_COLLECTION",
  COLLECTED: "COMPLETED",
  CLOSED: "COMPLETED",
};

export const getWorkshopExecutionStatus = (job: WorkshopStatusLike) => {
  if (job.executionStatus) {
    return job.executionStatus;
  }

  if (job.status) {
    return LEGACY_EXECUTION_STATUS_MAP[job.status] ?? job.status;
  }

  return null;
};

export const isWorkshopAwaitingApproval = (job: WorkshopStatusLike) =>
  job.currentEstimateStatus === "PENDING_APPROVAL" || job.status === "WAITING_FOR_APPROVAL";

export const hasWorkshopApprovedEstimate = (job: WorkshopStatusLike) =>
  job.currentEstimateStatus === "APPROVED" || job.status === "APPROVED";

export const isWorkshopWaitingForParts = (job: WorkshopStatusLike) =>
  getWorkshopExecutionStatus(job) === "WAITING_FOR_PARTS"
  || job.status === "WAITING_FOR_PARTS"
  || job.partsStatus === "SHORT";

export const isWorkshopReadyForCollection = (job: WorkshopStatusLike) =>
  getWorkshopExecutionStatus(job) === "READY_FOR_COLLECTION"
  || job.status === "BIKE_READY"
  || job.status === "READY_FOR_COLLECTION";

export const isWorkshopOpen = (job: WorkshopStatusLike) => {
  const executionStatus = getWorkshopExecutionStatus(job);
  return executionStatus !== "COMPLETED" && executionStatus !== "CANCELLED";
};

export const isWorkshopActiveExecution = (job: WorkshopStatusLike) => {
  const executionStatus = getWorkshopExecutionStatus(job);
  return executionStatus === "BOOKING_MADE"
    || executionStatus === "READY_FOR_WORK"
    || executionStatus === "IN_PROGRESS"
    || executionStatus === "PAUSED"
    || executionStatus === "WAITING_FOR_PARTS";
};

export const toWorkshopStatusBadgeClass = (job: WorkshopStatusLike) => {
  const executionStatus = getWorkshopExecutionStatus(job);
  if (executionStatus === "COMPLETED") return "status-badge status-complete";
  if (executionStatus === "CANCELLED") return "status-badge status-cancelled";
  if (isWorkshopReadyForCollection(job)) return "status-badge status-ready";
  if (isWorkshopAwaitingApproval(job) || isWorkshopWaitingForParts(job)) {
    return "status-badge status-warning";
  }
  return "status-badge status-info";
};
