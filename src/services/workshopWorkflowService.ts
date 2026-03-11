import { Prisma, WorkshopJobNoteVisibility, WorkshopJobStatus } from "@prisma/client";
import { emit } from "../core/events";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { createAuditEventTx, type AuditActor } from "./auditService";

type StaffRole = "STAFF" | "MANAGER" | "ADMIN";
type WorkflowStage = "BOOKED" | "IN_PROGRESS" | "READY" | "COMPLETED" | "CANCELLED";

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

const stageByStatus: Record<WorkshopJobStatus, WorkflowStage> = {
  BOOKING_MADE: "BOOKED",
  BIKE_ARRIVED: "IN_PROGRESS",
  WAITING_FOR_APPROVAL: "IN_PROGRESS",
  APPROVED: "IN_PROGRESS",
  WAITING_FOR_PARTS: "IN_PROGRESS",
  ON_HOLD: "IN_PROGRESS",
  BIKE_READY: "READY",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
};

const canonicalStatusByStage: Record<WorkflowStage, WorkshopJobStatus> = {
  BOOKED: "BOOKING_MADE",
  IN_PROGRESS: "BIKE_ARRIVED",
  READY: "BIKE_READY",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
};

const parseTargetStageOrThrow = (inputStatus: string): WorkflowStage => {
  const normalized = inputStatus.trim().toUpperCase();

  switch (normalized) {
    case "BOOKED":
    case "BOOKING_MADE":
      return "BOOKED";
    case "IN_PROGRESS":
    case "BIKE_ARRIVED":
    case "WAITING_FOR_APPROVAL":
    case "APPROVED":
    case "WAITING_FOR_PARTS":
    case "ON_HOLD":
      return "IN_PROGRESS";
    case "READY":
    case "BIKE_READY":
      return "READY";
    case "COMPLETED":
      return "COMPLETED";
    case "CANCELLED":
      return "CANCELLED";
    default:
      throw new HttpError(
        400,
        "status must be one of BOOKED, IN_PROGRESS, READY, COMPLETED, CANCELLED",
        "INVALID_STATUS",
      );
  }
};

const parseApprovalStatusOrThrow = (inputStatus: string): WorkshopJobStatus => {
  const normalized = inputStatus.trim().toUpperCase();

  if (normalized === "WAITING_FOR_APPROVAL") {
    return "WAITING_FOR_APPROVAL";
  }
  if (normalized === "APPROVED") {
    return "APPROVED";
  }

  throw new HttpError(
    400,
    "status must be WAITING_FOR_APPROVAL or APPROVED",
    "INVALID_APPROVAL_STATUS",
  );
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
        assignedStaffId: updated.assignedStaffId,
        assignedStaffName: updated.assignedStaffName,
        updatedAt: updated.updatedAt,
      },
      idempotent: false,
    };
  });
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

  const targetStage = parseTargetStageOrThrow(rawStatus);
  const targetStatus = canonicalStatusByStage[targetStage];

  return prisma.$transaction(async (tx) => {
    const job = await tx.workshopJob.findUnique({
      where: { id: workshopJobId },
    });

    if (!job) {
      throw new HttpError(404, "Workshop job not found", "WORKSHOP_JOB_NOT_FOUND");
    }

    const fromStage = stageByStatus[job.status];
    if (fromStage === targetStage) {
      return {
        job: {
          id: job.id,
          status: job.status,
          cancelledAt: job.cancelledAt,
          updatedAt: job.updatedAt,
          completedAt: job.completedAt,
        },
        idempotent: true,
        emittedStage: targetStage,
      };
    }

    const isAllowed =
      targetStage === "CANCELLED" ||
      (fromStage === "BOOKED" && targetStage === "IN_PROGRESS") ||
      (fromStage === "IN_PROGRESS" && targetStage === "READY") ||
      (fromStage === "READY" && targetStage === "COMPLETED");

    if (!isAllowed) {
      throw new HttpError(
        409,
        "Invalid workshop status transition",
        "INVALID_STATUS_TRANSITION",
      );
    }

    const data: Prisma.WorkshopJobUpdateInput = {
      status: targetStatus,
    };

    if (targetStage === "COMPLETED" && !job.completedAt) {
      data.completedAt = new Date();
    }

    if (targetStage === "CANCELLED") {
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
          fromStage,
          toStage: targetStage,
          requestedStatus: rawStatus,
        },
      },
      auditActor,
    );

    return {
      job: {
        id: updated.id,
        status: updated.status,
        cancelledAt: updated.cancelledAt,
        updatedAt: updated.updatedAt,
        completedAt: updated.completedAt,
      },
      idempotent: false,
      emittedStage: targetStage,
    };
  });

  if (!result.idempotent && (result.emittedStage === "READY" || result.emittedStage === "COMPLETED")) {
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
      cancelledAt: result.job.cancelledAt,
      updatedAt: result.job.updatedAt,
    },
    idempotent: result.idempotent,
  };
};

export const setWorkshopJobApprovalStatus = async (
  workshopJobId: string,
  input: SetWorkshopApprovalStatusInput,
  auditActor?: AuditActor,
) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  const targetStatus = parseApprovalStatusOrThrow(input.status);

  return prisma.$transaction(async (tx) => {
    const job = await tx.workshopJob.findUnique({
      where: { id: workshopJobId },
    });

    if (!job) {
      throw new HttpError(404, "Workshop job not found", "WORKSHOP_JOB_NOT_FOUND");
    }

    if (job.status === targetStatus) {
      return {
        job: {
          id: job.id,
          status: job.status,
          cancelledAt: job.cancelledAt,
          updatedAt: job.updatedAt,
        },
        idempotent: true,
      };
    }

    if (
      job.status === "WAITING_FOR_PARTS" ||
      job.status === "BIKE_READY" ||
      job.status === "COMPLETED" ||
      job.status === "CANCELLED"
    ) {
      throw new HttpError(
        409,
        "Approval state can only be set before the job is ready, completed, cancelled, or waiting for parts",
        "INVALID_APPROVAL_STATE_TRANSITION",
      );
    }

    const updated = await tx.workshopJob.update({
      where: { id: workshopJobId },
      data: {
        status: targetStatus,
      },
    });

    await createAuditEventTx(
      tx,
      {
        action: "JOB_APPROVAL_STATUS_CHANGED",
        entityType: "WORKSHOP_JOB",
        entityId: workshopJobId,
        metadata: {
          fromStatus: job.status,
          toStatus: updated.status,
        },
      },
      auditActor,
    );

    return {
      job: {
        id: updated.id,
        status: updated.status,
        cancelledAt: updated.cancelledAt,
        updatedAt: updated.updatedAt,
      },
      idempotent: false,
    };
  });
};
