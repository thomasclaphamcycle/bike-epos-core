import { on } from "./events";
import { deliverWorkshopNotificationEvent } from "../services/notificationService";
import { logger } from "../utils/logger";

let notificationSubscribersRegistered = false;
const isEventBusDebugEnabled = () => process.env.EVENT_BUS_DEBUG === "1";

export const registerNotificationSubscribers = () => {
  if (notificationSubscribersRegistered) {
    return;
  }

  notificationSubscribersRegistered = true;

  on("workshop.quote.ready", async (payload) => {
    try {
      await deliverWorkshopNotificationEvent({
        type: "QUOTE_READY",
        workshopJobId: payload.workshopJobId,
        workshopEstimateId: payload.workshopEstimateId,
      });
    } catch (error) {
      if (isEventBusDebugEnabled()) {
        logger.error("eventbus.notifications.quote_ready_failed", error, {
          workshopJobId: payload.workshopJobId,
          workshopEstimateId: payload.workshopEstimateId,
        });
      }

      throw error;
    }
  });

  on("workshop.job.ready_for_collection", async (payload) => {
    try {
      await deliverWorkshopNotificationEvent({
        type: "JOB_READY_FOR_COLLECTION",
        workshopJobId: payload.workshopJobId,
      });
    } catch (error) {
      if (isEventBusDebugEnabled()) {
        logger.error("eventbus.notifications.ready_for_collection_failed", error, {
          workshopJobId: payload.workshopJobId,
        });
      }

      throw error;
    }
  });

  on("workshop.portal_message.ready", async (payload) => {
    try {
      await deliverWorkshopNotificationEvent({
        type: "PORTAL_MESSAGE",
        workshopJobId: payload.workshopJobId,
        workshopMessageId: payload.workshopMessageId,
      });
    } catch (error) {
      if (isEventBusDebugEnabled()) {
        logger.error("eventbus.notifications.portal_message_failed", error, {
          workshopJobId: payload.workshopJobId,
          workshopMessageId: payload.workshopMessageId,
        });
      }

      throw error;
    }
  });
};
