import crypto from "node:crypto";
import {
  Prisma,
  WorkshopNotification as WorkshopNotificationModel,
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
import { sendWhatsAppMessage } from "./whatsappService";
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

type NotificationChannelDecision =
  | {
      channel: WorkshopNotificationChannel;
      action: "send";
      strategyRank: number;
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
      strategyRank: number;
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

const notificationChannels: WorkshopNotificationChannel[] = [
  "EMAIL",
  "SMS",
  "WHATSAPP",
];

const automaticChannelOrderByEvent: Record<
  WorkshopNotificationEventType,
  readonly WorkshopNotificationChannel[]
> = {
  QUOTE_READY: ["WHATSAPP", "SMS", "EMAIL"],
  JOB_READY_FOR_COLLECTION: ["SMS", "WHATSAPP", "EMAIL"],
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
          emailAllowed: true,
          smsAllowed: true,
          whatsappAllowed: true,
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
      emailAllowed: true,
      smsAllowed: true,
      whatsappAllowed: true,
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
type NotificationCustomerPreferences = {
  emailAllowed: boolean;
  smsAllowed: boolean;
  whatsappAllowed: boolean;
};

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

const notificationChannelLabel = (channel: WorkshopNotificationChannel) => {
  switch (channel) {
    case "EMAIL":
      return "Email";
    case "SMS":
      return "SMS";
    case "WHATSAPP":
      return "WhatsApp";
    default:
      return channel;
  }
};

const getStrategyRank = (
  eventType: WorkshopNotificationEventType,
  channel: WorkshopNotificationChannel,
) => {
  const rank = automaticChannelOrderByEvent[eventType].indexOf(channel);
  return rank >= 0 ? rank + 1 : automaticChannelOrderByEvent[eventType].length + 1;
};

const isManualNotificationAttempt = (dedupeKey: string) => dedupeKey.includes(":manual:");

const buildNotificationStrategy = (notification: WorkshopNotificationRecord) => {
  const priorityRank = getStrategyRank(notification.eventType, notification.channel);
  const isManual = isManualNotificationAttempt(notification.dedupeKey);

  return {
    mode: isManual ? "MANUAL_RESEND" : "AUTOMATED",
    priorityRank,
    priorityType: priorityRank === 1 ? "PRIMARY" : "FALLBACK",
    label: isManual ? "Manual resend" : priorityRank === 1 ? "Primary" : `Fallback ${priorityRank}`,
  };
};

const toWorkshopNotificationResponse = (notification: WorkshopNotificationRecord) => ({
  id: notification.id,
  workshopJobId: notification.workshopJobId,
  workshopEstimateId: notification.workshopEstimateId,
  channel: notification.channel,
  eventType: notification.eventType,
  deliveryStatus: notification.deliveryStatus,
  recipientEmail: notification.recipientEmail,
  recipientPhone: notification.recipientPhone,
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
  strategy: buildNotificationStrategy(notification),
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

const buildChannelDedupeKey = (
  baseKey: string,
  channel: WorkshopNotificationChannel,
) => `${baseKey}:${channel.toLowerCase()}`;

const buildSkipDecision = (input: {
  channel: WorkshopNotificationChannel;
  strategyRank: number;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  subject?: string | null;
  payload: Prisma.JsonObject;
  customerId: string | null;
  workshopEstimateId: string | null;
  baseDedupeKey: string;
  reasonCode: string;
  reasonMessage: string;
}): NotificationChannelDecision => ({
  channel: input.channel,
  action: "skip",
  strategyRank: input.strategyRank,
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

const buildQuoteNotReadyDecision = (
  workshopJobId: string,
  customerId: string | null,
): NotificationChannelDecision =>
  buildSkipDecision({
    channel: "EMAIL",
    strategyRank: getStrategyRank("QUOTE_READY", "EMAIL"),
    payload: {
      workshopJobId,
    },
    customerId,
    workshopEstimateId: null,
    baseDedupeKey: `workshop:quote-ready:${workshopJobId}:quote-not-ready`,
    reasonCode: "QUOTE_NOT_READY",
    reasonMessage: "There is no current quote awaiting approval for this job.",
  });

const buildDerivedSkipDecision = (
  decision: NotificationChannelDecision,
  input: {
    reasonCode: string;
    reasonMessage: string;
  },
): NotificationChannelDecision => ({
  channel: decision.channel,
  action: "skip",
  strategyRank: decision.strategyRank,
  recipientEmail: decision.recipientEmail,
  recipientPhone: decision.recipientPhone,
  subject: decision.subject,
  text: null,
  html: null,
  payload: decision.payload,
  customerId: decision.customerId,
  workshopEstimateId: decision.workshopEstimateId,
  dedupeKey: decision.dedupeKey,
  reasonCode: input.reasonCode,
  reasonMessage: input.reasonMessage,
});

const isFalseLike = (value: string | null | undefined) => {
  const normalized = normalizeOptionalText(value)?.toLowerCase();
  return normalized === "0" || normalized === "false" || normalized === "off" || normalized === "no";
};

const isNotificationChannelEnabled = (channel: WorkshopNotificationChannel) => {
  const envKey =
    channel === "EMAIL"
      ? "WORKSHOP_NOTIFICATION_EMAIL_ENABLED"
      : channel === "SMS"
        ? "WORKSHOP_NOTIFICATION_SMS_ENABLED"
        : "WORKSHOP_NOTIFICATION_WHATSAPP_ENABLED";

  return !isFalseLike(process.env[envKey]);
};

const buildChannelDisabledReasonMessage = (channel: WorkshopNotificationChannel) =>
  `${notificationChannelLabel(channel)} notifications are disabled, so this delivery path was skipped.`;

const isCustomerChannelAllowed = (
  customer: NotificationCustomerPreferences | null | undefined,
  channel: WorkshopNotificationChannel,
) => {
  if (!customer) {
    return true;
  }

  switch (channel) {
    case "EMAIL":
      return customer.emailAllowed;
    case "SMS":
      return customer.smsAllowed;
    case "WHATSAPP":
      return customer.whatsappAllowed;
    default:
      return true;
  }
};

const buildCustomerChannelDisabledReasonMessage = (
  channel: WorkshopNotificationChannel,
) => {
  switch (channel) {
    case "EMAIL":
      return "Customer has email updates disabled, so this delivery path was skipped.";
    case "SMS":
      return "Customer has SMS updates disabled, so this delivery path was skipped.";
    case "WHATSAPP":
      return "Customer has WhatsApp updates disabled, so this delivery path was skipped.";
    default:
      return `Customer has ${notificationChannelLabel(channel)} updates disabled, so this delivery path was skipped.`;
  }
};

const buildFallbackNotRequiredReasonMessage = (
  deliveredChannel: WorkshopNotificationChannel,
  skippedChannel: WorkshopNotificationChannel,
) =>
  `${notificationChannelLabel(deliveredChannel)} delivered successfully, so the ${notificationChannelLabel(
    skippedChannel,
  )} fallback was not needed.`;

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
    whatsappFrom: normalizeOptionalText(process.env.WHATSAPP_FROM) ?? null,
  };
};

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
        strategyRank: getStrategyRank("QUOTE_READY", channel),
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
  const customer = estimate.workshopJob.customer;
  const bikeDisplayName = buildBikeDisplayName({
    bike: estimate.workshopJob.bike,
    bikeDescription: estimate.workshopJob.bikeDescription,
  });
  const recipientEmail = normalizeOptionalEmail(customer?.email);
  const recipientPhone = normalizeOptionalPhone(customer?.phone);
  const customerId = customer?.id ?? estimate.workshopJob.customerId ?? null;
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
        strategyRank: getStrategyRank("QUOTE_READY", channel),
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
  const whatsAppText = `Hi ${customerName}, your quote for ${bikeDisplayName} is ready to review: ${quoteUrl}`;

  return [
    !recipientEmail
      ? buildSkipDecision({
          channel: "EMAIL",
          strategyRank: getStrategyRank("QUOTE_READY", "EMAIL"),
          recipientPhone,
          payload: basePayload,
          customerId,
          workshopEstimateId: estimate.id,
          baseDedupeKey,
          reasonCode: "CUSTOMER_EMAIL_MISSING",
          reasonMessage:
            "Customer email is missing, so the workshop quote email was not sent.",
        })
      : !isCustomerChannelAllowed(customer, "EMAIL")
        ? buildSkipDecision({
            channel: "EMAIL",
            strategyRank: getStrategyRank("QUOTE_READY", "EMAIL"),
            recipientEmail,
            recipientPhone: null,
            subject: emailSubject,
            payload: basePayload,
            customerId,
            workshopEstimateId: estimate.id,
            baseDedupeKey,
            reasonCode: "CUSTOMER_CHANNEL_DISABLED",
            reasonMessage: buildCustomerChannelDisabledReasonMessage("EMAIL"),
          })
        : {
            channel: "EMAIL",
            action: "send",
            strategyRank: getStrategyRank("QUOTE_READY", "EMAIL"),
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
          },
    !recipientPhone
      ? buildSkipDecision({
          channel: "SMS",
          strategyRank: getStrategyRank("QUOTE_READY", "SMS"),
          recipientEmail,
          payload: basePayload,
          customerId,
          workshopEstimateId: estimate.id,
          baseDedupeKey,
          reasonCode: "CUSTOMER_PHONE_MISSING",
          reasonMessage:
            "Customer phone number is missing, so the workshop quote SMS was not sent.",
        })
      : !isCustomerChannelAllowed(customer, "SMS")
        ? buildSkipDecision({
            channel: "SMS",
            strategyRank: getStrategyRank("QUOTE_READY", "SMS"),
            recipientEmail: null,
            recipientPhone,
            payload: basePayload,
            customerId,
            workshopEstimateId: estimate.id,
            baseDedupeKey,
            reasonCode: "CUSTOMER_CHANNEL_DISABLED",
            reasonMessage: buildCustomerChannelDisabledReasonMessage("SMS"),
          })
        : {
            channel: "SMS",
            action: "send",
            strategyRank: getStrategyRank("QUOTE_READY", "SMS"),
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
          },
    !recipientPhone
      ? buildSkipDecision({
          channel: "WHATSAPP",
          strategyRank: getStrategyRank("QUOTE_READY", "WHATSAPP"),
          recipientEmail,
          payload: basePayload,
          customerId,
          workshopEstimateId: estimate.id,
          baseDedupeKey,
          reasonCode: "CUSTOMER_PHONE_MISSING",
          reasonMessage:
            "Customer phone number is missing, so the workshop quote WhatsApp message was not sent.",
        })
      : !isCustomerChannelAllowed(customer, "WHATSAPP")
        ? buildSkipDecision({
            channel: "WHATSAPP",
            strategyRank: getStrategyRank("QUOTE_READY", "WHATSAPP"),
            recipientEmail: null,
            recipientPhone,
            payload: basePayload,
            customerId,
            workshopEstimateId: estimate.id,
            baseDedupeKey,
            reasonCode: "CUSTOMER_CHANNEL_DISABLED",
            reasonMessage: buildCustomerChannelDisabledReasonMessage("WHATSAPP"),
          })
        : {
            channel: "WHATSAPP",
            action: "send",
            strategyRank: getStrategyRank("QUOTE_READY", "WHATSAPP"),
            recipientEmail: null,
            recipientPhone,
            subject: null,
            text: whatsAppText,
            html: null,
            payload: {
              ...basePayload,
              quoteUrl,
            },
            customerId,
            workshopEstimateId: estimate.id,
            dedupeKey: buildChannelDedupeKey(baseDedupeKey, "WHATSAPP"),
          },
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
        strategyRank: getStrategyRank("JOB_READY_FOR_COLLECTION", channel),
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
  const customer = job.customer;
  const bikeDisplayName = buildBikeDisplayName({
    bike: job.bike,
    bikeDescription: job.bikeDescription,
  });
  const recipientEmail = normalizeOptionalEmail(customer?.email);
  const recipientPhone = normalizeOptionalPhone(customer?.phone);
  const customerId = customer?.id ?? job.customerId ?? null;
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
        strategyRank: getStrategyRank("JOB_READY_FOR_COLLECTION", channel),
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
  const whatsAppText = `Hi ${customerName}, ${bikeDisplayName} is ready for collection from ${store.name}. Please contact the shop if you need to confirm a collection time.`;

  return [
    !recipientEmail
      ? buildSkipDecision({
          channel: "EMAIL",
          strategyRank: getStrategyRank("JOB_READY_FOR_COLLECTION", "EMAIL"),
          recipientPhone,
          payload: basePayload,
          customerId,
          workshopEstimateId: null,
          baseDedupeKey,
          reasonCode: "CUSTOMER_EMAIL_MISSING",
          reasonMessage:
            "Customer email is missing, so the ready-for-collection email was not sent.",
        })
      : !isCustomerChannelAllowed(customer, "EMAIL")
        ? buildSkipDecision({
            channel: "EMAIL",
            strategyRank: getStrategyRank("JOB_READY_FOR_COLLECTION", "EMAIL"),
            recipientEmail,
            recipientPhone: null,
            subject: emailSubject,
            payload: basePayload,
            customerId,
            workshopEstimateId: null,
            baseDedupeKey,
            reasonCode: "CUSTOMER_CHANNEL_DISABLED",
            reasonMessage: buildCustomerChannelDisabledReasonMessage("EMAIL"),
          })
        : {
            channel: "EMAIL",
            action: "send",
            strategyRank: getStrategyRank("JOB_READY_FOR_COLLECTION", "EMAIL"),
            recipientEmail,
            recipientPhone: null,
            subject: emailSubject,
            text: emailText,
            html: emailHtml,
            payload: basePayload,
            customerId,
            workshopEstimateId: null,
            dedupeKey: buildChannelDedupeKey(baseDedupeKey, "EMAIL"),
          },
    !recipientPhone
      ? buildSkipDecision({
          channel: "SMS",
          strategyRank: getStrategyRank("JOB_READY_FOR_COLLECTION", "SMS"),
          recipientEmail,
          payload: basePayload,
          customerId,
          workshopEstimateId: null,
          baseDedupeKey,
          reasonCode: "CUSTOMER_PHONE_MISSING",
          reasonMessage:
            "Customer phone number is missing, so the ready-for-collection SMS was not sent.",
        })
      : !isCustomerChannelAllowed(customer, "SMS")
        ? buildSkipDecision({
            channel: "SMS",
            strategyRank: getStrategyRank("JOB_READY_FOR_COLLECTION", "SMS"),
            recipientEmail: null,
            recipientPhone,
            payload: basePayload,
            customerId,
            workshopEstimateId: null,
            baseDedupeKey,
            reasonCode: "CUSTOMER_CHANNEL_DISABLED",
            reasonMessage: buildCustomerChannelDisabledReasonMessage("SMS"),
          })
        : {
            channel: "SMS",
            action: "send",
            strategyRank: getStrategyRank("JOB_READY_FOR_COLLECTION", "SMS"),
            recipientEmail: null,
            recipientPhone,
            subject: null,
            text: smsText,
            html: null,
            payload: basePayload,
            customerId,
            workshopEstimateId: null,
            dedupeKey: buildChannelDedupeKey(baseDedupeKey, "SMS"),
          },
    !recipientPhone
      ? buildSkipDecision({
          channel: "WHATSAPP",
          strategyRank: getStrategyRank("JOB_READY_FOR_COLLECTION", "WHATSAPP"),
          recipientEmail,
          payload: basePayload,
          customerId,
          workshopEstimateId: null,
          baseDedupeKey,
          reasonCode: "CUSTOMER_PHONE_MISSING",
          reasonMessage:
            "Customer phone number is missing, so the ready-for-collection WhatsApp message was not sent.",
        })
      : !isCustomerChannelAllowed(customer, "WHATSAPP")
        ? buildSkipDecision({
            channel: "WHATSAPP",
            strategyRank: getStrategyRank("JOB_READY_FOR_COLLECTION", "WHATSAPP"),
            recipientEmail: null,
            recipientPhone,
            payload: basePayload,
            customerId,
            workshopEstimateId: null,
            baseDedupeKey,
            reasonCode: "CUSTOMER_CHANNEL_DISABLED",
            reasonMessage: buildCustomerChannelDisabledReasonMessage("WHATSAPP"),
          })
        : {
            channel: "WHATSAPP",
            action: "send",
            strategyRank: getStrategyRank("JOB_READY_FOR_COLLECTION", "WHATSAPP"),
            recipientEmail: null,
            recipientPhone,
            subject: null,
            text: whatsAppText,
            html: null,
            payload: basePayload,
            customerId,
            workshopEstimateId: null,
            dedupeKey: buildChannelDedupeKey(baseDedupeKey, "WHATSAPP"),
          },
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
) => {
  if (channel === "SMS") {
    return "SMS_SEND_FAILED";
  }

  if (channel === "WHATSAPP") {
    return "WHATSAPP_SEND_FAILED";
  }

  return "EMAIL_SEND_FAILED";
};

const requireRecipient = (value: string | null, field: string) => {
  if (!value) {
    throw new Error(`${field} is required for notification delivery`);
  }

  return value;
};

const sendWorkshopNotification = async (
  workshopJobId: string,
  eventType: WorkshopNotificationEventType,
  decision: NotificationChannelDecision,
  options: {
    forceUniqueAttempt?: boolean;
  } = {},
) => {
  const rawAttemptDecision = {
    ...decision,
    dedupeKey: buildNotificationAttemptDedupeKey(decision.dedupeKey, options),
  };
  const attemptDecision =
    rawAttemptDecision.action === "send" &&
    !isNotificationChannelEnabled(rawAttemptDecision.channel)
      ? buildDerivedSkipDecision(rawAttemptDecision, {
          reasonCode: "CHANNEL_DISABLED",
          reasonMessage: buildChannelDisabledReasonMessage(rawAttemptDecision.channel),
        })
      : rawAttemptDecision;
  const claim = await claimWorkshopNotification(
    workshopJobId,
    eventType,
    attemptDecision,
  );
  if (claim.idempotent) {
    logOperationalEvent("workshop.notification.duplicate", {
      entityId: claim.notification.id,
      workshopJobId,
      eventType,
      channel: attemptDecision.channel,
      dedupeKey: attemptDecision.dedupeKey,
      resultStatus: "noop",
    });

    return {
      notificationId: claim.notification.id,
      deliveryStatus: claim.notification.deliveryStatus,
      channel: claim.notification.channel,
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
      channel: attemptDecision.channel,
      reasonCode: attemptDecision.reasonCode,
      resultStatus: "noop",
    });

    return {
      notificationId: claim.notification.id,
      deliveryStatus: "SKIPPED" as const,
      channel: attemptDecision.channel,
      idempotent: false,
    };
  }

  try {
    const sender = await resolveStoreContext();
    const result =
      attemptDecision.channel === "SMS"
        ? await sendSmsMessage({
            to: requireRecipient(attemptDecision.recipientPhone, "recipientPhone"),
            from: sender.smsFrom,
            text: attemptDecision.text,
          })
        : attemptDecision.channel === "WHATSAPP"
          ? await sendWhatsAppMessage({
              to: requireRecipient(attemptDecision.recipientPhone, "recipientPhone"),
              from: sender.whatsappFrom,
              text: attemptDecision.text,
            })
          : await sendEmailMessage({
              to: requireRecipient(attemptDecision.recipientEmail, "recipientEmail"),
              from: sender.emailFrom,
              subject: attemptDecision.subject ?? "CorePOS notification",
              text: attemptDecision.text,
              ...(attemptDecision.html ? { html: attemptDecision.html } : {}),
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
      channel: attemptDecision.channel,
      deliveryMode: result.deliveryMode,
      recipientEmail: attemptDecision.recipientEmail,
      recipientPhone: attemptDecision.recipientPhone,
      resultStatus: "succeeded",
    });

    return {
      notificationId: claim.notification.id,
      deliveryStatus: "SENT" as const,
      channel: attemptDecision.channel,
      idempotent: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reasonCode = failureReasonCodeByChannel(attemptDecision.channel);
    await finalizeWorkshopNotification(claim.notification.id, {
      deliveryStatus: "FAILED",
      reasonCode,
      reasonMessage: message,
    });
    logCorePosError("workshop.notification.failed", error, {
      notificationId: claim.notification.id,
      workshopJobId,
      eventType,
      channel: attemptDecision.channel,
    });
    logOperationalEvent("workshop.notification.failed", {
      entityId: claim.notification.id,
      workshopJobId,
      eventType,
      channel: attemptDecision.channel,
      resultStatus: "failed",
      reasonCode,
    });

    return {
      notificationId: claim.notification.id,
      deliveryStatus: "FAILED" as const,
      channel: attemptDecision.channel,
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
  let deliveredChannel: WorkshopNotificationChannel | null = null;

  for (const decision of [...decisions].sort((left, right) => left.strategyRank - right.strategyRank)) {
    const automaticDecision =
      deliveredChannel && decision.action === "send"
        ? buildDerivedSkipDecision(decision, {
            reasonCode: "FALLBACK_NOT_REQUIRED",
            reasonMessage: buildFallbackNotRequiredReasonMessage(
              deliveredChannel,
              decision.channel,
            ),
          })
        : decision;

    const result = await sendWorkshopNotification(
      input.workshopJobId,
      eventType,
      automaticDecision,
    );
    results.push(result);

    if (!deliveredChannel && result.deliveryStatus === "SENT") {
      deliveredChannel = decision.channel;
    }
  }

  return {
    workshopJobId: input.workshopJobId,
    eventType,
    results,
  };
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

          const decisions = currentEstimate
            ? await buildQuoteReadyDecisions(workshopJobId, currentEstimate.id)
            : [buildQuoteNotReadyDecision(workshopJobId, job.customerId ?? null)];
          const emailDecision = decisions.find((decision) => decision.channel === "EMAIL");

          if (!emailDecision) {
            throw new HttpError(
              500,
              "Workshop quote resend could not resolve an email notification decision",
              "WORKSHOP_NOTIFICATION_DECISION_MISSING",
            );
          }

          return sendWorkshopNotification(workshopJobId, "QUOTE_READY", emailDecision, {
            forceUniqueAttempt: true,
          });
        })()
      : await (async () => {
          const decisions = await buildReadyForCollectionDecisions(workshopJobId);
          const emailDecision = decisions.find((decision) => decision.channel === "EMAIL");

          if (!emailDecision) {
            throw new HttpError(
              500,
              "Workshop ready-for-collection resend could not resolve an email notification decision",
              "WORKSHOP_NOTIFICATION_DECISION_MISSING",
            );
          }

          return sendWorkshopNotification(
            workshopJobId,
            "JOB_READY_FOR_COLLECTION",
            emailDecision,
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
