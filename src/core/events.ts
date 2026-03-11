export type CoreEventMap = {
  "sale.completed": {
    id: string;
    type: "sale.completed";
    timestamp: string;
    saleId: string;
    completedAt: string;
    totalPence?: number;
    changeDuePence?: number;
  };
  "purchaseOrder.received": {
    id: string;
    type: "purchaseOrder.received";
    timestamp: string;
    purchaseOrderId: string;
    poNumber: string;
    locationId: string;
    lineCount: number;
    quantityReceived: number;
    status: string;
  };
  "workshop.job.completed": {
    id: string;
    type: "workshop.job.completed";
    timestamp: string;
    workshopJobId: string;
    status: string;
    completedAt?: string;
    saleId?: string;
  };
  "stock.adjusted": {
    id: string;
    type: "stock.adjusted";
    timestamp: string;
    variantId: string;
    locationId: string;
    quantityDelta: number;
    totalOnHand: number;
    referenceType: string;
    referenceId: string;
  };
};

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
