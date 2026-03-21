export type WorkshopEstimateStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "SUPERSEDED";

export type WorkshopQuoteAccessStatus = "ACTIVE" | "EXPIRED" | "SUPERSEDED";

export const workshopEstimateStatusLabel = (
  status: WorkshopEstimateStatus | string | null | undefined,
  audience: "staff" | "customer" = "staff",
) => {
  switch (status) {
    case "PENDING_APPROVAL":
      return audience === "customer" ? "Awaiting Your Approval" : "Quote Pending";
    case "APPROVED":
      return "Approved";
    case "REJECTED":
      return "Rejected";
    case "SUPERSEDED":
      return "Superseded";
    case "DRAFT":
      return "Draft";
    default:
      return status || "Not Saved";
  }
};

export const workshopEstimateStatusClass = (
  status: WorkshopEstimateStatus | string | null | undefined,
) => {
  switch (status) {
    case "PENDING_APPROVAL":
      return "status-badge status-warning";
    case "APPROVED":
      return "status-badge status-complete";
    case "REJECTED":
      return "status-badge status-cancelled";
    case "SUPERSEDED":
      return "status-badge status-warning";
    default:
      return "status-badge";
  }
};

export const workshopQuoteAccessStatusLabel = (
  status: WorkshopQuoteAccessStatus | string | null | undefined,
) => {
  switch (status) {
    case "ACTIVE":
      return "Ready to Review";
    case "EXPIRED":
      return "Link Expired";
    case "SUPERSEDED":
      return "Superseded";
    default:
      return status || "-";
  }
};

export const workshopQuoteAccessStatusClass = (
  status: WorkshopQuoteAccessStatus | string | null | undefined,
) => {
  switch (status) {
    case "SUPERSEDED":
      return "status-badge status-warning";
    case "EXPIRED":
      return "status-badge status-cancelled";
    case "ACTIVE":
      return "status-badge status-complete";
    default:
      return "status-badge";
  }
};

export const workshopCustomerQuoteLinkStatusLabel = (
  status: "ACTIVE" | "EXPIRED" | string | null | undefined,
) => {
  switch (status) {
    case "ACTIVE":
      return "Current Link";
    case "EXPIRED":
      return "Expired Link";
    default:
      return status || "-";
  }
};
