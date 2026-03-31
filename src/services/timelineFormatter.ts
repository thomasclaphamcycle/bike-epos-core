import { Prisma, type DomainEvent } from "@prisma/client";
import { getRecentDiagnosticEvents } from "../core/eventSubscribers";
import { CORE_EVENT_NAMES, type CoreEventMap, type CoreEventName } from "../core/events";
import { prisma } from "../lib/prisma";
import { buildCustomerBikeDisplayName } from "./customerBikeService";
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
  category:
    | "auth"
    | "bike"
    | "communication"
    | "customer"
    | "inventory"
    | "payment"
    | "sale"
    | "workshop";
  metadata?: {
    actorName?: string | null;
    bikeDisplayName?: string | null;
    bikeDescription?: string | null;
    checkoutStaffName?: string | null;
    notePreview?: string | null;
    noteVisibility?: string | null;
    paymentSummary?: string | null;
    receiptNumber?: string | null;
    receiptUrl?: string | null;
  };
};

type DiagnosticEvent = ReturnType<typeof getRecentDiagnosticEvents>[number];

type TimelineEntityRef = {
  entityType: TimelineEntityType;
  entityId: string;
};

type TimelineSupportContext = {
  actorName?: string | null;
  bikeDescription?: string | null;
  bikeDisplayName?: string | null;
  saleSummary?: {
    checkoutStaffName?: string | null;
    paymentSummary?: string | null;
    receiptNumber?: string | null;
    receiptUrl?: string | null;
  };
};

type TimelineEventRecord<TEventName extends CoreEventName = CoreEventName> = {
  eventName: TEventName;
  payload: CoreEventMap[TEventName];
  requestId?: string | null;
  actorStaffId?: string | null;
  linkedEntities?: TimelineEntityRef[];
  context?: TimelineSupportContext;
};

type PersistedTimelineRow = Pick<
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
>;

const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const formatSignedNumber = (value: number) => (value >= 0 ? `+${value}` : `${value}`);

const isTimelineEntityType = (value: string): value is TimelineEntityType =>
  TIMELINE_ENTITY_TYPES.includes(value as TimelineEntityType);

const isCoreEventName = (value: string): value is CoreEventName =>
  CORE_EVENT_NAMES.includes(value as CoreEventName);

const getStaffDisplayName = (input: { name?: string | null; username?: string | null } | null | undefined) =>
  input?.name?.trim() || input?.username?.trim() || null;

const formatStatusLabel = (value: string) => {
  const normalized = value.trim().toUpperCase();
  switch (normalized) {
    case "BOOKED":
      return "Booked";
    case "BIKE_ARRIVED":
      return "Bike arrived";
    case "IN_PROGRESS":
      return "In progress";
    case "WAITING_FOR_APPROVAL":
      return "Waiting for approval";
    case "WAITING_FOR_PARTS":
      return "Waiting for parts";
    case "ON_HOLD":
      return "On hold";
    case "READY_FOR_COLLECTION":
      return "Ready for collection";
    case "COMPLETED":
      return "Completed";
    case "COLLECTED":
      return "Collected";
    case "CANCELLED":
      return "Cancelled";
    case "APPROVED":
      return "Approved";
    case "REJECTED":
      return "Rejected";
    case "PENDING_APPROVAL":
      return "Pending approval";
    default:
      return normalized
        .toLowerCase()
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
  }
};

const formatTenderMethod = (value: string) => {
  switch (value) {
    case "BANK_TRANSFER":
      return "Bank transfer";
    case "CARD":
      return "Card";
    case "CASH":
      return "Cash";
    case "VOUCHER":
      return "Voucher";
    default:
      return formatStatusLabel(value);
  }
};

const summarizeTenders = (
  tenders: Array<{ method: string; amountPence: number }>,
) => {
  if (tenders.length === 0) {
    return null;
  }

  return tenders
    .slice()
    .sort((left, right) => right.amountPence - left.amountPence)
    .map((tender) => `${formatTenderMethod(tender.method)} ${formatMoney(tender.amountPence)}`)
    .join(" • ");
};

const buildTimelineEntityRefs = (
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
      refs.push(
        { entityType: "SALE", entityId: event.payload.saleId },
        event.payload.customerId
          ? { entityType: "CUSTOMER", entityId: event.payload.customerId }
          : null,
        event.payload.workshopJobId
          ? { entityType: "WORKSHOP_JOB", entityId: event.payload.workshopJobId }
          : null,
        event.payload.bikeId
          ? { entityType: "BIKE", entityId: event.payload.bikeId }
          : null,
      );
      break;
    case "customer.bike.created":
      refs.push(
        { entityType: "BIKE", entityId: event.payload.bikeId },
        { entityType: "CUSTOMER", entityId: event.payload.customerId },
      );
      break;
    case "purchaseOrder.received":
      refs.push({
        entityType: "PURCHASE_ORDER",
        entityId: event.payload.purchaseOrderId,
      });
      break;
    case "workshop.job.created":
    case "workshop.job.status_changed":
    case "workshop.job.completed":
    case "workshop.quote.ready":
    case "workshop.estimate.decided":
    case "workshop.job.ready_for_collection":
    case "workshop.note.added":
    case "workshop.portal_message.ready":
    case "workshop.portal_message.received":
      refs.push(
        { entityType: "WORKSHOP_JOB", entityId: event.payload.workshopJobId },
        event.payload.customerId
          ? { entityType: "CUSTOMER", entityId: event.payload.customerId }
          : null,
        event.payload.bikeId
          ? { entityType: "BIKE", entityId: event.payload.bikeId }
          : null,
        "saleId" in event.payload && event.payload.saleId
          ? { entityType: "SALE", entityId: event.payload.saleId }
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

  return buildTimelineEntityRefs(event)[0] ?? null;
};

const buildSaleDescription = (event: TimelineEventRecord<"sale.completed">) => {
  const receiptNumber = event.context?.saleSummary?.receiptNumber ?? null;
  const parts = [
    event.payload.totalPence !== undefined ? formatMoney(event.payload.totalPence) : null,
    receiptNumber ? `Receipt ${receiptNumber}` : null,
    event.context?.saleSummary?.paymentSummary ?? null,
  ].filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join(" • ") : "Finalized sale recorded.";
};

const appendActor = (base: string, actorName?: string | null) =>
  actorName ? `${base} by ${actorName}.` : `${base}.`;

export const formatTimelineEvent = (
  event: TimelineEventRecord,
  requestedEntity?: TimelineEntityRef,
): TimelineItem | null => {
  const entity = resolveTimelineEntity(event, requestedEntity);
  if (!entity) {
    return null;
  }

  const common = {
    id: `${event.eventName}:${event.payload.id}:${event.payload.timestamp}`,
    eventName: event.eventName,
    entityType: entity.entityType,
    entityId: entity.entityId,
    occurredAt: event.payload.timestamp,
  } satisfies Pick<
    TimelineItem,
    "entityId" | "entityType" | "eventName" | "id" | "occurredAt"
  >;

  switch (event.eventName) {
    case "auth.login.succeeded":
      return {
        ...common,
        label: "Signed in",
        description: `Staff login succeeded via ${event.payload.authMethod}.`,
        category: "auth",
      };
    case "payments.intent.created":
      return {
        ...common,
        label: "Payment intent created",
        description: event.payload.provider
          ? `Payment intent was prepared with ${event.payload.provider}.`
          : "Payment intent was prepared for checkout.",
        category: "payment",
      };
    case "payments.refund.recorded":
      return {
        ...common,
        label: "Refund recorded",
        description:
          event.payload.resultStatus === "idempotent"
            ? "Refund replay returned the existing result without creating a duplicate."
            : "Refund was recorded successfully.",
        category: "payment",
      };
    case "sale.completed":
      return {
        ...common,
        label: "Sale completed",
        description: buildSaleDescription(event),
        category: "sale",
        metadata: {
          actorName: event.context?.actorName ?? null,
          checkoutStaffName: event.context?.saleSummary?.checkoutStaffName ?? null,
          paymentSummary: event.context?.saleSummary?.paymentSummary ?? null,
          receiptNumber: event.context?.saleSummary?.receiptNumber ?? null,
          receiptUrl: event.context?.saleSummary?.receiptUrl ?? null,
        },
      };
    case "customer.bike.created":
      return {
        ...common,
        label: "Bike added",
        description: event.context?.bikeDisplayName
          ? `Bike added to customer record: ${event.context.bikeDisplayName}.`
          : event.payload.bikeDisplayName
            ? `Bike added to customer record: ${event.payload.bikeDisplayName}.`
            : "Bike added to customer record.",
        category: "bike",
        metadata: {
          actorName: event.context?.actorName ?? null,
          bikeDisplayName: event.context?.bikeDisplayName ?? event.payload.bikeDisplayName ?? null,
        },
      };
    case "purchaseOrder.received":
      return {
        ...common,
        label: "Purchase order received",
        description: `${event.payload.quantityReceived} items were received against PO ${event.payload.poNumber}.`,
        category: "inventory",
      };
    case "workshop.job.created":
      {
        const bikeDescription = event.payload.bikeDescription ?? event.context?.bikeDescription ?? null;
        return {
          ...common,
          label: "Workshop job created",
          description: bikeDescription
            ? `New workshop job opened for ${bikeDescription}.`
            : "New workshop job opened.",
          category: "workshop",
          metadata: {
            actorName: event.context?.actorName ?? null,
            bikeDescription,
          },
        };
      }
    case "workshop.job.status_changed":
      return {
        ...common,
        label: "Workshop status changed",
        description: appendActor(
          `Status changed from ${formatStatusLabel(event.payload.fromStatus)} to ${formatStatusLabel(event.payload.toStatus)}`,
          event.context?.actorName,
        ),
        category: "workshop",
        metadata: {
          actorName: event.context?.actorName ?? null,
          bikeDescription: event.context?.bikeDescription ?? null,
        },
      };
    case "workshop.job.completed":
      {
        const receiptNumber = event.context?.saleSummary?.receiptNumber ?? null;
        const paymentSummary = event.context?.saleSummary?.paymentSummary ?? null;
        return {
          ...common,
          label: "Job completed",
          description: receiptNumber || paymentSummary
            ? [
                "Workshop handoff completed",
                receiptNumber ? `Receipt ${receiptNumber}` : null,
                paymentSummary,
              ]
                .filter((value): value is string => Boolean(value))
                .join(" • ")
            : "Workshop job moved into the completed stage.",
          category: "workshop",
          metadata: {
            actorName: event.context?.actorName ?? null,
            paymentSummary,
            receiptNumber,
            receiptUrl: event.context?.saleSummary?.receiptUrl ?? null,
          },
        };
      }
    case "workshop.quote.ready":
      return {
        ...common,
        label: "Quote ready",
        description: `Estimate v${event.payload.estimateVersion} is ready for customer approval.`,
        category: "workshop",
      };
    case "workshop.estimate.decided": {
      const isApproved = event.payload.status === "APPROVED";
      const customerDriven =
        (event.payload.decisionSource ?? "").toUpperCase() === "CUSTOMER" && !event.context?.actorName;
      return {
        ...common,
        label: isApproved ? "Estimate approved" : "Estimate rejected",
        description: customerDriven
          ? `Customer ${isApproved ? "approved" : "rejected"} estimate v${event.payload.estimateVersion}.`
          : appendActor(
              `Estimate v${event.payload.estimateVersion} ${isApproved ? "approved" : "rejected"}`,
              event.context?.actorName,
            ),
        category: "workshop",
        metadata: {
          actorName: event.context?.actorName ?? null,
          bikeDescription: event.context?.bikeDescription ?? null,
        },
      };
    }
    case "workshop.job.ready_for_collection":
      return {
        ...common,
        label: "Ready for collection",
        description: appendActor(
          "Workshop job reached the ready-for-collection stage",
          event.context?.actorName,
        ),
        category: "workshop",
        metadata: {
          actorName: event.context?.actorName ?? null,
        },
      };
    case "workshop.note.added":
      return {
        ...common,
        label: event.payload.visibility === "CUSTOMER" ? "Customer note added" : "Workshop note added",
        description: appendActor(
          `${event.payload.visibility === "CUSTOMER" ? "Customer-visible" : "Internal"} note added${event.payload.notePreview ? ` • ${event.payload.notePreview}` : ""}`,
          event.context?.actorName,
        ),
        category: "workshop",
        metadata: {
          actorName: event.context?.actorName ?? null,
          notePreview: event.payload.notePreview ?? null,
          noteVisibility: event.payload.visibility,
        },
      };
    case "workshop.portal_message.ready":
      return {
        ...common,
        label: "Customer message sent",
        description: appendActor(
          "Customer-visible workshop update sent",
          event.context?.actorName,
        ),
        category: "communication",
        metadata: {
          actorName: event.context?.actorName ?? null,
        },
      };
    case "workshop.portal_message.received":
      return {
        ...common,
        label: "Customer message received",
        description: "Customer replied through the workshop portal.",
        category: "communication",
      };
    case "stock.adjusted":
      return {
        ...common,
        label: "Stock adjusted",
        description: `On-hand stock changed by ${formatSignedNumber(event.payload.quantityDelta)} to ${event.payload.totalOnHand}.`,
        category: "inventory",
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

const buildLinkedEntities = (event: PersistedTimelineRow) =>
  [
    isTimelineEntityType(event.entityType)
      ? {
          entityType: event.entityType,
          entityId: event.entityId,
        }
      : null,
    event.customerId
      ? {
          entityType: "CUSTOMER" as const,
          entityId: event.customerId,
        }
      : null,
    event.bikeId
      ? {
          entityType: "BIKE" as const,
          entityId: event.bikeId,
        }
      : null,
    event.workshopJobId
      ? {
          entityType: "WORKSHOP_JOB" as const,
          entityId: event.workshopJobId,
        }
      : null,
    event.saleId
      ? {
          entityType: "SALE" as const,
          entityId: event.saleId,
        }
      : null,
    event.variantId
      ? {
          entityType: "VARIANT" as const,
          entityId: event.variantId,
        }
      : null,
  ].filter((ref): ref is TimelineEntityRef => ref !== null);

const loadTimelineSupportContext = async (rows: PersistedTimelineRow[]) => {
  const actorIds = [...new Set(rows.map((row) => row.actorStaffId).filter((value): value is string => Boolean(value)))];
  const saleIds = [
    ...new Set(
      rows
        .map((row) => row.saleId ?? (row.entityType === "SALE" ? row.entityId : null))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const workshopJobIds = [
    ...new Set(
      rows
        .map((row) => row.workshopJobId ?? (row.entityType === "WORKSHOP_JOB" ? row.entityId : null))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const bikeIds = [
    ...new Set(
      rows
        .map((row) => row.bikeId ?? (row.entityType === "BIKE" ? row.entityId : null))
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  const [actors, sales, workshopJobs, bikes] = await Promise.all([
    actorIds.length === 0
      ? Promise.resolve([])
      : prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: {
            id: true,
            username: true,
            name: true,
          },
        }),
    saleIds.length === 0
      ? Promise.resolve([])
      : prisma.sale.findMany({
          where: { id: { in: saleIds } },
          select: {
            id: true,
            receiptNumber: true,
            createdByStaff: {
              select: {
                username: true,
                name: true,
              },
            },
            receipt: {
              select: {
                receiptNumber: true,
                issuedByStaff: {
                  select: {
                    username: true,
                    name: true,
                  },
                },
              },
            },
            tenders: {
              select: {
                method: true,
                amountPence: true,
                createdByStaff: {
                  select: {
                    username: true,
                    name: true,
                  },
                },
              },
            },
          },
        }),
    workshopJobIds.length === 0
      ? Promise.resolve([])
      : prisma.workshopJob.findMany({
          where: { id: { in: workshopJobIds } },
          select: {
            id: true,
            bikeDescription: true,
          },
        }),
    bikeIds.length === 0
      ? Promise.resolve([])
      : prisma.customerBike.findMany({
          where: { id: { in: bikeIds } },
          select: {
            id: true,
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
        }),
  ]);

  return {
    actorNames: new Map(
      actors.map((actor) => [actor.id, getStaffDisplayName(actor) ?? actor.id]),
    ),
    bikeDescriptions: new Map(
      workshopJobs.map((job) => [job.id, job.bikeDescription]),
    ),
    bikeDisplayNames: new Map(
      bikes.map((bike) => [bike.id, buildCustomerBikeDisplayName(bike)]),
    ),
    saleSummaries: new Map(
      sales.map((sale) => {
        const receiptNumber = sale.receipt?.receiptNumber ?? sale.receiptNumber ?? null;
        const receiptUrl = receiptNumber ? `/r/${encodeURIComponent(receiptNumber)}` : null;
        const checkoutStaffName =
          getStaffDisplayName(sale.receipt?.issuedByStaff)
          ?? getStaffDisplayName(sale.createdByStaff)
          ?? getStaffDisplayName(sale.tenders[0]?.createdByStaff)
          ?? null;

        return [
          sale.id,
          {
            checkoutStaffName,
            paymentSummary: summarizeTenders(sale.tenders),
            receiptNumber,
            receiptUrl,
          },
        ];
      }),
    ),
  };
};

const toPersistedTimelineEvent = (
  event: PersistedTimelineRow,
  contextMaps: Awaited<ReturnType<typeof loadTimelineSupportContext>>,
): TimelineEventRecord | null => {
  if (!isCoreEventName(event.eventName)) {
    return null;
  }

  const saleId = event.saleId ?? (event.entityType === "SALE" ? event.entityId : null);
  const workshopJobId =
    event.workshopJobId ?? (event.entityType === "WORKSHOP_JOB" ? event.entityId : null);
  const bikeId = event.bikeId ?? (event.entityType === "BIKE" ? event.entityId : null);

  return {
    eventName: event.eventName,
    payload: event.payload as CoreEventMap[typeof event.eventName],
    requestId: event.requestId ?? null,
    actorStaffId: event.actorStaffId ?? null,
    linkedEntities: buildLinkedEntities(event),
    context: {
      actorName: event.actorStaffId ? contextMaps.actorNames.get(event.actorStaffId) ?? null : null,
      bikeDescription: workshopJobId ? contextMaps.bikeDescriptions.get(workshopJobId) ?? null : null,
      bikeDisplayName: bikeId ? contextMaps.bikeDisplayNames.get(bikeId) ?? null : null,
      saleSummary: saleId ? contextMaps.saleSummaries.get(saleId) : undefined,
    },
  };
};

const buildPersistedTimelineWhere = (
  entityType: TimelineEntityType,
  entityId: string,
): Prisma.DomainEventWhereInput => {
  switch (entityType) {
    case "CUSTOMER":
      return {
        OR: [{ entityType, entityId }, { customerId: entityId }],
      };
    case "BIKE":
      return {
        OR: [{ entityType, entityId }, { bikeId: entityId }],
      };
    case "WORKSHOP_JOB":
      return {
        OR: [{ entityType, entityId }, { workshopJobId: entityId }],
      };
    case "SALE":
      return {
        OR: [{ entityType, entityId }, { saleId: entityId }],
      };
    case "VARIANT":
      return {
        OR: [{ entityType, entityId }, { variantId: entityId }],
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

    const contextMaps = await loadTimelineSupportContext(rows);

    return rows
      .map((row) => toPersistedTimelineEvent(row, contextMaps))
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
      const matchingEntity = buildTimelineEntityRefs(event).find(
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
