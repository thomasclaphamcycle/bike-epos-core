import { PrintJobStatus, PrintJobWorkflowType, Prisma } from "@prisma/client";
import {
  MANAGED_PRINT_JOB_STATUSES,
  MANAGED_PRINT_JOB_WORKFLOW_TYPES,
  validateManagedPrintQueuePayload,
  type ManagedPrintJobListResponse,
  type ManagedPrintJobResponse,
  type ManagedPrintJobStatus,
  type ManagedPrintJobSummary,
  type ManagedPrintQueuePayload,
  type ManagedPrintWorkflowType,
} from "../../shared/managedPrintJobContract";
import { prisma } from "../lib/prisma";
import { logOperationalEvent } from "../lib/operationalLogger";
import { HttpError } from "../utils/http";
import { createAuditEventTx, type AuditActor } from "./auditService";
import { type ManagedPrintDispatchResult, dispatchManagedPrintPayload } from "./managedPrintDispatchService";

type ManagedPrintQueueClient = Prisma.TransactionClient | typeof prisma;

type EnqueueManagedPrintJobInput = {
  workflowType: ManagedPrintWorkflowType;
  printerId: string;
  payload: ManagedPrintQueuePayload;
  documentLabel?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  createdByStaffId?: string | null;
  maxAttempts?: number;
};

type ListManagedPrintJobsInput = {
  statuses?: ManagedPrintJobStatus[];
  workflowType?: ManagedPrintWorkflowType | null;
  printerId?: string | null;
  take?: number;
};

type DispatchHandler = (payloadInput: unknown) => Promise<ManagedPrintDispatchResult>;

const DEFAULT_LIST_STATUSES: ManagedPrintJobStatus[] = ["PENDING", "PROCESSING", "FAILED"];
const DEFAULT_LIST_LIMIT = 40;
const MAX_LIST_LIMIT = 200;
const DEFAULT_MAX_ATTEMPTS = 3;
const QUEUE_SWEEP_INTERVAL_MS = 2000;
const RETRY_BACKOFF_MS = [0, 5000, 20000] as const;

const RETRYABLE_ERROR_CODES = new Set([
  "RECEIPT_PRINT_AGENT_UNREACHABLE",
  "RECEIPT_PRINT_AGENT_TIMEOUT",
  "RECEIPT_PRINT_AGENT_TRANSPORT_FAILED",
  "SHIPPING_PRINT_AGENT_UNREACHABLE",
  "SHIPPING_PRINT_AGENT_TIMEOUT",
  "PRODUCT_LABEL_PRINT_AGENT_UNREACHABLE",
  "PRODUCT_LABEL_PRINT_AGENT_TIMEOUT",
  "BIKE_TAG_PRINT_AGENT_UNREACHABLE",
  "BIKE_TAG_PRINT_AGENT_TIMEOUT",
]);

const NON_RETRYABLE_ERROR_CODES = new Set([
  "RECEIPT_PRINT_AGENT_NOT_CONFIGURED",
  "RECEIPT_PRINT_AGENT_REQUEST_INVALID",
  "RECEIPT_PRINT_AGENT_REJECTED",
  "RECEIPT_PRINT_AGENT_INVALID_RESPONSE",
  "PRINTER_NOT_FOUND",
  "PRINTER_INACTIVE",
  "PRINTER_NOT_RECEIPT_CAPABLE",
  "PRINTER_FAMILY_NOT_SUPPORTED",
  "PRINTER_MODEL_NOT_SUPPORTED",
  "PRINTER_TRANSPORT_NOT_SUPPORTED",
  "PRINTER_TARGET_MISCONFIGURED",
  "INVALID_RECEIPT_PRINT",
  "PRINT_QUEUE_WORKFLOW_NOT_SUPPORTED",
  "PRINT_QUEUE_PAYLOAD_INVALID",
]);

const RETRYABLE_MESSAGE_PATTERNS = [
  /\btimeout\b/i,
  /\btimed out\b/i,
  /\bECONNREFUSED\b/i,
  /\bECONNRESET\b/i,
  /\bEHOSTUNREACH\b/i,
  /\bENETUNREACH\b/i,
  /\bETIMEDOUT\b/i,
  /\bcould not be reached\b/i,
  /\bconnection\b/i,
  /\bsocket\b/i,
];

const printJobSelect = Prisma.validator<Prisma.PrintJobSelect>()({
  id: true,
  workflowType: true,
  printerId: true,
  status: true,
  attemptCount: true,
  maxAttempts: true,
  payload: true,
  documentLabel: true,
  sourceEntityType: true,
  sourceEntityId: true,
  createdByStaffId: true,
  lastError: true,
  lastErrorCode: true,
  lastErrorRetryable: true,
  nextAttemptAt: true,
  createdAt: true,
  updatedAt: true,
  startedAt: true,
  completedAt: true,
  cancelledAt: true,
  printer: {
    select: {
      key: true,
      name: true,
    },
  },
});

type PrintJobRecord = Prisma.PrintJobGetPayload<{ select: typeof printJobSelect }>;

let dispatchHandler: DispatchHandler = dispatchManagedPrintPayload;
let queueSweepTimer: NodeJS.Timeout | null = null;
const activePrinterDrains = new Map<string, Promise<void>>();

const isManagedPrintWorkflowType = (value: unknown): value is ManagedPrintWorkflowType =>
  typeof value === "string" && MANAGED_PRINT_JOB_WORKFLOW_TYPES.includes(value as ManagedPrintWorkflowType);

const isManagedPrintJobStatus = (value: unknown): value is ManagedPrintJobStatus =>
  typeof value === "string" && MANAGED_PRINT_JOB_STATUSES.includes(value as ManagedPrintJobStatus);

const normalizeOptionalText = (value: string | null | undefined) => {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeTake = (value: number | undefined) => {
  if (value === undefined) {
    return DEFAULT_LIST_LIMIT;
  }
  if (!Number.isInteger(value) || value <= 0 || value > MAX_LIST_LIMIT) {
    throw new HttpError(
      400,
      `take must be an integer between 1 and ${MAX_LIST_LIMIT}`,
      "INVALID_PRINT_JOB_FILTER",
    );
  }
  return value;
};

const normalizeMaxAttempts = (value: number | undefined) => {
  if (value === undefined) {
    return DEFAULT_MAX_ATTEMPTS;
  }
  if (!Number.isInteger(value) || value <= 0 || value > 10) {
    throw new HttpError(400, "maxAttempts must be an integer between 1 and 10", "INVALID_PRINT_JOB");
  }
  return value;
};

const normalizeStatuses = (statuses: ManagedPrintJobStatus[] | undefined) => {
  if (!statuses || statuses.length === 0) {
    return DEFAULT_LIST_STATUSES;
  }
  for (const status of statuses) {
    if (!isManagedPrintJobStatus(status)) {
      throw new HttpError(400, "status filter is invalid", "INVALID_PRINT_JOB_FILTER");
    }
  }
  return Array.from(new Set(statuses));
};

const serializePrintJob = (job: PrintJobRecord): ManagedPrintJobSummary => ({
  id: job.id,
  workflowType: job.workflowType,
  printerId: job.printerId,
  printerKey: job.printer?.key ?? null,
  printerName: job.printer?.name ?? null,
  status: job.status,
  attemptCount: job.attemptCount,
  maxAttempts: job.maxAttempts,
  documentLabel: job.documentLabel ?? null,
  sourceEntityType: job.sourceEntityType ?? null,
  sourceEntityId: job.sourceEntityId ?? null,
  createdByStaffId: job.createdByStaffId ?? null,
  lastError: job.lastError ?? null,
  lastErrorCode: job.lastErrorCode ?? null,
  lastErrorRetryable: job.lastErrorRetryable ?? null,
  nextAttemptAt: job.nextAttemptAt?.toISOString() ?? null,
  createdAt: job.createdAt.toISOString(),
  updatedAt: job.updatedAt.toISOString(),
  startedAt: job.startedAt?.toISOString() ?? null,
  completedAt: job.completedAt?.toISOString() ?? null,
  cancelledAt: job.cancelledAt?.toISOString() ?? null,
  canRetry: job.status === "FAILED" || job.status === "CANCELLED",
});

const extractErrorCode = (error: unknown) => (error instanceof HttpError ? error.code : null);

const isRetryablePrintJobError = (error: unknown) => {
  const code = extractErrorCode(error);
  if (code && NON_RETRYABLE_ERROR_CODES.has(code)) {
    return false;
  }
  if (code && RETRYABLE_ERROR_CODES.has(code)) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return RETRYABLE_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
};

const buildFailureMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const getRetryBackoffMs = (attemptCount: number) => {
  if (attemptCount <= 0) {
    return RETRY_BACKOFF_MS[0];
  }
  if (attemptCount === 1) {
    return RETRY_BACKOFF_MS[1];
  }
  return RETRY_BACKOFF_MS[2];
};

const assertPayloadMatchesQueueRequest = (workflowType: ManagedPrintWorkflowType, printerId: string, payload: ManagedPrintQueuePayload) => {
  if (payload.workflowType !== workflowType) {
    throw new HttpError(
      400,
      "print job payload workflow does not match requested workflow type",
      "INVALID_PRINT_JOB",
    );
  }
  if (payload.printRequest.printer.printerId !== printerId) {
    throw new HttpError(
      400,
      "print job payload printer does not match requested printer",
      "INVALID_PRINT_JOB",
    );
  }
};

const getPrintJobByIdTx = async (db: ManagedPrintQueueClient, jobId: string) =>
  db.printJob.findUnique({
    where: { id: jobId },
    select: printJobSelect,
  });

const claimNextEligiblePrintJobForPrinter = async (
  db: ManagedPrintQueueClient,
  printerId: string,
  claimTime: Date,
): Promise<PrintJobRecord | null> => {
  const claimedRows = await db.$queryRaw<Array<{ id: string }>>`
    WITH next_job AS (
      SELECT "id"
      FROM "PrintJob"
      WHERE "printerId" = CAST(${printerId} AS UUID)
        AND "status" = 'PENDING'
        AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${claimTime})
        AND NOT EXISTS (
          SELECT 1
          FROM "PrintJob" processing
          WHERE processing."printerId" = CAST(${printerId} AS UUID)
            AND processing."status" = 'PROCESSING'
        )
      ORDER BY COALESCE("nextAttemptAt", "createdAt") ASC, "createdAt" ASC, "id" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "PrintJob"
    SET
      "status" = 'PROCESSING',
      "attemptCount" = "attemptCount" + 1,
      "startedAt" = ${claimTime},
      "updatedAt" = ${claimTime},
      "completedAt" = NULL,
      "cancelledAt" = NULL,
      "lastError" = NULL,
      "lastErrorCode" = NULL,
      "lastErrorRetryable" = NULL,
      "nextAttemptAt" = NULL
    WHERE "id" IN (SELECT "id" FROM next_job)
    RETURNING "id";
  `;

  const claimedId = claimedRows[0]?.id;
  if (!claimedId) {
    return null;
  }

  return getPrintJobByIdTx(db, claimedId);
};

const markPrintJobSucceeded = async (
  jobId: string,
  dispatchResult: ManagedPrintDispatchResult,
) => {
  const updated = await prisma.printJob.update({
    where: { id: jobId },
    data: {
      status: PrintJobStatus.SUCCEEDED,
      completedAt: new Date(),
      nextAttemptAt: null,
      lastError: null,
      lastErrorCode: null,
      lastErrorRetryable: null,
    },
    select: printJobSelect,
  });

  logOperationalEvent("print_queue.job.succeeded", {
    entityId: updated.id,
    workflowType: updated.workflowType,
    printerId: updated.printerId,
    attemptCount: updated.attemptCount,
    externalJobId: dispatchResult.externalJobId,
    printerTarget: dispatchResult.printerTarget,
    simulated: dispatchResult.simulated,
  });

  return updated;
};

const markPrintJobFailed = async (
  job: PrintJobRecord,
  error: unknown,
) => {
  const retryable = isRetryablePrintJobError(error);
  const canRetryAutomatically = retryable && job.attemptCount < job.maxAttempts;
  const lastError = buildFailureMessage(error);
  const lastErrorCode = extractErrorCode(error);
  const nextAttemptAt = canRetryAutomatically
    ? new Date(Date.now() + getRetryBackoffMs(job.attemptCount))
    : null;

  const updated = await prisma.printJob.update({
    where: { id: job.id },
    data: {
      status: canRetryAutomatically ? PrintJobStatus.PENDING : PrintJobStatus.FAILED,
      completedAt: canRetryAutomatically ? null : new Date(),
      nextAttemptAt,
      lastError,
      lastErrorCode,
      lastErrorRetryable: retryable,
    },
    select: printJobSelect,
  });

  logOperationalEvent(
    canRetryAutomatically ? "print_queue.job.retry_scheduled" : "print_queue.job.failed",
    {
      entityId: updated.id,
      workflowType: updated.workflowType,
      printerId: updated.printerId,
      attemptCount: updated.attemptCount,
      maxAttempts: updated.maxAttempts,
      lastErrorCode,
      lastError,
      retryable,
      nextAttemptAt: updated.nextAttemptAt?.toISOString() ?? null,
    },
  );

  return updated;
};

const processNextEligiblePrintJobForPrinter = async (printerId: string): Promise<boolean> => {
  const claimTime = new Date();
  const claimed = await prisma.$transaction((tx) => claimNextEligiblePrintJobForPrinter(tx, printerId, claimTime));
  if (!claimed) {
    return false;
  }

  try {
    const dispatchResult = await dispatchHandler(claimed.payload);
    await markPrintJobSucceeded(claimed.id, dispatchResult);
  } catch (error) {
    await markPrintJobFailed(claimed, error);
  }

  return true;
};

const drainPrinterQueue = async (printerId: string) => {
  while (await processNextEligiblePrintJobForPrinter(printerId)) {
    // keep draining eligible jobs for this printer one at a time
  }
};

const hasDuePrintJobForPrinter = async (printerId: string) => {
  const pendingJob = await prisma.printJob.findFirst({
    where: {
      printerId,
      status: PrintJobStatus.PENDING,
      OR: [
        { nextAttemptAt: null },
        { nextAttemptAt: { lte: new Date() } },
      ],
    },
    select: {
      id: true,
    },
  });

  return Boolean(pendingJob);
};

const ensurePrinterDrain = (printerId: string) => {
  const existing = activePrinterDrains.get(printerId);
  if (existing) {
    return existing;
  }

  const drainPromise = drainPrinterQueue(printerId)
    .catch((error) => {
      logOperationalEvent("print_queue.printer_drain.failed", {
        entityId: printerId,
        printerId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(async () => {
      activePrinterDrains.delete(printerId);
      try {
        if (await hasDuePrintJobForPrinter(printerId)) {
          void ensurePrinterDrain(printerId);
        }
      } catch (error) {
        logOperationalEvent("print_queue.printer_drain.recheck_failed", {
          entityId: printerId,
          printerId,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    });

  activePrinterDrains.set(printerId, drainPromise);
  return drainPromise;
};

export const triggerManagedPrintQueueForPrinter = (printerId: string) => {
  void ensurePrinterDrain(printerId);
};

export const processDueManagedPrintJobsOnce = async () => {
  const duePrinters = await prisma.printJob.findMany({
    where: {
      status: PrintJobStatus.PENDING,
      OR: [
        { nextAttemptAt: null },
        { nextAttemptAt: { lte: new Date() } },
      ],
    },
    distinct: ["printerId"],
    select: {
      printerId: true,
    },
  });

  await Promise.all(duePrinters.map((row) => ensurePrinterDrain(row.printerId)));
};

export const startManagedPrintQueueWorker = () => {
  if (queueSweepTimer) {
    return;
  }

  queueSweepTimer = setInterval(() => {
    void processDueManagedPrintJobsOnce();
  }, QUEUE_SWEEP_INTERVAL_MS);
  void processDueManagedPrintJobsOnce();
};

export const stopManagedPrintQueueWorker = () => {
  if (queueSweepTimer) {
    clearInterval(queueSweepTimer);
    queueSweepTimer = null;
  }
};

export const enqueueManagedPrintJob = async (
  input: EnqueueManagedPrintJobInput,
  auditActor?: AuditActor,
): Promise<ManagedPrintJobResponse> => {
  if (!isManagedPrintWorkflowType(input.workflowType)) {
    throw new HttpError(400, "workflowType is invalid", "INVALID_PRINT_JOB");
  }

  const payload = validateManagedPrintQueuePayload(input.payload);
  assertPayloadMatchesQueueRequest(input.workflowType, input.printerId, payload);
  const maxAttempts = normalizeMaxAttempts(input.maxAttempts);

  const created = await prisma.$transaction(async (tx) => {
    const job = await tx.printJob.create({
      data: {
        workflowType: input.workflowType as PrintJobWorkflowType,
        printerId: input.printerId,
        status: PrintJobStatus.PENDING,
        maxAttempts,
        payload: payload as unknown as Prisma.InputJsonValue,
        documentLabel: normalizeOptionalText(input.documentLabel),
        sourceEntityType: normalizeOptionalText(input.sourceEntityType),
        sourceEntityId: normalizeOptionalText(input.sourceEntityId),
        createdByStaffId: normalizeOptionalText(input.createdByStaffId),
        nextAttemptAt: new Date(),
      },
      select: printJobSelect,
    });

    await createAuditEventTx(
      tx,
      {
        action: "PRINT_JOB_ENQUEUED",
        entityType: "PRINT_JOB",
        entityId: job.id,
        metadata: {
          workflowType: job.workflowType,
          printerId: job.printerId,
          documentLabel: job.documentLabel,
          sourceEntityType: job.sourceEntityType,
          sourceEntityId: job.sourceEntityId,
        },
      },
      auditActor,
    );

    return job;
  });

  logOperationalEvent("print_queue.job.enqueued", {
    entityId: created.id,
    workflowType: created.workflowType,
    printerId: created.printerId,
    status: created.status,
    documentLabel: created.documentLabel,
  });

  triggerManagedPrintQueueForPrinter(created.printerId);

  return {
    job: serializePrintJob(created),
  };
};

export const listManagedPrintJobs = async (
  input: ListManagedPrintJobsInput = {},
): Promise<ManagedPrintJobListResponse> => {
  const statuses = normalizeStatuses(input.statuses);
  const take = normalizeTake(input.take);
  if (input.workflowType !== undefined && input.workflowType !== null && !isManagedPrintWorkflowType(input.workflowType)) {
    throw new HttpError(400, "workflowType filter is invalid", "INVALID_PRINT_JOB_FILTER");
  }

  const jobs = await prisma.printJob.findMany({
    where: {
      status: {
        in: statuses as PrintJobStatus[],
      },
      ...(input.workflowType ? { workflowType: input.workflowType as PrintJobWorkflowType } : {}),
      ...(input.printerId ? { printerId: input.printerId } : {}),
    },
    orderBy: [
      { createdAt: "desc" },
      { id: "desc" },
    ],
    take,
    select: printJobSelect,
  });

  return {
    jobs: jobs.map(serializePrintJob),
  };
};

export const getManagedPrintJob = async (jobId: string): Promise<ManagedPrintJobResponse> => {
  const job = await prisma.printJob.findUnique({
    where: { id: jobId },
    select: printJobSelect,
  });

  if (!job) {
    throw new HttpError(404, "Print job was not found", "PRINT_JOB_NOT_FOUND");
  }

  return {
    job: serializePrintJob(job),
  };
};

export const retryManagedPrintJob = async (
  jobId: string,
  auditActor?: AuditActor,
): Promise<ManagedPrintJobResponse> => {
  const retried = await prisma.$transaction(async (tx) => {
    const existing = await getPrintJobByIdTx(tx, jobId);
    if (!existing) {
      throw new HttpError(404, "Print job was not found", "PRINT_JOB_NOT_FOUND");
    }
    if (existing.status !== PrintJobStatus.FAILED && existing.status !== PrintJobStatus.CANCELLED) {
      throw new HttpError(409, "Only failed or cancelled print jobs can be retried", "PRINT_JOB_RETRY_INVALID");
    }

    const updated = await tx.printJob.update({
      where: { id: jobId },
      data: {
        status: PrintJobStatus.PENDING,
        attemptCount: 0,
        lastError: null,
        lastErrorCode: null,
        lastErrorRetryable: null,
        nextAttemptAt: new Date(),
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
      },
      select: printJobSelect,
    });

    await createAuditEventTx(
      tx,
      {
        action: "PRINT_JOB_RETRIED",
        entityType: "PRINT_JOB",
        entityId: updated.id,
        metadata: {
          workflowType: updated.workflowType,
          printerId: updated.printerId,
        },
      },
      auditActor,
    );

    return updated;
  });

  logOperationalEvent("print_queue.job.retried", {
    entityId: retried.id,
    workflowType: retried.workflowType,
    printerId: retried.printerId,
  });

  triggerManagedPrintQueueForPrinter(retried.printerId);

  return {
    job: serializePrintJob(retried),
  };
};

export const __testing = {
  setDispatchHandler(handler: DispatchHandler) {
    dispatchHandler = handler;
  },
  resetDispatchHandler() {
    dispatchHandler = dispatchManagedPrintPayload;
  },
  processDueManagedPrintJobsOnce,
  triggerManagedPrintQueueForPrinter,
  stopManagedPrintQueueWorker,
  isRetryablePrintJobError,
};
