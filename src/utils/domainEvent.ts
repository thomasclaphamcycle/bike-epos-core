import { Prisma } from "@prisma/client";
import { CORE_EVENT_NAMES, emit, type CoreEventMap, type CoreEventName } from "../core/events";
import { prisma } from "../lib/prisma";
import { getRequestContext } from "../lib/requestContext";
import { logger } from "./logger";

type EventInput<TEventName extends CoreEventName> = Omit<
  CoreEventMap[TEventName],
  "requestId" | "actorStaffId"
> & {
  requestId?: string;
  actorStaffId?: string;
};

type PersistedEventTarget = {
  entityType: string;
  entityId: string;
  customerId?: string | null;
  bikeId?: string | null;
  workshopJobId?: string | null;
  saleId?: string | null;
  variantId?: string | null;
};

type AnyCoreEventPayload = CoreEventMap[CoreEventName];
type SaleCompletedEvent = CoreEventMap["sale.completed"];
type WorkshopCompletedEvent = CoreEventMap["workshop.job.completed"];
type WorkshopQuoteReadyEvent = CoreEventMap["workshop.quote.ready"];
type WorkshopReadyForCollectionEvent = CoreEventMap["workshop.job.ready_for_collection"];
type WorkshopPortalMessageEvent = CoreEventMap["workshop.portal_message.ready"];
type StockAdjustedEvent = CoreEventMap["stock.adjusted"];

const isCoreEventName = (value: string): value is CoreEventName =>
  CORE_EVENT_NAMES.includes(value as CoreEventName);

const toJsonValue = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const toOccurredAt = (timestamp: string) => {
  const occurredAt = new Date(timestamp);
  return Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt;
};

const buildPersistedEventTarget = (
  eventName: CoreEventName,
  payload: AnyCoreEventPayload,
): PersistedEventTarget | null => {
  switch (eventName) {
    case "sale.completed": {
      const salePayload = payload as SaleCompletedEvent;
      return {
        entityType: "SALE",
        entityId: salePayload.saleId,
        customerId: salePayload.customerId ?? null,
        bikeId: salePayload.bikeId ?? null,
        workshopJobId: salePayload.workshopJobId ?? null,
        saleId: salePayload.saleId,
      };
    }
    case "workshop.job.completed": {
      const workshopPayload = payload as WorkshopCompletedEvent;
      return {
        entityType: "WORKSHOP_JOB",
        entityId: workshopPayload.workshopJobId,
        customerId: workshopPayload.customerId ?? null,
        bikeId: workshopPayload.bikeId ?? null,
        workshopJobId: workshopPayload.workshopJobId,
        saleId: workshopPayload.saleId ?? null,
      };
    }
    case "workshop.quote.ready": {
      const workshopPayload = payload as WorkshopQuoteReadyEvent;
      return {
        entityType: "WORKSHOP_JOB",
        entityId: workshopPayload.workshopJobId,
        customerId: workshopPayload.customerId ?? null,
        bikeId: workshopPayload.bikeId ?? null,
        workshopJobId: workshopPayload.workshopJobId,
      };
    }
    case "workshop.job.ready_for_collection": {
      const workshopPayload = payload as WorkshopReadyForCollectionEvent;
      return {
        entityType: "WORKSHOP_JOB",
        entityId: workshopPayload.workshopJobId,
        customerId: workshopPayload.customerId ?? null,
        bikeId: workshopPayload.bikeId ?? null,
        workshopJobId: workshopPayload.workshopJobId,
        saleId: workshopPayload.saleId ?? null,
      };
    }
    case "workshop.portal_message.ready": {
      const workshopPayload = payload as WorkshopPortalMessageEvent;
      return {
        entityType: "WORKSHOP_JOB",
        entityId: workshopPayload.workshopJobId,
        customerId: workshopPayload.customerId ?? null,
        bikeId: workshopPayload.bikeId ?? null,
        workshopJobId: workshopPayload.workshopJobId,
      };
    }
    case "stock.adjusted": {
      const stockPayload = payload as StockAdjustedEvent;
      return {
        entityType: "VARIANT",
        entityId: stockPayload.variantId,
        variantId: stockPayload.variantId,
      };
    }
    default:
      return null;
  }
};

const enrichPersistedEventTarget = async (
  eventName: CoreEventName,
  payload: AnyCoreEventPayload,
  target: PersistedEventTarget,
) => {
  switch (eventName) {
    case "sale.completed": {
      const salePayload = payload as SaleCompletedEvent;
      if (
        salePayload.customerId !== undefined &&
        salePayload.workshopJobId !== undefined &&
        salePayload.bikeId !== undefined
      ) {
        return target;
      }

      const sale = await prisma.sale.findUnique({
        where: { id: salePayload.saleId },
        select: {
          customerId: true,
          workshopJobId: true,
          workshopJob: {
            select: {
              bikeId: true,
            },
          },
        },
      });

      return {
        ...target,
        customerId: salePayload.customerId ?? sale?.customerId ?? null,
        workshopJobId: salePayload.workshopJobId ?? sale?.workshopJobId ?? null,
        bikeId: salePayload.bikeId ?? sale?.workshopJob?.bikeId ?? null,
      };
    }
    case "workshop.job.completed":
    case "workshop.quote.ready":
    case "workshop.job.ready_for_collection":
    case "workshop.portal_message.ready": {
      const workshopPayload = payload as
        | WorkshopCompletedEvent
        | WorkshopQuoteReadyEvent
        | WorkshopReadyForCollectionEvent
        | WorkshopPortalMessageEvent;
      const workshopJobId = workshopPayload.workshopJobId;
      const hasCustomerLink = workshopPayload.customerId !== undefined;
      const hasBikeLink = workshopPayload.bikeId !== undefined;
      const hasSaleLink = "saleId" in workshopPayload && workshopPayload.saleId !== undefined;

      if (hasCustomerLink && hasBikeLink && hasSaleLink) {
        return target;
      }

      const job = await prisma.workshopJob.findUnique({
        where: { id: workshopJobId },
        select: {
          customerId: true,
          bikeId: true,
          sale: {
            select: {
              id: true,
            },
          },
        },
      });

      return {
        ...target,
        customerId: workshopPayload.customerId ?? job?.customerId ?? null,
        bikeId: workshopPayload.bikeId ?? job?.bikeId ?? null,
        saleId:
          ("saleId" in workshopPayload ? workshopPayload.saleId : undefined)
          ?? job?.sale?.id
          ?? target.saleId
          ?? null,
      };
    }
    default:
      return target;
  }
};

export const shouldPersist = (
  eventName: CoreEventName,
  _payload: AnyCoreEventPayload,
) => {
  switch (eventName) {
    case "sale.completed":
    case "workshop.job.completed":
    case "workshop.quote.ready":
    case "workshop.job.ready_for_collection":
    case "workshop.portal_message.ready":
    case "stock.adjusted":
      return true;
    default:
      return false;
  }
};

const persistSelectedEvent = async (
  eventName: CoreEventName,
  payload: AnyCoreEventPayload,
) => {
  if (!shouldPersist(eventName, payload)) {
    return;
  }

  const initialTarget = buildPersistedEventTarget(eventName, payload);
  if (!initialTarget) {
    return;
  }

  try {
    const target = await enrichPersistedEventTarget(eventName, payload, initialTarget);

    await prisma.domainEvent.create({
      data: {
        eventId: payload.id,
        eventName,
        entityType: target.entityType,
        entityId: target.entityId,
        customerId: target.customerId ?? null,
        bikeId: target.bikeId ?? null,
        workshopJobId: target.workshopJobId ?? null,
        saleId: target.saleId ?? null,
        variantId: target.variantId ?? null,
        requestId: payload.requestId ?? null,
        actorStaffId: payload.actorStaffId ?? null,
        payload: toJsonValue(payload),
        occurredAt: toOccurredAt(payload.timestamp),
      },
    });

    logger.debug("domain.event.persisted", {
      eventName,
      eventId: payload.id,
      entityType: target.entityType,
      entityId: target.entityId,
      requestId: payload.requestId ?? null,
      actorStaffId: payload.actorStaffId ?? null,
    });
  } catch (error) {
    logger.error("domain.event.persist_failed", error, {
      eventName,
      eventId: payload.id,
      requestId: payload.requestId ?? null,
      actorStaffId: payload.actorStaffId ?? null,
    });
  }
};

export const emitEvent = <TEventName extends CoreEventName>(
  eventName: TEventName,
  payload: EventInput<TEventName>,
): CoreEventMap[TEventName] => {
  if (!isCoreEventName(eventName)) {
    throw new Error(`Unsupported core event "${eventName}"`);
  }

  const requestContext = getRequestContext();
  const requestId = payload.requestId ?? requestContext?.requestId;
  const actorStaffId = payload.actorStaffId ?? requestContext?.actorStaffId;
  const eventPayload = (
    {
      ...payload,
      ...(requestId ? { requestId } : {}),
      ...(actorStaffId ? { actorStaffId } : {}),
    }
  ) as CoreEventMap[TEventName];

  emit(eventName, eventPayload);
  void persistSelectedEvent(eventName, eventPayload);

  logger.debug("domain.event.emitted", {
    eventName,
    eventId: eventPayload.id,
    requestId: eventPayload.requestId ?? null,
    actorStaffId: eventPayload.actorStaffId ?? null,
  });

  return eventPayload;
};
