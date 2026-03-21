import crypto from "node:crypto";
import {
  Prisma,
  WorkshopEstimateDecisionSource,
  WorkshopEstimateStatus,
  WorkshopJobNoteVisibility,
  WorkshopJobStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { createAuditEventTx, type AuditActor } from "./auditService";
import { buildCustomerBikeDisplayName } from "./customerBikeService";

type SaveWorkshopEstimateInput = {
  actor?: AuditActor;
};

type SetWorkshopEstimateStatusInput = {
  status: string;
  actor?: AuditActor;
  decisionSource?: WorkshopEstimateDecisionSource;
};

type PublicWorkshopQuoteDecisionInput = {
  status: string;
};

const CUSTOMER_QUOTE_TTL_DAYS = 30;

const createSecureToken = () => crypto.randomBytes(24).toString("base64url");

const resolveCustomerQuoteExpiryDate = () =>
  new Date(Date.now() + CUSTOMER_QUOTE_TTL_DAYS * 24 * 60 * 60 * 1000);

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

const publicEstimateInclude = Prisma.validator<Prisma.WorkshopEstimateInclude>()({
  ...estimateInclude,
  lines: {
    include: {
      product: {
        select: {
          id: true,
          name: true,
        },
      },
      variant: {
        select: {
          id: true,
          sku: true,
          name: true,
        },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  },
  workshopJob: {
    select: {
      id: true,
      status: true,
      scheduledDate: true,
      bikeDescription: true,
      customerName: true,
      customer: {
        select: {
          id: true,
          name: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
      bike: {
        select: {
          id: true,
          customerId: true,
          label: true,
          make: true,
          model: true,
          colour: true,
          frameNumber: true,
          serialNumber: true,
          registrationNumber: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      jobNotes: {
        where: {
          visibility: "CUSTOMER" satisfies WorkshopJobNoteVisibility,
        },
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true,
          note: true,
          createdAt: true,
          authorStaff: {
            select: {
              id: true,
              username: true,
              name: true,
            },
          },
        },
      },
    },
  },
});

type WorkshopEstimateRecord = Prisma.WorkshopEstimateGetPayload<{
  include: typeof estimateInclude;
}>;

type PublicWorkshopEstimateRecord = Prisma.WorkshopEstimateGetPayload<{
  include: typeof publicEstimateInclude;
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

const canPersistEstimateForJobStatus = (status: WorkshopJobStatus) =>
  !["WAITING_FOR_PARTS", "BIKE_READY", "COMPLETED", "CANCELLED"].includes(status);

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

const parsePublicEstimateDecisionStatus = (value: string) => {
  const normalized = value.trim().toUpperCase();

  if (normalized === "APPROVED") {
    return "APPROVED" as WorkshopEstimateStatus;
  }
  if (normalized === "REJECTED") {
    return "REJECTED" as WorkshopEstimateStatus;
  }

  throw new HttpError(
    400,
    "status must be APPROVED or REJECTED",
    "INVALID_QUOTE_DECISION_STATUS",
  );
};

const toWorkshopJobStatusForEstimate = (
  status: WorkshopEstimateStatus,
): WorkshopJobStatus => {
  switch (status) {
    case "PENDING_APPROVAL":
      return "WAITING_FOR_APPROVAL";
    case "APPROVED":
      return "APPROVED";
    case "REJECTED":
      return "ON_HOLD";
    default:
      return "BIKE_ARRIVED";
  }
};

const getCustomerQuoteStatus = (estimate: {
  customerQuoteToken: string | null;
  customerQuoteTokenExpiresAt: Date | null;
}) => {
  if (!estimate.customerQuoteToken || !estimate.customerQuoteTokenExpiresAt) {
    return null;
  }

  return {
    publicPath: `/quote/${encodeURIComponent(estimate.customerQuoteToken)}`,
    expiresAt: estimate.customerQuoteTokenExpiresAt,
    status:
      estimate.customerQuoteTokenExpiresAt.getTime() < Date.now()
        ? ("EXPIRED" as const)
        : ("ACTIVE" as const),
  };
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
  decisionSource: estimate.decisionSource,
  createdAt: estimate.createdAt,
  updatedAt: estimate.updatedAt,
  isCurrent: estimate.supersededAt === null,
  customerQuote: getCustomerQuoteStatus(estimate),
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

const buildCustomerDisplayName = (customer: {
  name: string;
  firstName: string;
  lastName: string;
}) => {
  const explicitName = normalizeOptionalText(customer.name);
  if (explicitName) {
    return explicitName;
  }

  return [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();
};

const toPublicQuoteResponse = (
  estimate: PublicWorkshopEstimateRecord,
  input: {
    accessStatus: "ACTIVE" | "EXPIRED" | "SUPERSEDED";
    canApprove: boolean;
    canReject: boolean;
    idempotent?: boolean;
  },
) => {
  const customerName = estimate.workshopJob.customer
    ? buildCustomerDisplayName(estimate.workshopJob.customer)
    : normalizeOptionalText(estimate.workshopJob.customerName) ?? "Workshop customer";
  const bikeDisplayName = estimate.workshopJob.bike
    ? buildCustomerBikeDisplayName(estimate.workshopJob.bike)
    : normalizeOptionalText(estimate.workshopJob.bikeDescription) ?? "Bike";

  return {
    quote: {
      accessStatus: input.accessStatus,
      canApprove: input.canApprove,
      canReject: input.canReject,
      idempotent: input.idempotent ?? false,
      customerQuote: getCustomerQuoteStatus(estimate),
    },
    job: {
      id: estimate.workshopJob.id,
      status: estimate.workshopJob.status,
      scheduledDate: estimate.workshopJob.scheduledDate,
      customerName,
      bikeDescription: estimate.workshopJob.bikeDescription,
      bikeDisplayName,
      bike: estimate.workshopJob.bike
        ? {
            id: estimate.workshopJob.bike.id,
            displayName: bikeDisplayName,
            label: estimate.workshopJob.bike.label,
            make: estimate.workshopJob.bike.make,
            model: estimate.workshopJob.bike.model,
            colour: estimate.workshopJob.bike.colour,
          }
        : null,
    },
    customer: estimate.workshopJob.customer
      ? {
          id: estimate.workshopJob.customer.id,
          name: customerName,
          email: estimate.workshopJob.customer.email,
          phone: estimate.workshopJob.customer.phone,
        }
      : null,
    estimate: {
      ...toEstimateResponse(estimate),
      lines: estimate.lines.map((line) => ({
        id: line.id,
        type: line.type,
        description: line.description,
        qty: line.qty,
        unitPricePence: line.unitPricePence,
        lineTotalPence: line.lineTotalPence,
        productName: line.product?.name ?? null,
        variantName: line.variant?.name ?? null,
        variantSku: line.variant?.sku ?? null,
      })),
    },
    customerNotes: estimate.workshopJob.jobNotes.map((note) => ({
      id: note.id,
      note: note.note,
      createdAt: note.createdAt,
      authorName: note.authorStaff?.name ?? note.authorStaff?.username ?? null,
    })),
  };
};

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

const ensureCustomerQuoteTokenTx = async (
  tx: Prisma.TransactionClient,
  estimate: WorkshopEstimateRecord,
  actor?: AuditActor,
) => {
  const existingQuote = getCustomerQuoteStatus(estimate);
  if (existingQuote && existingQuote.status === "ACTIVE") {
    return {
      estimate,
      customerQuote: existingQuote,
      idempotent: true,
    };
  }

  const updated = await tx.workshopEstimate.update({
    where: { id: estimate.id },
    data: {
      customerQuoteToken: estimate.customerQuoteToken ?? createSecureToken(),
      customerQuoteTokenExpiresAt: resolveCustomerQuoteExpiryDate(),
    },
    include: estimateInclude,
  });

  await createAuditEventTx(
    tx,
    {
      action: "WORKSHOP_ESTIMATE_CUSTOMER_QUOTE_LINK_READY",
      entityType: "WORKSHOP_ESTIMATE",
      entityId: updated.id,
      metadata: {
        workshopJobId: updated.workshopJobId,
        version: updated.version,
        refreshed: Boolean(estimate.customerQuoteToken),
        quoteTokenExpiresAt: updated.customerQuoteTokenExpiresAt?.toISOString() ?? null,
      },
    },
    actor,
  );

  return {
    estimate: updated,
    customerQuote: getCustomerQuoteStatus(updated),
    idempotent: false,
  };
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

const getWorkshopEstimateByCustomerQuoteTokenTx = async (
  tx: Prisma.TransactionClient | typeof prisma,
  token: string,
) =>
  tx.workshopEstimate.findUnique({
    where: { customerQuoteToken: token },
    include: publicEstimateInclude,
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
    decisionSource?: WorkshopEstimateDecisionSource | null;
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
      decisionSource:
        input.status === "APPROVED" || input.status === "REJECTED"
          ? (input.decisionSource ?? "STAFF")
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

const updateWorkshopJobStatusFromEstimateTx = async (
  tx: Prisma.TransactionClient,
  jobId: string,
  currentStatus: WorkshopJobStatus,
  estimateStatus: WorkshopEstimateStatus,
) => {
  const nextStatus = toWorkshopJobStatusForEstimate(estimateStatus);
  if (currentStatus === nextStatus) {
    return currentStatus;
  }

  const updated = await tx.workshopJob.update({
    where: { id: jobId },
    data: {
      status: nextStatus,
    },
    select: {
      status: true,
    },
  });

  return updated.status;
};

const updateEstimateStatusTx = async (
  tx: Prisma.TransactionClient,
  estimate: WorkshopEstimateRecord,
  status: WorkshopEstimateStatus,
  actor?: AuditActor,
  decisionSource: WorkshopEstimateDecisionSource | null = "STAFF",
) => {
  const actorStaffId = await resolveActorStaffIdTx(tx, actor);
  const now = new Date();

  return tx.workshopEstimate.update({
    where: { id: estimate.id },
    data: {
      status,
      decisionByStaffId:
        status === "APPROVED" || status === "REJECTED" ? actorStaffId : null,
      decisionSource:
        status === "APPROVED" || status === "REJECTED"
          ? decisionSource
          : null,
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
        decisionSource: input.estimate.decisionSource,
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
        decisionSource: input.estimate.decisionSource,
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
  if (job.status === "WAITING_FOR_APPROVAL" || job.status === "APPROVED") {
    const updated = await tx.workshopJob.update({
      where: { id: workshopJobId },
      data: {
        status: "BIKE_ARRIVED",
      },
      select: {
        status: true,
      },
    });
    toJobStatus = updated.status;
  }

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
        "Estimate snapshots can only be saved before the job is ready, completed, cancelled, or waiting for parts",
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
  const decisionSource = input.decisionSource ?? "STAFF";

  return prisma.$transaction(async (tx) => {
    const job = await ensureWorkshopJobWithLinesTx(tx, workshopJobId);

    if (job.closedAt) {
      throw new HttpError(409, "Closed jobs cannot change estimate state", "WORKSHOP_JOB_CLOSED");
    }
    if (!canPersistEstimateForJobStatus(job.status)) {
      throw new HttpError(
        409,
        "Approval state can only be set before the job is ready, completed, cancelled, or waiting for parts",
        "INVALID_APPROVAL_STATE_TRANSITION",
      );
    }

    let currentEstimate = await getCurrentWorkshopEstimateTx(tx, workshopJobId);
    const fromJobStatus = job.status;

    if (!currentEstimate) {
      const created = await createEstimateVersionTx(tx, job, {
        status: targetStatus,
        actor: input.actor,
        decisionSource,
      });
      const toJobStatus = await updateWorkshopJobStatusFromEstimateTx(
        tx,
        workshopJobId,
        job.status,
        targetStatus,
      );
      await writeApprovalAuditEventsTx(
        tx,
        {
          workshopJobId,
          estimate: created,
          fromEstimateStatus: null,
          toEstimateStatus: targetStatus,
          fromJobStatus,
          toJobStatus,
        },
        input.actor,
      );

      return {
        estimate: toEstimateResponse(created),
        job: {
          id: workshopJobId,
          status: toJobStatus,
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
        nextEstimate = await updateEstimateStatusTx(
          tx,
          currentEstimate,
          "PENDING_APPROVAL",
          input.actor,
          null,
        );
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
          decisionSource,
        });
      } else {
        nextEstimate = await updateEstimateStatusTx(
          tx,
          currentEstimate,
          "APPROVED",
          input.actor,
          decisionSource,
        );
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

      nextEstimate = await updateEstimateStatusTx(
        tx,
        currentEstimate,
        "REJECTED",
        input.actor,
        decisionSource,
      );
      nextEstimateStatus = "REJECTED";
    }

    const toJobStatus = await updateWorkshopJobStatusFromEstimateTx(
      tx,
      workshopJobId,
      job.status,
      nextEstimateStatus,
    );

    await writeApprovalAuditEventsTx(
      tx,
      {
        workshopJobId,
        estimate: nextEstimate,
        fromEstimateStatus,
        toEstimateStatus: nextEstimateStatus,
        fromJobStatus,
        toJobStatus,
      },
      input.actor,
    );

    return {
      estimate: toEstimateResponse(nextEstimate),
      job: {
        id: workshopJobId,
        status: toJobStatus,
      },
      idempotent: false,
    };
  });
};

export const createWorkshopEstimateCustomerQuoteLink = async (
  workshopJobId: string,
  input: SaveWorkshopEstimateInput = {},
) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  return prisma.$transaction(async (tx) => {
    const job = await ensureWorkshopJobWithLinesTx(tx, workshopJobId);

    if (job.closedAt) {
      throw new HttpError(409, "Closed jobs cannot share customer quotes", "WORKSHOP_JOB_CLOSED");
    }

    const currentEstimate = await getCurrentWorkshopEstimateTx(tx, workshopJobId);
    if (!currentEstimate) {
      throw new HttpError(
        409,
        "Save or request an estimate before sharing a customer quote link",
        "WORKSHOP_ESTIMATE_NOT_READY",
      );
    }

    const prepared = await ensureCustomerQuoteTokenTx(tx, currentEstimate, input.actor);

    return {
      estimate: toEstimateResponse(prepared.estimate),
      customerQuote: prepared.customerQuote,
      idempotent: prepared.idempotent,
    };
  });
};

export const getPublicWorkshopEstimateQuote = async (tokenValue: string) => {
  const token = normalizeOptionalText(tokenValue);
  if (!token) {
    throw new HttpError(400, "Quote token is required", "INVALID_QUOTE_TOKEN");
  }

  const estimate = await getWorkshopEstimateByCustomerQuoteTokenTx(prisma, token);
  if (!estimate) {
    throw new HttpError(404, "Quote link not found", "WORKSHOP_QUOTE_NOT_FOUND");
  }

  const currentEstimate = await getCurrentWorkshopEstimateTx(prisma, estimate.workshopJobId);
  const customerQuote = getCustomerQuoteStatus(estimate);
  const isCurrent = currentEstimate?.id === estimate.id && estimate.supersededAt === null;
  const accessStatus =
    !isCurrent
      ? ("SUPERSEDED" as const)
      : customerQuote?.status === "EXPIRED"
        ? ("EXPIRED" as const)
        : ("ACTIVE" as const);
  const canRespond =
    accessStatus === "ACTIVE" && estimate.status === "PENDING_APPROVAL";

  return toPublicQuoteResponse(estimate, {
    accessStatus,
    canApprove: canRespond,
    canReject: canRespond,
  });
};

export const submitPublicWorkshopEstimateQuoteDecision = async (
  tokenValue: string,
  input: PublicWorkshopQuoteDecisionInput,
) => {
  const token = normalizeOptionalText(tokenValue);
  if (!token) {
    throw new HttpError(400, "Quote token is required", "INVALID_QUOTE_TOKEN");
  }

  const targetStatus = parsePublicEstimateDecisionStatus(input.status);

  return prisma.$transaction(async (tx) => {
    const estimate = await getWorkshopEstimateByCustomerQuoteTokenTx(tx, token);
    if (!estimate) {
      throw new HttpError(404, "Quote link not found", "WORKSHOP_QUOTE_NOT_FOUND");
    }

    const customerQuote = getCustomerQuoteStatus(estimate);
    if (!customerQuote || customerQuote.status === "EXPIRED") {
      throw new HttpError(410, "This quote link has expired", "WORKSHOP_QUOTE_EXPIRED");
    }

    const currentEstimate = await getCurrentWorkshopEstimateTx(tx, estimate.workshopJobId);
    if (!currentEstimate || currentEstimate.id !== estimate.id || estimate.supersededAt !== null) {
      throw new HttpError(
        409,
        "This quote is no longer current. Please contact the shop for the latest estimate.",
        "WORKSHOP_QUOTE_SUPERSEDED",
      );
    }

    if (estimate.status === targetStatus) {
      return toPublicQuoteResponse(estimate, {
        accessStatus: "ACTIVE",
        canApprove: false,
        canReject: false,
        idempotent: true,
      });
    }

    if (estimate.status !== "PENDING_APPROVAL") {
      throw new HttpError(
        409,
        "This quote is not awaiting customer approval.",
        "WORKSHOP_QUOTE_NOT_ACTIONABLE",
      );
    }

    const nextEstimate = await updateEstimateStatusTx(
      tx,
      estimate,
      targetStatus,
      undefined,
      "CUSTOMER",
    );
    const toJobStatus = await updateWorkshopJobStatusFromEstimateTx(
      tx,
      estimate.workshopJobId,
      estimate.workshopJob.status,
      targetStatus,
    );

    await writeApprovalAuditEventsTx(
      tx,
      {
        workshopJobId: estimate.workshopJobId,
        estimate: nextEstimate,
        fromEstimateStatus: estimate.status,
        toEstimateStatus: targetStatus,
        fromJobStatus: estimate.workshopJob.status,
        toJobStatus,
      },
      undefined,
    );

    await createAuditEventTx(tx, {
      action: "WORKSHOP_ESTIMATE_CUSTOMER_DECISION",
      entityType: "WORKSHOP_ESTIMATE",
      entityId: nextEstimate.id,
      metadata: {
        workshopJobId: nextEstimate.workshopJobId,
        version: nextEstimate.version,
        decisionStatus: targetStatus,
        quoteTokenLastEight: token.slice(-8),
      },
    });

    const refreshed = await getWorkshopEstimateByCustomerQuoteTokenTx(tx, token);
    if (!refreshed) {
      throw new HttpError(500, "Quote decision could not be reloaded", "WORKSHOP_QUOTE_RELOAD_FAILED");
    }

    return toPublicQuoteResponse(refreshed, {
      accessStatus: "ACTIVE",
      canApprove: false,
      canReject: false,
      idempotent: false,
    });
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
