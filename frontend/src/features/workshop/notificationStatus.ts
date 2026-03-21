export type WorkshopNotificationEventType =
  | "QUOTE_READY"
  | "JOB_READY_FOR_COLLECTION";

export type WorkshopNotificationDeliveryStatus =
  | "PENDING"
  | "SENT"
  | "SKIPPED"
  | "FAILED";

export const workshopNotificationEventLabel = (
  eventType: WorkshopNotificationEventType | string | null | undefined,
) => {
  switch (eventType) {
    case "QUOTE_READY":
      return "Quote Ready";
    case "JOB_READY_FOR_COLLECTION":
      return "Ready for Collection";
    default:
      return eventType || "-";
  }
};

export const workshopNotificationDeliveryStatusLabel = (
  status: WorkshopNotificationDeliveryStatus | string | null | undefined,
) => {
  switch (status) {
    case "SENT":
      return "Sent";
    case "SKIPPED":
      return "Skipped";
    case "FAILED":
      return "Failed";
    case "PENDING":
      return "Sending";
    default:
      return status || "-";
  }
};

export const workshopNotificationDeliveryStatusClass = (
  status: WorkshopNotificationDeliveryStatus | string | null | undefined,
) => {
  switch (status) {
    case "SENT":
      return "status-badge status-complete";
    case "SKIPPED":
      return "status-badge status-warning";
    case "FAILED":
      return "status-badge status-cancelled";
    default:
      return "status-badge";
  }
};
