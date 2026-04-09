import { Request, Response } from "express";
import {
  MANAGED_PRINT_JOB_STATUSES,
  MANAGED_PRINT_JOB_WORKFLOW_TYPES,
  type ManagedPrintJobStatus,
  type ManagedPrintWorkflowType,
} from "../../shared/managedPrintJobContract";
import { getRequestAuditActor } from "../middleware/staffRole";
import { listManagedPrintJobs, getManagedPrintJob, retryManagedPrintJob } from "../services/managedPrintQueueService";
import { HttpError } from "../utils/http";
import { parseOptionalIntegerQuery } from "../utils/requestParsing";

const parseStatusFilter = (value: unknown): ManagedPrintJobStatus[] | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, "status must be a comma-separated string", "INVALID_PRINT_JOB_FILTER");
  }

  const statuses = value
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);

  if (statuses.length === 0) {
    return undefined;
  }

  for (const status of statuses) {
    if (!MANAGED_PRINT_JOB_STATUSES.includes(status as ManagedPrintJobStatus)) {
      throw new HttpError(400, `Unsupported print job status: ${status}`, "INVALID_PRINT_JOB_FILTER");
    }
  }

  return statuses as ManagedPrintJobStatus[];
};

const parseWorkflowTypeFilter = (value: unknown): ManagedPrintWorkflowType | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, "workflowType must be a string", "INVALID_PRINT_JOB_FILTER");
  }

  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return undefined;
  }
  if (!MANAGED_PRINT_JOB_WORKFLOW_TYPES.includes(normalized as ManagedPrintWorkflowType)) {
    throw new HttpError(400, `Unsupported print workflow type: ${normalized}`, "INVALID_PRINT_JOB_FILTER");
  }

  return normalized as ManagedPrintWorkflowType;
};

export const listManagedPrintJobsHandler = async (req: Request, res: Response) => {
  const payload = await listManagedPrintJobs({
    statuses: parseStatusFilter(req.query.status),
    workflowType: parseWorkflowTypeFilter(req.query.workflowType),
    printerId: typeof req.query.printerId === "string" ? req.query.printerId : undefined,
    take: parseOptionalIntegerQuery(req.query.take, {
      code: "INVALID_PRINT_JOB_FILTER",
      message: "take must be an integer between 1 and 200",
      min: 1,
      max: 200,
    }),
  });

  res.json(payload);
};

export const getManagedPrintJobHandler = async (req: Request, res: Response) => {
  const payload = await getManagedPrintJob(req.params.jobId);
  res.json(payload);
};

export const retryManagedPrintJobHandler = async (req: Request, res: Response) => {
  const payload = await retryManagedPrintJob(req.params.jobId, getRequestAuditActor(req));
  res.json(payload);
};
