import { Prisma, type DomainEvent } from "@prisma/client";
import { getRecentDiagnosticEvents } from "../core/eventSubscribers";
import { CORE_EVENT_NAMES, type CoreEventMap, type CoreEventName } from "../core/events";
import { prisma } from "../lib/prisma";
import { logger } from "../utils/logger";
import { getWorkshopDisplayStatusOrFallback } from "./workshopStatusService";

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

type TimelineDisplayContext = {
  actorNames: Map<string, string>;
  saleReceiptNumbers: Map<string, string | null>;
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
    case "workshop.estimate.decided":
    case "workshop.job.status_changed":
    case "workshop.job.ready_for_collection":
    case "workshop.note.added":
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

const getActorName = (
  event: TimelineEventRecord,
  displayContext: TimelineDisplayContext,
) => (event.actorStaffId ? displayContext.actorNames.get(event.actorStaffId) ?? null : null);

const formatActorSuffix = (
  event: TimelineEventRecord,
  displayContext: TimelineDisplayContext,
) => {
  const actorName = getActorName(event, displayContext);
  return actorName ? ` by ${actorName}` : "";
};

const formatSaleReference = (
  saleId: string,
  displayContext: TimelineDisplayContext,
) => {
  const receiptNumber = displayContext.saleReceiptNumbers.get(saleId) ?? null;
  return receiptNumber ? `receipt ${receiptNumber}` : `sale ${saleId.slice(0, 8).toUpperCase()}`;
};

export const formatTimelineEvent = (
  event: TimelineEventRecord,
  requestedEntity?: TimelineEntityRef,
  displayContext: TimelineDisplayContext = {
    actorNames: new Map(),
    saleReceiptNumbers: new Map(),
  },
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
        description: `Staff login succeeded via ${event.payload.authMethod}${formatActorSuffix(event, displayContext)}.`,
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
          ? `Payment intent was prepared with ${event.payload.provider}${formatActorSuffix(event, displayContext)}.`
          : `Payment intent was prepared for checkout${formatActorSuffix(event, displayContext)}.`,
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
            ? `Refund replay returned the existing result without creating a duplicate${formatActorSuffix(event, displayContext)}.`
            : `Refund was recorded successfully${formatActorSuffix(event, displayContext)}.`,
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
            ? `Finalized checkout completed for ${formatMoney(event.payload.totalPence)} on ${formatSaleReference(event.payload.saleId, displayContext)}${formatActorSuffix(event, displayContext)}.`
            : `Finalized checkout completed on ${formatSaleReference(event.payload.saleId, displayContext)}${formatActorSuffix(event, displayContext)}.`,
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
          ? `Workshop handoff completed and linked to ${formatSaleReference(event.payload.saleId, displayContext)}${formatActorSuffix(event, displayContext)}.`
          : `Workshop job moved into the completed stage${formatActorSuffix(event, displayContext)}.`,
      };
    case "workshop.quote.ready":
      return {
        id: `${event.eventName}:${event.payload.id}:${event.payload.timestamp}`,
        eventName: event.eventName,
        entityType: entity.entityType,
        entityId: entity.entityId,
        occurredAt: event.payload.timestamp,
        label: "Quote ready",
        description: `Estimate v${event.payload.estimateVersion} is ready for customer approval${formatActorSuffix(event, displayContext)}.`,
      };
    case "workshop.estimate.decided": {
      const decisionVerb = event.payload.decisionStatus === "APPROVED" ? "approved" : "rejected";
      const actorName = getActorName(event, displayContext);
      const decisionContext =
        event.payload.decisionSource === "CUSTOMER"
          ? "by the customer through the secure quote link"
          : actorName
            ? `by ${actorName}`
            : "with the workshop";
      return {
        id: `${event.eventName}:${event.payload.id}:${event.payload.timestamp}`,
        eventName: event.eventName,
        entityType: entity.entityType,
        entityId: entity.entityId,
        occurredAt: event.payload.timestamp,
        label: event.payload.decisionStatus === "APPROVED" ? "Quote approved" : "Quote rejected",
        description: `Estimate v${event.payload.estimateVersion} was ${decisionVerb} ${decisionContext}.`,
      };
    }
    case "workshop.job.status_changed":
      return {
        id: `${event.eventName}:${event.payload.id}:${event.payload.timestamp}`,
        eventName: event.eventName,
        entityType: entity.entityType,
        entityId: entity.entityId,
        occurredAt: event.payload.timestamp,
        label: "Status updated",
        description: `Status changed from ${getWorkshopDisplayStatusOrFallback(event.payload.fromStatus)} to ${getWorkshopDisplayStatusOrFallback(event.payload.toStatus)}${formatActorSuffix(event, displayContext)}.`,
      };
    case "workshop.job.ready_for_collection":
      return {
        id: `${event.eventName}:${event.payload.id}:${event.payload.timestamp}`,
        eventName: event.eventName,
        entityType: entity.entityType,
        entityId: entity.entityId,
        occurredAt: event.payload.timestamp,
        label: "Ready for collection",
        description: `Workshop job reached the ready-for-collection stage${formatActorSuffix(event, displayContext)}.`,
      };
    case "workshop.note.added":
      return {
        id: `${event.eventName}:${event.payload.id}:${event.payload.timestamp}`,
        eventName: event.eventName,
        entityType: entity.entityType,
        entityId: entity.entityId,
        occurredAt: event.payload.timestamp,
        label: event.payload.visibility === "CUSTOMER" ? "Customer note added" : "Workshop note added",
        description:
          event.payload.visibility === "CUSTOMER"
            ? `Customer-visible workshop note added${formatActorSuffix(event, displayContext)}.`
            : `Internal workshop note added${formatActorSuffix(event, displayContext)}.`,
      };
    case "workshop.portal_message.ready":
      return {
        id: `${event.eventName}:${event.payload.id}:${event.payload.timestamp}`,
        eventName: event.eventName,
        entityType: entity.entityType,
        entityId: entity.entityId,
        occurredAt: event.payload.timestamp,
        label: "Customer message posted",
        description: `A customer-visible workshop portal message was added to the conversation${formatActorSuffix(event, displayContext)}.`,
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

const loadTimelineDisplayContext = async (
  events: TimelineEventRecord[],
): Promise<TimelineDisplayContext> => {
  const actorIds = [...new Set(events.flatMap((event) => (event.actorStaffId ? [event.actorStaffId] : [])))];
  const saleIds = [
    ...new Set(
      events.flatMap((event) => {
        switch (event.eventName) {
          case "sale.completed":
            return [event.payload.saleId];
          case "workshop.job.completed":
          case "workshop.job.status_changed":
          case "workshop.job.ready_for_collection":
            return event.payload.saleId ? [event.payload.saleId] : [];
          default:
            return [];
        }
      }),
    ),
  ];

  const [users, sales] = await Promise.all([
    actorIds.length > 0
      ? prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: {
            id: true,
            name: true,
            username: true,
          },
        })
      : Promise.resolve([]),
    saleIds.length > 0
      ? prisma.sale.findMany({
          where: { id: { in: saleIds } },
          select: {
            id: true,
            receiptNumber: true,
            receipt: {
              select: {
                receiptNumber: true,
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  return {
    actorNames: new Map(users.map((user) => [user.id, user.name ?? user.username])),
    saleReceiptNumbers: new Map(
      sales.map((sale) => [sale.id, sale.receipt?.receiptNumber ?? sale.receiptNumber ?? null]),
    ),
  };
};

const toTimelineItems = (
  events: TimelineEventRecord[],
  requestedEntity: TimelineEntityRef,
  displayContext: TimelineDisplayContext,
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

      return formatTimelineEvent(event, matchingEntity, displayContext);
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
  const displayContext = await loadTimelineDisplayContext([...persistedEvents, ...inMemoryEvents]);

  const uniqueItems = new Map<string, TimelineItem>();

  for (const item of toTimelineItems(
    [...persistedEvents, ...inMemoryEvents],
    requestedEntity,
    displayContext,
  )
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
