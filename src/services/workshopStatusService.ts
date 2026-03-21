import { WorkshopJobStatus } from "@prisma/client";
import { HttpError } from "../utils/http";

export type WorkshopExecutionStatus =
  | "BOOKED"
  | "IN_PROGRESS"
  | "READY"
  | "COLLECTED"
  | "CLOSED";

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
      return "BOOKING_MADE";
    case "IN_PROGRESS":
      return "BIKE_ARRIVED";
    case "READY":
      return "BIKE_READY";
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
    case "BOOKING_MADE":
      return "BOOKED";
    case "BIKE_READY":
      return "READY";
    case "COMPLETED":
      return "COLLECTED";
    case "CANCELLED":
      return "CLOSED";
    default:
      return "IN_PROGRESS";
  }
};
