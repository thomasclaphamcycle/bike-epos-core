import { on } from "./events";
import { prepareReminderCandidateFromWorkshopCompletion } from "../services/reminderCandidateService";
import { logger } from "../utils/logger";

let reminderSubscribersRegistered = false;
const isEventBusDebugEnabled = () => process.env.EVENT_BUS_DEBUG === "1";

export const registerReminderSubscribers = () => {
  if (reminderSubscribersRegistered) {
    return;
  }

  reminderSubscribersRegistered = true;

  on("workshop.job.completed", async (payload) => {
    if (payload.status !== "COMPLETED" || !payload.completedAt) {
      return;
    }

    try {
      const candidate = await prepareReminderCandidateFromWorkshopCompletion({
        workshopJobId: payload.workshopJobId,
        sourceEvent: payload.type,
      });

      if (isEventBusDebugEnabled() && candidate) {
        logger.info("eventbus.reminders.candidate_prepared", {
          workshopJobId: candidate.workshopJobId,
          reminderCandidateId: candidate.id,
          status: candidate.status,
          dueAt: candidate.dueAt.toISOString(),
        });
      }
    } catch (error) {
      if (isEventBusDebugEnabled()) {
        logger.error("eventbus.reminders.prepare_failed", error, {
          workshopJobId: payload.workshopJobId,
        });
      }

      throw error;
    }
  });
};
