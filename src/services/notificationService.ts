import crypto from "node:crypto";
import {
  Prisma,
  WorkshopNotification as WorkshopNotificationModel,
  WorkshopNotificationEventType,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import { logCorePosError, logCorePosEvent, logOperationalEvent } from "../lib/operationalLogger";
import { createAuditEventTx } from "./auditService";
import { listStoreInfoSettings } from "./configurationService";
import { buildCustomerBikeDisplayName } from "./customerBikeService";
import { sendEmailMessage } from "./emailService";
import { HttpError, isUuid } from "../utils/http";

type WorkshopNotificationEventInput =
  | {
      type: "QUOTE_READY";
      workshopJobId: string;
      workshopEstimateId: string;
    }
  | {
      type: "JOB_READY_FOR_COLLECTION";
      workshopJobId: string;
    };

type ResendWorkshopNotificationInput = {
  eventType: WorkshopNotificationEventType;
};

type EmailDeliveryDecision =
  | {
      action: "send";
      recipientEmail: string;
      subject: string;
      text: string;
      html: string;
      payload: Prisma.JsonObject;
      customerId: string | null;
      workshopEstimateId: string | null;
      dedupeKey: string;
    }
  | {
      action: "skip";
      recipientEmail: string | null;
      subject: string | null;
      text: string | null;
      html: string | null;
      payload: Prisma.JsonObject;
      customerId: string | null;
      workshopEstimateId: string | null;
      dedupeKey: string;
      reasonCode: string;
      reasonMessage: string;
    };

const quoteEstimateInclude = Prisma.validator<Prisma.WorkshopEstimateInclude>()({
  workshopJob: {
    select: {
      id: true,
      status: true,
      customerId: true,
      customerName: true,
      bikeDescription: true,
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
    },
  },
});

const readyJobInclude = Prisma.validator<Prisma.WorkshopJobInclude>()({
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
});

type QuoteEstimateRecord = Prisma.WorkshopEstimateGetPayload<{
  include: typeof quoteEstimateInclude;
}>;

type ReadyJobRecord = Prisma.WorkshopJobGetPayload<{
  include: typeof readyJobInclude;
}>;

type WorkshopNotificationRecord = WorkshopNotificationModel;

const normalizeOptionalText = (value: string | null | undefined) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeOptionalEmail = (value: string | null | undefined) =>
  normalizeOptionalText(value)?.toLowerCase() ?? null;

const buildNotificationAttemptDedupeKey = (
  baseKey: string,
  options: {
    forceUniqueAttempt?: boolean;
  } = {},
) =>
  options.forceUniqueAttempt
    ? `${baseKey}:manual:${Date.now()}:${crypto.randomUUID()}`
    : baseKey;

const ensureWorkshopJobExists = async (workshopJobId: string) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  const job = await prisma.workshopJob.findUnique({
    where: { id: workshopJobId },
    select: {
      id: true,
      customerId: true,
    },
  });

  if (!job) {
    throw new HttpError(404, "Workshop job not found", "WORKSHOP_JOB_NOT_FOUND");
  }

  return job;
};

const summarizeNotificationText = (value: string | null | undefined) => {
  const lines =
    value
      ?.split("\n")
      .map((line) => line.trim())
      .filter(Boolean) ?? [];

  if (lines.length === 0) {
    return null;
  }

  return lines.find((line) => !/^hi\b/i.test(line)) ?? lines[0] ?? null;
};

const toWorkshopNotificationResponse = (notification: WorkshopNotificationRecord) => ({
  id: notification.id,
  workshopJobId: notification.workshopJobId,
  workshopEstimateId: notification.workshopEstimateId,
  channel: notification.channel,
  eventType: notification.eventType,
  deliveryStatus: notification.deliveryStatus,
  recipientEmail: notification.recipientEmail,
  subject: notification.subject,
  messageSummary:
    normalizeOptionalText(notification.subject) ??
    summarizeNotificationText(notification.bodyText) ??
    null,
  reasonCode: notification.reasonCode,
  reasonMessage: notification.reasonMessage,
  sentAt: notification.sentAt,
  createdAt: notification.createdAt,
  updatedAt: notification.updatedAt,
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

  return [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim() || "Workshop customer";
};

const buildBikeDisplayName = (input: {
  bike:
    | QuoteEstimateRecord["workshopJob"]["bike"]
    | ReadyJobRecord["bike"]
    | null;
  bikeDescription: string | null;
}) => {
  if (input.bike) {
    return buildCustomerBikeDisplayName(input.bike);
  }

  return normalizeOptionalText(input.bikeDescription) ?? "your bike";
};

const buildQuoteNotReadyDecision = (
  workshopJobId: string,
  customerId: string | null,
): EmailDeliveryDecision => ({
  action: "skip",
  recipientEmail: null,
  subject: null,
  text: null,
  html: null,
  payload: {
    workshopJobId,
  },
  customerId,
  workshopEstimateId: null,
  dedupeKey: `workshop:quote-ready:${workshopJobId}:quote-not-ready`,
  reasonCode: "QUOTE_NOT_READY",
  reasonMessage: "There is no current quote awaiting approval for this job.",
});

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const resolvePublicAppUrl = (path: string) => {
  const baseUrl =
    normalizeOptionalText(process.env.PUBLIC_APP_URL) ??
    normalizeOptionalText(process.env.APP_BASE_URL) ??
    `http://localhost:${normalizeOptionalText(process.env.PORT) ?? "3000"}`;

  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBaseUrl}${normalizedPath}`;
};

const formatMoney = (pence: number, currency: string) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(pence / 100);

const resolveSender = async () => {
  const store = await listStoreInfoSettings();
  const fromEmail =
    normalizeOptionalEmail(process.env.EMAIL_FROM) ??
    normalizeOptionalEmail(store.email) ??
    "no-reply@corepos.local";
  const fromName =
    normalizeOptionalText(process.env.EMAIL_FROM_NAME) ??
    normalizeOptionalText(store.name) ??
    normalizeOptionalText(store.businessName) ??
    "CorePOS";

  return {
    store,
    from: {
      email: fromEmail,
      name: fromName,
    },
  };
};

const prepareQuoteReadyDecision = async (
  workshopJobId: string,
  workshopEstimateId: string,
): Promise<EmailDeliveryDecision> => {
  const estimate = await prisma.workshopEstimate.findUnique({
    where: { id: workshopEstimateId },
    include: quoteEstimateInclude,
  });

  if (!estimate || estimate.workshopJobId !== workshopJobId) {
    return {
      action: "skip",
      recipientEmail: null,
      subject: null,
      text: null,
      html: null,
      payload: {
        workshopJobId,
        workshopEstimateId,
      },
      customerId: null,
      workshopEstimateId,
      dedupeKey: `workshop:quote-ready:${workshopEstimateId}`,
      reasonCode: "ESTIMATE_NOT_FOUND",
      reasonMessage: "Workshop estimate could not be loaded for notification.",
    };
  }

  const currentEstimate = await prisma.workshopEstimate.findFirst({
    where: {
      workshopJobId,
      supersededAt: null,
    },
    select: {
      id: true,
    },
    orderBy: [{ version: "desc" }],
  });

  const customerName = estimate.workshopJob.customer
    ? buildCustomerDisplayName(estimate.workshopJob.customer)
    : normalizeOptionalText(estimate.workshopJob.customerName) ?? "Workshop customer";
  const bikeDisplayName = buildBikeDisplayName({
    bike: estimate.workshopJob.bike,
    bikeDescription: estimate.workshopJob.bikeDescription,
  });
  const recipientEmail = normalizeOptionalEmail(estimate.workshopJob.customer?.email);
  const quotePath = estimate.customerQuoteToken ? `/quote/${encodeURIComponent(estimate.customerQuoteToken)}` : null;
  const isCurrent = currentEstimate?.id === estimate.id && estimate.supersededAt === null;
  const isExpired =
    estimate.customerQuoteTokenExpiresAt !== null
      ? estimate.customerQuoteTokenExpiresAt.getTime() < Date.now()
      : true;

  const basePayload: Prisma.JsonObject = {
    workshopJobId,
    workshopEstimateId: estimate.id,
    estimateVersion: estimate.version,
    bikeDescription: bikeDisplayName,
    customerName,
    subtotalPence: estimate.subtotalPence,
    quotePublicPath: quotePath,
  };

  if (!recipientEmail) {
    return {
      action: "skip",
      recipientEmail: null,
      subject: null,
      text: null,
      html: null,
      payload: basePayload,
      customerId: estimate.workshopJob.customer?.id ?? estimate.workshopJob.customerId ?? null,
      workshopEstimateId: estimate.id,
      dedupeKey: `workshop:quote-ready:${estimate.id}`,
      reasonCode: "CUSTOMER_EMAIL_MISSING",
      reasonMessage: "Customer email is missing, so the workshop quote email was not sent.",
    };
  }

  if (!isCurrent || estimate.status !== "PENDING_APPROVAL" || !quotePath || isExpired) {
    return {
      action: "skip",
      recipientEmail,
      subject: null,
      text: null,
      html: null,
      payload: {
        ...basePayload,
        currentEstimateId: currentEstimate?.id ?? null,
        estimateStatus: estimate.status,
        isCurrent,
        isExpired,
      },
      customerId: estimate.workshopJob.customer?.id ?? estimate.workshopJob.customerId ?? null,
      workshopEstimateId: estimate.id,
      dedupeKey: `workshop:quote-ready:${estimate.id}`,
      reasonCode: "QUOTE_NOT_ACTIONABLE",
      reasonMessage: "Quote notification was skipped because the estimate is no longer current and actionable.",
    };
  }

  const { store } = await resolveSender();
  const quoteUrl = resolvePublicAppUrl(quotePath);
  const total = formatMoney(estimate.subtotalPence, store.defaultCurrency || "GBP");
  const subject = `${store.name}: your workshop quote is ready`;
  const text = [
    `Hi ${customerName},`,
    "",
    `Your workshop quote for ${bikeDisplayName} is ready to review.`,
    `Quoted total: ${total}.`,
    "",
    "Review and respond here:",
    quoteUrl,
    "",
    "If the quote changes before you review it, the link will clearly show that it is no longer current.",
    "",
    `Thanks,`,
    store.name,
    store.phone ? store.phone : null,
    store.email ? store.email : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
  const html = [
    `<p>Hi ${escapeHtml(customerName)},</p>`,
    `<p>Your workshop quote for <strong>${escapeHtml(bikeDisplayName)}</strong> is ready to review.</p>`,
    `<p><strong>Quoted total:</strong> ${escapeHtml(total)}</p>`,
    `<p><a href="${escapeHtml(quoteUrl)}">Review and respond to your quote</a></p>`,
    `<p>If the quote changes before you review it, the link will clearly show that it is no longer current.</p>`,
    `<p>Thanks,<br />${escapeHtml(store.name)}${
      store.phone ? `<br />${escapeHtml(store.phone)}` : ""
    }${store.email ? `<br />${escapeHtml(store.email)}` : ""}</p>`,
  ].join("");

  return {
    action: "send",
    recipientEmail,
    subject,
    text,
    html,
    payload: {
      ...basePayload,
      quoteUrl,
    },
    customerId: estimate.workshopJob.customer?.id ?? estimate.workshopJob.customerId ?? null,
    workshopEstimateId: estimate.id,
    dedupeKey: `workshop:quote-ready:${estimate.id}`,
  };
};

const prepareReadyForCollectionDecision = async (
  workshopJobId: string,
): Promise<EmailDeliveryDecision> => {
  const job = await prisma.workshopJob.findUnique({
    where: { id: workshopJobId },
    include: readyJobInclude,
  });

  if (!job) {
    return {
      action: "skip",
      recipientEmail: null,
      subject: null,
      text: null,
      html: null,
      payload: {
        workshopJobId,
      },
      customerId: null,
      workshopEstimateId: null,
      dedupeKey: `workshop:ready-for-collection:${workshopJobId}`,
      reasonCode: "WORKSHOP_JOB_NOT_FOUND",
      reasonMessage: "Workshop job could not be loaded for the ready-for-collection notification.",
    };
  }

  const customerName = job.customer
    ? buildCustomerDisplayName(job.customer)
    : normalizeOptionalText(job.customerName) ?? "Workshop customer";
  const bikeDisplayName = buildBikeDisplayName({
    bike: job.bike,
    bikeDescription: job.bikeDescription,
  });
  const recipientEmail = normalizeOptionalEmail(job.customer?.email);
  const basePayload: Prisma.JsonObject = {
    workshopJobId: job.id,
    bikeDescription: bikeDisplayName,
    customerName,
    jobStatus: job.status,
  };

  if (!recipientEmail) {
    return {
      action: "skip",
      recipientEmail: null,
      subject: null,
      text: null,
      html: null,
      payload: basePayload,
      customerId: job.customer?.id ?? job.customerId ?? null,
      workshopEstimateId: null,
      dedupeKey: `workshop:ready-for-collection:${job.id}`,
      reasonCode: "CUSTOMER_EMAIL_MISSING",
      reasonMessage: "Customer email is missing, so the ready-for-collection email was not sent.",
    };
  }

  if (job.status !== "BIKE_READY") {
    return {
      action: "skip",
      recipientEmail,
      subject: null,
      text: null,
      html: null,
      payload: basePayload,
      customerId: job.customer?.id ?? job.customerId ?? null,
      workshopEstimateId: null,
      dedupeKey: `workshop:ready-for-collection:${job.id}`,
      reasonCode: "JOB_NOT_READY",
      reasonMessage: "Ready-for-collection notification was skipped because the job is no longer in BIKE_READY.",
    };
  }

  const { store } = await resolveSender();
  const subject = `${store.name}: your bike is ready for collection`;
  const text = [
    `Hi ${customerName},`,
    "",
    `${bikeDisplayName} is ready for collection.`,
    "Please contact the shop if you need to confirm a collection time.",
    "",
    `Thanks,`,
    store.name,
    store.phone ? store.phone : null,
    store.email ? store.email : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
  const html = [
    `<p>Hi ${escapeHtml(customerName)},</p>`,
    `<p><strong>${escapeHtml(bikeDisplayName)}</strong> is ready for collection.</p>`,
    `<p>Please contact the shop if you need to confirm a collection time.</p>`,
    `<p>Thanks,<br />${escapeHtml(store.name)}${
      store.phone ? `<br />${escapeHtml(store.phone)}` : ""
    }${store.email ? `<br />${escapeHtml(store.email)}` : ""}</p>`,
  ].join("");

  return {
    action: "send",
    recipientEmail,
    subject,
    text,
    html,
    payload: basePayload,
    customerId: job.customer?.id ?? job.customerId ?? null,
    workshopEstimateId: null,
    dedupeKey: `workshop:ready-for-collection:${job.id}`,
  };
};

const claimWorkshopNotification = async (
  workshopJobId: string,
  eventType: WorkshopNotificationEventType,
  decision: EmailDeliveryDecision,
) => {
  try {
    const notification = await prisma.workshopNotification.create({
      data: {
        workshopJobId,
        workshopEstimateId: decision.workshopEstimateId,
        customerId: decision.customerId,
        channel: "EMAIL",
        eventType,
        deliveryStatus: "PENDING",
        recipientEmail: decision.recipientEmail,
        subject: decision.subject,
        bodyText: decision.text,
        bodyHtml: decision.html,
        dedupeKey: decision.dedupeKey,
        payload: decision.payload,
      },
    });

    return {
      notification,
      idempotent: false,
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await prisma.workshopNotification.findUnique({
        where: { dedupeKey: decision.dedupeKey },
      });

      if (existing) {
        return {
          notification: existing,
          idempotent: true,
        };
      }
    }

    throw error;
  }
};

const finalizeWorkshopNotification = async (
  notificationId: string,
  outcome: {
    deliveryStatus: "SENT" | "SKIPPED" | "FAILED";
    providerMessageId?: string | null;
    reasonCode?: string | null;
    reasonMessage?: string | null;
    sentAt?: Date | null;
  },
) => {
  await prisma.$transaction(async (tx) => {
    const updated = await tx.workshopNotification.update({
      where: { id: notificationId },
      data: {
        deliveryStatus: outcome.deliveryStatus,
        providerMessageId: outcome.providerMessageId ?? null,
        reasonCode: outcome.reasonCode ?? null,
        reasonMessage: outcome.reasonMessage ?? null,
        sentAt: outcome.sentAt ?? null,
      },
    });

    await createAuditEventTx(tx, {
      action: `WORKSHOP_NOTIFICATION_${outcome.deliveryStatus}`,
      entityType: "WORKSHOP_NOTIFICATION",
      entityId: updated.id,
      metadata: {
        workshopJobId: updated.workshopJobId,
        workshopEstimateId: updated.workshopEstimateId,
        channel: updated.channel,
        eventType: updated.eventType,
        recipientEmail: updated.recipientEmail,
        reasonCode: outcome.reasonCode ?? null,
      },
    });
  });
};

const sendWorkshopNotification = async (
  workshopJobId: string,
  eventType: WorkshopNotificationEventType,
  decision: EmailDeliveryDecision,
  options: {
    forceUniqueAttempt?: boolean;
  } = {},
) => {
  const attemptDecision = {
    ...decision,
    dedupeKey: buildNotificationAttemptDedupeKey(decision.dedupeKey, options),
  };
  const claim = await claimWorkshopNotification(workshopJobId, eventType, attemptDecision);
  if (claim.idempotent) {
    logOperationalEvent("workshop.notification.duplicate", {
      entityId: claim.notification.id,
      workshopJobId,
      eventType,
      dedupeKey: attemptDecision.dedupeKey,
      resultStatus: "noop",
    });

    return {
      notificationId: claim.notification.id,
      deliveryStatus: claim.notification.deliveryStatus,
      idempotent: true,
    };
  }

  if (attemptDecision.action === "skip") {
    await finalizeWorkshopNotification(claim.notification.id, {
      deliveryStatus: "SKIPPED",
      reasonCode: attemptDecision.reasonCode,
      reasonMessage: attemptDecision.reasonMessage,
    });
    logOperationalEvent("workshop.notification.skipped", {
      entityId: claim.notification.id,
      workshopJobId,
      eventType,
      reasonCode: attemptDecision.reasonCode,
      resultStatus: "noop",
    });

    return {
      notificationId: claim.notification.id,
      deliveryStatus: "SKIPPED" as const,
      idempotent: false,
    };
  }

  try {
    const sender = await resolveSender();
    const result = await sendEmailMessage({
      to: attemptDecision.recipientEmail,
      from: sender.from,
      subject: attemptDecision.subject,
      text: attemptDecision.text,
      html: attemptDecision.html,
    });

    await finalizeWorkshopNotification(claim.notification.id, {
      deliveryStatus: "SENT",
      providerMessageId: result.messageId,
      sentAt: new Date(),
    });

    logOperationalEvent("workshop.notification.sent", {
      entityId: claim.notification.id,
      workshopJobId,
      eventType,
      deliveryMode: result.deliveryMode,
      recipientEmail: attemptDecision.recipientEmail,
      resultStatus: "succeeded",
    });

    return {
      notificationId: claim.notification.id,
      deliveryStatus: "SENT" as const,
      idempotent: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finalizeWorkshopNotification(claim.notification.id, {
      deliveryStatus: "FAILED",
      reasonCode: "EMAIL_SEND_FAILED",
      reasonMessage: message,
    });
    logCorePosError("workshop.notification.failed", error, {
      notificationId: claim.notification.id,
      workshopJobId,
      eventType,
    });
    logOperationalEvent("workshop.notification.failed", {
      entityId: claim.notification.id,
      workshopJobId,
      eventType,
      resultStatus: "failed",
      reasonCode: "EMAIL_SEND_FAILED",
    });

    return {
      notificationId: claim.notification.id,
      deliveryStatus: "FAILED" as const,
      idempotent: false,
    };
  }
};

export const deliverWorkshopNotificationEvent = async (
  input: WorkshopNotificationEventInput,
) => {
  if (input.type === "QUOTE_READY") {
    const decision = await prepareQuoteReadyDecision(input.workshopJobId, input.workshopEstimateId);
    return sendWorkshopNotification(input.workshopJobId, "QUOTE_READY", decision);
  }

  const decision = await prepareReadyForCollectionDecision(input.workshopJobId);
  return sendWorkshopNotification(input.workshopJobId, "JOB_READY_FOR_COLLECTION", decision);
};

export const listWorkshopNotificationsForJob = async (workshopJobId: string) => {
  await ensureWorkshopJobExists(workshopJobId);

  const notifications = await prisma.workshopNotification.findMany({
    where: {
      workshopJobId,
    },
    orderBy: [{ createdAt: "desc" }],
  });

  logCorePosEvent("workshop.notification.listed", {
    workshopJobId,
    count: notifications.length,
  });

  return {
    workshopJobId,
    notifications: notifications.map(toWorkshopNotificationResponse),
  };
};

export const resendWorkshopNotificationForJob = async (
  workshopJobId: string,
  input: ResendWorkshopNotificationInput,
) => {
  const job = await ensureWorkshopJobExists(workshopJobId);

  const delivery =
    input.eventType === "QUOTE_READY"
      ? await (async () => {
          const currentEstimate = await prisma.workshopEstimate.findFirst({
            where: {
              workshopJobId,
              supersededAt: null,
            },
            select: {
              id: true,
            },
            orderBy: [{ version: "desc" }],
          });

          const decision = currentEstimate
            ? await prepareQuoteReadyDecision(workshopJobId, currentEstimate.id)
            : buildQuoteNotReadyDecision(workshopJobId, job.customerId ?? null);

          return sendWorkshopNotification(workshopJobId, "QUOTE_READY", decision, {
            forceUniqueAttempt: true,
          });
        })()
      : await (async () => {
          const decision = await prepareReadyForCollectionDecision(workshopJobId);
          return sendWorkshopNotification(
            workshopJobId,
            "JOB_READY_FOR_COLLECTION",
            decision,
            {
              forceUniqueAttempt: true,
            },
          );
        })();

  const notification = await prisma.workshopNotification.findUnique({
    where: {
      id: delivery.notificationId,
    },
  });

  if (!notification) {
    throw new HttpError(
      500,
      "Workshop notification resend completed without a saved notification row",
      "WORKSHOP_NOTIFICATION_MISSING",
    );
  }

  return {
    notification: toWorkshopNotificationResponse(notification),
    attempt: {
      idempotent: delivery.idempotent,
      deliveryStatus: delivery.deliveryStatus,
    },
  };
};
