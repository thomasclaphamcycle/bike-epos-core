import crypto from "node:crypto";
import {
  Prisma,
  WorkshopMessageChannel,
} from "@prisma/client";
import { emit } from "../core/events";
import { prisma } from "../lib/prisma";
import { HttpError, isUuid } from "../utils/http";
import { createAuditEventTx, type AuditActor } from "./auditService";
import {
  getPublicWorkshopPortalContext,
  getPublicWorkshopPortalContextTx,
  getWorkshopPortalAccessForJobTx,
} from "./workshopEstimateService";

type StaffConversationMessageInput = {
  authorStaffId?: string | null;
  body?: string;
  channel?: string;
};

type PublicConversationReplyInput = {
  body?: string;
};

const MESSAGE_MAX_LENGTH = 4000;

const conversationInclude = Prisma.validator<Prisma.WorkshopConversationInclude>()({
  messages: {
    orderBy: [{ createdAt: "asc" }],
    include: {
      authorStaff: {
        select: {
          id: true,
          username: true,
          name: true,
        },
      },
    },
  },
});

type WorkshopConversationRecord = Prisma.WorkshopConversationGetPayload<{
  include: typeof conversationInclude;
}>;

const normalizeOptionalText = (value: string | null | undefined) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeMessageBody = (value: string | undefined) => {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw new HttpError(400, "message body is required", "INVALID_WORKSHOP_MESSAGE");
  }

  if (normalized.length > MESSAGE_MAX_LENGTH) {
    throw new HttpError(
      400,
      `message body must be ${MESSAGE_MAX_LENGTH} characters or fewer`,
      "INVALID_WORKSHOP_MESSAGE",
    );
  }

  return normalized;
};

const parseMessageChannel = (value: string | undefined): WorkshopMessageChannel => {
  const normalized = normalizeOptionalText(value)?.toUpperCase() ?? "PORTAL";

  if (normalized !== "PORTAL") {
    throw new HttpError(
      400,
      "channel must be PORTAL for workshop conversation messages",
      "INVALID_WORKSHOP_MESSAGE_CHANNEL",
    );
  }

  return "PORTAL";
};

const ensureWorkshopJobExistsTx = async (
  tx: Prisma.TransactionClient,
  workshopJobId: string,
) => {
  const job = await tx.workshopJob.findUnique({
    where: { id: workshopJobId },
    select: {
      id: true,
      customerId: true,
      customerName: true,
    },
  });

  if (!job) {
    throw new HttpError(404, "Workshop job not found", "WORKSHOP_JOB_NOT_FOUND");
  }

  return job;
};

const ensureStaffAuthorExistsTx = async (
  tx: Prisma.TransactionClient,
  authorStaffId: string | null,
) => {
  if (!authorStaffId) {
    return null;
  }

  const staff = await tx.user.findUnique({
    where: { id: authorStaffId },
    select: { id: true },
  });

  if (!staff) {
    throw new HttpError(404, "Staff member not found", "STAFF_NOT_FOUND");
  }

  return staff;
};

const ensureWorkshopConversationTx = async (
  tx: Prisma.TransactionClient,
  workshopJobId: string,
) => {
  const job = await ensureWorkshopJobExistsTx(tx, workshopJobId);
  const conversation = await tx.workshopConversation.upsert({
    where: { workshopJobId },
    update: {
      customerId: job.customerId ?? null,
    },
    create: {
      workshopJobId,
      customerId: job.customerId ?? null,
    },
    include: conversationInclude,
  });

  return {
    job,
    conversation,
  };
};

const touchConversationTx = async (
  tx: Prisma.TransactionClient,
  conversationId: string,
  customerId: string | null,
) =>
  tx.workshopConversation.update({
    where: { id: conversationId },
    data: {
      customerId,
    },
  });

const toStaffMessageResponse = (
  message: WorkshopConversationRecord["messages"][number],
) => ({
  id: message.id,
  direction: message.direction,
  channel: message.channel,
  customerVisible: message.customerVisible,
  body: message.body,
  deliveryStatus: message.deliveryStatus,
  sentAt: message.sentAt,
  receivedAt: message.receivedAt,
  externalMessageId: message.externalMessageId,
  createdAt: message.createdAt,
  updatedAt: message.updatedAt,
  authorStaff: message.authorStaff
    ? {
        id: message.authorStaff.id,
        username: message.authorStaff.username,
        name: message.authorStaff.name,
      }
    : null,
});

const toPublicMessageResponse = (
  message: WorkshopConversationRecord["messages"][number],
) => ({
  id: message.id,
  direction: message.direction,
  channel: message.channel,
  body: message.body,
  sentAt: message.sentAt,
  receivedAt: message.receivedAt,
  createdAt: message.createdAt,
  senderLabel:
    message.direction === "INBOUND"
      ? "You"
      : normalizeOptionalText(message.authorStaff?.name) ?? "Workshop team",
});

const toStaffConversationResponse = async (conversation: WorkshopConversationRecord) => {
  const portalAccess = await getWorkshopPortalAccessForJobTx(prisma, conversation.workshopJobId);
  const lastMessage = conversation.messages[conversation.messages.length - 1] ?? null;

  return {
    conversation: {
      id: conversation.id,
      workshopJobId: conversation.workshopJobId,
      customerId: conversation.customerId,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messageCount: conversation.messages.length,
      lastMessageAt: lastMessage?.createdAt ?? null,
      portalAccess,
    },
    messages: conversation.messages.map(toStaffMessageResponse),
  };
};

const toPublicConversationResponse = (
  conversation: WorkshopConversationRecord,
  input: {
    accessStatus: "ACTIVE" | "EXPIRED" | "SUPERSEDED";
    canReply: boolean;
  },
) => {
  const customerVisibleMessages = conversation.messages.filter((message) => message.customerVisible);
  const lastMessage = customerVisibleMessages[customerVisibleMessages.length - 1] ?? null;

  return {
    conversation: {
      id: conversation.id,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      accessStatus: input.accessStatus,
      canReply: input.canReply,
      messageCount: customerVisibleMessages.length,
      lastMessageAt: lastMessage?.createdAt ?? null,
    },
    messages: customerVisibleMessages.map(toPublicMessageResponse),
  };
};

const loadConversationForJobTx = async (
  tx: Prisma.TransactionClient,
  workshopJobId: string,
) => {
  const { conversation } = await ensureWorkshopConversationTx(tx, workshopJobId);
  return conversation;
};

export const getWorkshopConversationForJob = async (workshopJobId: string) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  const conversation = await loadConversationForJobTx(prisma, workshopJobId);
  return toStaffConversationResponse(conversation);
};

export const postWorkshopConversationMessageForJob = async (
  workshopJobId: string,
  input: StaffConversationMessageInput,
  auditActor?: AuditActor,
) => {
  if (!isUuid(workshopJobId)) {
    throw new HttpError(400, "Invalid workshop job id", "INVALID_WORKSHOP_JOB_ID");
  }

  const authorStaffId = normalizeOptionalText(input.authorStaffId) ?? null;
  const body = normalizeMessageBody(input.body);
  const channel = parseMessageChannel(input.channel);

  const result = await prisma.$transaction(async (tx) => {
    const { job, conversation } = await ensureWorkshopConversationTx(tx, workshopJobId);
    await ensureStaffAuthorExistsTx(tx, authorStaffId);

    const created = await tx.workshopMessage.create({
      data: {
        conversationId: conversation.id,
        direction: "OUTBOUND",
        channel,
        authorStaffId,
        customerVisible: true,
        body,
        deliveryStatus: "SENT",
        sentAt: new Date(),
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

    await touchConversationTx(tx, conversation.id, job.customerId ?? null);

    await createAuditEventTx(
      tx,
      {
        action: "WORKSHOP_CONVERSATION_MESSAGE_SENT",
        entityType: "WORKSHOP_JOB",
        entityId: workshopJobId,
        metadata: {
          conversationId: conversation.id,
          messageId: created.id,
          direction: created.direction,
          channel: created.channel,
          authorStaffId: created.authorStaffId,
          bodyLength: created.body.length,
        },
      },
      auditActor,
    );

    const refreshed = await loadConversationForJobTx(tx, workshopJobId);

    return {
      conversation: refreshed,
      messageId: created.id,
    };
  });

  emit("workshop.portal_message.ready", {
    id: crypto.randomUUID(),
    type: "workshop.portal_message.ready",
    timestamp: new Date().toISOString(),
    workshopJobId,
    workshopMessageId: result.messageId,
  });

  return toStaffConversationResponse(result.conversation);
};

export const getPublicWorkshopConversation = async (tokenValue: string) => {
  const context = await getPublicWorkshopPortalContext(tokenValue);
  const conversation = await loadConversationForJobTx(prisma, context.estimate.workshopJobId);

  return toPublicConversationResponse(conversation, {
    accessStatus: context.accessStatus,
    canReply: context.canReply,
  });
};

export const postPublicWorkshopConversationReply = async (
  tokenValue: string,
  input: PublicConversationReplyInput,
) => {
  const token = normalizeOptionalText(tokenValue);
  if (!token) {
    throw new HttpError(400, "Quote token is required", "INVALID_QUOTE_TOKEN");
  }

  const body = normalizeMessageBody(input.body);

  const result = await prisma.$transaction(async (tx) => {
    const context = await getPublicWorkshopPortalContextTx(tx, token);

    if (!context.canReply) {
      throw new HttpError(
        410,
        "This portal link is no longer active for customer replies.",
        "WORKSHOP_PORTAL_REPLY_UNAVAILABLE",
      );
    }

    const { job, conversation } = await ensureWorkshopConversationTx(tx, context.estimate.workshopJobId);

    await tx.workshopMessage.create({
      data: {
        conversationId: conversation.id,
        direction: "INBOUND",
        channel: "PORTAL",
        customerVisible: true,
        body,
        deliveryStatus: "RECEIVED",
        receivedAt: new Date(),
      },
    });

    await touchConversationTx(tx, conversation.id, job.customerId ?? null);

    await createAuditEventTx(tx, {
      action: "WORKSHOP_CONVERSATION_MESSAGE_RECEIVED",
      entityType: "WORKSHOP_JOB",
      entityId: context.estimate.workshopJobId,
      metadata: {
        conversationId: conversation.id,
        direction: "INBOUND",
        channel: "PORTAL",
        bodyLength: body.length,
        quoteTokenLastEight: token.slice(-8),
      },
    });

    const refreshed = await loadConversationForJobTx(tx, context.estimate.workshopJobId);

    return {
      conversation: refreshed,
      accessStatus: context.accessStatus,
      canReply: context.canReply,
    };
  });

  return toPublicConversationResponse(result.conversation, {
    accessStatus: result.accessStatus,
    canReply: result.canReply,
  });
};
