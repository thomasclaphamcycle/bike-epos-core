import { Prisma, WorkshopJobNoteVisibility, WorkshopJobStatus } from "@prisma/client";
import { emit } from "../core/events";
import { logOperationalEvent } from "../lib/operationalLogger";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { createAuditEventTx, type AuditActor } from "./auditService";
import { setWorkshopEstimateStatus } from "./workshopEstimateService";
import {
  normalizeWorkshopExecutionStatus,
  parseWorkshopExecutionStatusOrThrow,
  toStoredWorkshopJobStatus,
  type WorkshopExecutionStatus,
} from "./workshopStatusService";

type StaffRole = "STAFF" | "MANAGER" | "ADMIN";

type AssignWorkshopJobInput = {
  staffId: string | null;
  actorRole: StaffRole;
  actorId?: string;
};

type AddWorkshopJobNoteInput = {
  note: string;
  visibility: WorkshopJobNoteVisibility;
  authorStaffId?: string;
};

type ChangeWorkshopJobStatusInput = {
  status: string;
};

type SetWorkshopApprovalStatusInput = {
  status: string;
};

const normalizeText = (value: string | undefined | null): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const canTransitionExecutionStatus = (
  fromStatus: WorkshopExecutionStatus,
  toStatus: WorkshopExecutionStatus,
) => {
  if (fromStatus === toStatus) {
    return true;
  }

  switch (fromStatus) {
    case "BOOKING_MADE":
      return toStatus === "READY_FOR_WORK"
        || toStatus === "IN_PROGRESS"
        || toStatus === "CANCELLED";
    case "READY_FOR_WORK":
      return toStatus === "IN_PROGRESS"
        || toStatus === "PAUSED"
        || toStatus === "WAITING_FOR_PARTS"
        || toStatus === "CANCELLED";
    case "IN_PROGRESS":
      return toStatus === "PAUSED"
        || toStatus === "WAITING_FOR_PARTS"
        || toStatus === "READY_FOR_COLLECTION"
        || toStatus === "CANCELLED";
    case "PAUSED":
      return toStatus === "READY_FOR_WORK"
        || toStatus === "IN_PROGRESS"
        || toStatus === "WAITING_FOR_PARTS"
        || toStatus === "CANCELLED";
    case "WAITING_FOR_PARTS":
      return toStatus === "READY_FOR_WORK"
        || toStatus === "IN_PROGRESS"
        || toStatus === "PAUSED"
        || toStatus === "CANCELLED";
    case "READY_FOR_COLLECTION":
      return toStatus === "IN_PROGRESS"
        || toStatus === "PAUSED"
        || toStatus === "WAITING_FOR_PARTS"
        || toStatus === "COMPLETED";
    case "COMPLETED":
    case "CANCELLED":
      return false;
  }
};

const assertCanAssignOrUnassign = (jobAssignedStaffId: string | null, input: AssignWorkshopJobInput) => {
  if (input.actorRole !== "STAFF") {
    return;
  }

  const actorId = normalizeText(input.actorId);
  if (!actorId) {
    throw new HttpError(
      400,
      "X-Staff-Id is required for STAFF assignment changes",
      "MISSING_STAFF_ID",
    );
  }

  if (input.staffId === null) {
    if (jobAssignedStaffId && jobAssignedStaffId !== actorId) {
      throw new HttpError(
        403,
        "STAFF can only unassign jobs assigned to themselves",
        "INSUFFICIENT_ROLE",
      );
    }
    return;
  }

  if (input.staffId !== actorId) {
    throw new HttpError(
      403,
      "STAFF can only assign jobs to themselves",
      "INSUFFICIENT_ROLE",
    );
  }
};

export const assignWorkshopJob = async (
  workshopJobId: string,
  input: AssignWorkshopJobInput,
  auditActor?: AuditActor,
) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  const result = await prisma.$transaction(async (tx) => {
    const job = await tx.workshopJob.findUnique({
      where: { id: workshopJobId },
    });

    if (!job) {
      throw new HttpError(404, "Workshop job not found", "WORKSHOP_JOB_NOT_FOUND");
    }

    assertCanAssignOrUnassign(job.assignedStaffId, input);

    let assignedStaffId: string | null = input.staffId;
    let assignedStaffName: string | null = null;

    if (assignedStaffId) {
      const staff = await tx.user.findUnique({
        where: { id: assignedStaffId },
        select: {
          id: true,
          username: true,
          name: true,
        },
      });
      if (!staff) {
        throw new HttpError(404, "Staff member not found", "STAFF_NOT_FOUND");
      }
      assignedStaffName = normalizeText(staff.name) ?? staff.username;
    } else {
      assignedStaffId = null;
    }

    if (
      job.assignedStaffId === assignedStaffId &&
      (job.assignedStaffName ?? null) === (assignedStaffName ?? null)
    ) {
      return {
        job: {
          id: job.id,
          status: job.status,
          executionStatus: normalizeWorkshopExecutionStatus(job.status),
          assignedStaffId: job.assignedStaffId,
          assignedStaffName: job.assignedStaffName,
          updatedAt: job.updatedAt,
        },
        idempotent: true,
      };
    }

    const updated = await tx.workshopJob.update({
      where: { id: workshopJobId },
      data: {
        assignedStaffId,
        assignedStaffName,
      },
    });

    await createAuditEventTx(
      tx,
      {
        action: "JOB_ASSIGNED",
        entityType: "WORKSHOP_JOB",
        entityId: updated.id,
        metadata: {
          fromAssignedStaffId: job.assignedStaffId,
          fromAssignedStaffName: job.assignedStaffName,
          toAssignedStaffId: updated.assignedStaffId,
          toAssignedStaffName: updated.assignedStaffName,
        },
      },
      auditActor,
    );

    return {
      job: {
        id: updated.id,
        status: updated.status,
        executionStatus: normalizeWorkshopExecutionStatus(updated.status),
        assignedStaffId: updated.assignedStaffId,
        assignedStaffName: updated.assignedStaffName,
        updatedAt: updated.updatedAt,
      },
      idempotent: false,
    };
  });

  return result;
};

export const addWorkshopJobNote = async (
  workshopJobId: string,
  input: AddWorkshopJobNoteInput,
  auditActor?: AuditActor,
) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  const note = normalizeText(input.note);
  if (!note) {
    throw new HttpError(400, "note is required", "INVALID_NOTE");
  }

  const authorStaffId = normalizeText(input.authorStaffId) ?? null;

  return prisma.$transaction(async (tx) => {
    const job = await tx.workshopJob.findUnique({
      where: { id: workshopJobId },
      select: { id: true },
    });

    if (!job) {
      throw new HttpError(404, "Workshop job not found", "WORKSHOP_JOB_NOT_FOUND");
    }

    if (authorStaffId) {
      const author = await tx.user.findUnique({
        where: { id: authorStaffId },
        select: { id: true },
      });
      if (!author) {
        throw new HttpError(404, "Staff member not found", "STAFF_NOT_FOUND");
      }
    }

    const created = await tx.workshopJobNote.create({
      data: {
        workshopJobId,
        authorStaffId,
        visibility: input.visibility,
        note,
      },
      include: {
        authorStaff: {
          select: {
            id: true,
            username: true,
            name: true,
          },
        },
      },
    });

    await createAuditEventTx(
      tx,
      {
        action: "JOB_NOTE_ADDED",
        entityType: "WORKSHOP_JOB",
        entityId: workshopJobId,
        metadata: {
          noteId: created.id,
          visibility: created.visibility,
          authorStaffId: created.authorStaffId,
        },
      },
      auditActor,
    );

    return {
      note: {
        id: created.id,
        workshopJobId: created.workshopJobId,
        authorStaffId: created.authorStaffId,
        visibility: created.visibility,
        note: created.note,
        createdAt: created.createdAt,
        authorStaff: created.authorStaff
          ? {
              id: created.authorStaff.id,
              username: created.authorStaff.username,
              name: created.authorStaff.name,
            }
          : null,
      },
    };
  });
};

export const getWorkshopJobNotes = async (workshopJobId: string) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  const job = await prisma.workshopJob.findUnique({
    where: { id: workshopJobId },
    select: { id: true },
  });

  if (!job) {
    throw new HttpError(404, "Workshop job not found", "WORKSHOP_JOB_NOT_FOUND");
  }

  const notes = await prisma.workshopJobNote.findMany({
    where: { workshopJobId },
    orderBy: { createdAt: "desc" },
    include: {
      authorStaff: {
        select: {
          id: true,
          username: true,
          name: true,
        },
      },
    },
  });

  return {
    notes: notes.map((note) => ({
      id: note.id,
      workshopJobId: note.workshopJobId,
      authorStaffId: note.authorStaffId,
      visibility: note.visibility,
      note: note.note,
      createdAt: note.createdAt,
      authorStaff: note.authorStaff
        ? {
            id: note.authorStaff.id,
            username: note.authorStaff.username,
            name: note.authorStaff.name,
          }
        : null,
    })),
  };
};

export const changeWorkshopJobStatus = async (
  workshopJobId: string,
  input: ChangeWorkshopJobStatusInput,
  auditActor?: AuditActor,
) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  const rawStatus = normalizeText(input.status);
  if (!rawStatus) {
    throw new HttpError(400, "status is required", "INVALID_STATUS");
  }

  const targetExecutionStatus = parseWorkshopExecutionStatusOrThrow(rawStatus);
  const targetStatus = toStoredWorkshopJobStatus(targetExecutionStatus);

  const result = await prisma.$transaction(async (tx) => {
    const job = await tx.workshopJob.findUnique({
      where: { id: workshopJobId },
      include: {
        sale: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!job) {
      throw new HttpError(404, "Workshop job not found", "WORKSHOP_JOB_NOT_FOUND");
    }

    const fromExecutionStatus = normalizeWorkshopExecutionStatus(job.status);
    if (fromExecutionStatus === targetExecutionStatus) {
      return {
        job: {
          id: job.id,
          status: job.status,
          executionStatus: fromExecutionStatus,
          cancelledAt: job.cancelledAt,
          updatedAt: job.updatedAt,
          completedAt: job.completedAt,
        },
        fromStatus: job.status,
        toStatus: job.status,
        idempotent: true,
        emittedExecutionStatus: targetExecutionStatus,
      };
    }

    if (!canTransitionExecutionStatus(fromExecutionStatus, targetExecutionStatus)) {
      throw new HttpError(
        409,
        "Invalid workshop status transition",
        "INVALID_STATUS_TRANSITION",
      );
    }

    if (targetExecutionStatus === "COMPLETED" && !job.sale) {
      throw new HttpError(
        409,
        "Workshop job must be checked out to a sale before collection",
        "WORKSHOP_COLLECTION_REQUIRES_SALE",
      );
    }

    const data: Prisma.WorkshopJobUpdateInput = {
      status: targetStatus,
    };

    if (targetExecutionStatus === "COMPLETED" && !job.completedAt) {
      data.completedAt = new Date();
    }

    if (targetExecutionStatus === "CANCELLED") {
      data.cancelledAt = new Date();
    }

    const updated = await tx.workshopJob.update({
      where: { id: workshopJobId },
      data,
    });

    await createAuditEventTx(
      tx,
      {
        action: "JOB_STATUS_CHANGED",
        entityType: "WORKSHOP_JOB",
        entityId: workshopJobId,
        metadata: {
          fromStatus: job.status,
          toStatus: updated.status,
          fromExecutionStatus,
          toExecutionStatus: targetExecutionStatus,
          requestedStatus: rawStatus,
        },
      },
      auditActor,
    );

    return {
      job: {
        id: updated.id,
        status: updated.status,
        executionStatus: normalizeWorkshopExecutionStatus(updated.status),
        cancelledAt: updated.cancelledAt,
        updatedAt: updated.updatedAt,
        completedAt: updated.completedAt,
      },
      fromStatus: job.status,
      toStatus: updated.status,
      idempotent: false,
      emittedExecutionStatus: targetExecutionStatus,
    };
  });

  logOperationalEvent("workshop.job.status_changed", {
    entityId: result.job.id,
    resultStatus: result.idempotent ? "noop" : "succeeded",
    workshopJobId: result.job.id,
    fromStatus: result.fromStatus,
    toStatus: result.toStatus,
    fromExecutionStatus: normalizeWorkshopExecutionStatus(result.fromStatus),
    toExecutionStatus: result.emittedExecutionStatus,
    idempotent: result.idempotent,
    completedAt: result.job.completedAt?.toISOString(),
  });

  if (!result.idempotent && result.emittedExecutionStatus === "COMPLETED") {
    emit("workshop.job.completed", {
      id: result.job.id,
      type: "workshop.job.completed",
      timestamp: new Date().toISOString(),
      workshopJobId: result.job.id,
      status: result.job.status,
      ...(result.job.completedAt ? { completedAt: result.job.completedAt.toISOString() } : {}),
    });
  }

  return {
    job: {
      id: result.job.id,
      status: result.job.status,
      executionStatus: result.job.executionStatus,
      cancelledAt: result.job.cancelledAt,
      updatedAt: result.job.updatedAt,
      completedAt: result.job.completedAt,
    },
    idempotent: result.idempotent,
  };
};

export const setWorkshopJobApprovalStatus = async (
  workshopJobId: string,
  input: SetWorkshopApprovalStatusInput,
  auditActor?: AuditActor,
) => {
  const result = await setWorkshopEstimateStatus(
    workshopJobId,
    {
      status: input.status,
      actor: auditActor,
    },
  );

  return {
    job: {
      id: result.job.id,
      status: result.job.status,
      executionStatus: normalizeWorkshopExecutionStatus(result.job.status),
      cancelledAt: null,
      updatedAt: result.estimate.updatedAt,
    },
    idempotent: result.idempotent,
  };
};
