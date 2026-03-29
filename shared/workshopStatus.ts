export const WORKSHOP_CANONICAL_STATUSES = [
  "BOOKED",
  "BIKE_ARRIVED",
  "WAITING_FOR_APPROVAL",
  "APPROVED",
  "WAITING_FOR_PARTS",
  "ON_HOLD",
  "BIKE_READY",
  "COMPLETED",
] as const;

export const WORKSHOP_EXCEPTIONAL_STATUSES = [
  "CANCELLED",
] as const;

export const WORKSHOP_ALL_DISPLAY_STATUSES = [
  ...WORKSHOP_CANONICAL_STATUSES,
  ...WORKSHOP_EXCEPTIONAL_STATUSES,
] as const;

export const WORKSHOP_STATUS_TIMELINE = [
  "BOOKED",
  "BIKE_ARRIVED",
  "WAITING_FOR_APPROVAL",
  "APPROVED",
  "WAITING_FOR_PARTS",
  "ON_HOLD",
  "BIKE_READY",
  "COMPLETED",
] as const;

export type WorkshopCanonicalStatus = typeof WORKSHOP_CANONICAL_STATUSES[number];
export type WorkshopExceptionalStatus = typeof WORKSHOP_EXCEPTIONAL_STATUSES[number];
export type WorkshopDisplayStatus = typeof WORKSHOP_ALL_DISPLAY_STATUSES[number];
export type WorkshopTimelineStatus = typeof WORKSHOP_STATUS_TIMELINE[number];
export type WorkshopStatusTone =
  | "booked"
  | "arrived"
  | "approval"
  | "approved"
  | "parts"
  | "ready"
  | "completed"
  | "hold"
  | "cancelled";

const WORKSHOP_STATUS_ALIASES: Record<string, WorkshopDisplayStatus> = {
  BOOKING_MADE: "BOOKED",
  BOOKED: "BOOKED",
  BIKE_ARRIVED: "BIKE_ARRIVED",
  WAITING_FOR_APPROVAL: "WAITING_FOR_APPROVAL",
  IN_PROGRESS: "APPROVED",
  APPROVED: "APPROVED",
  WAITING_FOR_PARTS: "WAITING_FOR_PARTS",
  READY: "BIKE_READY",
  BIKE_READY: "BIKE_READY",
  READY_FOR_COLLECTION: "BIKE_READY",
  COMPLETED: "COMPLETED",
  COLLECTED: "COMPLETED",
  CLOSED: "COMPLETED",
  ON_HOLD: "ON_HOLD",
  CANCELLED: "CANCELLED",
};

const WORKSHOP_STATUS_LABELS: Record<WorkshopDisplayStatus, string> = {
  BOOKED: "Booked",
  BIKE_ARRIVED: "Bike Arrived",
  WAITING_FOR_APPROVAL: "Waiting for Approval",
  APPROVED: "Approved",
  WAITING_FOR_PARTS: "Waiting for Parts",
  BIKE_READY: "Bike Ready",
  COMPLETED: "Completed",
  ON_HOLD: "On Hold",
  CANCELLED: "Cancelled",
};

const WORKSHOP_STATUS_DESCRIPTIONS: Record<WorkshopDisplayStatus, string> = {
  BOOKED: "Booked into the workshop and waiting to start.",
  BIKE_ARRIVED: "Bike is on site and ready for workshop intake.",
  WAITING_FOR_APPROVAL: "Bench work is paused while the customer decides.",
  APPROVED: "Work is approved and can progress on the bench.",
  WAITING_FOR_PARTS: "Progress is blocked until parts are available.",
  BIKE_READY: "Bench work is complete and the bike is ready to hand over.",
  COMPLETED: "The job has been handed over and closed out.",
  ON_HOLD: "The job is paused for an operational reason.",
  CANCELLED: "The job has been cancelled and removed from the live flow.",
};

const WORKSHOP_STATUS_TONES: Record<WorkshopDisplayStatus, WorkshopStatusTone> = {
  BOOKED: "booked",
  BIKE_ARRIVED: "arrived",
  WAITING_FOR_APPROVAL: "approval",
  APPROVED: "approved",
  WAITING_FOR_PARTS: "parts",
  BIKE_READY: "ready",
  COMPLETED: "completed",
  ON_HOLD: "hold",
  CANCELLED: "cancelled",
};

const PERSISTED_STATUS_BY_DISPLAY_STATUS: Record<WorkshopDisplayStatus, string> = {
  BOOKED: "BOOKED",
  BIKE_ARRIVED: "BIKE_ARRIVED",
  WAITING_FOR_APPROVAL: "WAITING_FOR_APPROVAL",
  APPROVED: "IN_PROGRESS",
  WAITING_FOR_PARTS: "WAITING_FOR_PARTS",
  BIKE_READY: "READY_FOR_COLLECTION",
  COMPLETED: "COMPLETED",
  ON_HOLD: "ON_HOLD",
  CANCELLED: "CANCELLED",
};

export const normalizeWorkshopDisplayStatus = (
  value: string | null | undefined,
): WorkshopDisplayStatus | null => {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  return WORKSHOP_STATUS_ALIASES[normalized] ?? null;
};

export const getWorkshopDisplayStatusLabel = (
  value: string | null | undefined,
) => {
  const normalized = normalizeWorkshopDisplayStatus(value);
  return normalized ? WORKSHOP_STATUS_LABELS[normalized] : value || "-";
};

export const getWorkshopDisplayStatusDescription = (
  value: string | null | undefined,
) => {
  const normalized = normalizeWorkshopDisplayStatus(value);
  return normalized ? WORKSHOP_STATUS_DESCRIPTIONS[normalized] : "";
};

export const getWorkshopDisplayStatusTone = (
  value: string | null | undefined,
) => {
  const normalized = normalizeWorkshopDisplayStatus(value);
  return normalized ? WORKSHOP_STATUS_TONES[normalized] : "booked";
};

export const toPersistedWorkshopStatusValue = (
  value: string | null | undefined,
) => {
  const normalized = normalizeWorkshopDisplayStatus(value);
  return normalized ? PERSISTED_STATUS_BY_DISPLAY_STATUS[normalized] : null;
};

export const getWorkshopTimelineStatus = (
  value: string | null | undefined,
): WorkshopTimelineStatus | null => {
  const normalized = normalizeWorkshopDisplayStatus(value);
  if (!normalized || normalized === "CANCELLED") {
    return null;
  }

  return normalized;
};
