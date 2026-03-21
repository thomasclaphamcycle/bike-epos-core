import { Router } from "express";
import {
  addWorkshopJobNoteHandler,
  addWorkshopJobLineHandler,
  attachWorkshopJobCustomerHandler,
  assignWorkshopJobHandler,
  cancelWorkshopJobHandler,
  changeWorkshopJobStatusHandler,
  closeWorkshopJobHandler,
  checkoutWorkshopJobHandler,
  createWorkshopEstimateCustomerQuoteLinkHandler,
  createWorkshopJobHandler,
  deleteWorkshopJobLineHandler,
  finalizeWorkshopJobHandler,
  getWorkshopAvailabilityHandler,
  getWorkshopDashboardHandler,
  getWorkshopJobHandler,
  getWorkshopJobNotesHandler,
  listWorkshopJobNotificationsHandler,
  listWorkshopJobsHandler,
  patchWorkshopJobLineHandler,
  patchWorkshopJobHandler,
  resendWorkshopJobNotificationHandler,
  saveWorkshopEstimateHandler,
  setWorkshopJobApprovalStatusHandler,
} from "../controllers/workshopController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const workshopRouter = Router();

workshopRouter.get("/availability", getWorkshopAvailabilityHandler);
workshopRouter.get("/dashboard", requireRoleAtLeast("STAFF"), getWorkshopDashboardHandler);
workshopRouter.post("/jobs", requireRoleAtLeast("STAFF"), createWorkshopJobHandler);
workshopRouter.get("/jobs", requireRoleAtLeast("STAFF"), listWorkshopJobsHandler);
workshopRouter.get("/jobs/:id", requireRoleAtLeast("STAFF"), getWorkshopJobHandler);
workshopRouter.get("/jobs/:id/notifications", requireRoleAtLeast("STAFF"), listWorkshopJobNotificationsHandler);
workshopRouter.post("/jobs/:id/notifications/resend", requireRoleAtLeast("STAFF"), resendWorkshopJobNotificationHandler);
workshopRouter.patch("/jobs/:id", requireRoleAtLeast("STAFF"), patchWorkshopJobHandler);
workshopRouter.patch("/jobs/:id/customer", requireRoleAtLeast("STAFF"), attachWorkshopJobCustomerHandler);
workshopRouter.post("/jobs/:id/lines", requireRoleAtLeast("STAFF"), addWorkshopJobLineHandler);
workshopRouter.patch("/jobs/:id/lines/:lineId", requireRoleAtLeast("STAFF"), patchWorkshopJobLineHandler);
workshopRouter.delete("/jobs/:id/lines/:lineId", requireRoleAtLeast("STAFF"), deleteWorkshopJobLineHandler);
workshopRouter.post("/jobs/:id/estimate", requireRoleAtLeast("STAFF"), saveWorkshopEstimateHandler);
workshopRouter.post("/jobs/:id/customer-quote-link", requireRoleAtLeast("STAFF"), createWorkshopEstimateCustomerQuoteLinkHandler);
workshopRouter.post("/jobs/:id/finalize", requireRoleAtLeast("STAFF"), finalizeWorkshopJobHandler);
workshopRouter.post("/jobs/:id/close", requireRoleAtLeast("STAFF"), closeWorkshopJobHandler);
workshopRouter.post("/jobs/:id/assign", requireRoleAtLeast("STAFF"), assignWorkshopJobHandler);
workshopRouter.post("/jobs/:id/status", requireRoleAtLeast("STAFF"), changeWorkshopJobStatusHandler);
workshopRouter.post("/jobs/:id/approval", requireRoleAtLeast("STAFF"), setWorkshopJobApprovalStatusHandler);
workshopRouter.post("/jobs/:id/notes", requireRoleAtLeast("STAFF"), addWorkshopJobNoteHandler);
workshopRouter.get("/jobs/:id/notes", requireRoleAtLeast("STAFF"), getWorkshopJobNotesHandler);
workshopRouter.post("/jobs/:id/checkout", requireRoleAtLeast("STAFF"), checkoutWorkshopJobHandler);
workshopRouter.post("/jobs/:id/cancel", requireRoleAtLeast("STAFF"), cancelWorkshopJobHandler);
