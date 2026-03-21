export type WorkshopExecutionStatus =
  | "BOOKED"
  | "IN_PROGRESS"
  | "READY"
  | "COLLECTED"
  | "CLOSED";

export const workshopExecutionStatusLabel = (
  status: WorkshopExecutionStatus | string | null | undefined,
) => {
  switch (status) {
    case "BOOKED":
      return "Booked";
    case "IN_PROGRESS":
      return "In Progress";
    case "READY":
      return "Ready for Collection";
    case "COLLECTED":
      return "Collected";
    case "CLOSED":
      return "Closed";
    default:
      return status || "-";
  }
};

export const workshopExecutionStatusClass = (
  status: WorkshopExecutionStatus | string | null | undefined,
  rawStatus?: string | null,
) => {
  switch (status) {
    case "READY":
      return "status-badge status-ready";
    case "COLLECTED":
      return "status-badge status-complete";
    case "CLOSED":
      return rawStatus === "CANCELLED"
        ? "status-badge status-cancelled"
        : "status-badge";
    case "IN_PROGRESS":
      return "status-badge status-info";
    default:
      return "status-badge";
  }
};

export const workshopRawStatusLabel = (
  status: string | null | undefined,
) => {
  switch (status) {
    case "BOOKING_MADE":
      return "Booked";
    case "BIKE_ARRIVED":
      return "Ready for Work";
    case "WAITING_FOR_APPROVAL":
      return "Quote Pending";
    case "APPROVED":
      return "Quote Approved";
    case "WAITING_FOR_PARTS":
      return "Waiting for Parts";
    case "ON_HOLD":
      return "Paused / On Hold";
    case "BIKE_READY":
      return "Ready for Collection";
    case "COMPLETED":
      return "Collected";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status || "-";
  }
};

export const workshopRawStatusClass = (
  status: string | null | undefined,
) => {
  switch (status) {
    case "WAITING_FOR_APPROVAL":
    case "WAITING_FOR_PARTS":
      return "status-badge status-warning";
    case "APPROVED":
    case "ON_HOLD":
      return "status-badge status-info";
    case "BIKE_READY":
      return "status-badge status-ready";
    case "COMPLETED":
      return "status-badge status-complete";
    case "CANCELLED":
      return "status-badge status-cancelled";
    default:
      return "status-badge";
  }
};
