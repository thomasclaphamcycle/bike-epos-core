import { on } from "./events";
import { deliverWorkshopNotificationEvent } from "../services/notificationService";

let notificationSubscribersRegistered = false;

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
      if (process.env.EVENT_BUS_DEBUG === "1") {
        console.warn(
          `[eventbus:notifications] quote-ready failed ${JSON.stringify({
            workshopJobId: payload.workshopJobId,
            workshopEstimateId: payload.workshopEstimateId,
            message: error instanceof Error ? error.message : String(error),
          })}`,
        );
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
      if (process.env.EVENT_BUS_DEBUG === "1") {
        console.warn(
          `[eventbus:notifications] ready-for-collection failed ${JSON.stringify({
            workshopJobId: payload.workshopJobId,
            message: error instanceof Error ? error.message : String(error),
          })}`,
        );
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
      if (process.env.EVENT_BUS_DEBUG === "1") {
        console.warn(
          `[eventbus:notifications] portal-message failed ${JSON.stringify({
            workshopJobId: payload.workshopJobId,
            workshopMessageId: payload.workshopMessageId,
            message: error instanceof Error ? error.message : String(error),
          })}`,
        );
      }

      throw error;
    }
  });
};
