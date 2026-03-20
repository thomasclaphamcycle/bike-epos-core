import { WorkshopJobStatus } from "@prisma/client";
import { HttpError } from "../utils/http";

export type WorkshopExecutionStatus =
  | "BOOKING_MADE"
  | "READY_FOR_WORK"
  | "IN_PROGRESS"
  | "PAUSED"
  | "WAITING_FOR_PARTS"
  | "READY_FOR_COLLECTION"
  | "COMPLETED"
  | "CANCELLED";

export type WorkflowStatus = "BOOKED" | "IN_PROGRESS" | "READY" | "COLLECTED" | "CLOSED";

const EXECUTION_STATUS_BY_DB_STATUS: Record<WorkshopJobStatus, WorkshopExecutionStatus> = {
  BOOKING_MADE: "BOOKING_MADE",
  READY_FOR_WORK: "READY_FOR_WORK",
  IN_PROGRESS: "IN_PROGRESS",
  PAUSED: "PAUSED",
  WAITING_FOR_PARTS: "WAITING_FOR_PARTS",
  READY_FOR_COLLECTION: "READY_FOR_COLLECTION",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  BIKE_ARRIVED: "IN_PROGRESS",
  WAITING_FOR_APPROVAL: "PAUSED",
  APPROVED: "READY_FOR_WORK",
  ON_HOLD: "PAUSED",
  BIKE_READY: "READY_FOR_COLLECTION",
};

const EXACT_DB_STATUSES = new Set<string>(Object.keys(EXECUTION_STATUS_BY_DB_STATUS));

const DB_STATUS_FILTERS_BY_EXECUTION_STATUS: Record<WorkshopExecutionStatus, WorkshopJobStatus[]> = {
  BOOKING_MADE: ["BOOKING_MADE"],
  READY_FOR_WORK: ["READY_FOR_WORK", "APPROVED"],
  IN_PROGRESS: ["IN_PROGRESS", "BIKE_ARRIVED"],
  PAUSED: ["PAUSED", "ON_HOLD", "WAITING_FOR_APPROVAL"],
  WAITING_FOR_PARTS: ["WAITING_FOR_PARTS"],
  READY_FOR_COLLECTION: ["READY_FOR_COLLECTION", "BIKE_READY"],
  COMPLETED: ["COMPLETED"],
  CANCELLED: ["CANCELLED"],
};

export const WORKSHOP_OPEN_DB_STATUSES: WorkshopJobStatus[] = [
  "BOOKING_MADE",
  "READY_FOR_WORK",
  "IN_PROGRESS",
  "PAUSED",
  "WAITING_FOR_PARTS",
  "READY_FOR_COLLECTION",
  "BIKE_ARRIVED",
  "WAITING_FOR_APPROVAL",
  "APPROVED",
  "ON_HOLD",
  "BIKE_READY",
];

export const WORKSHOP_ACTIVE_WORKLOAD_DB_STATUSES: WorkshopJobStatus[] = [
  "IN_PROGRESS",
  "WAITING_FOR_PARTS",
  "PAUSED",
  "READY_FOR_COLLECTION",
  "BIKE_ARRIVED",
  "APPROVED",
  "ON_HOLD",
  "BIKE_READY",
];

export const normalizeWorkshopExecutionStatus = (
  status: WorkshopJobStatus,
): WorkshopExecutionStatus => EXECUTION_STATUS_BY_DB_STATUS[status];

export const parseWorkshopExecutionStatusOrThrow = (
  inputStatus: string,
): WorkshopExecutionStatus => {
  const normalized = inputStatus.trim().toUpperCase();

  switch (normalized) {
    case "BOOKED":
    case "BOOKING_MADE":
      return "BOOKING_MADE";
    case "READY_FOR_WORK":
    case "CHECKED_IN":
      return "READY_FOR_WORK";
    case "IN_PROGRESS":
    case "START_WORK":
    case "BIKE_ARRIVED":
      return "IN_PROGRESS";
    case "PAUSED":
    case "ON_HOLD":
    case "WAITING_FOR_APPROVAL":
      return "PAUSED";
    case "WAITING_FOR_PARTS":
      return "WAITING_FOR_PARTS";
    case "READY":
    case "READY_FOR_COLLECTION":
    case "BIKE_READY":
      return "READY_FOR_COLLECTION";
    case "COMPLETED":
    case "COLLECTED":
    case "CLOSED":
      return "COMPLETED";
    case "CANCELLED":
      return "CANCELLED";
    case "APPROVED":
      return "READY_FOR_WORK";
    default:
      throw new HttpError(
        400,
        "status must be BOOKING_MADE, READY_FOR_WORK, IN_PROGRESS, PAUSED, WAITING_FOR_PARTS, READY_FOR_COLLECTION, COMPLETED, or CANCELLED",
        "INVALID_STATUS",
      );
  }
};

export const toStoredWorkshopJobStatus = (
  status: WorkshopExecutionStatus,
): WorkshopJobStatus => {
  switch (status) {
    case "BOOKING_MADE":
      return "BOOKING_MADE";
    case "READY_FOR_WORK":
      return "READY_FOR_WORK";
    case "IN_PROGRESS":
      return "IN_PROGRESS";
    case "PAUSED":
      return "PAUSED";
    case "WAITING_FOR_PARTS":
      return "WAITING_FOR_PARTS";
    case "READY_FOR_COLLECTION":
      return "READY_FOR_COLLECTION";
    case "COMPLETED":
      return "COMPLETED";
    case "CANCELLED":
      return "CANCELLED";
  }
};

export const expandWorkshopStatusFilter = (
  rawStatus: string,
): WorkshopJobStatus[] => {
  const normalized = rawStatus.trim().toUpperCase();

  if (EXACT_DB_STATUSES.has(normalized)) {
    return [normalized as WorkshopJobStatus];
  }

  switch (normalized) {
    case "BOOKED":
      return DB_STATUS_FILTERS_BY_EXECUTION_STATUS.BOOKING_MADE;
    case "CHECKED_IN":
      return DB_STATUS_FILTERS_BY_EXECUTION_STATUS.READY_FOR_WORK;
    case "START_WORK":
      return DB_STATUS_FILTERS_BY_EXECUTION_STATUS.IN_PROGRESS;
    case "READY":
      return DB_STATUS_FILTERS_BY_EXECUTION_STATUS.READY_FOR_COLLECTION;
    case "COLLECTED":
    case "CLOSED":
      return DB_STATUS_FILTERS_BY_EXECUTION_STATUS.COMPLETED;
    default: {
      const parsed = parseWorkshopExecutionStatusOrThrow(normalized);
      return DB_STATUS_FILTERS_BY_EXECUTION_STATUS[parsed];
    }
  }
};

export const toLegacyWorkflowStatus = (job: {
  status: WorkshopJobStatus;
  closedAt: Date | null;
}): WorkflowStatus => {
  if (job.closedAt) {
    return "CLOSED";
  }

  switch (normalizeWorkshopExecutionStatus(job.status)) {
    case "BOOKING_MADE":
      return "BOOKED";
    case "READY_FOR_COLLECTION":
      return "READY";
    case "COMPLETED":
      return "COLLECTED";
    case "CANCELLED":
      return "CLOSED";
    default:
      return "IN_PROGRESS";
  }
};
