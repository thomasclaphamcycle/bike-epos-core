import crypto from "node:crypto";
import {
  Prisma,
  WorkshopEstimateDecisionSource,
  WorkshopEstimateStatus,
  WorkshopJobLineType,
  WorkshopJobNoteVisibility,
  WorkshopJobSource,
  WorkshopJobStatus,
  WorkshopNotificationEventType,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { getCustomerDisplayName } from "../utils/customerName";
import { emitEvent } from "../utils/domainEvent";
import { createAuditEventTx, type AuditActor } from "./auditService";
import { buildWorkshopStatusAuditMetadata } from "./workshopStatusService";
import { buildCustomerBikeDisplayName } from "./customerBikeService";
import { toWorkshopExecutionStatus } from "./workshopStatusService";

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
      closedAt: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
      scheduledDate: true,
      scheduledStartAt: true,
      scheduledEndAt: true,
      durationMinutes: true,
      bikeDescription: true,
      customerName: true,
      customer: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
      bike: {
        select: {
          label: true,
          make: true,
          model: true,
          year: true,
          bikeType: true,
          colour: true,
          wheelSize: true,
          frameSize: true,
          groupset: true,
          motorBrand: true,
          motorModel: true,
        },
      },
      sale: {
        select: {
          totalPence: true,
          createdAt: true,
        },
      },
      lines: {
        include: {
          product: {
            select: {
              name: true,
            },
          },
          variant: {
            select: {
              sku: true,
              name: true,
            },
          },
        },
        orderBy: [{ createdAt: "asc" }],
      },
      jobNotes: {
        where: {
          visibility: "CUSTOMER" satisfies WorkshopJobNoteVisibility,
        },
        orderBy: [{ createdAt: "desc" }],
        select: {
          note: true,
          createdAt: true,
        },
      },
      notifications: {
        where: {
          deliveryStatus: "SENT",
          eventType: {
            in: [
              "QUOTE_READY" satisfies WorkshopNotificationEventType,
              "JOB_READY_FOR_COLLECTION" satisfies WorkshopNotificationEventType,
            ],
          },
        },
        orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
        select: {
          eventType: true,
          sentAt: true,
          createdAt: true,
        },
      },
    },
  },
});

const publicEstimateSummaryInclude = Prisma.validator<Prisma.WorkshopEstimateInclude>()({
  lines: {
    include: {
      product: {
        select: {
          name: true,
        },
      },
      variant: {
        select: {
          sku: true,
          name: true,
        },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  },
});

type WorkshopEstimateRecord = Prisma.WorkshopEstimateGetPayload<{
  include: typeof estimateInclude;
}>;

type PublicWorkshopEstimateRecord = Prisma.WorkshopEstimateGetPayload<{
  include: typeof publicEstimateInclude;
}>;

type PublicWorkshopEstimateSummaryRecord = Prisma.WorkshopEstimateGetPayload<{
  include: typeof publicEstimateSummaryInclude;
}>;

type WorkshopJobWithLinesRecord = {
  id: string;
  bikeId: string | null;
  bikeDescription: string | null;
  assignedStaffId: string | null;
  status: WorkshopJobStatus;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  durationMinutes: number | null;
  source: WorkshopJobSource;
  finalizedBasketId: string | null;
  completedAt: Date | null;
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

const hasBikePresentEvidence = (
  job: Pick<WorkshopJobWithLinesRecord, "bikeId" | "bikeDescription" | "source">,
) =>
  Boolean(
    job.bikeId
    || normalizeOptionalText(job.bikeDescription)
    || job.source === "IN_STORE",
  );

const hasActiveWorkEvidence = (
  job: Pick<
    WorkshopJobWithLinesRecord,
    "assignedStaffId" | "scheduledStartAt" | "scheduledEndAt" | "durationMinutes" | "finalizedBasketId" | "completedAt"
  >,
) =>
  Boolean(
    job.assignedStaffId
    || job.scheduledStartAt
    || job.scheduledEndAt
    || job.durationMinutes
    || job.finalizedBasketId
    || job.completedAt,
  );

const resolvePreWorkWorkshopStatus = (
  job: Pick<WorkshopJobWithLinesRecord, "bikeId" | "bikeDescription" | "source">,
): WorkshopJobStatus => (hasBikePresentEvidence(job) ? "BIKE_ARRIVED" : "BOOKED");

const canPersistEstimateForJobStatus = (status: WorkshopJobStatus) =>
  !["WAITING_FOR_PARTS", "READY_FOR_COLLECTION", "COMPLETED", "CANCELLED"].includes(status);

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
  job: WorkshopJobWithLinesRecord,
  estimateStatus: WorkshopEstimateStatus,
): WorkshopJobStatus => {
  switch (estimateStatus) {
    case "PENDING_APPROVAL":
      return "WAITING_FOR_APPROVAL";
    case "APPROVED":
      if (job.status === "IN_PROGRESS" || job.status === "WAITING_FOR_PARTS" || job.status === "ON_HOLD") {
        return job.status;
      }
      return hasActiveWorkEvidence(job) ? "IN_PROGRESS" : resolvePreWorkWorkshopStatus(job);
    case "REJECTED":
      return "ON_HOLD";
    default:
      return resolvePreWorkWorkshopStatus(job);
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
    publicPath: `/public/workshop/${encodeURIComponent(estimate.customerQuoteToken)}`,
    expiresAt: estimate.customerQuoteTokenExpiresAt,
    status:
      estimate.customerQuoteTokenExpiresAt.getTime() < Date.now()
        ? ("EXPIRED" as const)
        : ("ACTIVE" as const),
  };
};

type WorkshopPortalAccessStatus =
  | "ACTIVE"
  | "EXPIRED"
  | "SUPERSEDED"
  | "UNAVAILABLE";

const getCurrentWorkshopEstimateMetaTx = async (
  tx: Prisma.TransactionClient,
  workshopJobId: string,
) =>
  tx.workshopEstimate.findFirst({
    where: {
      workshopJobId,
      supersededAt: null,
    },
    select: {
      id: true,
      version: true,
    },
    orderBy: [{ version: "desc" }],
  });

export const getWorkshopPortalAccessForJobTx = async (
  tx: Prisma.TransactionClient,
  workshopJobId: string,
) => {
  const [currentEstimate, estimates] = await Promise.all([
    getCurrentWorkshopEstimateMetaTx(tx, workshopJobId),
    tx.workshopEstimate.findMany({
      where: {
        workshopJobId,
        customerQuoteToken: {
          not: null,
        },
      },
      select: {
        id: true,
        version: true,
        customerQuoteToken: true,
        customerQuoteTokenExpiresAt: true,
      },
      orderBy: [{ version: "desc" }],
    }),
  ]);

  if (estimates.length === 0) {
    return {
      accessStatus: "UNAVAILABLE" as WorkshopPortalAccessStatus,
      publicPath: null,
      expiresAt: null,
      linkedEstimateId: null,
      linkedEstimateVersion: null,
      currentEstimateVersion: currentEstimate?.version ?? null,
      hasUpdatedEstimate: false,
      canCustomerReply: false,
    };
  }

  const activeCurrent =
    estimates.find(
      (estimate) =>
        estimate.id === currentEstimate?.id &&
        getCustomerQuoteStatus(estimate)?.status === "ACTIVE",
    ) ?? null;
  const activeAny =
    estimates.find((estimate) => getCustomerQuoteStatus(estimate)?.status === "ACTIVE") ?? null;
  const selectedEstimate = activeCurrent ?? activeAny ?? estimates[0];
  const customerQuote = getCustomerQuoteStatus(selectedEstimate);
  const accessStatus: WorkshopPortalAccessStatus =
    customerQuote?.status === "EXPIRED"
      ? "EXPIRED"
      : currentEstimate && currentEstimate.id !== selectedEstimate.id
        ? "SUPERSEDED"
        : "ACTIVE";

  return {
    accessStatus,
    publicPath: customerQuote?.publicPath ?? null,
    expiresAt: customerQuote?.expiresAt ?? null,
    linkedEstimateId: selectedEstimate.id,
    linkedEstimateVersion: selectedEstimate.version,
    currentEstimateVersion: currentEstimate?.version ?? null,
    hasUpdatedEstimate:
      currentEstimate !== null && currentEstimate.id !== selectedEstimate.id,
    canCustomerReply: customerQuote?.status === "ACTIVE",
  };
};

export const getWorkshopPortalAccessForJob = async (workshopJobId: string) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  return getWorkshopPortalAccessForJobTx(prisma, workshopJobId);
};

export const getPublicWorkshopPortalContextTx = async (
  tx: Prisma.TransactionClient,
  token: string,
) => {
  const estimate = await getWorkshopEstimateByCustomerQuoteTokenTx(tx, token);
  if (!estimate) {
    throw new HttpError(404, "Quote link not found", "WORKSHOP_QUOTE_NOT_FOUND");
  }

  const currentEstimate = await getCurrentWorkshopEstimatePublicTx(tx, estimate.workshopJobId);
  const customerQuote = getCustomerQuoteStatus(estimate);
  const isCurrent = currentEstimate?.id === estimate.id && estimate.supersededAt === null;
  const accessStatus =
    !isCurrent
      ? ("SUPERSEDED" as const)
      : customerQuote?.status === "EXPIRED"
        ? ("EXPIRED" as const)
        : ("ACTIVE" as const);

  return {
    token,
    estimate,
    currentEstimate,
    customerQuote,
    accessStatus,
    canApprove: accessStatus === "ACTIVE" && estimate.status === "PENDING_APPROVAL",
    canReject: accessStatus === "ACTIVE" && estimate.status === "PENDING_APPROVAL",
    canReply: customerQuote?.status === "ACTIVE",
  };
};

export const getPublicWorkshopPortalContext = async (tokenValue: string) => {
  const token = normalizeOptionalText(tokenValue);
  if (!token) {
    throw new HttpError(400, "Quote token is required", "INVALID_QUOTE_TOKEN");
  }

  return getPublicWorkshopPortalContextTx(prisma, token);
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
  firstName: string;
  lastName: string;
}) => getCustomerDisplayName(customer, "");

const toCustomerWorkshopStatusLabel = (
  status: ReturnType<typeof toWorkshopExecutionStatus>,
) => {
  switch (status) {
    case "BOOKED":
      return "Booked In";
    case "IN_PROGRESS":
      return "In Progress";
    case "READY":
      return "Ready for Collection";
    case "COLLECTED":
      return "Collected";
    case "CLOSED":
      return "Closed";
  }
};

const formatPortalMoneyLabel = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const buildCustomerPortalProgress = (input: {
  rawStatus: WorkshopJobStatus;
  closedAt: Date | null;
  scheduledStartAt: Date | null;
  scheduledDate: Date | null;
  estimate: ReturnType<typeof toPublicEstimateSummary> | null;
  accessStatus: "ACTIVE" | "EXPIRED" | "SUPERSEDED";
  canApprove: boolean;
  finalSummary: {
    totalPence: number;
    collectedAt: Date | null;
  } | null;
}) => {
  const hasSchedule = Boolean(input.scheduledStartAt || input.scheduledDate);

  if (input.closedAt || input.rawStatus === "CANCELLED") {
    return {
      stage: "CLOSED",
      label: "Closed",
      headline: "This workshop job is now closed",
      detail: "If you still need help with this bike, please contact the shop directly.",
      nextStep: "The workshop can help if anything needs to be revisited.",
      needsCustomerAction: false,
    };
  }

  if (input.rawStatus === "COMPLETED") {
    return {
      stage: "COLLECTED",
      label: "Collected",
      headline: "Your bike has been collected",
      detail: input.finalSummary
        ? `Final total: ${formatPortalMoneyLabel(input.finalSummary.totalPence)}`
        : "The workshop has marked this job as collected.",
      nextStep: "You can keep this secure link to review the final work summary, shared notes, and attachments.",
      needsCustomerAction: false,
    };
  }

  if (input.rawStatus === "READY_FOR_COLLECTION") {
    return {
      stage: "READY_FOR_COLLECTION",
      label: "Ready for collection",
      headline: "Your bike is ready to collect",
      detail: input.finalSummary
        ? `Collection total: ${formatPortalMoneyLabel(input.finalSummary.totalPence)}`
        : "The workshop has finished the current work and says your bike is ready.",
      nextStep:
        "Please contact the shop if you need to confirm collection timing or have any final questions.",
      needsCustomerAction: false,
    };
  }

  if (input.rawStatus === "WAITING_FOR_APPROVAL" || input.estimate?.status === "PENDING_APPROVAL") {
    return {
      stage: "AWAITING_APPROVAL",
      label: "Awaiting approval",
      headline: "The workshop is waiting for your go-ahead",
      detail: input.estimate
        ? `Please review the current quote total of ${formatPortalMoneyLabel(
            input.estimate.subtotalPence,
          )} before work continues.`
        : "The workshop is waiting for approval before continuing with the next stage of work.",
      nextStep:
        input.accessStatus === "ACTIVE" && input.canApprove
          ? "Use the quote section below to approve or reject the work."
          : "Contact the shop if you need a fresh approval link.",
      needsCustomerAction: input.accessStatus === "ACTIVE" && input.canApprove,
    };
  }

  if (input.rawStatus === "WAITING_FOR_PARTS") {
    return {
      stage: "WAITING",
      label: "Waiting on parts",
      headline: "The workshop is waiting on parts",
      detail: "Your bike stays on the job while the shop waits for the required parts to arrive.",
      nextStep: "The workshop will update you here as soon as the parts arrive or the plan changes.",
      needsCustomerAction: false,
    };
  }

  if (input.rawStatus === "ON_HOLD") {
    return {
      stage: "WAITING",
      label: "Waiting on an update",
      headline: "This job is temporarily paused",
      detail: "The workshop is waiting on something before work can continue.",
      nextStep: "Use the message thread below if you need to check in with the workshop.",
      needsCustomerAction: false,
    };
  }

  if (input.rawStatus === "IN_PROGRESS") {
    return {
      stage: "IN_PROGRESS",
      label: "In progress",
      headline: "Your bike is with the workshop",
      detail: hasSchedule
        ? "The bike is in an active workshop slot and work is underway."
        : "The workshop has your bike and is progressing the job.",
      nextStep: "The workshop will update you here if anything changes or if they need your approval.",
      needsCustomerAction: false,
    };
  }

  if (hasSchedule) {
    return {
      stage: "SCHEDULED",
      label: "Scheduled",
      headline: "Your bike is booked into the workshop",
      detail: "The workshop has reserved time for your bike.",
      nextStep: "Check the scheduled time below and contact the shop if you need to discuss timing.",
      needsCustomerAction: false,
    };
  }

  return {
    stage: "BOOKED",
    label: "Booked in",
    headline: "Your bike is booked in with the workshop",
    detail: "The job is open and the workshop will update you when work starts or timing is confirmed.",
    nextStep: "You can use this secure page to follow updates from the shop.",
    needsCustomerAction: false,
  };
};

const toBikeTypeLabel = (value: string | null | undefined) => {
  const normalized = normalizeOptionalText(value)?.toUpperCase();
  switch (normalized) {
    case "ROAD":
      return "Road";
    case "MTB":
      return "Mountain Bike";
    case "E_BIKE":
      return "E-bike";
    case "HYBRID":
      return "Hybrid";
    case "GRAVEL":
      return "Gravel";
    case "COMMUTER":
      return "Commuter";
    case "BMX":
      return "BMX";
    case "KIDS":
      return "Kids";
    case "CARGO":
      return "Cargo";
    case "FOLDING":
      return "Folding";
    case "OTHER":
      return "Other";
    default:
      return value ?? null;
  }
};

const toPublicLineSummary = (line: {
  type: WorkshopJobLineType;
  description: string;
  qty: number;
  unitPricePence: number;
  product?: {
    name: string;
  } | null;
  variant?: {
    sku: string;
    name: string | null;
  } | null;
}) => ({
  type: line.type,
  description: line.description,
  qty: line.qty,
  unitPricePence: line.unitPricePence,
  lineTotalPence: line.qty * line.unitPricePence,
  productName: line.product?.name ?? null,
  variantName: line.variant?.name ?? null,
  variantSku: line.variant?.sku ?? null,
});

const buildLineSummaryTotals = (
  lines: Array<ReturnType<typeof toPublicLineSummary>>,
) => ({
  labourTotalPence: lines
    .filter((line) => line.type === "LABOUR")
    .reduce((sum, line) => sum + line.lineTotalPence, 0),
  partsTotalPence: lines
    .filter((line) => line.type === "PART")
    .reduce((sum, line) => sum + line.lineTotalPence, 0),
  subtotalPence: lines.reduce((sum, line) => sum + line.lineTotalPence, 0),
  lineCount: lines.length,
});

const toPublicEstimateSummary = (
  estimate: PublicWorkshopEstimateRecord | PublicWorkshopEstimateSummaryRecord,
) => {
  const lines = estimate.lines.map((line) => toPublicLineSummary(line));

  return {
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
    lines,
  };
};

const getLatestPortalNotificationAt = (
  notifications: PublicWorkshopEstimateRecord["workshopJob"]["notifications"],
  eventType: WorkshopNotificationEventType,
) => {
  const match = notifications.find((notification) => notification.eventType === eventType);
  return match?.sentAt ?? match?.createdAt ?? null;
};

const buildPortalTimeline = (input: {
  createdAt: Date;
  scheduledStartAt: Date | null;
  scheduledDate: Date | null;
  durationMinutes: number | null;
  estimate: ReturnType<typeof toPublicEstimateSummary> | null;
  notifications: PublicWorkshopEstimateRecord["workshopJob"]["notifications"];
  completedAt: Date | null;
  finalSummary: {
    totalPence: number;
    collectedAt: Date | null;
  } | null;
}) => {
  const events: Array<{
    type: string;
    label: string;
    occurredAt: Date;
    detail: string | null;
  }> = [
    {
      type: "JOB_CREATED",
      label: "Job received",
      occurredAt: input.createdAt,
      detail: null,
    },
  ];

  if (input.scheduledStartAt || input.scheduledDate) {
    events.push({
      type: "SCHEDULED",
      label: "Scheduled into the workshop",
      occurredAt: input.scheduledStartAt ?? input.scheduledDate ?? input.createdAt,
      detail: input.durationMinutes ? `${input.durationMinutes} minute workshop slot` : null,
    });
  }

  if (input.estimate?.requestedAt) {
    events.push({
      type: "QUOTE_READY",
      label: "Quote ready to review",
      occurredAt: input.estimate.requestedAt,
      detail: `Quote total ${formatPortalMoneyLabel(input.estimate.subtotalPence)}`,
    });
  }

  if (input.estimate?.approvedAt) {
    events.push({
      type: "QUOTE_APPROVED",
      label: "Quote approved",
      occurredAt: input.estimate.approvedAt,
      detail:
        input.estimate.decisionSource === "CUSTOMER"
          ? "Approved through this secure link"
          : "Approved with the workshop",
    });
  }

  if (input.estimate?.rejectedAt) {
    events.push({
      type: "QUOTE_REJECTED",
      label: "Quote rejected",
      occurredAt: input.estimate.rejectedAt,
      detail:
        input.estimate.decisionSource === "CUSTOMER"
          ? "Rejected through this secure link"
          : "Rejected with the workshop",
    });
  }

  const readyForCollectionAt = getLatestPortalNotificationAt(
    input.notifications,
    "JOB_READY_FOR_COLLECTION",
  );
  if (readyForCollectionAt) {
    events.push({
      type: "READY_FOR_COLLECTION",
      label: "Ready for collection",
      occurredAt: readyForCollectionAt,
      detail: input.finalSummary
        ? `Collection total ${formatPortalMoneyLabel(input.finalSummary.totalPence)}`
        : "The workshop says the bike is ready to collect",
    });
  }

  if (input.completedAt) {
    events.push({
      type: "COLLECTED",
      label: "Collected",
      occurredAt: input.completedAt,
      detail: null,
    });
  }

  return events.sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
};

const toPublicQuoteResponse = (
  estimate: PublicWorkshopEstimateRecord,
  input: {
    accessStatus: "ACTIVE" | "EXPIRED" | "SUPERSEDED";
    canApprove: boolean;
    canReject: boolean;
    idempotent?: boolean;
    currentEstimate?: PublicWorkshopEstimateSummaryRecord | null;
  },
) => {
  const customerName = estimate.workshopJob.customer
    ? buildCustomerDisplayName(estimate.workshopJob.customer)
    : normalizeOptionalText(estimate.workshopJob.customerName) ?? "Workshop customer";
  const bikeDisplayName = estimate.workshopJob.bike
    ? buildCustomerBikeDisplayName(estimate.workshopJob.bike)
    : normalizeOptionalText(estimate.workshopJob.bikeDescription) ?? "Bike";
  const executionStatus = toWorkshopExecutionStatus({
    status: estimate.workshopJob.status,
    closedAt: estimate.workshopJob.closedAt,
  });
  const currentEstimate = input.currentEstimate ?? null;
  const displayEstimate = currentEstimate ?? estimate;
  const displayEstimateSummary = toPublicEstimateSummary(displayEstimate);
  const workLines = estimate.workshopJob.lines.map((line) => toPublicLineSummary(line));
  const workSummary = {
    ...buildLineSummaryTotals(workLines),
    lines: workLines,
  };
  const access = {
    accessStatus: input.accessStatus,
    canApprove: input.canApprove,
    canReject: input.canReject,
    idempotent: input.idempotent ?? false,
    customerQuote: getCustomerQuoteStatus(estimate),
    linkedEstimateVersion: estimate.version,
    currentEstimateVersion: currentEstimate?.version ?? estimate.version,
    hasUpdatedEstimate:
      estimate.supersededAt !== null ||
      (currentEstimate !== null && currentEstimate.id !== estimate.id),
  };
  const finalSummary = estimate.workshopJob.sale
    ? {
        totalPence: estimate.workshopJob.sale.totalPence,
        collectedAt: estimate.workshopJob.completedAt ?? estimate.workshopJob.sale.createdAt,
      }
    : null;
  const customerProgress = buildCustomerPortalProgress({
    rawStatus: estimate.workshopJob.status,
    closedAt: estimate.workshopJob.closedAt,
    scheduledStartAt: estimate.workshopJob.scheduledStartAt,
    scheduledDate: estimate.workshopJob.scheduledDate,
    estimate: displayEstimateSummary,
    accessStatus: access.accessStatus,
    canApprove: access.canApprove,
    finalSummary,
  });

  return {
    portal: access,
    quote: access,
    customerProgress,
    job: {
      status: executionStatus,
      statusLabel: toCustomerWorkshopStatusLabel(executionStatus),
      createdAt: estimate.workshopJob.createdAt,
      updatedAt: estimate.workshopJob.updatedAt,
      scheduledDate: estimate.workshopJob.scheduledDate,
      scheduledStartAt: estimate.workshopJob.scheduledStartAt,
      scheduledEndAt: estimate.workshopJob.scheduledEndAt,
      durationMinutes: estimate.workshopJob.durationMinutes,
      customerName,
      bikeDescription: estimate.workshopJob.bikeDescription,
      bikeDisplayName,
      finalSummary,
    },
    bike: {
      displayName: bikeDisplayName,
      label: estimate.workshopJob.bike?.label ?? null,
      make: estimate.workshopJob.bike?.make ?? null,
      model: estimate.workshopJob.bike?.model ?? null,
      year: estimate.workshopJob.bike?.year ?? null,
      bikeType: estimate.workshopJob.bike?.bikeType ?? null,
      bikeTypeLabel: toBikeTypeLabel(estimate.workshopJob.bike?.bikeType),
      colour: estimate.workshopJob.bike?.colour ?? null,
      wheelSize: estimate.workshopJob.bike?.wheelSize ?? null,
      frameSize: estimate.workshopJob.bike?.frameSize ?? null,
      groupset: estimate.workshopJob.bike?.groupset ?? null,
      motorBrand: estimate.workshopJob.bike?.motorBrand ?? null,
      motorModel: estimate.workshopJob.bike?.motorModel ?? null,
    },
    estimate: displayEstimateSummary,
    workSummary,
    customerNotes: estimate.workshopJob.jobNotes.map((note) => ({
      note: note.note,
      createdAt: note.createdAt,
    })),
    timeline: buildPortalTimeline({
      createdAt: estimate.workshopJob.createdAt,
      scheduledStartAt: estimate.workshopJob.scheduledStartAt,
      scheduledDate: estimate.workshopJob.scheduledDate,
      durationMinutes: estimate.workshopJob.durationMinutes,
      estimate: displayEstimateSummary,
      notifications: estimate.workshopJob.notifications,
      completedAt: estimate.workshopJob.completedAt,
      finalSummary,
    }),
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
      customerId: true,
      bikeId: true,
      bikeDescription: true,
      assignedStaffId: true,
      status: true,
      scheduledStartAt: true,
      scheduledEndAt: true,
      durationMinutes: true,
      source: true,
      finalizedBasketId: true,
      completedAt: true,
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

const getCurrentWorkshopEstimatePublicTx = async (
  tx: Prisma.TransactionClient | typeof prisma,
  workshopJobId: string,
) =>
  tx.workshopEstimate.findFirst({
    where: {
      workshopJobId,
      supersededAt: null,
    },
    include: publicEstimateSummaryInclude,
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
  job: WorkshopJobWithLinesRecord,
  estimateStatus: WorkshopEstimateStatus,
) => {
  const nextStatus = toWorkshopJobStatusForEstimate(job, estimateStatus);
  if (job.status === nextStatus) {
    return job.status;
  }

  const updated = await tx.workshopJob.update({
    where: { id: job.id },
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
  if (input.fromJobStatus !== input.toJobStatus) {
    await createAuditEventTx(
      tx,
      {
        action: "JOB_STATUS_CHANGED",
        entityType: "WORKSHOP_JOB",
        entityId: input.workshopJobId,
        metadata: {
          estimateId: input.estimate.id,
          estimateVersion: input.estimate.version,
          ...buildWorkshopStatusAuditMetadata({
            fromStatus: input.fromJobStatus,
            toStatus: input.toJobStatus,
            changeSource: "AUTOMATIC",
            trigger: "ESTIMATE_STATUS_SYNC",
          }),
        },
      },
      actor,
    );
  }

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
        ...buildWorkshopStatusAuditMetadata({
          fromStatus: input.fromJobStatus,
          toStatus: input.toJobStatus,
          changeSource: "AUTOMATIC",
          trigger: "ESTIMATE_APPROVAL_FLOW",
        }),
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
  if (job.status === "WAITING_FOR_APPROVAL") {
    const updated = await tx.workshopJob.update({
      where: { id: workshopJobId },
      data: {
        status: resolvePreWorkWorkshopStatus(job),
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

  const result = await prisma.$transaction(async (tx) => {
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
      let created = await createEstimateVersionTx(tx, job, {
        status: targetStatus,
        actor: input.actor,
        decisionSource,
      });
      if (targetStatus === "PENDING_APPROVAL") {
        const preparedQuote = await ensureCustomerQuoteTokenTx(tx, created, input.actor);
        created = preparedQuote.estimate;
      }
      const toJobStatus = await updateWorkshopJobStatusFromEstimateTx(
        tx,
        job,
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
          customerId: job.customerId,
          bikeId: job.bikeId,
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
            customerId: job.customerId,
            bikeId: job.bikeId,
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
      const preparedQuote = await ensureCustomerQuoteTokenTx(tx, nextEstimate, input.actor);
      nextEstimate = preparedQuote.estimate;
    } else if (targetStatus === "APPROVED") {
      if (currentEstimate.status === "APPROVED") {
        return {
          estimate: toEstimateResponse(currentEstimate),
          job: {
            id: workshopJobId,
            customerId: job.customerId,
            bikeId: job.bikeId,
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
            customerId: job.customerId,
            bikeId: job.bikeId,
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
      job,
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
        customerId: job.customerId,
        bikeId: job.bikeId,
        status: toJobStatus,
      },
      idempotent: false,
    };
  });

  if (!result.idempotent && targetStatus === "PENDING_APPROVAL") {
    emitEvent("workshop.quote.ready", {
      id: result.estimate.id,
      type: "workshop.quote.ready",
      timestamp: new Date().toISOString(),
      workshopJobId: result.job.id,
      workshopEstimateId: result.estimate.id,
      estimateVersion: result.estimate.version,
      customerId: result.job.customerId,
      bikeId: result.job.bikeId,
      ...(result.estimate.customerQuote?.publicPath
        ? { quotePublicPath: result.estimate.customerQuote.publicPath }
        : {}),
    });
  }

  if (!result.idempotent && (targetStatus === "APPROVED" || targetStatus === "REJECTED")) {
    emitEvent("workshop.estimate.decided", {
      id: result.estimate.id,
      type: "workshop.estimate.decided",
      timestamp: new Date().toISOString(),
      workshopJobId: result.job.id,
      workshopEstimateId: result.estimate.id,
      estimateVersion: result.estimate.version,
      status: targetStatus,
      decisionSource: decisionSource ?? null,
      customerId: result.job.customerId,
      bikeId: result.job.bikeId,
      ...(input.actor?.actorId ? { actorStaffId: input.actor.actorId } : {}),
    });
  }

  return result;
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
        "Save or request an estimate before sharing a customer portal link",
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
  const context = await getPublicWorkshopPortalContext(tokenValue);

  return toPublicQuoteResponse(context.estimate, {
    accessStatus: context.accessStatus,
    canApprove: context.canApprove,
    canReject: context.canReject,
    currentEstimate: context.currentEstimate,
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
    const context = await getPublicWorkshopPortalContextTx(tx, token);
    const estimate = context.estimate;

    if (!context.customerQuote || context.customerQuote.status === "EXPIRED") {
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
      const currentPortalEstimate = await getCurrentWorkshopEstimatePublicTx(tx, estimate.workshopJobId);

      return toPublicQuoteResponse(estimate, {
        accessStatus: "ACTIVE",
        canApprove: false,
        canReject: false,
        idempotent: true,
        currentEstimate: currentPortalEstimate,
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
    const job = await ensureWorkshopJobWithLinesTx(tx, estimate.workshopJobId);
    const toJobStatus = await updateWorkshopJobStatusFromEstimateTx(
      tx,
      job,
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

    const currentPortalEstimate = await getCurrentWorkshopEstimatePublicTx(tx, refreshed.workshopJobId);

    return toPublicQuoteResponse(refreshed, {
      accessStatus: "ACTIVE",
      canApprove: false,
      canReject: false,
      idempotent: false,
      currentEstimate: currentPortalEstimate,
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
