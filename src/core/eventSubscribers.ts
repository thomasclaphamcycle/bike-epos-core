import { on, type CoreEventMap } from "./events";
import { registerNotificationSubscribers } from "./notificationSubscribers";
import { registerReminderSubscribers } from "./reminderSubscribers";

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
    console.info(`[eventbus] ${eventName} ${JSON.stringify(toLogSummary(eventName, payload))}`);
  }
};

const toLogSummary = <TEventName extends DiagnosticEventName>(
  eventName: TEventName,
  payload: CoreEventMap[TEventName],
) => {
  switch (eventName) {
    case "auth.login.succeeded":
      return {
        userId: payload.userId,
        authMethod: payload.authMethod,
        resultStatus: payload.resultStatus,
      };
    case "payments.intent.created":
      return {
        paymentIntentId: payload.paymentIntentId,
        saleId: payload.saleId ?? null,
        provider: payload.provider ?? null,
        resultStatus: payload.resultStatus,
      };
    case "payments.refund.recorded":
      return {
        paymentId: payload.paymentId,
        refundId: payload.refundId,
        resultStatus: payload.resultStatus,
      };
    case "sale.completed":
      return {
        saleId: payload.saleId,
        totalPence: payload.totalPence ?? null,
        changeDuePence: payload.changeDuePence ?? null,
      };
    case "purchaseOrder.received":
      return {
        purchaseOrderId: payload.purchaseOrderId,
        poNumber: payload.poNumber,
        quantityReceived: payload.quantityReceived,
        status: payload.status,
      };
    case "workshop.job.completed":
      return {
        workshopJobId: payload.workshopJobId,
        status: payload.status,
        saleId: payload.saleId ?? null,
      };
    case "workshop.quote.ready":
      return {
        workshopJobId: payload.workshopJobId,
        workshopEstimateId: payload.workshopEstimateId,
        estimateVersion: payload.estimateVersion,
      };
    case "workshop.job.ready_for_collection":
      return {
        workshopJobId: payload.workshopJobId,
        status: payload.status,
      };
    case "workshop.portal_message.ready":
      return {
        workshopJobId: payload.workshopJobId,
        workshopMessageId: payload.workshopMessageId,
      };
    case "stock.adjusted":
      return {
        variantId: payload.variantId,
        locationId: payload.locationId,
        quantityDelta: payload.quantityDelta,
        totalOnHand: payload.totalOnHand,
      };
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

  on("purchaseOrder.received", (payload) => {
    recordDiagnosticEvent("purchaseOrder.received", payload);
  });

  on("workshop.job.completed", (payload) => {
    recordDiagnosticEvent("workshop.job.completed", payload);
  });

  on("workshop.quote.ready", (payload) => {
    recordDiagnosticEvent("workshop.quote.ready", payload);
  });

  on("workshop.job.ready_for_collection", (payload) => {
    recordDiagnosticEvent("workshop.job.ready_for_collection", payload);
  });

  on("workshop.portal_message.ready", (payload) => {
    recordDiagnosticEvent("workshop.portal_message.ready", payload);
  });

  on("stock.adjusted", (payload) => {
    recordDiagnosticEvent("stock.adjusted", payload);
  });
};

export const getRecentDiagnosticEvents = () => recentEvents.slice();
