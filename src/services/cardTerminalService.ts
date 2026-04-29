import {
  CardTerminalSession,
  CardTerminalSessionStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import { DojoClient, DojoPaymentIntent, DojoTerminalSession } from "../payments/dojo/dojoClient";
import {
  getDojoTerminalIntegrationConfig,
  toPublicDojoTerminalIntegrationConfig,
} from "../payments/dojo/dojoConfig";
import { HttpError, isUuid } from "../utils/http";
import { addSaleTender } from "./salesService";
import {
  capturePaymentIntentById,
  createPaymentIntent,
} from "./paymentIntentService";

type CreateTerminalSaleSessionInput = {
  saleId?: string;
  amountPence?: number;
  terminalId?: string;
};

type SignatureVerificationInput = {
  accepted?: boolean;
};

const MOCK_TERMINAL_ID = "dojo-mock-terminal";

const normalizeOptionalText = (value: string | undefined | null): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const assertPositivePence = (value: number | undefined, fieldName: string) => {
  if (!Number.isInteger(value) || (value ?? 0) <= 0) {
    throw new HttpError(400, `${fieldName} must be a positive integer`, "INVALID_CARD_TERMINAL_SESSION");
  }
  return value as number;
};

const normalizeStatusToken = (value: string | undefined | null) =>
  normalizeOptionalText(value)?.replace(/[\s_-]+/g, "").toLowerCase();

const toTerminalSessionStatus = (
  sessionStatus: string | undefined | null,
  paymentIntentStatus?: string | undefined | null,
): CardTerminalSessionStatus => {
  const normalizedSessionStatus = normalizeStatusToken(sessionStatus);
  const normalizedPaymentStatus = normalizeStatusToken(paymentIntentStatus);

  if (normalizedSessionStatus === "signatureverificationrequired") {
    return "SIGNATURE_VERIFICATION_REQUIRED";
  }
  if (normalizedSessionStatus === "captured" || normalizedPaymentStatus === "captured") {
    return "CAPTURED";
  }
  if (normalizedSessionStatus === "authorized" || normalizedPaymentStatus === "authorized") {
    return "AUTHORIZED";
  }
  if (normalizedSessionStatus === "declined" || normalizedPaymentStatus === "declined") {
    return "DECLINED";
  }
  if (
    normalizedSessionStatus === "canceled" ||
    normalizedSessionStatus === "cancelled" ||
    normalizedPaymentStatus === "canceled" ||
    normalizedPaymentStatus === "cancelled"
  ) {
    return "CANCELED";
  }
  if (normalizedSessionStatus === "expired") {
    return "EXPIRED";
  }
  if (normalizedSessionStatus === "failed" || normalizedPaymentStatus === "failed") {
    return "FAILED";
  }
  if (normalizedSessionStatus === "created") {
    return "CREATED";
  }
  if (normalizedSessionStatus) {
    return "INITIATED";
  }
  return "UNKNOWN";
};

const isFinalStatus = (status: CardTerminalSessionStatus) =>
  status === "CAPTURED" ||
  status === "DECLINED" ||
  status === "CANCELED" ||
  status === "EXPIRED" ||
  status === "FAILED";

const toJsonInput = (value: unknown): Prisma.InputJsonValue | undefined =>
  value === undefined ? undefined : (value as Prisma.InputJsonValue);

const getDojoTerminalSessionId = (session: DojoTerminalSession) =>
  normalizeOptionalText(session.id) ?? normalizeOptionalText(session.terminalSessionId);

const getDojoPaymentIntentId = (intent: DojoPaymentIntent) =>
  normalizeOptionalText(intent.id);

const buildDojoReference = (saleId: string) => `CorePOS sale ${saleId.slice(0, 8)}`;

const toCardTerminalSessionResponse = (
  session: CardTerminalSession,
  salePayment?: unknown,
) => ({
  session: {
    id: session.id,
    provider: session.provider,
    status: session.status,
    sessionType: session.sessionType,
    saleId: session.saleId,
    corePaymentIntentId: session.corePaymentIntentId,
    saleTenderId: session.saleTenderId,
    providerPaymentIntentId: session.providerPaymentIntentId,
    providerTerminalSessionId: session.providerTerminalSessionId,
    terminalId: session.terminalId,
    amountPence: session.amountPence,
    currencyCode: session.currencyCode,
    providerStatus: session.providerStatus,
    providerReference: session.providerReference,
    lastErrorCode: session.lastErrorCode,
    lastErrorMessage: session.lastErrorMessage,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    completedAt: session.completedAt,
    isFinal: isFinalStatus(session.status),
  },
  ...(salePayment ? { salePayment } : {}),
});

export const getCardTerminalIntegrationConfig = () => ({
  config: toPublicDojoTerminalIntegrationConfig(),
});

export const listCardTerminals = async (status = "Available") => {
  const config = getDojoTerminalIntegrationConfig();
  if (!config.enabled) {
    return {
      config: toPublicDojoTerminalIntegrationConfig(config),
      terminals: [],
    };
  }

  if (config.mockMode) {
    return {
      config: toPublicDojoTerminalIntegrationConfig(config),
      terminals: [
        {
          id: config.defaultTerminalId ?? MOCK_TERMINAL_ID,
          terminalId: config.defaultTerminalId ?? MOCK_TERMINAL_ID,
          name: "Mock Dojo terminal",
          status: "Available",
        },
      ],
    };
  }

  const client = new DojoClient(config);
  const payload = await client.listTerminals(status);
  const terminalRows = Array.isArray(payload) ? payload : payload.terminals ?? [];

  return {
    config: toPublicDojoTerminalIntegrationConfig(config),
    terminals: terminalRows.map((terminal) => {
      const terminalId = normalizeOptionalText(terminal.terminalId) ?? normalizeOptionalText(terminal.id);
      return {
        id: terminalId ?? "",
        terminalId: terminalId ?? "",
        name: normalizeOptionalText(terminal.name) ?? terminalId ?? "Dojo terminal",
        status: normalizeOptionalText(terminal.status) ?? "Unknown",
        tid: normalizeOptionalText(terminal.tid) ?? null,
      };
    }),
  };
};

const markCoreIntentFailed = async (intentId: string | undefined) => {
  if (!intentId) {
    return;
  }
  await prisma.paymentIntent.update({
    where: { id: intentId },
    data: { status: "FAILED" },
  }).catch(() => undefined);
};

export const createCardTerminalSaleSession = async (
  input: CreateTerminalSaleSessionInput,
  staffActorId?: string,
) => {
  const saleId = normalizeOptionalText(input.saleId);
  if (!saleId || !isUuid(saleId)) {
    throw new HttpError(400, "saleId must be a valid UUID", "INVALID_CARD_TERMINAL_SESSION");
  }

  const amountPence = assertPositivePence(input.amountPence, "amountPence");
  const config = getDojoTerminalIntegrationConfig();
  if (!config.enabled) {
    throw new HttpError(503, "Dojo Pay at Counter is not enabled", "DOJO_TERMINALS_DISABLED");
  }
  if (!config.configured) {
    throw new HttpError(
      503,
      "Dojo Pay at Counter is missing API credentials or integration identifiers",
      "DOJO_TERMINALS_NOT_CONFIGURED",
    );
  }

  const terminalId =
    normalizeOptionalText(input.terminalId) ??
    config.defaultTerminalId ??
    (config.mockMode ? MOCK_TERMINAL_ID : undefined);
  if (!terminalId) {
    throw new HttpError(400, "terminalId is required", "DOJO_TERMINAL_REQUIRED");
  }

  const localIntentResult = await createPaymentIntent(
    {
      saleId,
      amountPence,
      provider: "CARD",
    },
    staffActorId,
  );
  const localIntent = localIntentResult.intent;

  try {
    if (config.mockMode) {
      const providerPaymentIntentId = `pi_mock_${localIntent.id.replace(/-/g, "").slice(0, 24)}`;
      const providerTerminalSessionId = `ts_mock_${localIntent.id.replace(/-/g, "").slice(0, 24)}`;
      await prisma.paymentIntent.update({
        where: { id: localIntent.id },
        data: { externalRef: providerPaymentIntentId },
      });

      const session = await prisma.cardTerminalSession.create({
        data: {
          provider: "DOJO",
          status: "INITIATED",
          sessionType: "Sale",
          saleId,
          corePaymentIntentId: localIntent.id,
          providerPaymentIntentId,
          providerTerminalSessionId,
          terminalId,
          amountPence,
          currencyCode: config.currencyCode,
          providerStatus: "Initiated",
          providerReference: buildDojoReference(saleId),
          createdByStaffId: staffActorId ?? null,
        },
      });

      return toCardTerminalSessionResponse(session, localIntentResult.salePayment);
    }

    const client = new DojoClient(config);
    const dojoIntent = await client.createPaymentIntent({
      saleId,
      amountPence,
      reference: buildDojoReference(saleId),
      description: `CorePOS card payment for sale ${saleId}`,
      currencyCode: config.currencyCode,
    });
    const providerPaymentIntentId = getDojoPaymentIntentId(dojoIntent);
    if (!providerPaymentIntentId) {
      throw new HttpError(502, "Dojo did not return a payment intent id", "DOJO_INVALID_RESPONSE");
    }

    await prisma.paymentIntent.update({
      where: { id: localIntent.id },
      data: { externalRef: providerPaymentIntentId },
    });

    const dojoSession = await client.createSaleTerminalSession({
      terminalId,
      paymentIntentId: providerPaymentIntentId,
    });
    const providerTerminalSessionId = getDojoTerminalSessionId(dojoSession);
    if (!providerTerminalSessionId) {
      throw new HttpError(502, "Dojo did not return a terminal session id", "DOJO_INVALID_RESPONSE");
    }

    const session = await prisma.cardTerminalSession.create({
      data: {
        provider: "DOJO",
        status: toTerminalSessionStatus(dojoSession.status, dojoIntent.status),
        sessionType: "Sale",
        saleId,
        corePaymentIntentId: localIntent.id,
        providerPaymentIntentId,
        providerTerminalSessionId,
        terminalId,
        amountPence,
        currencyCode: config.currencyCode,
        providerStatus: normalizeOptionalText(dojoSession.status) ?? null,
        providerReference: buildDojoReference(saleId),
        ...(toJsonInput(dojoSession.notificationEvents)
          ? { notificationEvents: toJsonInput(dojoSession.notificationEvents) }
          : {}),
        createdByStaffId: staffActorId ?? null,
      },
    });

    return toCardTerminalSessionResponse(session, localIntentResult.salePayment);
  } catch (error) {
    await markCoreIntentFailed(localIntent.id);
    throw error;
  }
};

const settleCapturedTerminalSession = async (
  session: CardTerminalSession,
  staffActorId?: string,
) => {
  const sale = await prisma.sale.findUnique({
    where: { id: session.saleId },
    select: { completedAt: true },
  });
  if (sale?.completedAt) {
    return { paid: true, saleAlreadyCompleted: true };
  }

  let saleTenderId = session.saleTenderId;
  if (!saleTenderId) {
    const tenderResult = await addSaleTender(
      session.saleId,
      {
        method: "CARD",
        amountPence: session.amountPence,
      },
      staffActorId,
    );
    saleTenderId = tenderResult.tender.id;
    await prisma.cardTerminalSession.update({
      where: { id: session.id },
      data: { saleTenderId },
    });
  }

  if (!session.corePaymentIntentId) {
    return { paid: true, saleTenderId };
  }

  return capturePaymentIntentById(session.corePaymentIntentId, staffActorId);
};

const updateSessionFromProviderState = async (
  session: CardTerminalSession,
  nextStatus: CardTerminalSessionStatus,
  providerStatus: string | null,
  providerPayload: {
    notificationEvents?: unknown;
    customerReceipt?: unknown;
    merchantReceipt?: unknown;
  },
  staffActorId?: string,
) => {
  if (nextStatus === "CAPTURED" && session.status !== "CAPTURED") {
    try {
      const salePayment = await settleCapturedTerminalSession(session, staffActorId);
      const captured = await prisma.cardTerminalSession.update({
        where: { id: session.id },
        data: {
          status: "CAPTURED",
          providerStatus,
          completedAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null,
          ...(toJsonInput(providerPayload.notificationEvents)
            ? { notificationEvents: toJsonInput(providerPayload.notificationEvents) }
            : {}),
          ...(toJsonInput(providerPayload.customerReceipt)
            ? { customerReceipt: toJsonInput(providerPayload.customerReceipt) }
            : {}),
          ...(toJsonInput(providerPayload.merchantReceipt)
            ? { merchantReceipt: toJsonInput(providerPayload.merchantReceipt) }
            : {}),
        },
      });
      return toCardTerminalSessionResponse(captured, salePayment);
    } catch (error) {
      const failed = await prisma.cardTerminalSession.update({
        where: { id: session.id },
        data: {
          status: "FAILED",
          providerStatus,
          lastErrorCode: error instanceof HttpError ? error.code : "CARD_TERMINAL_SETTLEMENT_FAILED",
          lastErrorMessage: error instanceof Error ? error.message : "Card terminal settlement failed",
        },
      });
      return toCardTerminalSessionResponse(failed);
    }
  }

  const updated = await prisma.cardTerminalSession.update({
    where: { id: session.id },
    data: {
      status: nextStatus,
      providerStatus,
      ...(isFinalStatus(nextStatus) ? { completedAt: new Date() } : {}),
      ...(toJsonInput(providerPayload.notificationEvents)
        ? { notificationEvents: toJsonInput(providerPayload.notificationEvents) }
        : {}),
      ...(toJsonInput(providerPayload.customerReceipt)
        ? { customerReceipt: toJsonInput(providerPayload.customerReceipt) }
        : {}),
      ...(toJsonInput(providerPayload.merchantReceipt)
        ? { merchantReceipt: toJsonInput(providerPayload.merchantReceipt) }
        : {}),
    },
  });

  return toCardTerminalSessionResponse(updated);
};

export const refreshCardTerminalSession = async (
  sessionId: string,
  staffActorId?: string,
) => {
  if (!isUuid(sessionId)) {
    throw new HttpError(400, "Invalid terminal session id", "INVALID_CARD_TERMINAL_SESSION_ID");
  }

  const session = await prisma.cardTerminalSession.findUnique({ where: { id: sessionId } });
  if (!session) {
    throw new HttpError(404, "Card terminal session not found", "CARD_TERMINAL_SESSION_NOT_FOUND");
  }
  if (isFinalStatus(session.status)) {
    return toCardTerminalSessionResponse(session);
  }

  const config = getDojoTerminalIntegrationConfig();
  if (config.mockMode) {
    return updateSessionFromProviderState(
      session,
      "CAPTURED",
      "Captured",
      {
        notificationEvents: [
          {
            type: "mock",
            message: "Mock Dojo terminal captured the payment.",
          },
        ],
      },
      staffActorId,
    );
  }

  if (!session.providerTerminalSessionId) {
    throw new HttpError(
      409,
      "Card terminal session is missing its Dojo terminal session id",
      "CARD_TERMINAL_SESSION_NOT_READY",
    );
  }

  const client = new DojoClient(config);
  const dojoSession = await client.getTerminalSession(session.providerTerminalSessionId);
  let dojoIntent: DojoPaymentIntent | null = null;
  if (session.providerPaymentIntentId) {
    dojoIntent = await client.getPaymentIntent(session.providerPaymentIntentId);
  }

  const nextStatus = toTerminalSessionStatus(dojoSession.status, dojoIntent?.status);
  return updateSessionFromProviderState(
    session,
    nextStatus,
    normalizeOptionalText(dojoSession.status) ?? normalizeOptionalText(dojoIntent?.status) ?? null,
    {
      notificationEvents: dojoSession.notificationEvents,
      customerReceipt: dojoSession.customerReceipt,
      merchantReceipt: dojoSession.merchantReceipt,
    },
    staffActorId,
  );
};

export const cancelCardTerminalSession = async (sessionId: string) => {
  if (!isUuid(sessionId)) {
    throw new HttpError(400, "Invalid terminal session id", "INVALID_CARD_TERMINAL_SESSION_ID");
  }

  const session = await prisma.cardTerminalSession.findUnique({ where: { id: sessionId } });
  if (!session) {
    throw new HttpError(404, "Card terminal session not found", "CARD_TERMINAL_SESSION_NOT_FOUND");
  }
  if (isFinalStatus(session.status)) {
    return toCardTerminalSessionResponse(session);
  }

  const config = getDojoTerminalIntegrationConfig();
  if (config.mockMode) {
    const canceled = await prisma.cardTerminalSession.update({
      where: { id: session.id },
      data: {
        status: "CANCELED",
        providerStatus: "Canceled",
        completedAt: new Date(),
      },
    });
    return toCardTerminalSessionResponse(canceled);
  }

  if (!session.providerTerminalSessionId) {
    throw new HttpError(
      409,
      "Card terminal session is missing its Dojo terminal session id",
      "CARD_TERMINAL_SESSION_NOT_READY",
    );
  }

  const client = new DojoClient(config);
  const dojoSession = await client.cancelTerminalSession(session.providerTerminalSessionId);
  const canceledStatus = toTerminalSessionStatus(dojoSession.status);
  const updated = await prisma.cardTerminalSession.update({
    where: { id: session.id },
    data: {
      status: canceledStatus === "UNKNOWN" ? "CANCELED" : canceledStatus,
      providerStatus: normalizeOptionalText(dojoSession.status) ?? "Canceled",
      ...(isFinalStatus(canceledStatus) ? { completedAt: new Date() } : {}),
    },
  });
  return toCardTerminalSessionResponse(updated);
};

export const respondToCardTerminalSignature = async (
  sessionId: string,
  input: SignatureVerificationInput,
  staffActorId?: string,
) => {
  if (!isUuid(sessionId)) {
    throw new HttpError(400, "Invalid terminal session id", "INVALID_CARD_TERMINAL_SESSION_ID");
  }
  if (typeof input.accepted !== "boolean") {
    throw new HttpError(400, "accepted must be a boolean", "INVALID_SIGNATURE_RESPONSE");
  }

  const session = await prisma.cardTerminalSession.findUnique({ where: { id: sessionId } });
  if (!session) {
    throw new HttpError(404, "Card terminal session not found", "CARD_TERMINAL_SESSION_NOT_FOUND");
  }

  const config = getDojoTerminalIntegrationConfig();
  if (config.mockMode) {
    return updateSessionFromProviderState(
      session,
      input.accepted ? "CAPTURED" : "DECLINED",
      input.accepted ? "Captured" : "Declined",
      {},
      staffActorId,
    );
  }

  if (!session.providerTerminalSessionId) {
    throw new HttpError(
      409,
      "Card terminal session is missing its Dojo terminal session id",
      "CARD_TERMINAL_SESSION_NOT_READY",
    );
  }

  const client = new DojoClient(config);
  await client.respondToSignatureVerification(session.providerTerminalSessionId, input.accepted);
  return refreshCardTerminalSession(session.id, staffActorId);
};
