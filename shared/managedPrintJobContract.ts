import {
  validateBikeTagPrintRequest,
  type BikeTagPrintRequest,
} from "./bikeTagPrintContract";
import {
  validateProductLabelPrintRequest,
  type ProductLabelPrintRequest,
} from "./productLabelPrintContract";
import {
  validateReceiptPrintRequest,
  type ReceiptPrintRequest,
} from "./receiptPrintContract";
import {
  validateShipmentPrintRequest,
  type ShipmentPrintRequest,
} from "./shippingPrintContract";
import {
  expectIsoDateString,
  expectNonNegativeInteger,
  expectNullableString,
  expectPositiveInteger,
  expectRecord,
  expectString,
} from "./printContractUtils";

export const MANAGED_PRINT_JOB_WORKFLOW_TYPES = [
  "RECEIPT_PRINT",
  "SHIPMENT_LABEL_PRINT",
  "PRODUCT_LABEL_PRINT",
  "BIKE_TAG_PRINT",
] as const;

export const MANAGED_PRINT_JOB_STATUSES = [
  "PENDING",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
] as const;

export const MANAGED_PRINT_QUEUE_PAYLOAD_VERSION = 1 as const;

export type ManagedPrintWorkflowType = (typeof MANAGED_PRINT_JOB_WORKFLOW_TYPES)[number];
export type ManagedPrintJobStatus = (typeof MANAGED_PRINT_JOB_STATUSES)[number];

export type ManagedPrintQueuePayload =
  | {
    version: typeof MANAGED_PRINT_QUEUE_PAYLOAD_VERSION;
    workflowType: "RECEIPT_PRINT";
    printRequest: ReceiptPrintRequest;
  }
  | {
    version: typeof MANAGED_PRINT_QUEUE_PAYLOAD_VERSION;
    workflowType: "SHIPMENT_LABEL_PRINT";
    printRequest: ShipmentPrintRequest;
  }
  | {
    version: typeof MANAGED_PRINT_QUEUE_PAYLOAD_VERSION;
    workflowType: "PRODUCT_LABEL_PRINT";
    printRequest: ProductLabelPrintRequest;
  }
  | {
    version: typeof MANAGED_PRINT_QUEUE_PAYLOAD_VERSION;
    workflowType: "BIKE_TAG_PRINT";
    printRequest: BikeTagPrintRequest;
  };

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

const isManagedPrintWorkflowType = (value: string): value is ManagedPrintWorkflowType =>
  MANAGED_PRINT_JOB_WORKFLOW_TYPES.includes(value as ManagedPrintWorkflowType);

const isManagedPrintJobStatus = (value: string): value is ManagedPrintJobStatus =>
  MANAGED_PRINT_JOB_STATUSES.includes(value as ManagedPrintJobStatus);

export const validateManagedPrintQueuePayload = (value: unknown): ManagedPrintQueuePayload => {
  const record = expectRecord(value, "payload");
  const version = Number(record.version);
  const workflowType = expectString(record.workflowType, "payload.workflowType");
  if (version !== MANAGED_PRINT_QUEUE_PAYLOAD_VERSION) {
    throw new Error(`payload.version must be ${MANAGED_PRINT_QUEUE_PAYLOAD_VERSION}`);
  }
  if (!isManagedPrintWorkflowType(workflowType)) {
    throw new Error(`payload.workflowType must be one of ${MANAGED_PRINT_JOB_WORKFLOW_TYPES.join(", ")}`);
  }

  switch (workflowType) {
    case "RECEIPT_PRINT":
      return {
        version: MANAGED_PRINT_QUEUE_PAYLOAD_VERSION,
        workflowType,
        printRequest: validateReceiptPrintRequest(record.printRequest),
      };
    case "SHIPMENT_LABEL_PRINT":
      return {
        version: MANAGED_PRINT_QUEUE_PAYLOAD_VERSION,
        workflowType,
        printRequest: validateShipmentPrintRequest(record.printRequest),
      };
    case "PRODUCT_LABEL_PRINT":
      return {
        version: MANAGED_PRINT_QUEUE_PAYLOAD_VERSION,
        workflowType,
        printRequest: validateProductLabelPrintRequest(record.printRequest),
      };
    case "BIKE_TAG_PRINT":
      return {
        version: MANAGED_PRINT_QUEUE_PAYLOAD_VERSION,
        workflowType,
        printRequest: validateBikeTagPrintRequest(record.printRequest),
      };
  }
};

export const validateManagedPrintJobSummary = (value: unknown): ManagedPrintJobSummary => {
  const record = expectRecord(value, "job");
  const workflowType = expectString(record.workflowType, "job.workflowType");
  const status = expectString(record.status, "job.status");
  if (!isManagedPrintWorkflowType(workflowType)) {
    throw new Error(`job.workflowType must be one of ${MANAGED_PRINT_JOB_WORKFLOW_TYPES.join(", ")}`);
  }
  if (!isManagedPrintJobStatus(status)) {
    throw new Error(`job.status must be one of ${MANAGED_PRINT_JOB_STATUSES.join(", ")}`);
  }

  return {
    id: expectString(record.id, "job.id"),
    workflowType,
    printerId: expectString(record.printerId, "job.printerId"),
    printerKey: expectNullableString(record.printerKey, "job.printerKey"),
    printerName: expectNullableString(record.printerName, "job.printerName"),
    status,
    attemptCount: expectNonNegativeInteger(record.attemptCount, "job.attemptCount"),
    maxAttempts: expectPositiveInteger(record.maxAttempts, "job.maxAttempts"),
    documentLabel: expectNullableString(record.documentLabel, "job.documentLabel"),
    sourceEntityType: expectNullableString(record.sourceEntityType, "job.sourceEntityType"),
    sourceEntityId: expectNullableString(record.sourceEntityId, "job.sourceEntityId"),
    createdByStaffId: expectNullableString(record.createdByStaffId, "job.createdByStaffId"),
    lastError: expectNullableString(record.lastError, "job.lastError"),
    lastErrorCode: expectNullableString(record.lastErrorCode, "job.lastErrorCode"),
    lastErrorRetryable:
      record.lastErrorRetryable === null
        ? null
        : Boolean(record.lastErrorRetryable),
    nextAttemptAt:
      record.nextAttemptAt === null
        ? null
        : expectIsoDateString(record.nextAttemptAt, "job.nextAttemptAt"),
    createdAt: expectIsoDateString(record.createdAt, "job.createdAt"),
    updatedAt: expectIsoDateString(record.updatedAt, "job.updatedAt"),
    startedAt:
      record.startedAt === null
        ? null
        : expectIsoDateString(record.startedAt, "job.startedAt"),
    completedAt:
      record.completedAt === null
        ? null
        : expectIsoDateString(record.completedAt, "job.completedAt"),
    cancelledAt:
      record.cancelledAt === null
        ? null
        : expectIsoDateString(record.cancelledAt, "job.cancelledAt"),
    canRetry: Boolean(record.canRetry),
  };
};

export const validateManagedPrintJobListResponse = (value: unknown): ManagedPrintJobListResponse => {
  const record = expectRecord(value, "response");
  if (!Array.isArray(record.jobs)) {
    throw new Error("response.jobs must be an array");
  }
  return {
    jobs: record.jobs.map((job) => validateManagedPrintJobSummary(job)),
  };
};

export const validateManagedPrintJobResponse = (value: unknown): ManagedPrintJobResponse => {
  const record = expectRecord(value, "response");
  return {
    job: validateManagedPrintJobSummary(record.job),
  };
};
