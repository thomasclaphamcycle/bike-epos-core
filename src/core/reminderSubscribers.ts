import { on } from "./events";
import { prepareReminderCandidateFromWorkshopCompletion } from "../services/reminderCandidateService";

let reminderSubscribersRegistered = false;

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

      if (process.env.EVENT_BUS_DEBUG === "1" && candidate) {
        console.info(
          `[eventbus:reminders] workshop.job.completed ${JSON.stringify({
            workshopJobId: candidate.workshopJobId,
            reminderCandidateId: candidate.id,
            status: candidate.status,
            dueAt: candidate.dueAt.toISOString(),
          })}`,
        );
      }
    } catch (error) {
      if (process.env.EVENT_BUS_DEBUG === "1") {
        console.warn(
          `[eventbus:reminders] failed ${JSON.stringify({
            workshopJobId: payload.workshopJobId,
            message: error instanceof Error ? error.message : String(error),
          })}`,
        );
      }

      throw error;
    }
  });
};
