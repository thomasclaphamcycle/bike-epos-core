import { Router } from "express";
import {
  createBikeServiceScheduleHandler,
  createCustomerBikeHandler,
  createCustomerHandler,
  getCustomerHandler,
  getCustomerBikeHistoryHandler,
  getCustomerBikeWorkshopStartContextHandler,
  getCustomerTimelineHandler,
  listBikeServiceSchedulesHandler,
  listCustomersHandler,
  listCustomerBikesHandler,
  listCustomerSalesHandler,
  listCustomerWorkshopJobsHandler,
  markBikeServiceScheduleServicedHandler,
  searchCustomersHandler,
  updateCustomerBikeHandler,
  updateBikeServiceScheduleHandler,
  updateCustomerCommunicationPreferencesHandler,
} from "../controllers/customerController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const customerRouter = Router();

customerRouter.post("/", requireRoleAtLeast("STAFF"), createCustomerHandler);
customerRouter.get("/", requireRoleAtLeast("STAFF"), listCustomersHandler);
customerRouter.get("/search", requireRoleAtLeast("STAFF"), searchCustomersHandler);
customerRouter.get("/bikes/:bikeId/workshop-start", requireRoleAtLeast("STAFF"), getCustomerBikeWorkshopStartContextHandler);
customerRouter.get("/bikes/:bikeId/service-schedules", requireRoleAtLeast("STAFF"), listBikeServiceSchedulesHandler);
customerRouter.post("/bikes/:bikeId/service-schedules", requireRoleAtLeast("STAFF"), createBikeServiceScheduleHandler);
customerRouter.patch(
  "/bikes/:bikeId/service-schedules/:scheduleId",
  requireRoleAtLeast("STAFF"),
  updateBikeServiceScheduleHandler,
);
customerRouter.post(
  "/bikes/:bikeId/service-schedules/:scheduleId/mark-serviced",
  requireRoleAtLeast("STAFF"),
  markBikeServiceScheduleServicedHandler,
);
customerRouter.get("/bikes/:bikeId", requireRoleAtLeast("STAFF"), getCustomerBikeHistoryHandler);
customerRouter.patch("/bikes/:bikeId", requireRoleAtLeast("STAFF"), updateCustomerBikeHandler);
customerRouter.get("/:id/bikes", requireRoleAtLeast("STAFF"), listCustomerBikesHandler);
customerRouter.post("/:id/bikes", requireRoleAtLeast("STAFF"), createCustomerBikeHandler);
customerRouter.patch(
  "/:id/communication-preferences",
  requireRoleAtLeast("STAFF"),
  updateCustomerCommunicationPreferencesHandler,
);
customerRouter.get("/:id/sales", requireRoleAtLeast("STAFF"), listCustomerSalesHandler);
customerRouter.get("/:id/workshop-jobs", requireRoleAtLeast("STAFF"), listCustomerWorkshopJobsHandler);
customerRouter.get("/:id/timeline", requireRoleAtLeast("STAFF"), getCustomerTimelineHandler);
customerRouter.get("/:id", requireRoleAtLeast("STAFF"), getCustomerHandler);
