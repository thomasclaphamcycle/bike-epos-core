type CoreEventEnvelope<TType extends string> = {
  id: string;
  type: TType;
  timestamp: string;
  requestId?: string;
  actorStaffId?: string;
};

export type CoreEventMap = {
  "auth.login.succeeded": CoreEventEnvelope<"auth.login.succeeded"> & {
    userId: string;
    authMethod: "password" | "pin";
    resultStatus: "succeeded";
  };
  "payments.intent.created": CoreEventEnvelope<"payments.intent.created"> & {
    paymentIntentId: string;
    saleId?: string | null;
    provider?: string | null;
    resultStatus: "succeeded";
  };
  "payments.refund.recorded": CoreEventEnvelope<"payments.refund.recorded"> & {
    paymentId: string;
    refundId: string;
    resultStatus: "idempotent" | "succeeded";
  };
  "sale.completed": CoreEventEnvelope<"sale.completed"> & {
    saleId: string;
    completedAt: string;
    totalPence?: number;
    changeDuePence?: number;
    customerId?: string | null;
    workshopJobId?: string | null;
    bikeId?: string | null;
  };
  "purchaseOrder.received": CoreEventEnvelope<"purchaseOrder.received"> & {
    purchaseOrderId: string;
    poNumber: string;
    locationId: string;
    lineCount: number;
    quantityReceived: number;
    status: string;
  };
  "workshop.job.completed": CoreEventEnvelope<"workshop.job.completed"> & {
    workshopJobId: string;
    status: string;
    completedAt?: string;
    saleId?: string;
    customerId?: string | null;
    bikeId?: string | null;
  };
  "workshop.quote.ready": CoreEventEnvelope<"workshop.quote.ready"> & {
    workshopJobId: string;
    workshopEstimateId: string;
    estimateVersion: number;
    quotePublicPath?: string;
    customerId?: string | null;
    bikeId?: string | null;
  };
  "workshop.estimate.decided": CoreEventEnvelope<"workshop.estimate.decided"> & {
    workshopJobId: string;
    workshopEstimateId: string;
    estimateVersion: number;
    decisionStatus: "APPROVED" | "REJECTED";
    decisionSource?: "STAFF" | "CUSTOMER" | null;
    customerId?: string | null;
    bikeId?: string | null;
  };
  "workshop.job.status_changed": CoreEventEnvelope<"workshop.job.status_changed"> & {
    workshopJobId: string;
    fromStatus: string;
    toStatus: string;
    customerId?: string | null;
    bikeId?: string | null;
    saleId?: string | null;
  };
  "workshop.job.ready_for_collection": CoreEventEnvelope<"workshop.job.ready_for_collection"> & {
    workshopJobId: string;
    status: string;
    customerId?: string | null;
    bikeId?: string | null;
    saleId?: string | null;
  };
  "workshop.note.added": CoreEventEnvelope<"workshop.note.added"> & {
    workshopJobId: string;
    workshopJobNoteId: string;
    visibility: "INTERNAL" | "CUSTOMER";
    customerId?: string | null;
    bikeId?: string | null;
  };
  "workshop.portal_message.ready": CoreEventEnvelope<"workshop.portal_message.ready"> & {
    workshopJobId: string;
    workshopMessageId: string;
    customerId?: string | null;
    bikeId?: string | null;
  };
  "stock.adjusted": CoreEventEnvelope<"stock.adjusted"> & {
    variantId: string;
    locationId: string;
    quantityDelta: number;
    totalOnHand: number;
    referenceType: string;
    referenceId: string;
  };
};

export type CoreEventName = keyof CoreEventMap;
export const CORE_EVENT_NAMES = [
  "auth.login.succeeded",
  "payments.intent.created",
  "payments.refund.recorded",
  "sale.completed",
  "purchaseOrder.received",
  "workshop.job.completed",
  "workshop.quote.ready",
  "workshop.estimate.decided",
  "workshop.job.status_changed",
  "workshop.job.ready_for_collection",
  "workshop.note.added",
  "workshop.portal_message.ready",
  "stock.adjusted",
] as const satisfies readonly CoreEventName[];

type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;

const listeners = new Map<string, Set<EventHandler>>();

export const emit = <TEventName extends keyof CoreEventMap>(
  eventName: TEventName,
  payload: CoreEventMap[TEventName],
) => {
  const handlers = listeners.get(eventName);
  if (!handlers || handlers.size === 0) {
    return;
  }

  for (const handler of [...handlers]) {
    void Promise.resolve()
      .then(() => handler(payload))
      .catch(() => {
        // Event handlers are intentionally isolated from the main app flow.
      });
  }
};

export const on = <TEventName extends keyof CoreEventMap>(
  eventName: TEventName,
  handler: EventHandler<CoreEventMap[TEventName]>,
) => {
  const set = listeners.get(eventName) ?? new Set<EventHandler>();
  set.add(handler as EventHandler);
  listeners.set(eventName, set);

  return () => {
    const current = listeners.get(eventName);
    if (!current) {
      return;
    }
    current.delete(handler as EventHandler);
    if (current.size === 0) {
      listeners.delete(eventName);
    }
  };
};
