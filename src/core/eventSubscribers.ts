import { on, type CoreEventMap } from "./events";
import { registerNotificationSubscribers } from "./notificationSubscribers";
import { registerReminderSubscribers } from "./reminderSubscribers";
import { logger } from "../utils/logger";

type DiagnosticEventName = keyof CoreEventMap;

type DiagnosticEvent<TEventName extends DiagnosticEventName = DiagnosticEventName> = {
  eventName: TEventName;
  observedAt: string;
  payload: CoreEventMap[TEventName];
};

const MAX_DIAGNOSTIC_EVENTS = 50;
const recentEvents: DiagnosticEvent[] = [];

let subscribersRegistered = false;

const recordDiagnosticEvent = <TEventName extends DiagnosticEventName>(
  eventName: TEventName,
  payload: CoreEventMap[TEventName],
) => {
  recentEvents.push({
    eventName,
    observedAt: new Date().toISOString(),
    payload,
  });

  if (recentEvents.length > MAX_DIAGNOSTIC_EVENTS) {
    recentEvents.splice(0, recentEvents.length - MAX_DIAGNOSTIC_EVENTS);
  }

  if (process.env.EVENT_BUS_DEBUG === "1") {
    const summary = toLogSummary(eventName, payload);
    logger.info("eventbus.diagnostic_event", {
      eventName,
      ...(summary ?? {}),
    });
  }
};

const toLogSummary = <TEventName extends DiagnosticEventName>(
  eventName: TEventName,
  payload: CoreEventMap[TEventName],
) => {
  switch (eventName) {
    case "auth.login.succeeded": {
      const event = payload as CoreEventMap["auth.login.succeeded"];
      return {
        userId: event.userId,
        authMethod: event.authMethod,
        resultStatus: event.resultStatus,
      };
    }
    case "payments.intent.created": {
      const event = payload as CoreEventMap["payments.intent.created"];
      return {
        paymentIntentId: event.paymentIntentId,
        saleId: event.saleId ?? null,
        provider: event.provider ?? null,
        resultStatus: event.resultStatus,
      };
    }
    case "payments.refund.recorded": {
      const event = payload as CoreEventMap["payments.refund.recorded"];
      return {
        paymentId: event.paymentId,
        refundId: event.refundId,
        resultStatus: event.resultStatus,
      };
    }
    case "sale.completed": {
      const event = payload as CoreEventMap["sale.completed"];
      return {
        saleId: event.saleId,
        totalPence: event.totalPence ?? null,
        changeDuePence: event.changeDuePence ?? null,
      };
    }
    case "customer.bike.created": {
      const event = payload as CoreEventMap["customer.bike.created"];
      return {
        customerId: event.customerId,
        bikeId: event.bikeId,
        bikeDisplayName: event.bikeDisplayName ?? null,
      };
    }
    case "purchaseOrder.received": {
      const event = payload as CoreEventMap["purchaseOrder.received"];
      return {
        purchaseOrderId: event.purchaseOrderId,
        poNumber: event.poNumber,
        quantityReceived: event.quantityReceived,
        status: event.status,
      };
    }
    case "workshop.job.created": {
      const event = payload as CoreEventMap["workshop.job.created"];
      return {
        workshopJobId: event.workshopJobId,
        status: event.status,
        customerId: event.customerId ?? null,
        bikeId: event.bikeId ?? null,
      };
    }
    case "workshop.job.status_changed": {
      const event = payload as CoreEventMap["workshop.job.status_changed"];
      return {
        workshopJobId: event.workshopJobId,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        stage: event.stage,
      };
    }
    case "workshop.job.completed": {
      const event = payload as CoreEventMap["workshop.job.completed"];
      return {
        workshopJobId: event.workshopJobId,
        status: event.status,
        saleId: event.saleId ?? null,
      };
    }
    case "workshop.quote.ready": {
      const event = payload as CoreEventMap["workshop.quote.ready"];
      return {
        workshopJobId: event.workshopJobId,
        workshopEstimateId: event.workshopEstimateId,
        estimateVersion: event.estimateVersion,
      };
    }
    case "workshop.estimate.decided": {
      const event = payload as CoreEventMap["workshop.estimate.decided"];
      return {
        workshopJobId: event.workshopJobId,
        workshopEstimateId: event.workshopEstimateId,
        estimateVersion: event.estimateVersion,
        status: event.status,
        decisionSource: event.decisionSource ?? null,
      };
    }
    case "workshop.job.ready_for_collection": {
      const event = payload as CoreEventMap["workshop.job.ready_for_collection"];
      return {
        workshopJobId: event.workshopJobId,
        status: event.status,
      };
    }
    case "workshop.note.added": {
      const event = payload as CoreEventMap["workshop.note.added"];
      return {
        workshopJobId: event.workshopJobId,
        workshopJobNoteId: event.workshopJobNoteId,
        visibility: event.visibility,
      };
    }
    case "workshop.portal_message.ready": {
      const event = payload as CoreEventMap["workshop.portal_message.ready"];
      return {
        workshopJobId: event.workshopJobId,
        workshopMessageId: event.workshopMessageId,
      };
    }
    case "workshop.portal_message.received": {
      const event = payload as CoreEventMap["workshop.portal_message.received"];
      return {
        workshopJobId: event.workshopJobId,
        workshopMessageId: event.workshopMessageId,
      };
    }
    case "stock.adjusted": {
      const event = payload as CoreEventMap["stock.adjusted"];
      return {
        variantId: event.variantId,
        locationId: event.locationId,
        quantityDelta: event.quantityDelta,
        totalOnHand: event.totalOnHand,
      };
    }
  }
};

export const registerInternalEventSubscribers = () => {
  if (subscribersRegistered) {
    return;
  }

  subscribersRegistered = true;
  registerReminderSubscribers();
  registerNotificationSubscribers();

  on("auth.login.succeeded", (payload) => {
    recordDiagnosticEvent("auth.login.succeeded", payload);
  });

  on("payments.intent.created", (payload) => {
    recordDiagnosticEvent("payments.intent.created", payload);
  });

  on("payments.refund.recorded", (payload) => {
    recordDiagnosticEvent("payments.refund.recorded", payload);
  });

  on("sale.completed", (payload) => {
    recordDiagnosticEvent("sale.completed", payload);
  });

  on("customer.bike.created", (payload) => {
    recordDiagnosticEvent("customer.bike.created", payload);
  });

  on("purchaseOrder.received", (payload) => {
    recordDiagnosticEvent("purchaseOrder.received", payload);
  });

  on("workshop.job.created", (payload) => {
    recordDiagnosticEvent("workshop.job.created", payload);
  });

  on("workshop.job.status_changed", (payload) => {
    recordDiagnosticEvent("workshop.job.status_changed", payload);
  });

  on("workshop.job.completed", (payload) => {
    recordDiagnosticEvent("workshop.job.completed", payload);
  });

  on("workshop.quote.ready", (payload) => {
    recordDiagnosticEvent("workshop.quote.ready", payload);
  });

  on("workshop.estimate.decided", (payload) => {
    recordDiagnosticEvent("workshop.estimate.decided", payload);
  });

  on("workshop.job.ready_for_collection", (payload) => {
    recordDiagnosticEvent("workshop.job.ready_for_collection", payload);
  });

  on("workshop.note.added", (payload) => {
    recordDiagnosticEvent("workshop.note.added", payload);
  });

  on("workshop.portal_message.ready", (payload) => {
    recordDiagnosticEvent("workshop.portal_message.ready", payload);
  });

  on("workshop.portal_message.received", (payload) => {
    recordDiagnosticEvent("workshop.portal_message.received", payload);
  });

  on("stock.adjusted", (payload) => {
    recordDiagnosticEvent("stock.adjusted", payload);
  });
};

export const getRecentDiagnosticEvents = () => recentEvents.slice();
