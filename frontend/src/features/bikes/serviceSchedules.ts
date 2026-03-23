export type BikeServiceScheduleType =
  | "GENERAL_SERVICE"
  | "SAFETY_CHECK"
  | "BRAKES"
  | "DRIVETRAIN"
  | "SUSPENSION"
  | "E_BIKE_SYSTEM"
  | "TYRES"
  | "OTHER";

export type BikeServiceScheduleDueStatus = "UPCOMING" | "DUE" | "OVERDUE" | "INACTIVE";

export const BIKE_SERVICE_SCHEDULE_TYPE_OPTIONS: Array<{
  value: BikeServiceScheduleType;
  label: string;
}> = [
  { value: "GENERAL_SERVICE", label: "General service" },
  { value: "SAFETY_CHECK", label: "Safety check" },
  { value: "BRAKES", label: "Brakes" },
  { value: "DRIVETRAIN", label: "Drivetrain" },
  { value: "SUSPENSION", label: "Suspension" },
  { value: "E_BIKE_SYSTEM", label: "E-bike system" },
  { value: "TYRES", label: "Tyres" },
  { value: "OTHER", label: "Other" },
];

export const bikeServiceScheduleTypeLabel = (value: string | null | undefined) =>
  BIKE_SERVICE_SCHEDULE_TYPE_OPTIONS.find((option) => option.value === value)?.label
  ?? value
  ?? "-";

export const bikeServiceScheduleDueStatusLabel = (
  status: BikeServiceScheduleDueStatus | string | null | undefined,
) => {
  switch (status) {
    case "UPCOMING":
      return "Upcoming";
    case "DUE":
      return "Due";
    case "OVERDUE":
      return "Overdue";
    case "INACTIVE":
      return "Inactive";
    default:
      return status || "-";
  }
};

export const bikeServiceScheduleDueStatusClass = (
  status: BikeServiceScheduleDueStatus | string | null | undefined,
) => {
  switch (status) {
    case "OVERDUE":
      return "status-badge status-cancelled";
    case "DUE":
      return "status-badge status-warning";
    case "UPCOMING":
      return "status-badge status-info";
    case "INACTIVE":
      return "status-badge";
    default:
      return "status-badge";
  }
};

export const defaultBikeServiceScheduleTitle = (
  type: BikeServiceScheduleType,
) =>
  bikeServiceScheduleTypeLabel(type);
