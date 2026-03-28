export type WorkshopExecutionStatus =
  | "BOOKED"
  | "IN_PROGRESS"
  | "READY"
  | "COLLECTED"
  | "CLOSED";

export type WorkshopTechnicianWorkflowStage =
  | "QUEUED"
  | "AWAITING_APPROVAL"
  | "READY_FOR_BENCH"
  | "IN_REPAIR"
  | "WAITING_FOR_PARTS"
  | "PAUSED"
  | "READY_FOR_COLLECTION"
  | "COLLECTED"
  | "CANCELLED";

type WorkshopTechnicianWorkflowSummaryInput = {
  rawStatus: string | null | undefined;
  partsStatus?: string | null;
  assignedStaffName?: string | null;
  scheduledDate?: string | null;
  scheduledStartAt?: string | null;
  hasSale?: boolean;
  hasBasket?: boolean;
};

type WorkshopRawStatusTone =
  | "blue"
  | "purple"
  | "yellow"
  | "rose"
  | "green"
  | "red"
  | "neutral";

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
      return "Booking Made";
    case "BOOKED":
      return "Booked";
    case "BIKE_ARRIVED":
      return "Bike Arrived";
    case "IN_PROGRESS":
      return "In Progress";
    case "WAITING_FOR_APPROVAL":
      return "Waiting for Approval";
    case "APPROVED":
      return "Approved";
    case "WAITING_FOR_PARTS":
      return "Waiting for Parts";
    case "ON_HOLD":
      return "On Hold";
    case "READY_FOR_COLLECTION":
    case "BIKE_READY":
      return "Ready for Collection";
    case "COMPLETED":
      return "Completed";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status || "-";
  }
};

export const getWorkshopRawStatusTone = (
  status: string | null | undefined,
): WorkshopRawStatusTone => {
  switch (status) {
    case "BOOKED":
    case "BOOKING_MADE":
    case "BIKE_ARRIVED":
    case "IN_PROGRESS":
      return "blue";
    case "APPROVED":
      return "purple";
    case "WAITING_FOR_PARTS":
      return "yellow";
    case "WAITING_FOR_APPROVAL":
      return "rose";
    case "READY_FOR_COLLECTION":
    case "BIKE_READY":
    case "COMPLETED":
      return "green";
    case "ON_HOLD":
    case "CANCELLED":
      return "red";
    default:
      return "neutral";
  }
};

export const workshopRawStatusClass = (
  status: string | null | undefined,
) => {
  return `status-badge workshop-status-badge workshop-status-badge--${getWorkshopRawStatusTone(status)}`;
};

export const workshopRawStatusSurfaceClass = (
  status: string | null | undefined,
) => `workshop-status-surface workshop-status-surface--${getWorkshopRawStatusTone(status)}`;

export const workshopRawStatusActionClass = (
  status: string | null | undefined,
) => `workshop-status-action workshop-status-action--${getWorkshopRawStatusTone(status)}`;

export const workshopTechnicianWorkflowLabel = (
  stage: WorkshopTechnicianWorkflowStage | string | null | undefined,
) => {
  switch (stage) {
    case "QUEUED":
      return "Queued";
    case "AWAITING_APPROVAL":
      return "Waiting for Approval";
    case "READY_FOR_BENCH":
      return "Ready for Bench";
    case "IN_REPAIR":
      return "In Repair";
    case "WAITING_FOR_PARTS":
      return "Waiting for Parts";
    case "PAUSED":
      return "Paused";
    case "READY_FOR_COLLECTION":
      return "Ready for Collection";
    case "COLLECTED":
      return "Collected";
    case "CANCELLED":
      return "Cancelled";
    default:
      return stage || "-";
  }
};

export const workshopTechnicianWorkflowClass = (
  stage: WorkshopTechnicianWorkflowStage | string | null | undefined,
) => {
  switch (stage) {
    case "AWAITING_APPROVAL":
    case "WAITING_FOR_PARTS":
      return "status-badge status-warning";
    case "PAUSED":
    case "READY_FOR_BENCH":
    case "IN_REPAIR":
      return "status-badge status-info";
    case "READY_FOR_COLLECTION":
      return "status-badge status-ready";
    case "COLLECTED":
      return "status-badge status-complete";
    case "CANCELLED":
      return "status-badge status-cancelled";
    default:
      return "status-badge";
  }
};

export const toWorkshopTechnicianWorkflowStage = (
  rawStatus: string | null | undefined,
): WorkshopTechnicianWorkflowStage => {
  switch (rawStatus) {
    case "WAITING_FOR_APPROVAL":
      return "AWAITING_APPROVAL";
    case "APPROVED":
    case "BIKE_ARRIVED":
      return "READY_FOR_BENCH";
    case "IN_PROGRESS":
      return "IN_REPAIR";
    case "WAITING_FOR_PARTS":
      return "WAITING_FOR_PARTS";
    case "ON_HOLD":
      return "PAUSED";
    case "READY_FOR_COLLECTION":
    case "BIKE_READY":
      return "READY_FOR_COLLECTION";
    case "COMPLETED":
      return "COLLECTED";
    case "CANCELLED":
      return "CANCELLED";
    default:
      return "QUEUED";
  }
};

const formatScheduleLabel = (scheduledStartAt?: string | null, scheduledDate?: string | null) => {
  const value = scheduledStartAt || scheduledDate;
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return scheduledStartAt
    ? parsed.toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : parsed.toLocaleDateString([], {
        dateStyle: "medium",
      });
};

export const getWorkshopTechnicianWorkflowSummary = (
  input: WorkshopTechnicianWorkflowSummaryInput,
) => {
  const stage = toWorkshopTechnicianWorkflowStage(input.rawStatus);
  const scheduledLabel = formatScheduleLabel(input.scheduledStartAt, input.scheduledDate);

  const assignmentSummary = input.assignedStaffName
    ? scheduledLabel
      ? `Assigned to ${input.assignedStaffName} · ${scheduledLabel}`
      : `Assigned to ${input.assignedStaffName}`
    : scheduledLabel
      ? `Not assigned yet · ${scheduledLabel}`
      : "No technician or timed slot set";

  const partsBlocked = input.rawStatus === "WAITING_FOR_PARTS" || input.partsStatus === "SHORT";

  switch (stage) {
    case "AWAITING_APPROVAL":
      return {
        stage,
        label: workshopTechnicianWorkflowLabel(stage),
        className: workshopTechnicianWorkflowClass(stage),
        assignmentSummary,
        blockerLabel: "Customer approval still needed",
        blockerClassName: "status-badge status-warning",
        detail: "Bench work is paused until the current quote is approved or revised.",
        nextStep: "Keep the quote current, follow up with the customer, and only restart bench work after approval.",
      };
    case "READY_FOR_BENCH":
      return {
        stage,
        label: workshopTechnicianWorkflowLabel(stage),
        className: workshopTechnicianWorkflowClass(stage),
        assignmentSummary,
        blockerLabel: input.assignedStaffName ? "Bench slot is ready" : "Needs technician assignment",
        blockerClassName: input.assignedStaffName ? "status-badge status-info" : "status-badge",
        detail: "The bike is in the workshop and ready to move onto the bench when the team is ready to start work.",
        nextStep: "Confirm assignment, then move the job onto the bench when the technician is ready to begin.",
      };
    case "IN_REPAIR":
      return {
        stage,
        label: workshopTechnicianWorkflowLabel(stage),
        className: workshopTechnicianWorkflowClass(stage),
        assignmentSummary,
        blockerLabel: partsBlocked ? "Parts attention needed" : "Bench work active",
        blockerClassName: partsBlocked ? "status-badge status-warning" : "status-badge status-info",
        detail: "The bike is on the bench and the team should keep operational notes, parts, and attachments up to date.",
        nextStep: partsBlocked
          ? "Move the job into Waiting for Parts if stock is genuinely blocking progress."
          : "Continue repair work, then move to Ready for Collection when the bench work is complete.",
      };
    case "WAITING_FOR_PARTS":
      return {
        stage,
        label: workshopTechnicianWorkflowLabel(stage),
        className: workshopTechnicianWorkflowClass(stage),
        assignmentSummary,
        blockerLabel: "Parts are blocking progress",
        blockerClassName: "status-badge status-warning",
        detail: "Pause promises on completion until the missing parts are reserved, received, or substituted safely.",
        nextStep: "Resolve the missing parts, then resume bench work rather than jumping straight to collection.",
      };
    case "PAUSED":
      return {
        stage,
        label: workshopTechnicianWorkflowLabel(stage),
        className: workshopTechnicianWorkflowClass(stage),
        assignmentSummary,
        blockerLabel: "Manual hold",
        blockerClassName: "status-badge status-info",
        detail: "The job is paused for an internal reason, so the bench queue should treat it as blocked work.",
        nextStep: "Clear the hold reason, then either resume bench work or move it into Waiting for Parts if stock is the real blocker.",
      };
    case "READY_FOR_COLLECTION":
      return {
        stage,
        label: workshopTechnicianWorkflowLabel(stage),
        className: workshopTechnicianWorkflowClass(stage),
        assignmentSummary,
        blockerLabel: input.hasSale
          ? "Sale linked for collection"
          : input.hasBasket
            ? "POS handoff basket ready"
            : "Collection handoff still needed",
        blockerClassName: input.hasSale || input.hasBasket ? "status-badge status-complete" : "status-badge status-warning",
        detail: "Bench work is complete and the job should move through the counter handoff rather than back into repair.",
        nextStep: input.hasSale || input.hasBasket
          ? "Finish the customer handoff through POS when they arrive."
          : "Send the job to POS so collection can be completed cleanly at the counter.",
      };
    case "COLLECTED":
      return {
        stage,
        label: workshopTechnicianWorkflowLabel(stage),
        className: workshopTechnicianWorkflowClass(stage),
        assignmentSummary,
        blockerLabel: "Finished",
        blockerClassName: "status-badge status-complete",
        detail: "The customer handoff is complete and the job is no longer part of the live workshop queue.",
        nextStep: "Use the record for follow-up, history, or warranty context only.",
      };
    case "CANCELLED":
      return {
        stage,
        label: workshopTechnicianWorkflowLabel(stage),
        className: workshopTechnicianWorkflowClass(stage),
        assignmentSummary,
        blockerLabel: "Cancelled",
        blockerClassName: "status-badge status-cancelled",
        detail: "The job has been cancelled and should stay out of active workshop planning.",
        nextStep: "Only reopen operational work by creating or rebooking a new job if needed.",
      };
    default:
      return {
        stage,
        label: workshopTechnicianWorkflowLabel(stage),
        className: workshopTechnicianWorkflowClass(stage),
        assignmentSummary,
        blockerLabel: input.assignedStaffName ? "Queued for bench start" : "Queued for technician",
        blockerClassName: input.assignedStaffName ? "status-badge status-info" : "status-badge",
        detail: "The job is booked in and still needs a clear bench start or quote decision before it becomes active work.",
        nextStep:
          input.rawStatus === "BOOKING_MADE" || input.rawStatus === "BOOKED"
            ? input.assignedStaffName
              ? "Check the bike in fully, then move it onto the bench when the assigned technician is ready."
              : "Assign a technician, then either start bench work or move into quote approval if the customer still needs a decision."
            : input.assignedStaffName
              ? "Use the workflow actions to move the assigned job onto the bench."
              : "Assign a technician first, then use the workflow actions to move the job onto the bench.",
      };
  }
};
