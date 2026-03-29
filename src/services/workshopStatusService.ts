import { WorkshopJobStatus } from "@prisma/client";
import {
  getWorkshopDisplayStatusLabel,
  normalizeWorkshopDisplayStatus,
  toPersistedWorkshopStatusValue,
  type WorkshopDisplayStatus,
} from "../../shared/workshopStatus";
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
  const persisted = toPersistedWorkshopStatusValue(value);
  return (persisted as WorkshopJobStatus | null) ?? null;
};

export const toWorkshopDisplayStatus = (
  value: string | WorkshopJobStatus | null | undefined,
): WorkshopDisplayStatus | null => normalizeWorkshopDisplayStatus(value);

export const getWorkshopDisplayStatusOrFallback = (
  value: string | WorkshopJobStatus | null | undefined,
) => getWorkshopDisplayStatusLabel(value);

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

  switch (normalizeWorkshopDisplayStatus(job.status)) {
    case "BOOKED":
    case "BIKE_ARRIVED":
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

export const buildWorkshopStatusAuditMetadata = (input: {
  fromStatus: string | WorkshopJobStatus;
  toStatus: string | WorkshopJobStatus;
  requestedStatus?: string | null;
  changeSource: "MANUAL" | "AUTOMATIC";
  trigger: string;
}) => ({
  fromStatus: normalizeWorkshopDisplayStatus(input.fromStatus),
  toStatus: normalizeWorkshopDisplayStatus(input.toStatus),
  requestedStatus: input.requestedStatus ? normalizeWorkshopDisplayStatus(input.requestedStatus) ?? input.requestedStatus : null,
  persistedFromStatus: `${input.fromStatus}`,
  persistedToStatus: `${input.toStatus}`,
  changeSource: input.changeSource,
  trigger: input.trigger,
});
