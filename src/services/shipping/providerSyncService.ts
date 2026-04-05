import { Prisma, WebOrderShipmentStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logOperationalEvent } from "../../lib/operationalLogger";
import { HttpError } from "../../utils/http";
import { createAuditEventTx, type AuditActor } from "../auditService";
import type {
  ShippingProviderShipmentLifecycleInput,
  ShippingProviderShipmentLifecycleResult,
  ShippingProviderWebhookEvent,
} from "./contracts";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FAILED_PROVIDER_VOID_STATUSES = new Set(["REJECTED", "NOT_APPLICABLE"]);

const providerSyncShipmentSelect = Prisma.validator<Prisma.WebOrderShipmentSelect>()({
  id: true,
  webOrderId: true,
  shipmentNumber: true,
  status: true,
  providerKey: true,
  providerDisplayName: true,
  providerEnvironment: true,
  serviceCode: true,
  serviceName: true,
  trackingNumber: true,
  labelFormat: true,
  labelMimeType: true,
  labelFileName: true,
  labelContent: true,
  providerReference: true,
  providerShipmentReference: true,
  providerTrackingReference: true,
  providerLabelReference: true,
  providerStatus: true,
  providerRefundStatus: true,
  providerMetadata: true,
  labelGeneratedAt: true,
  providerSyncedAt: true,
  providerSyncError: true,
  printPreparedAt: true,
  printedAt: true,
  dispatchedAt: true,
  voidRequestedAt: true,
  voidedAt: true,
  reprintCount: true,
  webOrder: {
    select: {
      id: true,
      orderNumber: true,
      sourceChannel: true,
    },
  },
});

const providerSyncEventSelect = Prisma.validator<Prisma.ShippingProviderSyncEventSelect>()({
  id: true,
  providerKey: true,
  providerEventId: true,
  providerEventType: true,
  shipmentId: true,
  providerShipmentReference: true,
  providerTrackingReference: true,
  trackingNumber: true,
  signatureVerified: true,
  status: true,
  occurredAt: true,
  firstReceivedAt: true,
  lastReceivedAt: true,
  processedAt: true,
  syncAppliedAt: true,
  deliveryCount: true,
  errorCode: true,
  errorMessage: true,
  createdAt: true,
  updatedAt: true,
});

type ProviderSyncShipmentRecord = Prisma.WebOrderShipmentGetPayload<{ select: typeof providerSyncShipmentSelect }>;
type ProviderSyncEventRecord = Prisma.ShippingProviderSyncEventGetPayload<{ select: typeof providerSyncEventSelect }>;

type ProviderLifecycleAction = "SYNC" | "VOID" | "WEBHOOK";

type ApplyShipmentLifecycleResultInput = {
  shipmentId: string;
  lifecycleResult: ShippingProviderShipmentLifecycleResult;
  action: ProviderLifecycleAction;
  syncSource: "MANUAL_REFRESH" | "VOID_REQUEST" | "WEBHOOK";
  syncError?: string | null;
  auditActor?: AuditActor;
  auditMetadata?: Record<string, unknown>;
  assertCurrentShipment?: (shipment: ProviderSyncShipmentRecord) => void;
};

export type ProviderWebhookEventReceiptResponse = {
  id: string;
  providerKey: string;
  providerEventId: string;
  providerEventType: string;
  shipmentId: string | null;
  status: "RECEIVED" | "PROCESSED" | "IGNORED" | "FAILED";
  signatureVerified: boolean;
  occurredAt: Date | null;
  firstReceivedAt: Date;
  lastReceivedAt: Date;
  processedAt: Date | null;
  syncAppliedAt: Date | null;
  deliveryCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ProviderWebhookReconciliationResponse = {
  httpStatus: number;
  duplicate: boolean;
  applied: boolean;
  shipmentId: string | null;
  receipt: ProviderWebhookEventReceiptResponse;
};

const parseRequiredUuid = (value: string, field: string, code: string) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || !UUID_REGEX.test(normalized)) {
    throw new HttpError(400, `${field} must be a valid UUID`, code);
  }

  return normalized;
};

const normalizeOptionalText = (value: string | null | undefined) => {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const shipmentHasStoredLabelContent = (shipment: { labelContent: string | null | undefined }) =>
  typeof shipment.labelContent === "string" && shipment.labelContent.trim().length > 0;

const asProviderMetadataRecord = (value: Prisma.JsonValue | null): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
};

const toReceiptResponse = (receipt: ProviderSyncEventRecord): ProviderWebhookEventReceiptResponse => ({
  id: receipt.id,
  providerKey: receipt.providerKey,
  providerEventId: receipt.providerEventId,
  providerEventType: receipt.providerEventType,
  shipmentId: receipt.shipmentId ?? null,
  status: receipt.status,
  signatureVerified: receipt.signatureVerified,
  occurredAt: receipt.occurredAt ?? null,
  firstReceivedAt: receipt.firstReceivedAt,
  lastReceivedAt: receipt.lastReceivedAt,
  processedAt: receipt.processedAt ?? null,
  syncAppliedAt: receipt.syncAppliedAt ?? null,
  deliveryCount: receipt.deliveryCount,
  errorCode: receipt.errorCode ?? null,
  errorMessage: receipt.errorMessage ?? null,
  createdAt: receipt.createdAt,
  updatedAt: receipt.updatedAt,
});

export const normalizeProviderLifecycleToken = (value: string | null | undefined) => {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }

  return normalized.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase() || null;
};

const deriveShipmentStatusFromPrintState = (shipment: {
  printPreparedAt: Date | null;
  printedAt: Date | null;
  dispatchedAt: Date | null;
}): WebOrderShipmentStatus => {
  if (shipment.dispatchedAt) {
    return "DISPATCHED";
  }
  if (shipment.printedAt) {
    return "PRINTED";
  }
  if (shipment.printPreparedAt) {
    return "PRINT_PREPARED";
  }
  return "LABEL_READY";
};

const deriveShipmentStatusFromProviderLifecycle = (
  shipment: {
    status: WebOrderShipmentStatus;
    printPreparedAt: Date | null;
    printedAt: Date | null;
    dispatchedAt: Date | null;
  },
  result: ShippingProviderShipmentLifecycleResult,
) => {
  if (shipment.dispatchedAt) {
    return "DISPATCHED" as const;
  }

  const refundStatus = normalizeProviderLifecycleToken(result.providerRefundStatus);
  if (refundStatus === "REFUNDED") {
    return "VOIDED" as const;
  }
  if (refundStatus === "SUBMITTED") {
    return "VOID_PENDING" as const;
  }
  if (shipment.status === "VOID_PENDING" && refundStatus && FAILED_PROVIDER_VOID_STATUSES.has(refundStatus)) {
    return deriveShipmentStatusFromPrintState(shipment);
  }

  return shipment.status;
};

const buildShipmentLifecycleUpdateData = (
  shipment: ProviderSyncShipmentRecord,
  result: ShippingProviderShipmentLifecycleResult,
  syncedAt: Date,
  syncError: string | null,
): Prisma.WebOrderShipmentUpdateInput => {
  const refundStatus =
    result.providerRefundStatus !== undefined
      ? normalizeProviderLifecycleToken(result.providerRefundStatus)
      : (shipment.providerRefundStatus ?? null);
  const nextStatus = deriveShipmentStatusFromProviderLifecycle(shipment, {
    ...result,
    providerRefundStatus: refundStatus,
  });

  const update: Prisma.WebOrderShipmentUpdateInput = {
    status: nextStatus,
    trackingNumber: normalizeOptionalText(result.trackingNumber ?? undefined) ?? shipment.trackingNumber,
    serviceCode: normalizeOptionalText(result.normalizedServiceCode ?? undefined) ?? shipment.serviceCode,
    serviceName: normalizeOptionalText(result.normalizedServiceName ?? undefined) ?? shipment.serviceName,
    providerReference:
      result.providerReference !== undefined
        ? (result.providerReference ?? null)
        : (shipment.providerReference ?? null),
    providerShipmentReference:
      result.providerShipmentReference !== undefined
        ? (result.providerShipmentReference ?? null)
        : (shipment.providerShipmentReference ?? null),
    providerTrackingReference:
      result.providerTrackingReference !== undefined
        ? (result.providerTrackingReference ?? null)
        : (shipment.providerTrackingReference ?? null),
    providerLabelReference:
      result.providerLabelReference !== undefined
        ? (result.providerLabelReference ?? null)
        : (shipment.providerLabelReference ?? null),
    providerStatus:
      result.providerStatus !== undefined
        ? (normalizeProviderLifecycleToken(result.providerStatus) ?? null)
        : (shipment.providerStatus ?? null),
    providerRefundStatus: refundStatus,
    providerMetadata:
      result.providerMetadata !== undefined
        ? (result.providerMetadata as Prisma.InputJsonValue | null)
        : (shipment.providerMetadata as Prisma.InputJsonValue | null),
    providerSyncedAt: syncedAt,
    providerSyncError: syncError,
    voidRequestedAt:
      refundStatus === "SUBMITTED" || refundStatus === "REFUNDED"
        ? (shipment.voidRequestedAt ?? syncedAt)
        : shipment.voidRequestedAt,
    voidedAt:
      refundStatus === "REFUNDED"
        ? (shipment.voidedAt ?? syncedAt)
        : shipment.voidedAt,
  };

  if (result.document) {
    update.labelFormat = result.document.format;
    update.labelMimeType = result.document.mimeType;
    update.labelFileName = result.document.fileName;
    update.labelContent = result.document.content;
    update.labelGeneratedAt = syncedAt;
  }

  return update;
};

export const buildShipmentLifecycleInput = (
  shipment: ProviderSyncShipmentRecord,
): ShippingProviderShipmentLifecycleInput => ({
  order: {
    id: shipment.webOrder.id,
    orderNumber: shipment.webOrder.orderNumber,
    sourceChannel: shipment.webOrder.sourceChannel,
  },
  shipment: {
    shipmentId: shipment.id,
    shipmentNumber: shipment.shipmentNumber,
    providerKey: shipment.providerKey,
    providerDisplayName: shipment.providerDisplayName,
    providerEnvironment: shipment.providerEnvironment as ShippingProviderShipmentLifecycleInput["shipment"]["providerEnvironment"],
    serviceCode: shipment.serviceCode,
    serviceName: shipment.serviceName,
    trackingNumber: shipment.trackingNumber,
    providerReference: shipment.providerReference ?? null,
    providerShipmentReference: shipment.providerShipmentReference ?? null,
    providerTrackingReference: shipment.providerTrackingReference ?? null,
    providerLabelReference: shipment.providerLabelReference ?? null,
    providerStatus: shipment.providerStatus ?? null,
    providerRefundStatus: shipment.providerRefundStatus ?? null,
    providerMetadata: asProviderMetadataRecord(shipment.providerMetadata),
    hasStoredLabelDocument: shipmentHasStoredLabelContent(shipment),
    labelGeneratedAt: shipment.labelGeneratedAt,
  },
});

export const getShipmentForProviderLifecycleOrThrow = async (shipmentId: string) => {
  const normalizedShipmentId = parseRequiredUuid(shipmentId, "shipmentId", "INVALID_WEB_ORDER_SHIPMENT_ID");
  const shipment = await prisma.webOrderShipment.findUnique({
    where: { id: normalizedShipmentId },
    select: providerSyncShipmentSelect,
  });

  if (!shipment) {
    throw new HttpError(404, "Web order shipment not found", "WEB_ORDER_SHIPMENT_NOT_FOUND");
  }

  return shipment;
};

export const applyShipmentLifecycleResult = async ({
  shipmentId,
  lifecycleResult,
  action,
  syncSource,
  syncError = null,
  auditActor,
  auditMetadata = {},
  assertCurrentShipment,
}: ApplyShipmentLifecycleResultInput) => {
  const normalizedShipmentId = parseRequiredUuid(shipmentId, "shipmentId", "INVALID_WEB_ORDER_SHIPMENT_ID");
  const syncedAt = new Date();

  return prisma.$transaction(async (tx) => {
    const currentShipment = await tx.webOrderShipment.findUnique({
      where: { id: normalizedShipmentId },
      select: providerSyncShipmentSelect,
    });

    if (!currentShipment) {
      throw new HttpError(404, "Web order shipment not found", "WEB_ORDER_SHIPMENT_NOT_FOUND");
    }
    assertCurrentShipment?.(currentShipment);

    const savedShipment = await tx.webOrderShipment.update({
      where: { id: currentShipment.id },
      data: buildShipmentLifecycleUpdateData(currentShipment, lifecycleResult, syncedAt, syncError),
      select: providerSyncShipmentSelect,
    });

    await createAuditEventTx(
      tx,
      {
        action:
          action === "VOID"
            ? (syncError ? "WEB_ORDER_SHIPMENT_VOID_FAILED" : "WEB_ORDER_SHIPMENT_VOID_REQUESTED")
            : "WEB_ORDER_SHIPMENT_PROVIDER_SYNCED",
        entityType: "WEB_ORDER_SHIPMENT",
        entityId: savedShipment.id,
        metadata: {
          webOrderId: savedShipment.webOrder.id,
          orderNumber: savedShipment.webOrder.orderNumber,
          providerKey: savedShipment.providerKey,
          status: savedShipment.status,
          providerStatus: savedShipment.providerStatus,
          providerRefundStatus: savedShipment.providerRefundStatus,
          providerSyncedAt: syncedAt.toISOString(),
          syncSource,
          failureMessage: syncError,
          ...auditMetadata,
        },
      },
      auditActor,
    );

    return savedShipment;
  });
};

export const persistShipmentLifecycleFailure = async (
  shipmentId: string,
  action: "SYNC" | "VOID",
  error: unknown,
  auditActor?: AuditActor,
) => {
  const normalizedShipmentId = parseRequiredUuid(shipmentId, "shipmentId", "INVALID_WEB_ORDER_SHIPMENT_ID");
  const failureMessage = error instanceof Error ? error.message : String(error);
  const failureCode = error instanceof HttpError ? error.code : `SHIPMENT_${action}_FAILED`;

  const saved = await prisma.$transaction(async (tx) => {
    const shipment = await tx.webOrderShipment.findUnique({
      where: { id: normalizedShipmentId },
      select: {
        id: true,
        webOrderId: true,
        trackingNumber: true,
        status: true,
        providerKey: true,
      },
    });

    if (!shipment) {
      return null;
    }

    await tx.webOrderShipment.update({
      where: { id: shipment.id },
      data: {
        providerSyncError: failureMessage,
      },
    });

    await createAuditEventTx(
      tx,
      {
        action: action === "SYNC" ? "WEB_ORDER_SHIPMENT_PROVIDER_SYNC_FAILED" : "WEB_ORDER_SHIPMENT_VOID_FAILED",
        entityType: "WEB_ORDER_SHIPMENT",
        entityId: shipment.id,
        metadata: {
          webOrderId: shipment.webOrderId,
          trackingNumber: shipment.trackingNumber,
          providerKey: shipment.providerKey,
          status: shipment.status,
          failureCode,
          failureMessage,
        },
      },
      auditActor,
    );

    return shipment;
  });

  if (saved) {
    logOperationalEvent(
      action === "SYNC" ? "online_store.shipment.provider_sync_failed" : "online_store.shipment.void_failed",
      {
        entityId: saved.id,
        shipmentId: saved.id,
        webOrderId: saved.webOrderId,
        providerKey: saved.providerKey,
        failureCode,
      },
    );
  }
};

const findShipmentForWebhookTx = async (
  tx: Prisma.TransactionClient,
  providerKey: string,
  event: ShippingProviderWebhookEvent,
) => {
  const providerShipmentReference = normalizeOptionalText(event.providerShipmentReference ?? undefined);
  if (providerShipmentReference) {
    const shipment = await tx.webOrderShipment.findFirst({
      where: {
        providerKey,
        OR: [
          { providerShipmentReference },
          { providerReference: providerShipmentReference },
        ],
      },
      orderBy: [{ createdAt: "desc" }],
      select: providerSyncShipmentSelect,
    });
    if (shipment) {
      return shipment;
    }
  }

  const providerTrackingReference = normalizeOptionalText(event.providerTrackingReference ?? undefined);
  if (providerTrackingReference) {
    const shipment = await tx.webOrderShipment.findFirst({
      where: {
        providerKey,
        providerTrackingReference,
      },
      orderBy: [{ createdAt: "desc" }],
      select: providerSyncShipmentSelect,
    });
    if (shipment) {
      return shipment;
    }
  }

  const trackingNumber = normalizeOptionalText(event.trackingNumber ?? undefined);
  if (trackingNumber) {
    const shipment = await tx.webOrderShipment.findUnique({
      where: { trackingNumber },
      select: providerSyncShipmentSelect,
    });
    if (shipment?.providerKey === providerKey) {
      return shipment;
    }
  }

  return null;
};

const updateWebhookReceiptError = async (
  receiptId: string,
  error: unknown,
) => {
  const failureMessage = error instanceof Error ? error.message : String(error);
  const failureCode = error instanceof HttpError ? error.code : "SHIPPING_PROVIDER_SYNC_FAILED";

  const updated = await prisma.shippingProviderSyncEvent.update({
    where: { id: receiptId },
    data: {
      status: "FAILED",
      processedAt: new Date(),
      errorCode: failureCode,
      errorMessage: failureMessage,
    },
    select: providerSyncEventSelect,
  });

  logOperationalEvent("shipping.provider.webhook.failed", {
    entityId: updated.id,
    providerKey: updated.providerKey,
    providerEventId: updated.providerEventId,
    failureCode,
  });
};

export const reconcileProviderWebhookEvent = async (
  providerKey: string,
  event: ShippingProviderWebhookEvent,
  auditActor?: AuditActor,
): Promise<ProviderWebhookReconciliationResponse> => {
  let receiptId: string | null = null;
  const receivedAt = new Date();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existingReceipt = await tx.shippingProviderSyncEvent.findUnique({
        where: {
          providerKey_providerEventId: {
            providerKey,
            providerEventId: event.eventId,
          },
        },
        select: providerSyncEventSelect,
      });

      const payload = (event.payload ?? null) as Prisma.InputJsonValue | null;
      const upsertedReceipt = existingReceipt
        ? await tx.shippingProviderSyncEvent.update({
            where: { id: existingReceipt.id },
            data: {
              lastReceivedAt: receivedAt,
              deliveryCount: { increment: 1 },
            },
            select: providerSyncEventSelect,
          })
        : await tx.shippingProviderSyncEvent.create({
            data: {
              providerKey,
              providerEventId: event.eventId,
              providerEventType: event.eventType,
              providerShipmentReference: normalizeOptionalText(event.providerShipmentReference ?? undefined),
              providerTrackingReference: normalizeOptionalText(event.providerTrackingReference ?? undefined),
              trackingNumber: normalizeOptionalText(event.trackingNumber ?? undefined),
              signatureVerified: event.signatureVerified,
              status: "RECEIVED",
              occurredAt: event.occurredAt ?? null,
              firstReceivedAt: receivedAt,
              lastReceivedAt: receivedAt,
              payload,
            },
            select: providerSyncEventSelect,
          });

      receiptId = upsertedReceipt.id;

      if (upsertedReceipt.status === "PROCESSED" || upsertedReceipt.status === "IGNORED") {
        logOperationalEvent("shipping.provider.webhook.duplicate", {
          entityId: upsertedReceipt.id,
          providerKey,
          providerEventId: event.eventId,
          status: upsertedReceipt.status,
        });

        return {
          httpStatus: upsertedReceipt.status === "PROCESSED" ? 200 : 202,
          duplicate: true,
          applied: false,
          shipmentId: upsertedReceipt.shipmentId ?? null,
          receipt: upsertedReceipt,
        };
      }

      if (event.disposition === "IGNORE") {
        const ignoredReceipt = await tx.shippingProviderSyncEvent.update({
          where: { id: upsertedReceipt.id },
          data: {
            status: "IGNORED",
            processedAt: receivedAt,
            errorCode: "SHIPPING_PROVIDER_EVENT_IGNORED",
            errorMessage: event.ignoreReason ?? "Provider event was intentionally ignored",
          },
          select: providerSyncEventSelect,
        });

        logOperationalEvent("shipping.provider.webhook.ignored", {
          entityId: ignoredReceipt.id,
          providerKey,
          providerEventId: event.eventId,
          providerEventType: event.eventType,
        });

        return {
          httpStatus: 202,
          duplicate: false,
          applied: false,
          shipmentId: null,
          receipt: ignoredReceipt,
        };
      }

      if (!event.lifecycleResult) {
        throw new HttpError(
          502,
          "Provider event did not include a lifecycle update result",
          "SHIPPING_PROVIDER_EVENT_INVALID",
        );
      }

      const matchedShipment = await findShipmentForWebhookTx(tx, providerKey, event);
      if (!matchedShipment) {
        const ignoredReceipt = await tx.shippingProviderSyncEvent.update({
          where: { id: upsertedReceipt.id },
          data: {
            status: "IGNORED",
            processedAt: receivedAt,
            errorCode: "SHIPPING_PROVIDER_EVENT_UNMATCHED",
            errorMessage: "No matching CorePOS shipment was found for this provider event",
          },
          select: providerSyncEventSelect,
        });

        logOperationalEvent("shipping.provider.webhook.ignored", {
          entityId: ignoredReceipt.id,
          providerKey,
          providerEventId: event.eventId,
          providerEventType: event.eventType,
          reason: "UNMATCHED",
        });

        return {
          httpStatus: 202,
          duplicate: false,
          applied: false,
          shipmentId: null,
          receipt: ignoredReceipt,
        };
      }

      const savedShipment = await tx.webOrderShipment.update({
        where: { id: matchedShipment.id },
        data: buildShipmentLifecycleUpdateData(matchedShipment, event.lifecycleResult, receivedAt, null),
        select: providerSyncShipmentSelect,
      });

      await createAuditEventTx(
        tx,
        {
          action: "WEB_ORDER_SHIPMENT_PROVIDER_SYNCED",
          entityType: "WEB_ORDER_SHIPMENT",
          entityId: savedShipment.id,
          metadata: {
            webOrderId: savedShipment.webOrder.id,
            orderNumber: savedShipment.webOrder.orderNumber,
            providerKey: savedShipment.providerKey,
            status: savedShipment.status,
            providerStatus: savedShipment.providerStatus,
            providerRefundStatus: savedShipment.providerRefundStatus,
            providerSyncedAt: receivedAt.toISOString(),
            syncSource: "WEBHOOK",
            providerEventId: event.eventId,
            providerEventType: event.eventType,
          },
        },
        auditActor,
      );

      const processedReceipt = await tx.shippingProviderSyncEvent.update({
        where: { id: upsertedReceipt.id },
        data: {
          shipmentId: savedShipment.id,
          status: "PROCESSED",
          processedAt: receivedAt,
          syncAppliedAt: receivedAt,
          errorCode: null,
          errorMessage: null,
        },
        select: providerSyncEventSelect,
      });

      logOperationalEvent("shipping.provider.webhook.processed", {
        entityId: processedReceipt.id,
        shipmentId: savedShipment.id,
        providerKey,
        providerEventId: event.eventId,
        providerEventType: event.eventType,
      });

      return {
        httpStatus: 200,
        duplicate: false,
        applied: true,
        shipmentId: savedShipment.id,
        receipt: processedReceipt,
      };
    });

    return {
      ...result,
      receipt: toReceiptResponse(result.receipt),
    };
  } catch (error) {
    if (receiptId) {
      await updateWebhookReceiptError(receiptId, error);
    }
    throw error;
  }
};
