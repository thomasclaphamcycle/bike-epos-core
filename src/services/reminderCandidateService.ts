import { Prisma, ReminderCandidateStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";

export const DEFAULT_REMINDER_CANDIDATE_DUE_DAYS = 90;

type PrepareReminderCandidateInput = {
  workshopJobId: string;
  sourceEvent: string;
};

type ListReminderCandidatesInput = {
  status?: ReminderCandidateStatus;
  customerId?: string;
  take?: number;
  includeDismissed?: boolean;
};

const addDaysUtc = (value: Date, days: number) => {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const normalizeTake = (value: number | undefined) => {
  const resolved = value ?? 100;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > 200) {
    throw new HttpError(400, "take must be an integer between 1 and 200", "INVALID_REMINDER_CANDIDATE_FILTER");
  }
  return resolved;
};

const toResponse = (candidate: {
  id: string;
  customerId: string | null;
  workshopJobId: string;
  sourceEvent: string;
  dueAt: Date;
  status: ReminderCandidateStatus;
  reviewedAt: Date | null;
  reviewedByStaffId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: candidate.id,
  customerId: candidate.customerId,
  workshopJobId: candidate.workshopJobId,
  sourceEvent: candidate.sourceEvent,
  dueAt: candidate.dueAt,
  status: candidate.status,
  reviewedAt: candidate.reviewedAt,
  reviewedByStaffId: candidate.reviewedByStaffId,
  createdAt: candidate.createdAt,
  updatedAt: candidate.updatedAt,
});

const getReminderCandidateOrThrow = async (reminderCandidateId: string) => {
  if (!isUuid(reminderCandidateId)) {
    throw new HttpError(400, "Invalid reminder candidate id", "INVALID_REMINDER_CANDIDATE_ID");
  }

  const candidate = await prisma.reminderCandidate.findUnique({
    where: { id: reminderCandidateId },
  });

  if (!candidate) {
    throw new HttpError(404, "Reminder candidate not found", "REMINDER_CANDIDATE_NOT_FOUND");
  }

  return candidate;
};

const syncDueReminderCandidatesToReady = async (now = new Date()) => {
  await prisma.reminderCandidate.updateMany({
    where: {
      status: "PENDING",
      dueAt: {
        lte: now,
      },
    },
    data: {
      status: "READY",
    },
  });
};

export const prepareReminderCandidateFromWorkshopCompletion = async (
  input: PrepareReminderCandidateInput,
) => {
  if (!isUuid(input.workshopJobId)) {
    return null;
  }

  const workshopJob = await prisma.workshopJob.findUnique({
    where: { id: input.workshopJobId },
    select: {
      id: true,
      customerId: true,
      completedAt: true,
      status: true,
    },
  });

  if (
    !workshopJob ||
    !workshopJob.customerId ||
    !workshopJob.completedAt ||
    workshopJob.status !== "COMPLETED"
  ) {
    return null;
  }

  const dueAt = addDaysUtc(workshopJob.completedAt, DEFAULT_REMINDER_CANDIDATE_DUE_DAYS);
  const nextStatus: ReminderCandidateStatus = dueAt <= new Date() ? "READY" : "PENDING";

  const existing = await prisma.reminderCandidate.findUnique({
    where: { workshopJobId: workshopJob.id },
    select: {
      id: true,
      status: true,
    },
  });

  let candidate;

  if (existing) {
    candidate = await prisma.reminderCandidate.update({
      where: { workshopJobId: workshopJob.id },
      data: {
        customerId: workshopJob.customerId,
        sourceEvent: input.sourceEvent,
        dueAt,
        status: existing.status === "DISMISSED" ? "DISMISSED" : nextStatus,
      },
    });
  } else {
    try {
      candidate = await prisma.reminderCandidate.create({
        data: {
          customerId: workshopJob.customerId,
          workshopJobId: workshopJob.id,
          sourceEvent: input.sourceEvent,
          dueAt,
          status: nextStatus,
        },
      });
    } catch (createError) {
      if (
        createError instanceof Prisma.PrismaClientKnownRequestError &&
        createError.code === "P2002"
      ) {
        const concurrentExisting = await prisma.reminderCandidate.findUnique({
          where: { workshopJobId: workshopJob.id },
          select: {
            status: true,
          },
        });

        candidate = await prisma.reminderCandidate.update({
          where: { workshopJobId: workshopJob.id },
          data: {
            customerId: workshopJob.customerId,
            sourceEvent: input.sourceEvent,
            dueAt,
            status: concurrentExisting?.status === "DISMISSED" ? "DISMISSED" : nextStatus,
          },
        });
      } else {
        throw createError;
      }
    }
  }

  return toResponse(candidate);
};

export const listReminderCandidates = async (input: ListReminderCandidatesInput = {}) => {
  const take = normalizeTake(input.take);
  const now = new Date();

  await syncDueReminderCandidatesToReady(now);

  if (input.customerId !== undefined && !isUuid(input.customerId)) {
    throw new HttpError(400, "customerId must be a valid uuid", "INVALID_CUSTOMER_ID");
  }

  const candidates = await prisma.reminderCandidate.findMany({
    where: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.customerId ? { customerId: input.customerId } : {}),
      ...(!input.includeDismissed && !input.status
        ? {
            status: {
              not: "DISMISSED",
            },
          }
        : {}),
    },
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    take,
  });

  return {
    items: candidates.map(toResponse),
  };
};

export const dismissReminderCandidate = async (reminderCandidateId: string) => {
  return dismissReminderCandidateWithActor(reminderCandidateId);
};

export const markReminderCandidateReviewed = async (
  reminderCandidateId: string,
  reviewedByStaffId?: string,
) => {
  const existing = await getReminderCandidateOrThrow(reminderCandidateId);

  if (existing.reviewedAt) {
    return {
      candidate: toResponse(existing),
      idempotent: true,
    };
  }

  const candidate = await prisma.reminderCandidate.update({
    where: { id: existing.id },
    data: {
      reviewedAt: new Date(),
      reviewedByStaffId: reviewedByStaffId ?? existing.reviewedByStaffId,
    },
  });

  return {
    candidate: toResponse(candidate),
    idempotent: false,
  };
};

export const dismissReminderCandidateWithActor = async (
  reminderCandidateId: string,
  reviewedByStaffId?: string,
) => {
  const existing = await getReminderCandidateOrThrow(reminderCandidateId);

  if (existing.status === "DISMISSED") {
    return {
      candidate: toResponse(existing),
      idempotent: true,
    };
  }

  const reviewedAt = existing.reviewedAt ?? new Date();
  const candidate = await prisma.reminderCandidate.update({
    where: { id: existing.id },
    data: {
      status: "DISMISSED",
      reviewedAt,
      reviewedByStaffId: reviewedByStaffId ?? existing.reviewedByStaffId,
    },
  });

  return {
    candidate: toResponse(candidate),
    idempotent: false,
  };
};
