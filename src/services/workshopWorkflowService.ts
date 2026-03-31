import { Prisma, WorkshopJobNoteVisibility, WorkshopJobStatus } from "@prisma/client";
import { logOperationalEvent } from "../lib/operationalLogger";
import { prisma } from "../lib/prisma";
import { emitEvent } from "../utils/domainEvent";
import { HttpError, isUuid } from "../utils/http";
import { createAuditEventTx, type AuditActor } from "./auditService";
import { setWorkshopEstimateStatus } from "./workshopEstimateService";
import {
  assertWorkshopScheduleAllowed,
  resolveWorkshopSchedulePatch,
} from "./workshopCalendarService";
import {
  buildWorkshopStatusAuditMetadata,
  parseWorkshopRawStatusAlias,
  toWorkshopExecutionStatus,
} from "./workshopStatusService";

type StaffRole = "STAFF" | "MANAGER" | "ADMIN";
type WorkflowStage = "BOOKED" | "IN_PROGRESS" | "READY" | "COMPLETED" | "CANCELLED";

type AssignWorkshopJobInput = {
  staffId: string | null;
  actorRole: StaffRole;
  actorId?: string;
};

type UpdateWorkshopJobScheduleInput = {
  staffId?: string | null;
  scheduledStartAt?: string | Date | null;
  scheduledEndAt?: string | Date | null;
  durationMinutes?: number | null;
  clearSchedule?: boolean;
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
  BOOKED: "BOOKED",
  BIKE_ARRIVED: "BOOKED",
  IN_PROGRESS: "IN_PROGRESS",
  WAITING_FOR_APPROVAL: "IN_PROGRESS",
  WAITING_FOR_PARTS: "IN_PROGRESS",
  ON_HOLD: "IN_PROGRESS",
  READY_FOR_COLLECTION: "READY",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
};

const ACTIVE_RAW_STATUSES = new Set<WorkshopJobStatus>([
  "BOOKED",
  "BIKE_ARRIVED",
  "IN_PROGRESS",
  "WAITING_FOR_APPROVAL",
  "WAITING_FOR_PARTS",
  "ON_HOLD",
  "READY_FOR_COLLECTION",
]);

const parseTargetStatusOrThrow = (inputStatus: string): {
  targetStatus: WorkshopJobStatus;
  requestedStatus: string;
} => {
  const requestedStatus = inputStatus.trim().toUpperCase();
  const targetStatus = parseWorkshopRawStatusAlias(requestedStatus);

  if (!targetStatus) {
    throw new HttpError(
      400,
      "status must be one of BOOKED, BIKE_ARRIVED, WAITING_FOR_APPROVAL, APPROVED, WAITING_FOR_PARTS, BIKE_READY, COMPLETED, ON_HOLD, or CANCELLED",
      "INVALID_STATUS",
    );
  }

  return {
    targetStatus,
    requestedStatus,
  };
};

const canManuallyTransitionStatus = (
  currentStatus: WorkshopJobStatus,
  targetStatus: WorkshopJobStatus,
) => {
  if (currentStatus === targetStatus) {
    return true;
  }

  if (!ACTIVE_RAW_STATUSES.has(currentStatus)) {
    return false;
  }

  if (targetStatus === "COMPLETED" || targetStatus === "CANCELLED") {
    return true;
  }

  return ACTIVE_RAW_STATUSES.has(targetStatus);
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

const resolveAssignedStaffTx = async (
  tx: Prisma.TransactionClient,
  staffId: string | null,
) => {
  if (!staffId) {
    return {
      assignedStaffId: null,
      assignedStaffName: null,
    };
  }

  const staff = await tx.user.findUnique({
    where: { id: staffId },
    select: {
      id: true,
      username: true,
      name: true,
    },
  });
  if (!staff) {
    throw new HttpError(404, "Staff member not found", "STAFF_NOT_FOUND");
  }

  return {
    assignedStaffId: staff.id,
    assignedStaffName: normalizeText(staff.name) ?? staff.username,
  };
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

    const nextAssignment = await resolveAssignedStaffTx(tx, input.staffId);
    const assignedStaffId = nextAssignment.assignedStaffId;
    const assignedStaffName = nextAssignment.assignedStaffName;

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

    await assertWorkshopScheduleAllowed(
      {
        workshopJobId,
        staffId: assignedStaffId,
        scheduledDate: job.scheduledDate,
        scheduledStartAt: job.scheduledStartAt,
        scheduledEndAt: job.scheduledEndAt,
        durationMinutes: job.durationMinutes,
      },
      tx,
    );

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

  return result;
};

export const updateWorkshopJobSchedule = async (
  workshopJobId: string,
  input: UpdateWorkshopJobScheduleInput,
  auditActor?: AuditActor,
) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  const hasAssignmentChange = input.staffId !== undefined;
  const hasScheduleChange =
    Boolean(input.clearSchedule)
    || input.scheduledStartAt !== undefined
    || input.scheduledEndAt !== undefined
    || input.durationMinutes !== undefined;

  if (!hasAssignmentChange && !hasScheduleChange) {
    throw new HttpError(400, "No schedule fields provided", "INVALID_WORKSHOP_SCHEDULE_UPDATE");
  }

  const result = await prisma.$transaction(async (tx) => {
    const job = await tx.workshopJob.findUnique({
      where: { id: workshopJobId },
    });

    if (!job) {
      throw new HttpError(404, "Workshop job not found", "WORKSHOP_JOB_NOT_FOUND");
    }

    if (hasAssignmentChange) {
      assertCanAssignOrUnassign(job.assignedStaffId, {
        staffId: input.staffId ?? null,
        actorRole: input.actorRole,
        actorId: input.actorId,
      });
    }

    const nextAssignment = hasAssignmentChange
      ? await resolveAssignedStaffTx(tx, input.staffId ?? null)
      : {
          assignedStaffId: job.assignedStaffId,
          assignedStaffName: job.assignedStaffName,
        };

    const scheduleResolution = await resolveWorkshopSchedulePatch(
      {
        scheduledStartAt: input.scheduledStartAt,
        scheduledEndAt: input.scheduledEndAt,
        durationMinutes: input.durationMinutes,
        clearSchedule: input.clearSchedule,
      },
      {
        scheduledDate: job.scheduledDate,
        scheduledStartAt: job.scheduledStartAt,
        scheduledEndAt: job.scheduledEndAt,
        durationMinutes: job.durationMinutes,
      },
      tx,
    );

    const assignmentChanged =
      nextAssignment.assignedStaffId !== job.assignedStaffId
      || nextAssignment.assignedStaffName !== job.assignedStaffName;
    const scheduleChanged =
      scheduleResolution.schedule.scheduledDate?.getTime() !== job.scheduledDate?.getTime()
      || scheduleResolution.schedule.scheduledStartAt?.getTime() !== job.scheduledStartAt?.getTime()
      || scheduleResolution.schedule.scheduledEndAt?.getTime() !== job.scheduledEndAt?.getTime()
      || scheduleResolution.schedule.durationMinutes !== job.durationMinutes
      || (scheduleResolution.schedule.scheduledDate === null) !== (job.scheduledDate === null)
      || (scheduleResolution.schedule.scheduledStartAt === null) !== (job.scheduledStartAt === null)
      || (scheduleResolution.schedule.scheduledEndAt === null) !== (job.scheduledEndAt === null);

    if (!assignmentChanged && !scheduleChanged) {
      return {
        job: {
          id: job.id,
          status: toWorkshopExecutionStatus(job),
          rawStatus: job.status,
          assignedStaffId: job.assignedStaffId,
          assignedStaffName: job.assignedStaffName,
          scheduledDate: job.scheduledDate,
          scheduledStartAt: job.scheduledStartAt,
          scheduledEndAt: job.scheduledEndAt,
          durationMinutes: job.durationMinutes,
          updatedAt: job.updatedAt,
        },
        idempotent: true,
      };
    }

    await assertWorkshopScheduleAllowed(
      {
        workshopJobId,
        staffId: nextAssignment.assignedStaffId,
        scheduledDate: scheduleResolution.schedule.scheduledDate,
        scheduledStartAt: scheduleResolution.schedule.scheduledStartAt,
        scheduledEndAt: scheduleResolution.schedule.scheduledEndAt,
        durationMinutes: scheduleResolution.schedule.durationMinutes,
      },
      tx,
    );

    const updated = await tx.workshopJob.update({
      where: { id: workshopJobId },
      data: {
        assignedStaffId: nextAssignment.assignedStaffId,
        assignedStaffName: nextAssignment.assignedStaffName,
        scheduledDate: scheduleResolution.schedule.scheduledDate,
        scheduledStartAt: scheduleResolution.schedule.scheduledStartAt,
        scheduledEndAt: scheduleResolution.schedule.scheduledEndAt,
        durationMinutes: scheduleResolution.schedule.durationMinutes,
      },
    });

    await createAuditEventTx(
      tx,
      {
        action: "JOB_SCHEDULE_UPDATED",
        entityType: "WORKSHOP_JOB",
        entityId: updated.id,
        metadata: {
          fromAssignedStaffId: job.assignedStaffId,
          fromAssignedStaffName: job.assignedStaffName,
          toAssignedStaffId: updated.assignedStaffId,
          toAssignedStaffName: updated.assignedStaffName,
          fromScheduledDate: job.scheduledDate?.toISOString() ?? null,
          toScheduledDate: updated.scheduledDate?.toISOString() ?? null,
          fromScheduledStartAt: job.scheduledStartAt?.toISOString() ?? null,
          toScheduledStartAt: updated.scheduledStartAt?.toISOString() ?? null,
          fromScheduledEndAt: job.scheduledEndAt?.toISOString() ?? null,
          toScheduledEndAt: updated.scheduledEndAt?.toISOString() ?? null,
          fromDurationMinutes: job.durationMinutes,
          toDurationMinutes: updated.durationMinutes,
          clearSchedule: input.clearSchedule === true,
        },
      },
      auditActor,
    );

    return {
      job: {
        id: updated.id,
        status: toWorkshopExecutionStatus(updated),
        rawStatus: updated.status,
        assignedStaffId: updated.assignedStaffId,
        assignedStaffName: updated.assignedStaffName,
        scheduledDate: updated.scheduledDate,
        scheduledStartAt: updated.scheduledStartAt,
        scheduledEndAt: updated.scheduledEndAt,
        durationMinutes: updated.durationMinutes,
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

  const {
    targetStatus,
    requestedStatus,
  } = parseTargetStatusOrThrow(rawStatus);
  const targetStage = stageByStatus[targetStatus];

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

    const fromStage = stageByStatus[job.status];
    if (job.status === targetStatus) {
      return {
        job: {
          id: job.id,
          customerId: job.customerId,
          bikeId: job.bikeId,
          status: job.status,
          rawStatus: job.status,
          cancelledAt: job.cancelledAt,
          updatedAt: job.updatedAt,
          completedAt: job.completedAt,
        },
        fromStatus: job.status,
        toStatus: job.status,
        idempotent: true,
        emittedStage: targetStage,
        stageChanged: false,
        saleId: job.sale?.id ?? null,
      };
    }

    const isAllowed = canManuallyTransitionStatus(job.status, targetStatus);

    if (!isAllowed) {
      throw new HttpError(
        409,
        "Invalid workshop status transition",
        "INVALID_STATUS_TRANSITION",
      );
    }

    if (fromStage === "READY" && targetStage === "COMPLETED" && !job.sale) {
      throw new HttpError(
        409,
        "Workshop job must be checked out to a sale before collection",
        "WORKSHOP_COLLECTION_REQUIRES_SALE",
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
          fromStage,
          toStage: targetStage,
          ...buildWorkshopStatusAuditMetadata({
            fromStatus: job.status,
            toStatus: updated.status,
            requestedStatus,
            changeSource: "MANUAL",
            trigger: "MANUAL_STATUS_SELECTOR",
          }),
        },
      },
      auditActor,
    );

    return {
      job: {
        id: updated.id,
        customerId: updated.customerId,
        bikeId: updated.bikeId,
        status: updated.status,
        rawStatus: updated.status,
        cancelledAt: updated.cancelledAt,
        updatedAt: updated.updatedAt,
        completedAt: updated.completedAt,
      },
      fromStatus: job.status,
      toStatus: updated.status,
      idempotent: false,
      emittedStage: targetStage,
      stageChanged: fromStage !== targetStage,
      saleId: job.sale?.id ?? null,
    };
  });

  logOperationalEvent("workshop.job.status_changed", {
    entityId: result.job.id,
    resultStatus: result.idempotent ? "noop" : "succeeded",
    workshopJobId: result.job.id,
    fromStatus: result.fromStatus,
    toStatus: result.toStatus,
    stage: result.emittedStage,
    idempotent: result.idempotent,
    completedAt: result.job.completedAt?.toISOString(),
  });

  if (!result.idempotent && result.stageChanged && result.emittedStage === "COMPLETED") {
    emitEvent("workshop.job.completed", {
      id: result.job.id,
      type: "workshop.job.completed",
      timestamp: new Date().toISOString(),
      workshopJobId: result.job.id,
      status: result.job.status,
      ...(result.job.completedAt ? { completedAt: result.job.completedAt.toISOString() } : {}),
      customerId: result.job.customerId,
      bikeId: result.job.bikeId,
      saleId: result.saleId ?? null,
    });
  }

  if (!result.idempotent && result.stageChanged && result.emittedStage === "READY") {
    emitEvent("workshop.job.ready_for_collection", {
      id: result.job.id,
      type: "workshop.job.ready_for_collection",
      timestamp: new Date().toISOString(),
      workshopJobId: result.job.id,
      status: result.job.status,
      customerId: result.job.customerId,
      bikeId: result.job.bikeId,
      saleId: result.saleId ?? null,
    });
  }

  return {
    job: {
      id: result.job.id,
      status: result.job.status,
      rawStatus: result.job.rawStatus,
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
      rawStatus: result.job.status,
      cancelledAt: null,
      updatedAt: result.estimate.updatedAt,
    },
    idempotent: result.idempotent,
  };
};
