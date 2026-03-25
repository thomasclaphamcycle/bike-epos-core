import { WorkshopJobStatus } from "@prisma/client";
import { HttpError } from "../utils/http";

export type WorkshopExecutionStatus =
  | "BOOKED"
  | "IN_PROGRESS"
  | "READY"
  | "COLLECTED"
  | "CLOSED";

export const parseWorkshopRawStatusAlias = (
  value: string,
): WorkshopJobStatus | null => {
  const normalized = value.trim().toUpperCase();
  switch (normalized) {
    case "BOOKED":
    case "BOOKING_MADE":
      return "BOOKED";
    case "BIKE_ARRIVED":
      return "BIKE_ARRIVED";
    case "IN_PROGRESS":
      return "IN_PROGRESS";
    case "APPROVED":
      return "BIKE_ARRIVED";
    case "WAITING_FOR_APPROVAL":
      return "WAITING_FOR_APPROVAL";
    case "WAITING_FOR_PARTS":
      return "WAITING_FOR_PARTS";
    case "ON_HOLD":
      return "ON_HOLD";
    case "READY":
    case "BIKE_READY":
    case "READY_FOR_COLLECTION":
      return "READY_FOR_COLLECTION";
    case "COMPLETED":
    case "COLLECTED":
    case "CLOSED":
      return "COMPLETED";
    case "CANCELLED":
      return "CANCELLED";
    default:
      return null;
  }
};

export const parseWorkshopExecutionStatus = (
  value: string,
): WorkshopExecutionStatus => {
  const normalized = value.trim().toUpperCase();
  switch (normalized) {
    case "BOOKED":
      return "BOOKED";
    case "IN_PROGRESS":
      return "IN_PROGRESS";
    case "READY":
      return "READY";
    case "COLLECTED":
      return "COLLECTED";
    case "CLOSED":
      return "CLOSED";
    default:
      throw new HttpError(
        400,
        "status must be BOOKED, IN_PROGRESS, READY, COLLECTED, or CLOSED",
        "INVALID_WORKSHOP_STATUS",
      );
  }
};

export const toWorkshopJobStatus = (
  status: WorkshopExecutionStatus,
): WorkshopJobStatus => {
  switch (status) {
    case "BOOKED":
      return "BOOKED";
    case "IN_PROGRESS":
      return "IN_PROGRESS";
    case "READY":
      return "READY_FOR_COLLECTION";
    case "COLLECTED":
      return "COMPLETED";
    case "CLOSED":
      return "COMPLETED";
  }
};

export const toWorkshopExecutionStatus = (job: {
  status: WorkshopJobStatus;
  closedAt: Date | null;
}): WorkshopExecutionStatus => {
  if (job.closedAt) {
    return "CLOSED";
  }

  switch (job.status) {
    case "BOOKED":
    case "BIKE_ARRIVED":
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
