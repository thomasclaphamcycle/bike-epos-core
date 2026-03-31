import { Prisma, type DomainEvent } from "@prisma/client";
import { getRecentDiagnosticEvents } from "../core/eventSubscribers";
import { CORE_EVENT_NAMES, type CoreEventMap, type CoreEventName } from "../core/events";
import { prisma } from "../lib/prisma";
import { logger } from "../utils/logger";

export const TIMELINE_ENTITY_TYPES = [
  "BIKE",
  "CUSTOMER",
  "PAYMENT",
  "PURCHASE_ORDER",
  "SALE",
  "USER",
  "VARIANT",
  "WORKSHOP_JOB",
] as const;

export type TimelineEntityType = (typeof TIMELINE_ENTITY_TYPES)[number];

export type TimelineItem = {
  id: string;
  eventName: CoreEventName;
  entityType: TimelineEntityType;
  entityId: string;
  occurredAt: string;
  label: string;
  description: string;
};

type DiagnosticEvent = ReturnType<typeof getRecentDiagnosticEvents>[number];

type TimelineEventRecord<TEventName extends CoreEventName = CoreEventName> = {
  eventName: TEventName;
  payload: CoreEventMap[TEventName];
  requestId?: string | null;
  actorStaffId?: string | null;
  linkedEntities?: TimelineEntityRef[];
};

type TimelineEntityRef = {
  entityType: TimelineEntityType;
  entityId: string;
};

const formatMoney = (pence: number) => `GBP ${(pence / 100).toFixed(2)}`;

const formatSignedNumber = (value: number) => (value >= 0 ? `+${value}` : `${value}`);

const isTimelineEntityType = (value: string): value is TimelineEntityType =>
  TIMELINE_ENTITY_TYPES.includes(value as TimelineEntityType);

const isCoreEventName = (value: string): value is CoreEventName =>
  CORE_EVENT_NAMES.includes(value as CoreEventName);

const toTimelineEntityRefs = (
  event: TimelineEventRecord,
): TimelineEntityRef[] => {
  const refs: Array<TimelineEntityRef | null> = [];

  switch (event.eventName) {
    case "auth.login.succeeded":
      refs.push({
        entityType: "USER",
        entityId: event.payload.userId,
      });
      break;
    case "payments.intent.created":
      refs.push(
        event.payload.saleId
          ? {
              entityType: "SALE",
              entityId: event.payload.saleId,
            }
          : null,
      );
      break;
    case "payments.refund.recorded":
      refs.push({
        entityType: "PAYMENT",
        entityId: event.payload.paymentId,
      });
      break;
    case "sale.completed":
      refs.push({
        entityType: "SALE",
        entityId: event.payload.saleId,
      });
      refs.push(
        event.payload.customerId
          ? {
              entityType: "CUSTOMER",
              entityId: event.payload.customerId,
            }
          : null,
      );
      refs.push(
        event.payload.workshopJobId
          ? {
              entityType: "WORKSHOP_JOB",
              entityId: event.payload.workshopJobId,
            }
          : null,
      );
      refs.push(
        event.payload.bikeId
          ? {
              entityType: "BIKE",
              entityId: event.payload.bikeId,
            }
          : null,
      );
      break;
    case "purchaseOrder.received":
      refs.push({
        entityType: "PURCHASE_ORDER",
        entityId: event.payload.purchaseOrderId,
      });
      break;
    case "workshop.job.completed":
    case "workshop.quote.ready":
    case "workshop.job.ready_for_collection":
    case "workshop.portal_message.ready":
      refs.push({
        entityType: "WORKSHOP_JOB",
        entityId: event.payload.workshopJobId,
      });
      refs.push(
        event.payload.customerId
          ? {
              entityType: "CUSTOMER",
              entityId: event.payload.customerId,
            }
          : null,
      );
      refs.push(
        event.payload.bikeId
          ? {
              entityType: "BIKE",
              entityId: event.payload.bikeId,
            }
          : null,
      );
      refs.push(
        "saleId" in event.payload && event.payload.saleId
          ? {
              entityType: "SALE",
              entityId: event.payload.saleId,
            }
          : null,
      );
      break;
    case "stock.adjusted":
      refs.push({
        entityType: "VARIANT",
        entityId: event.payload.variantId,
      });
      break;
    default:
      return [];
  }

  const combinedRefs = [...refs, ...(event.linkedEntities ?? [])];
  const uniqueRefs = new Map<string, TimelineEntityRef>();

  for (const ref of combinedRefs) {
    if (
      ref !== null &&
      isTimelineEntityType(ref.entityType) &&
      typeof ref.entityId === "string" &&
      ref.entityId.trim().length > 0
    ) {
      const key = `${ref.entityType}:${ref.entityId}`;
      if (!uniqueRefs.has(key)) {
        uniqueRefs.set(key, ref);
      }
    }
  }

  return [...uniqueRefs.values()];
};

const resolveTimelineEntity = (
  event: TimelineEventRecord,
  requestedEntity?: TimelineEntityRef,
): TimelineEntityRef | null => {
  if (requestedEntity) {
    return requestedEntity;
  }

  return toTimelineEntityRefs(event)[0] ?? null;
};

export const formatTimelineEvent = (
  event: TimelineEventRecord,
  requestedEntity?: TimelineEntityRef,
): TimelineItem | null => {
  const entity = resolveTimelineEntity(event, requestedEntity);
  if (!entity) {
    return null;
  }

  switch (event.eventName) {
    case "auth.login.succeeded":
      return {
        id: `${event.eventName}:${event.payload.id}:${event.payload.timestamp}`,
        eventName: event.eventName,
        entityType: entity.entityType,
        entityId: entity.entityId,
        occurredAt: event.payload.timestamp,
        label: "Signed in",
        description: `Staff login succeeded via ${event.payload.authMethod}.`,
      };
    case "payments.intent.created":
      return {
        id: `${event.eventName}:${event.payload.id}:${event.payload.timestamp}`,
        eventName: event.eventName,
        entityType: entity.entityType,
        entityId: entity.entityId,
        occurredAt: event.payload.timestamp,
        label: "Payment intent created",
        description: event.payload.provider
          ? `Payment intent was prepared with ${event.payload.provider}.`
          : "Payment intent was prepared for checkout.",
      };
    case "payments.refund.recorded":
      return {
        id: `${event.eventName}:${event.payload.id}:${event.payload.timestamp}`,
        eventName: event.eventName,
        entityType: entity.entityType,
        entityId: entity.entityId,
        occurredAt: event.payload.timestamp,
        label: "Refund recorded",
        description:
          event.payload.resultStatus === "idempotent"
            ? "Refund replay returned the existing result without creating a duplicate."
            : "Refund was recorded successfully.",
      };
    case "sale.completed":
      return {
        id: `${event.eventName}:${event.payload.id}:${event.payload.timestamp}`,
        eventName: event.eventName,
        entityType: entity.entityType,
        entityId: entity.entityId,
        occurredAt: event.payload.timestamp,
        label: "Sale completed",
        description:
          event.payload.totalPence !== undefined
            ? `Sale completed for ${formatMoney(event.payload.totalPence)}.`
            : "Sale completed successfully.",
      };
    case "purchaseOrder.received":
      return {
        id: `${event.eventName}:${event.payload.id}:${event.payload.timestamp}`,
        eventName: event.eventName,
        entityType: entity.entityType,
        entityId: entity.entityId,
        occurredAt: event.payload.timestamp,
        label: "Purchase order received",
        description: `${event.payload.quantityReceived} items were received against PO ${event.payload.poNumber}.`,
      };
    case "workshop.job.completed":
      return {
        id: `${event.eventName}:${event.payload.id}:${event.payload.timestamp}`,
        eventName: event.eventName,
        entityType: entity.entityType,
        entityId: entity.entityId,
        occurredAt: event.payload.timestamp,
        label: "Job completed",
        description: event.payload.saleId
          ? `Workshop handoff completed and linked to sale ${event.payload.saleId.slice(0, 8)}.`
          : "Workshop job moved into the completed stage.",
      };
    case "workshop.quote.ready":
      return {
        id: `${event.eventName}:${event.payload.id}:${event.payload.timestamp}`,
        eventName: event.eventName,
        entityType: entity.entityType,
        entityId: entity.entityId,
        occurredAt: event.payload.timestamp,
        label: "Quote ready",
        description: `Estimate v${event.payload.estimateVersion} is ready for customer approval.`,
      };
    case "workshop.job.ready_for_collection":
      return {
        id: `${event.eventName}:${event.payload.id}:${event.payload.timestamp}`,
        eventName: event.eventName,
        entityType: entity.entityType,
        entityId: entity.entityId,
        occurredAt: event.payload.timestamp,
        label: "Ready for collection",
        description: "Workshop job reached the ready-for-collection stage.",
      };
    case "workshop.portal_message.ready":
      return {
        id: `${event.eventName}:${event.payload.id}:${event.payload.timestamp}`,
        eventName: event.eventName,
        entityType: entity.entityType,
        entityId: entity.entityId,
        occurredAt: event.payload.timestamp,
        label: "Customer message posted",
        description: "A customer-visible workshop portal message was added to the conversation.",
      };
    case "stock.adjusted":
      return {
        id: `${event.eventName}:${event.payload.id}:${event.payload.timestamp}`,
        eventName: event.eventName,
        entityType: entity.entityType,
        entityId: entity.entityId,
        occurredAt: event.payload.timestamp,
        label: "Stock adjusted",
        description: `On-hand stock changed by ${formatSignedNumber(event.payload.quantityDelta)} to ${event.payload.totalOnHand}.`,
      };
    default:
      return null;
  }
};

const buildTimelineEventKey = (item: TimelineItem) => item.id;

const toDiagnosticTimelineEvent = (event: DiagnosticEvent): TimelineEventRecord => ({
  eventName: event.eventName,
  payload: event.payload,
  requestId: event.payload.requestId ?? null,
  actorStaffId: event.payload.actorStaffId ?? null,
});

const toPersistedTimelineEvent = (
  event: Pick<
    DomainEvent,
    | "eventName"
    | "payload"
    | "requestId"
    | "actorStaffId"
    | "entityType"
    | "entityId"
    | "customerId"
    | "bikeId"
    | "workshopJobId"
    | "saleId"
    | "variantId"
  >,
): TimelineEventRecord | null => {
  if (!isCoreEventName(event.eventName)) {
    return null;
  }

  const linkedEntities = [
    isTimelineEntityType(event.entityType)
      ? {
          entityType: event.entityType,
          entityId: event.entityId,
        }
      : null,
    event.customerId
      ? {
          entityType: "CUSTOMER",
          entityId: event.customerId,
        }
      : null,
    event.bikeId
      ? {
          entityType: "BIKE",
          entityId: event.bikeId,
        }
      : null,
    event.workshopJobId
      ? {
          entityType: "WORKSHOP_JOB",
          entityId: event.workshopJobId,
        }
      : null,
    event.saleId
      ? {
          entityType: "SALE",
          entityId: event.saleId,
        }
      : null,
    event.variantId
      ? {
          entityType: "VARIANT",
          entityId: event.variantId,
        }
      : null,
  ].filter((ref): ref is TimelineEntityRef => ref !== null);

  return {
    eventName: event.eventName,
    payload: event.payload as CoreEventMap[typeof event.eventName],
    requestId: event.requestId ?? null,
    actorStaffId: event.actorStaffId ?? null,
    linkedEntities,
  };
};

const buildPersistedTimelineWhere = (
  entityType: TimelineEntityType,
  entityId: string,
): Prisma.DomainEventWhereInput => {
  switch (entityType) {
    case "CUSTOMER":
      return {
        OR: [
          { entityType, entityId },
          { customerId: entityId },
        ],
      };
    case "BIKE":
      return {
        OR: [
          { entityType, entityId },
          { bikeId: entityId },
        ],
      };
    case "WORKSHOP_JOB":
      return {
        OR: [
          { entityType, entityId },
          { workshopJobId: entityId },
        ],
      };
    case "SALE":
      return {
        OR: [
          { entityType, entityId },
          { saleId: entityId },
        ],
      };
    case "VARIANT":
      return {
        OR: [
          { entityType, entityId },
          { variantId: entityId },
        ],
      };
    default:
      return {
        entityType,
        entityId,
      };
  }
};

const loadPersistedTimelineEvents = async (input: {
  entityType: TimelineEntityType;
  entityId: string;
  limit: number;
}) => {
  try {
    const rows = await prisma.domainEvent.findMany({
      where: buildPersistedTimelineWhere(input.entityType, input.entityId),
      select: {
        eventName: true,
        payload: true,
        requestId: true,
        actorStaffId: true,
        entityType: true,
        entityId: true,
        customerId: true,
        bikeId: true,
        workshopJobId: true,
        saleId: true,
        variantId: true,
      },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take: Math.max(input.limit * 4, 100),
    });

    return rows
      .map(toPersistedTimelineEvent)
      .filter((event): event is TimelineEventRecord => event !== null);
  } catch (error) {
    logger.error("timeline.persisted_query_failed", error, {
      entityType: input.entityType,
      entityId: input.entityId,
    });
    return [];
  }
};

const toTimelineItems = (
  events: TimelineEventRecord[],
  requestedEntity: TimelineEntityRef,
) =>
  events
    .map((event) => {
      const matchingEntity = toTimelineEntityRefs(event).find(
        (entityRef) =>
          entityRef.entityType === requestedEntity.entityType &&
          entityRef.entityId === requestedEntity.entityId,
      );

      if (!matchingEntity) {
        return null;
      }

      return formatTimelineEvent(event, matchingEntity);
    })
    .filter((item): item is TimelineItem => item !== null);

export const listTimelineEvents = async (input: {
  entityType: TimelineEntityType;
  entityId: string;
  limit?: number;
}) => {
  const limit = input.limit ?? 25;
  const requestedEntity: TimelineEntityRef = {
    entityType: input.entityType,
    entityId: input.entityId,
  };

  const [persistedEvents, inMemoryEvents] = await Promise.all([
    loadPersistedTimelineEvents({
      entityType: input.entityType,
      entityId: input.entityId,
      limit,
    }),
    Promise.resolve(getRecentDiagnosticEvents().map(toDiagnosticTimelineEvent)),
  ]);

  const uniqueItems = new Map<string, TimelineItem>();

  for (const item of toTimelineItems([...persistedEvents, ...inMemoryEvents], requestedEntity)
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))) {
    const key = buildTimelineEventKey(item);
    if (!uniqueItems.has(key)) {
      uniqueItems.set(key, item);
    }
    if (uniqueItems.size >= limit) {
      break;
    }
  }

  return [...uniqueItems.values()];
};

export const isSupportedTimelineEntityType = isTimelineEntityType;
