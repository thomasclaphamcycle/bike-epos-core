import { apiGet, apiPost } from "../../api/client";

export type ManagedPrintWorkflowType =
  | "RECEIPT_PRINT"
  | "SHIPMENT_LABEL_PRINT"
  | "PRODUCT_LABEL_PRINT"
  | "BIKE_TAG_PRINT";

export type ManagedPrintJobStatus =
  | "PENDING"
  | "PROCESSING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

export type ManagedPrintJobSummary = {
  id: string;
  workflowType: ManagedPrintWorkflowType;
  printerId: string;
  printerKey: string | null;
  printerName: string | null;
  status: ManagedPrintJobStatus;
  attemptCount: number;
  maxAttempts: number;
  documentLabel: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  createdByStaffId: string | null;
  lastError: string | null;
  lastErrorCode: string | null;
  lastErrorRetryable: boolean | null;
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  canRetry: boolean;
};

export type ManagedPrintJobListResponse = {
  jobs: ManagedPrintJobSummary[];
};

export type ManagedPrintJobResponse = {
  job: ManagedPrintJobSummary;
};

export const getManagedPrintJob = async (jobId: string) =>
  apiGet<ManagedPrintJobResponse>(`/api/print-jobs/${encodeURIComponent(jobId)}`);

export const listManagedPrintJobs = async (query: {
  status?: ManagedPrintJobStatus[];
  workflowType?: ManagedPrintWorkflowType;
  take?: number;
} = {}) => {
  const params = new URLSearchParams();
  if (query.status && query.status.length > 0) {
    params.set("status", query.status.join(","));
  }
  if (query.workflowType) {
    params.set("workflowType", query.workflowType);
  }
  if (query.take !== undefined) {
    params.set("take", String(query.take));
  }

  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiGet<ManagedPrintJobListResponse>(`/api/print-jobs${suffix}`);
};

export const retryManagedPrintJob = async (jobId: string) =>
  apiPost<ManagedPrintJobResponse>(`/api/print-jobs/${encodeURIComponent(jobId)}/retry`);

export const isManagedPrintJobTerminal = (status: ManagedPrintJobStatus) =>
  status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED";

export const getManagedPrintJobStatusLabel = (status: ManagedPrintJobStatus) => {
  switch (status) {
    case "PENDING":
      return "Queued";
    case "PROCESSING":
      return "Printing";
    case "SUCCEEDED":
      return "Printed";
    case "FAILED":
      return "Failed";
    case "CANCELLED":
      return "Cancelled";
  }
};

export const getManagedPrintJobStatusBadgeClassName = (status: ManagedPrintJobStatus) => {
  switch (status) {
    case "PENDING":
    case "PROCESSING":
      return "status-badge status-info";
    case "SUCCEEDED":
      return "status-badge status-complete";
    case "FAILED":
      return "status-badge status-warning";
    case "CANCELLED":
      return "status-badge status-cancelled";
  }
};
