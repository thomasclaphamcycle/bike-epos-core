import { ReminderCandidateStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../utils/http";
import { toCustomerDisplayName, toPositiveIntWithinRangeOrThrow } from "./shared";

const MS_PER_DAY = 86_400_000;

const statusRank: Record<ReminderCandidateStatus, number> = {
  READY: 3,
  PENDING: 2,
  DISMISSED: 1,
};

const parseReminderCandidateStatus = (
  status: string | undefined,
): ReminderCandidateStatus | undefined => {
  if (status === undefined) {
    return undefined;
  }

  if (status === "PENDING" || status === "READY" || status === "DISMISSED") {
    return status;
  }

  throw new HttpError(
    400,
    "status must be one of PENDING, READY, DISMISSED",
    "INVALID_REPORT_FILTER",
  );
};

const syncReminderCandidateStatuses = async (now: Date) => {
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

export const getReminderCandidatesReport = async (
  status?: string,
  take?: number,
  includeDismissed?: boolean,
) => {
  const resolvedTake = toPositiveIntWithinRangeOrThrow(take, "take", 1, 200, 100);
  const resolvedStatus = parseReminderCandidateStatus(status);
  const resolvedIncludeDismissed = includeDismissed ?? false;
  const now = new Date();

  await syncReminderCandidateStatuses(now);

  const candidates = await prisma.reminderCandidate.findMany({
    where: {
      ...(resolvedStatus ? { status: resolvedStatus } : {}),
      ...(!resolvedStatus && !resolvedIncludeDismissed
        ? {
            status: {
              not: "DISMISSED",
            },
          }
        : {}),
    },
    select: {
      id: true,
      customerId: true,
      sourceEvent: true,
      dueAt: true,
      status: true,
      createdAt: true,
      customer: {
        select: {
          id: true,
          name: true,
          firstName: true,
          lastName: true,
        },
      },
      workshopJob: {
        select: {
          id: true,
          customerName: true,
          bikeDescription: true,
          completedAt: true,
        },
      },
    },
  });

  const items = candidates
    .map((candidate) => {
      const millisUntilDue = candidate.dueAt.getTime() - now.getTime();
      const daysUntilDue = millisUntilDue > 0
        ? Math.ceil(millisUntilDue / MS_PER_DAY)
        : 0;
      const daysOverdue = millisUntilDue < 0
        ? Math.ceil(Math.abs(millisUntilDue) / MS_PER_DAY)
        : 0;

      return {
        reminderCandidateId: candidate.id,
        customerId: candidate.customerId,
        customerName: candidate.customer
          ? toCustomerDisplayName(candidate.customer)
          : candidate.workshopJob.customerName?.trim() || "Unknown customer",
        workshopJobId: candidate.workshopJob.id,
        bikeDescription: candidate.workshopJob.bikeDescription,
        completedAt: candidate.workshopJob.completedAt,
        dueAt: candidate.dueAt,
        status: candidate.status,
        sourceEvent: candidate.sourceEvent,
        createdAt: candidate.createdAt,
        daysUntilDue,
        daysOverdue,
      };
    })
    .sort((left, right) => (
      statusRank[right.status] - statusRank[left.status]
      || left.dueAt.getTime() - right.dueAt.getTime()
      || left.customerName.localeCompare(right.customerName)
    ))
    .slice(0, resolvedTake);

  return {
    filters: {
      status: resolvedStatus ?? null,
      includeDismissed: resolvedIncludeDismissed,
      take: resolvedTake,
    },
    summary: {
      candidateCount: items.length,
      pendingCount: items.filter((item) => item.status === "PENDING").length,
      readyCount: items.filter((item) => item.status === "READY").length,
      dismissedCount: items.filter((item) => item.status === "DISMISSED").length,
      overdueCount: items.filter((item) => item.daysOverdue > 0).length,
    },
    items,
  };
};
