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
  getWorkshopCalendarHandler,
  getWorkshopDashboardHandler,
  getWorkshopJobAttachmentFileHandler,
  getWorkshopJobHandler,
  listWorkshopJobAttachmentsHandler,
  getWorkshopJobConversationHandler,
  getWorkshopJobNotesHandler,
  listWorkshopJobNotificationsHandler,
  listWorkshopJobsHandler,
  patchWorkshopJobScheduleHandler,
  patchWorkshopJobLineHandler,
  patchWorkshopJobHandler,
  postWorkshopJobAttachmentHandler,
  postWorkshopJobConversationMessageHandler,
  resendWorkshopJobNotificationHandler,
  saveWorkshopEstimateHandler,
  setWorkshopJobApprovalStatusHandler,
  deleteWorkshopJobAttachmentHandler,
} from "../controllers/workshopController";
import {
  applyWorkshopServiceTemplateHandler,
  createWorkshopServiceTemplateHandler,
  deleteWorkshopServiceTemplateHandler,
  getWorkshopServiceTemplateHandler,
  listWorkshopServiceTemplatesHandler,
  patchWorkshopServiceTemplateHandler,
} from "../controllers/workshopServiceTemplateController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const workshopRouter = Router();

workshopRouter.get("/availability", getWorkshopAvailabilityHandler);
workshopRouter.get("/calendar", requireRoleAtLeast("STAFF"), getWorkshopCalendarHandler);
workshopRouter.get("/dashboard", requireRoleAtLeast("STAFF"), getWorkshopDashboardHandler);
workshopRouter.get("/service-templates", requireRoleAtLeast("STAFF"), listWorkshopServiceTemplatesHandler);
workshopRouter.get("/service-templates/:id", requireRoleAtLeast("STAFF"), getWorkshopServiceTemplateHandler);
workshopRouter.post("/service-templates", requireRoleAtLeast("MANAGER"), createWorkshopServiceTemplateHandler);
workshopRouter.patch("/service-templates/:id", requireRoleAtLeast("MANAGER"), patchWorkshopServiceTemplateHandler);
workshopRouter.delete("/service-templates/:id", requireRoleAtLeast("MANAGER"), deleteWorkshopServiceTemplateHandler);
workshopRouter.post("/jobs", requireRoleAtLeast("STAFF"), createWorkshopJobHandler);
workshopRouter.get("/jobs", requireRoleAtLeast("STAFF"), listWorkshopJobsHandler);
workshopRouter.get("/jobs/:id", requireRoleAtLeast("STAFF"), getWorkshopJobHandler);
workshopRouter.get("/jobs/:id/attachments", requireRoleAtLeast("STAFF"), listWorkshopJobAttachmentsHandler);
workshopRouter.post("/jobs/:id/attachments", requireRoleAtLeast("STAFF"), postWorkshopJobAttachmentHandler);
workshopRouter.delete("/jobs/:id/attachments/:attachmentId", requireRoleAtLeast("STAFF"), deleteWorkshopJobAttachmentHandler);
workshopRouter.get("/jobs/:id/attachments/:attachmentId/file", requireRoleAtLeast("STAFF"), getWorkshopJobAttachmentFileHandler);
workshopRouter.get("/jobs/:id/conversation", requireRoleAtLeast("STAFF"), getWorkshopJobConversationHandler);
workshopRouter.post("/jobs/:id/conversation/messages", requireRoleAtLeast("STAFF"), postWorkshopJobConversationMessageHandler);
workshopRouter.post("/jobs/:id/templates/apply", requireRoleAtLeast("STAFF"), applyWorkshopServiceTemplateHandler);
workshopRouter.get("/jobs/:id/notifications", requireRoleAtLeast("STAFF"), listWorkshopJobNotificationsHandler);
workshopRouter.post("/jobs/:id/notifications/resend", requireRoleAtLeast("STAFF"), resendWorkshopJobNotificationHandler);
workshopRouter.patch("/jobs/:id", requireRoleAtLeast("STAFF"), patchWorkshopJobHandler);
workshopRouter.patch("/jobs/:id/schedule", requireRoleAtLeast("STAFF"), patchWorkshopJobScheduleHandler);
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
