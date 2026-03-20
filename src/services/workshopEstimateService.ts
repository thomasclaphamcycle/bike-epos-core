import { Prisma, WorkshopEstimateStatus, WorkshopJobStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { createAuditEventTx, type AuditActor } from "./auditService";
import { normalizeWorkshopExecutionStatus } from "./workshopStatusService";

type SaveWorkshopEstimateInput = {
  actor?: AuditActor;
};

type SetWorkshopEstimateStatusInput = {
  status: string;
  actor?: AuditActor;
};

const estimateInclude = Prisma.validator<Prisma.WorkshopEstimateInclude>()({
  createdByStaff: {
    select: {
      id: true,
      username: true,
      name: true,
    },
  },
  decisionByStaff: {
    select: {
      id: true,
      username: true,
      name: true,
    },
  },
});

type WorkshopEstimateRecord = Prisma.WorkshopEstimateGetPayload<{
  include: typeof estimateInclude;
}>;

type WorkshopJobWithLinesRecord = {
  id: string;
  status: WorkshopJobStatus;
  closedAt: Date | null;
  lines: Array<{
    id: string;
    type: "PART" | "LABOUR";
    productId: string | null;
    variantId: string | null;
    description: string;
    qty: number;
    unitPricePence: number;
  }>;
};

const normalizeOptionalText = (value: string | undefined | null) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const canPersistEstimateForJobStatus = (status: WorkshopJobStatus) => {
  const executionStatus = normalizeWorkshopExecutionStatus(status);
  return executionStatus !== "READY_FOR_COLLECTION"
    && executionStatus !== "COMPLETED"
    && executionStatus !== "CANCELLED";
};

const parseEstimateStatus = (value: string) => {
  const normalized = value.trim().toUpperCase();

  if (normalized === "WAITING_FOR_APPROVAL") {
    return "PENDING_APPROVAL" as WorkshopEstimateStatus;
  }
  if (normalized === "APPROVED") {
    return "APPROVED" as WorkshopEstimateStatus;
  }
  if (normalized === "REJECTED") {
    return "REJECTED" as WorkshopEstimateStatus;
  }

  throw new HttpError(
    400,
    "status must be WAITING_FOR_APPROVAL, APPROVED, or REJECTED",
    "INVALID_APPROVAL_STATUS",
  );
};

const toEstimateResponse = (estimate: WorkshopEstimateRecord) => ({
  id: estimate.id,
  workshopJobId: estimate.workshopJobId,
  version: estimate.version,
  status: estimate.status,
  labourTotalPence: estimate.labourTotalPence,
  partsTotalPence: estimate.partsTotalPence,
  subtotalPence: estimate.subtotalPence,
  lineCount: estimate.lineCount,
  requestedAt: estimate.requestedAt,
  approvedAt: estimate.approvedAt,
  rejectedAt: estimate.rejectedAt,
  supersededAt: estimate.supersededAt,
  createdAt: estimate.createdAt,
  updatedAt: estimate.updatedAt,
  isCurrent: estimate.supersededAt === null,
  createdByStaff: estimate.createdByStaff
    ? {
        id: estimate.createdByStaff.id,
        username: estimate.createdByStaff.username,
        name: estimate.createdByStaff.name,
      }
    : null,
  decisionByStaff: estimate.decisionByStaff
    ? {
        id: estimate.decisionByStaff.id,
        username: estimate.decisionByStaff.username,
        name: estimate.decisionByStaff.name,
      }
    : null,
});

const resolveActorStaffIdTx = async (
  tx: Prisma.TransactionClient,
  actor?: AuditActor,
) => {
  const actorId = normalizeOptionalText(actor?.actorId);
  if (!actorId) {
    return null;
  }

  const user = await tx.user.findUnique({
    where: { id: actorId },
    select: { id: true },
  });

  return user?.id ?? null;
};

const ensureWorkshopJobWithLinesTx = async (
  tx: Prisma.TransactionClient | typeof prisma,
  workshopJobId: string,
): Promise<WorkshopJobWithLinesRecord> => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  const job = await tx.workshopJob.findUnique({
    where: { id: workshopJobId },
    select: {
      id: true,
      status: true,
      closedAt: true,
      lines: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          type: true,
          productId: true,
          variantId: true,
          description: true,
          qty: true,
          unitPricePence: true,
        },
      },
    },
  });

  if (!job) {
    throw new HttpError(404, "Workshop job not found", "WORKSHOP_JOB_NOT_FOUND");
  }

  return job;
};

const getCurrentWorkshopEstimateTx = async (
  tx: Prisma.TransactionClient | typeof prisma,
  workshopJobId: string,
) =>
  tx.workshopEstimate.findFirst({
    where: {
      workshopJobId,
      supersededAt: null,
    },
    include: estimateInclude,
    orderBy: [{ version: "desc" }],
  });

const listWorkshopEstimatesTx = async (
  tx: Prisma.TransactionClient | typeof prisma,
  workshopJobId: string,
) =>
  tx.workshopEstimate.findMany({
    where: { workshopJobId },
    include: estimateInclude,
    orderBy: [{ version: "desc" }],
  });

const getNextWorkshopEstimateVersionTx = async (
  tx: Prisma.TransactionClient,
  workshopJobId: string,
) => {
  const latest = await tx.workshopEstimate.findFirst({
    where: { workshopJobId },
    orderBy: [{ version: "desc" }],
    select: {
      version: true,
    },
  });

  return (latest?.version ?? 0) + 1;
};

const buildSnapshotTotals = (job: WorkshopJobWithLinesRecord) => {
  if (job.lines.length === 0) {
    throw new HttpError(
      409,
      "Add labour or part lines before saving an estimate",
      "WORKSHOP_ESTIMATE_EMPTY",
    );
  }

  const labourTotalPence = job.lines
    .filter((line) => line.type === "LABOUR")
    .reduce((sum, line) => sum + line.qty * line.unitPricePence, 0);
  const partsTotalPence = job.lines
    .filter((line) => line.type === "PART")
    .reduce((sum, line) => sum + line.qty * line.unitPricePence, 0);

  return {
    labourTotalPence,
    partsTotalPence,
    subtotalPence: labourTotalPence + partsTotalPence,
    lineCount: job.lines.length,
    lines: job.lines.map((line, index) => ({
      workshopJobLineId: line.id,
      sortOrder: index,
      type: line.type,
      productId: line.productId,
      variantId: line.variantId,
      description: line.description,
      qty: line.qty,
      unitPricePence: line.unitPricePence,
      lineTotalPence: line.qty * line.unitPricePence,
    })),
  };
};

const createEstimateVersionTx = async (
  tx: Prisma.TransactionClient,
  job: WorkshopJobWithLinesRecord,
  input: {
    status: WorkshopEstimateStatus;
    actor?: AuditActor;
    supersedeEstimateId?: string;
  },
) => {
  const actorStaffId = await resolveActorStaffIdTx(tx, input.actor);
  const nextVersion = await getNextWorkshopEstimateVersionTx(tx, job.id);
  const snapshot = buildSnapshotTotals(job);
  const now = new Date();

  if (input.supersedeEstimateId) {
    await tx.workshopEstimate.update({
      where: { id: input.supersedeEstimateId },
      data: {
        supersededAt: now,
      },
    });
  }

  const created = await tx.workshopEstimate.create({
    data: {
      workshopJobId: job.id,
      version: nextVersion,
      status: input.status,
      labourTotalPence: snapshot.labourTotalPence,
      partsTotalPence: snapshot.partsTotalPence,
      subtotalPence: snapshot.subtotalPence,
      lineCount: snapshot.lineCount,
      createdByStaffId: actorStaffId,
      decisionByStaffId:
        input.status === "APPROVED" || input.status === "REJECTED"
          ? actorStaffId
          : null,
      requestedAt: input.status === "PENDING_APPROVAL" ? now : null,
      approvedAt: input.status === "APPROVED" ? now : null,
      rejectedAt: input.status === "REJECTED" ? now : null,
      lines: {
        create: snapshot.lines,
      },
    },
    include: estimateInclude,
  });

  await createAuditEventTx(
    tx,
    {
      action: "WORKSHOP_ESTIMATE_CREATED",
      entityType: "WORKSHOP_ESTIMATE",
      entityId: created.id,
      metadata: {
        workshopJobId: job.id,
        version: created.version,
        status: created.status,
        subtotalPence: created.subtotalPence,
        lineCount: created.lineCount,
      },
    },
    input.actor,
  );

  return created;
};

const updateEstimateStatusTx = async (
  tx: Prisma.TransactionClient,
  estimate: WorkshopEstimateRecord,
  status: WorkshopEstimateStatus,
  actor?: AuditActor,
) => {
  const actorStaffId = await resolveActorStaffIdTx(tx, actor);
  const now = new Date();

  return tx.workshopEstimate.update({
    where: { id: estimate.id },
    data: {
      status,
      decisionByStaffId:
        status === "APPROVED" || status === "REJECTED" ? actorStaffId : null,
      requestedAt:
        status === "PENDING_APPROVAL"
          ? now
          : estimate.requestedAt,
      approvedAt: status === "APPROVED" ? now : null,
      rejectedAt: status === "REJECTED" ? now : null,
    },
    include: estimateInclude,
  });
};

const writeApprovalAuditEventsTx = async (
  tx: Prisma.TransactionClient,
  input: {
    workshopJobId: string;
    estimate: WorkshopEstimateRecord;
    fromEstimateStatus: WorkshopEstimateStatus | null;
    toEstimateStatus: WorkshopEstimateStatus;
    fromJobStatus: WorkshopJobStatus;
    toJobStatus: WorkshopJobStatus;
  },
  actor?: AuditActor,
) => {
  await createAuditEventTx(
    tx,
    {
      action: "JOB_APPROVAL_STATUS_CHANGED",
      entityType: "WORKSHOP_JOB",
      entityId: input.workshopJobId,
      metadata: {
        estimateId: input.estimate.id,
        estimateVersion: input.estimate.version,
        fromEstimateStatus: input.fromEstimateStatus,
        toEstimateStatus: input.toEstimateStatus,
        fromStatus: input.fromJobStatus,
        toStatus: input.toJobStatus,
      },
    },
    actor,
  );

  await createAuditEventTx(
    tx,
    {
      action: "WORKSHOP_ESTIMATE_STATUS_CHANGED",
      entityType: "WORKSHOP_ESTIMATE",
      entityId: input.estimate.id,
      metadata: {
        workshopJobId: input.workshopJobId,
        version: input.estimate.version,
        fromStatus: input.fromEstimateStatus,
        toStatus: input.toEstimateStatus,
      },
    },
    actor,
  );
};

export const invalidateCurrentWorkshopEstimateTx = async (
  tx: Prisma.TransactionClient,
  workshopJobId: string,
  reason: string,
  actor?: AuditActor,
) => {
  const job = await ensureWorkshopJobWithLinesTx(tx, workshopJobId);
  const currentEstimate = await getCurrentWorkshopEstimateTx(tx, workshopJobId);

  if (!currentEstimate) {
    return null;
  }

  const supersededAt = new Date();
  await tx.workshopEstimate.update({
    where: { id: currentEstimate.id },
    data: {
      supersededAt,
    },
  });

  const fromJobStatus = job.status;
  let toJobStatus = job.status;
  await createAuditEventTx(
    tx,
    {
      action: "JOB_ESTIMATE_INVALIDATED",
      entityType: "WORKSHOP_JOB",
      entityId: workshopJobId,
      metadata: {
        estimateId: currentEstimate.id,
        estimateVersion: currentEstimate.version,
        previousEstimateStatus: currentEstimate.status,
        fromStatus: fromJobStatus,
        toStatus: toJobStatus,
        reason,
      },
    },
    actor,
  );

  await createAuditEventTx(
    tx,
    {
      action: "WORKSHOP_ESTIMATE_SUPERSEDED",
      entityType: "WORKSHOP_ESTIMATE",
      entityId: currentEstimate.id,
      metadata: {
        workshopJobId,
        version: currentEstimate.version,
        status: currentEstimate.status,
        reason,
        supersededAt: supersededAt.toISOString(),
      },
    },
    actor,
  );

  return {
    estimateId: currentEstimate.id,
    version: currentEstimate.version,
    fromJobStatus,
    toJobStatus,
  };
};

export const saveWorkshopEstimate = async (
  workshopJobId: string,
  input: SaveWorkshopEstimateInput = {},
) => {
  return prisma.$transaction(async (tx) => {
    const job = await ensureWorkshopJobWithLinesTx(tx, workshopJobId);

    if (job.closedAt) {
      throw new HttpError(409, "Closed jobs cannot be estimated", "WORKSHOP_JOB_CLOSED");
    }
    if (!canPersistEstimateForJobStatus(job.status)) {
      throw new HttpError(
        409,
        "Estimate snapshots can only be saved before the job is ready for collection, completed, or cancelled",
        "INVALID_ESTIMATE_STATE_TRANSITION",
      );
    }

    const currentEstimate = await getCurrentWorkshopEstimateTx(tx, workshopJobId);
    if (currentEstimate) {
      return {
        estimate: toEstimateResponse(currentEstimate),
        idempotent: true,
      };
    }

    const created = await createEstimateVersionTx(tx, job, {
      status: "DRAFT",
      actor: input.actor,
    });

    return {
      estimate: toEstimateResponse(created),
      idempotent: false,
    };
  });
};

export const setWorkshopEstimateStatus = async (
  workshopJobId: string,
  input: SetWorkshopEstimateStatusInput,
) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  const targetStatus = parseEstimateStatus(input.status);

  return prisma.$transaction(async (tx) => {
    const job = await ensureWorkshopJobWithLinesTx(tx, workshopJobId);

    if (job.closedAt) {
      throw new HttpError(409, "Closed jobs cannot change estimate state", "WORKSHOP_JOB_CLOSED");
    }
    if (!canPersistEstimateForJobStatus(job.status)) {
      throw new HttpError(
        409,
        "Approval state can only be set before the job is ready for collection, completed, or cancelled",
        "INVALID_APPROVAL_STATE_TRANSITION",
      );
    }

    let currentEstimate = await getCurrentWorkshopEstimateTx(tx, workshopJobId);
    const fromJobStatus = job.status;

    if (!currentEstimate) {
      const created = await createEstimateVersionTx(tx, job, {
        status: targetStatus,
        actor: input.actor,
      });
      await writeApprovalAuditEventsTx(
        tx,
        {
          workshopJobId,
          estimate: created,
          fromEstimateStatus: null,
          toEstimateStatus: targetStatus,
          fromJobStatus,
          toJobStatus: job.status,
        },
        input.actor,
      );

      return {
        estimate: toEstimateResponse(created),
        job: {
          id: workshopJobId,
          status: job.status,
        },
        idempotent: false,
      };
    }

    let nextEstimate: WorkshopEstimateRecord;
    let nextEstimateStatus = targetStatus;
    const fromEstimateStatus = currentEstimate.status;

    if (targetStatus === "PENDING_APPROVAL") {
      if (currentEstimate.status === "PENDING_APPROVAL") {
        return {
          estimate: toEstimateResponse(currentEstimate),
          job: {
            id: workshopJobId,
            status: job.status,
          },
          idempotent: true,
        };
      }

      if (currentEstimate.status === "DRAFT") {
        nextEstimate = await updateEstimateStatusTx(tx, currentEstimate, "PENDING_APPROVAL", input.actor);
      } else {
        nextEstimate = await createEstimateVersionTx(tx, job, {
          status: "PENDING_APPROVAL",
          actor: input.actor,
          supersedeEstimateId: currentEstimate.id,
        });
      }
    } else if (targetStatus === "APPROVED") {
      if (currentEstimate.status === "APPROVED") {
        return {
          estimate: toEstimateResponse(currentEstimate),
          job: {
            id: workshopJobId,
            status: job.status,
          },
          idempotent: true,
        };
      }

      if (currentEstimate.status === "REJECTED") {
        nextEstimate = await createEstimateVersionTx(tx, job, {
          status: "APPROVED",
          actor: input.actor,
          supersedeEstimateId: currentEstimate.id,
        });
      } else {
        nextEstimate = await updateEstimateStatusTx(tx, currentEstimate, "APPROVED", input.actor);
      }
    } else {
      if (currentEstimate.status === "REJECTED") {
        return {
          estimate: toEstimateResponse(currentEstimate),
          job: {
            id: workshopJobId,
            status: job.status,
          },
          idempotent: true,
        };
      }

      nextEstimate = await updateEstimateStatusTx(tx, currentEstimate, "REJECTED", input.actor);
      nextEstimateStatus = "REJECTED";
    }

    await writeApprovalAuditEventsTx(
      tx,
      {
        workshopJobId,
        estimate: nextEstimate,
        fromEstimateStatus,
        toEstimateStatus: nextEstimateStatus,
        fromJobStatus,
        toJobStatus: job.status,
      },
      input.actor,
    );

    return {
      estimate: toEstimateResponse(nextEstimate),
      job: {
        id: workshopJobId,
        status: job.status,
      },
      idempotent: false,
    };
  });
};

export const getWorkshopJobEstimateData = async (workshopJobId: string) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  const estimates = await listWorkshopEstimatesTx(prisma, workshopJobId);
  const currentEstimate = estimates.find((estimate) => estimate.supersededAt === null) ?? null;

  return {
    currentEstimate: currentEstimate ? toEstimateResponse(currentEstimate) : null,
    estimateHistory: estimates.map(toEstimateResponse),
    hasApprovedEstimate: currentEstimate?.status === "APPROVED",
  };
};
