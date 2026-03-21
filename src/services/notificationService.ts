import {
  Prisma,
  WorkshopNotificationChannel,
  WorkshopNotificationEventType,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  logCorePosError,
  logCorePosEvent,
  logOperationalEvent,
} from "../lib/operationalLogger";
import { createAuditEventTx } from "./auditService";
import { listStoreInfoSettings } from "./configurationService";
import { buildCustomerBikeDisplayName } from "./customerBikeService";
import { sendEmailMessage } from "./emailService";
import { sendSmsMessage } from "./smsService";

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

type NotificationChannelDecision =
  | {
      channel: WorkshopNotificationChannel;
      action: "send";
      recipientEmail: string | null;
      recipientPhone: string | null;
      subject: string | null;
      text: string;
      html: string | null;
      payload: Prisma.JsonObject;
      customerId: string | null;
      workshopEstimateId: string | null;
      dedupeKey: string;
    }
  | {
      channel: WorkshopNotificationChannel;
      action: "skip";
      recipientEmail: string | null;
      recipientPhone: string | null;
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

const notificationChannels: WorkshopNotificationChannel[] = ["EMAIL", "SMS"];

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

const normalizeOptionalText = (value: string | null | undefined) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeOptionalEmail = (value: string | null | undefined) =>
  normalizeOptionalText(value)?.toLowerCase() ?? null;

const normalizeOptionalPhone = (value: string | null | undefined) =>
  normalizeOptionalText(value) ?? null;

const buildCustomerDisplayName = (customer: {
  name: string;
  firstName: string;
  lastName: string;
}) => {
  const explicitName = normalizeOptionalText(customer.name);
  if (explicitName) {
    return explicitName;
  }

  return (
    [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim() ||
    "Workshop customer"
  );
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

const resolveStoreContext = async () => {
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
    emailFrom: {
      email: fromEmail,
      name: fromName,
    },
    smsFrom: normalizeOptionalText(process.env.SMS_FROM) ?? null,
  };
};

const buildChannelDedupeKey = (
  baseKey: string,
  channel: WorkshopNotificationChannel,
) => `${baseKey}:${channel.toLowerCase()}`;

const buildSkipDecision = (input: {
  channel: WorkshopNotificationChannel;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  subject?: string | null;
  payload: Prisma.JsonObject;
  customerId: string | null;
  workshopEstimateId: string | null;
  baseDedupeKey: string;
  reasonCode: string;
  reasonMessage: string;
}) => ({
  channel: input.channel,
  action: "skip" as const,
  recipientEmail: input.recipientEmail ?? null,
  recipientPhone: input.recipientPhone ?? null,
  subject: input.subject ?? null,
  text: null,
  html: null,
  payload: input.payload,
  customerId: input.customerId,
  workshopEstimateId: input.workshopEstimateId,
  dedupeKey: buildChannelDedupeKey(input.baseDedupeKey, input.channel),
  reasonCode: input.reasonCode,
  reasonMessage: input.reasonMessage,
});

const buildQuoteReadyDecisions = async (
  workshopJobId: string,
  workshopEstimateId: string,
): Promise<NotificationChannelDecision[]> => {
  const estimate = await prisma.workshopEstimate.findUnique({
    where: { id: workshopEstimateId },
    include: quoteEstimateInclude,
  });

  const missingEstimatePayload: Prisma.JsonObject = {
    workshopJobId,
    workshopEstimateId,
  };
  if (!estimate || estimate.workshopJobId !== workshopJobId) {
    const baseDedupeKey = `workshop:quote-ready:${workshopEstimateId}`;
    return notificationChannels.map((channel) =>
      buildSkipDecision({
        channel,
        payload: missingEstimatePayload,
        customerId: null,
        workshopEstimateId,
        baseDedupeKey,
        reasonCode: "ESTIMATE_NOT_FOUND",
        reasonMessage: "Workshop estimate could not be loaded for notification.",
      }),
    );
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
  const recipientPhone = normalizeOptionalPhone(estimate.workshopJob.customer?.phone);
  const customerId =
    estimate.workshopJob.customer?.id ?? estimate.workshopJob.customerId ?? null;
  const quotePath = estimate.customerQuoteToken
    ? `/quote/${encodeURIComponent(estimate.customerQuoteToken)}`
    : null;
  const isCurrent = currentEstimate?.id === estimate.id && estimate.supersededAt === null;
  const isExpired =
    estimate.customerQuoteTokenExpiresAt !== null
      ? estimate.customerQuoteTokenExpiresAt.getTime() < Date.now()
      : true;
  const baseDedupeKey = `workshop:quote-ready:${estimate.id}`;
  const basePayload: Prisma.JsonObject = {
    workshopJobId,
    workshopEstimateId: estimate.id,
    estimateVersion: estimate.version,
    bikeDescription: bikeDisplayName,
    customerName,
    subtotalPence: estimate.subtotalPence,
    quotePublicPath: quotePath,
  };

  if (!isCurrent || estimate.status !== "PENDING_APPROVAL" || !quotePath || isExpired) {
    const payload: Prisma.JsonObject = {
      ...basePayload,
      currentEstimateId: currentEstimate?.id ?? null,
      estimateStatus: estimate.status,
      isCurrent,
      isExpired,
    };

    return notificationChannels.map((channel) =>
      buildSkipDecision({
        channel,
        recipientEmail,
        recipientPhone,
        payload,
        customerId,
        workshopEstimateId: estimate.id,
        baseDedupeKey,
        reasonCode: "QUOTE_NOT_ACTIONABLE",
        reasonMessage:
          "Quote notification was skipped because the estimate is no longer current and actionable.",
      }),
    );
  }

  const { store } = await resolveStoreContext();
  const quoteUrl = resolvePublicAppUrl(quotePath);
  const total = formatMoney(estimate.subtotalPence, store.defaultCurrency || "GBP");
  const emailSubject = `${store.name}: your workshop quote is ready`;
  const emailText = [
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
  const emailHtml = [
    `<p>Hi ${escapeHtml(customerName)},</p>`,
    `<p>Your workshop quote for <strong>${escapeHtml(bikeDisplayName)}</strong> is ready to review.</p>`,
    `<p><strong>Quoted total:</strong> ${escapeHtml(total)}</p>`,
    `<p><a href="${escapeHtml(quoteUrl)}">Review and respond to your quote</a></p>`,
    `<p>If the quote changes before you review it, the link will clearly show that it is no longer current.</p>`,
    `<p>Thanks,<br />${escapeHtml(store.name)}${
      store.phone ? `<br />${escapeHtml(store.phone)}` : ""
    }${store.email ? `<br />${escapeHtml(store.email)}` : ""}</p>`,
  ].join("");
  const smsText = `${store.name}: your bike quote for ${bikeDisplayName} is ready. Review it here: ${quoteUrl}`;

  return [
    recipientEmail
      ? {
          channel: "EMAIL" as const,
          action: "send" as const,
          recipientEmail,
          recipientPhone: null,
          subject: emailSubject,
          text: emailText,
          html: emailHtml,
          payload: {
            ...basePayload,
            quoteUrl,
          },
          customerId,
          workshopEstimateId: estimate.id,
          dedupeKey: buildChannelDedupeKey(baseDedupeKey, "EMAIL"),
        }
      : buildSkipDecision({
          channel: "EMAIL",
          recipientPhone,
          payload: basePayload,
          customerId,
          workshopEstimateId: estimate.id,
          baseDedupeKey,
          reasonCode: "CUSTOMER_EMAIL_MISSING",
          reasonMessage:
            "Customer email is missing, so the workshop quote email was not sent.",
        }),
    recipientPhone
      ? {
          channel: "SMS" as const,
          action: "send" as const,
          recipientEmail: null,
          recipientPhone,
          subject: null,
          text: smsText,
          html: null,
          payload: {
            ...basePayload,
            quoteUrl,
          },
          customerId,
          workshopEstimateId: estimate.id,
          dedupeKey: buildChannelDedupeKey(baseDedupeKey, "SMS"),
        }
      : buildSkipDecision({
          channel: "SMS",
          recipientEmail,
          payload: basePayload,
          customerId,
          workshopEstimateId: estimate.id,
          baseDedupeKey,
          reasonCode: "CUSTOMER_PHONE_MISSING",
          reasonMessage:
            "Customer phone number is missing, so the workshop quote SMS was not sent.",
        }),
  ];
};

const buildReadyForCollectionDecisions = async (
  workshopJobId: string,
): Promise<NotificationChannelDecision[]> => {
  const job = await prisma.workshopJob.findUnique({
    where: { id: workshopJobId },
    include: readyJobInclude,
  });

  const missingJobPayload: Prisma.JsonObject = {
    workshopJobId,
  };
  if (!job) {
    const baseDedupeKey = `workshop:ready-for-collection:${workshopJobId}`;
    return notificationChannels.map((channel) =>
      buildSkipDecision({
        channel,
        payload: missingJobPayload,
        customerId: null,
        workshopEstimateId: null,
        baseDedupeKey,
        reasonCode: "WORKSHOP_JOB_NOT_FOUND",
        reasonMessage:
          "Workshop job could not be loaded for the ready-for-collection notification.",
      }),
    );
  }

  const customerName = job.customer
    ? buildCustomerDisplayName(job.customer)
    : normalizeOptionalText(job.customerName) ?? "Workshop customer";
  const bikeDisplayName = buildBikeDisplayName({
    bike: job.bike,
    bikeDescription: job.bikeDescription,
  });
  const recipientEmail = normalizeOptionalEmail(job.customer?.email);
  const recipientPhone = normalizeOptionalPhone(job.customer?.phone);
  const customerId = job.customer?.id ?? job.customerId ?? null;
  const baseDedupeKey = `workshop:ready-for-collection:${job.id}`;
  const basePayload: Prisma.JsonObject = {
    workshopJobId: job.id,
    bikeDescription: bikeDisplayName,
    customerName,
    jobStatus: job.status,
  };

  if (job.status !== "BIKE_READY") {
    return notificationChannels.map((channel) =>
      buildSkipDecision({
        channel,
        recipientEmail,
        recipientPhone,
        payload: basePayload,
        customerId,
        workshopEstimateId: null,
        baseDedupeKey,
        reasonCode: "JOB_NOT_READY",
        reasonMessage:
          "Ready-for-collection notification was skipped because the job is no longer in BIKE_READY.",
      }),
    );
  }

  const { store } = await resolveStoreContext();
  const emailSubject = `${store.name}: your bike is ready for collection`;
  const emailText = [
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
  const emailHtml = [
    `<p>Hi ${escapeHtml(customerName)},</p>`,
    `<p><strong>${escapeHtml(bikeDisplayName)}</strong> is ready for collection.</p>`,
    `<p>Please contact the shop if you need to confirm a collection time.</p>`,
    `<p>Thanks,<br />${escapeHtml(store.name)}${
      store.phone ? `<br />${escapeHtml(store.phone)}` : ""
    }${store.email ? `<br />${escapeHtml(store.email)}` : ""}</p>`,
  ].join("");
  const smsText = `${store.name}: ${bikeDisplayName} is ready for collection. Please contact the shop if you need to confirm a collection time.`;

  return [
    recipientEmail
      ? {
          channel: "EMAIL" as const,
          action: "send" as const,
          recipientEmail,
          recipientPhone: null,
          subject: emailSubject,
          text: emailText,
          html: emailHtml,
          payload: basePayload,
          customerId,
          workshopEstimateId: null,
          dedupeKey: buildChannelDedupeKey(baseDedupeKey, "EMAIL"),
        }
      : buildSkipDecision({
          channel: "EMAIL",
          recipientPhone,
          payload: basePayload,
          customerId,
          workshopEstimateId: null,
          baseDedupeKey,
          reasonCode: "CUSTOMER_EMAIL_MISSING",
          reasonMessage:
            "Customer email is missing, so the ready-for-collection email was not sent.",
        }),
    recipientPhone
      ? {
          channel: "SMS" as const,
          action: "send" as const,
          recipientEmail: null,
          recipientPhone,
          subject: null,
          text: smsText,
          html: null,
          payload: basePayload,
          customerId,
          workshopEstimateId: null,
          dedupeKey: buildChannelDedupeKey(baseDedupeKey, "SMS"),
        }
      : buildSkipDecision({
          channel: "SMS",
          recipientEmail,
          payload: basePayload,
          customerId,
          workshopEstimateId: null,
          baseDedupeKey,
          reasonCode: "CUSTOMER_PHONE_MISSING",
          reasonMessage:
            "Customer phone number is missing, so the ready-for-collection SMS was not sent.",
        }),
  ];
};

const claimWorkshopNotification = async (
  workshopJobId: string,
  eventType: WorkshopNotificationEventType,
  decision: NotificationChannelDecision,
) => {
  try {
    const notification = await prisma.workshopNotification.create({
      data: {
        workshopJobId,
        workshopEstimateId: decision.workshopEstimateId,
        customerId: decision.customerId,
        channel: decision.channel,
        eventType,
        deliveryStatus: "PENDING",
        recipientEmail: decision.recipientEmail,
        recipientPhone: decision.recipientPhone,
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
        recipientPhone: updated.recipientPhone,
        reasonCode: outcome.reasonCode ?? null,
      },
    });
  });
};

const failureReasonCodeByChannel = (
  channel: WorkshopNotificationChannel,
) => (channel === "SMS" ? "SMS_SEND_FAILED" : "EMAIL_SEND_FAILED");

const sendWorkshopNotification = async (
  workshopJobId: string,
  eventType: WorkshopNotificationEventType,
  decision: NotificationChannelDecision,
) => {
  const claim = await claimWorkshopNotification(workshopJobId, eventType, decision);
  if (claim.idempotent) {
    logOperationalEvent("workshop.notification.duplicate", {
      entityId: claim.notification.id,
      workshopJobId,
      eventType,
      channel: decision.channel,
      dedupeKey: decision.dedupeKey,
      resultStatus: "noop",
    });

    return {
      notificationId: claim.notification.id,
      deliveryStatus: claim.notification.deliveryStatus,
      channel: claim.notification.channel,
      idempotent: true,
    };
  }

  if (decision.action === "skip") {
    await finalizeWorkshopNotification(claim.notification.id, {
      deliveryStatus: "SKIPPED",
      reasonCode: decision.reasonCode,
      reasonMessage: decision.reasonMessage,
    });
    logOperationalEvent("workshop.notification.skipped", {
      entityId: claim.notification.id,
      workshopJobId,
      eventType,
      channel: decision.channel,
      reasonCode: decision.reasonCode,
      resultStatus: "noop",
    });

    return {
      notificationId: claim.notification.id,
      deliveryStatus: "SKIPPED" as const,
      channel: decision.channel,
      idempotent: false,
    };
  }

  try {
    const sender = await resolveStoreContext();
    const result =
      decision.channel === "SMS"
        ? await sendSmsMessage({
            to: decision.recipientPhone,
            from: sender.smsFrom,
            text: decision.text,
          })
        : await sendEmailMessage({
            to: decision.recipientEmail,
            from: sender.emailFrom,
            subject: decision.subject ?? "CorePOS notification",
            text: decision.text,
            ...(decision.html ? { html: decision.html } : {}),
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
      channel: decision.channel,
      deliveryMode: result.deliveryMode,
      recipientEmail: decision.recipientEmail,
      recipientPhone: decision.recipientPhone,
      resultStatus: "succeeded",
    });

    return {
      notificationId: claim.notification.id,
      deliveryStatus: "SENT" as const,
      channel: decision.channel,
      idempotent: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reasonCode = failureReasonCodeByChannel(decision.channel);
    await finalizeWorkshopNotification(claim.notification.id, {
      deliveryStatus: "FAILED",
      reasonCode,
      reasonMessage: message,
    });
    logCorePosError("workshop.notification.failed", error, {
      notificationId: claim.notification.id,
      workshopJobId,
      eventType,
      channel: decision.channel,
    });
    logOperationalEvent("workshop.notification.failed", {
      entityId: claim.notification.id,
      workshopJobId,
      eventType,
      channel: decision.channel,
      resultStatus: "failed",
      reasonCode,
    });

    return {
      notificationId: claim.notification.id,
      deliveryStatus: "FAILED" as const,
      channel: decision.channel,
      idempotent: false,
    };
  }
};

export const deliverWorkshopNotificationEvent = async (
  input: WorkshopNotificationEventInput,
) => {
  const decisions =
    input.type === "QUOTE_READY"
      ? await buildQuoteReadyDecisions(input.workshopJobId, input.workshopEstimateId)
      : await buildReadyForCollectionDecisions(input.workshopJobId);

  const eventType: WorkshopNotificationEventType =
    input.type === "QUOTE_READY" ? "QUOTE_READY" : "JOB_READY_FOR_COLLECTION";

  const results = [] as Array<{
    notificationId: string;
    deliveryStatus: string;
    channel: WorkshopNotificationChannel;
    idempotent: boolean;
  }>;

  for (const decision of decisions) {
    results.push(
      await sendWorkshopNotification(input.workshopJobId, eventType, decision),
    );
  }

  return {
    workshopJobId: input.workshopJobId,
    eventType,
    results,
  };
};

export const listWorkshopNotificationsForJob = async (workshopJobId: string) => {
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

  return notifications;
};
