import { Router } from "express";
import {
  addWorkshopJobNoteHandler,
  addWorkshopJobLineHandler,
  attachWorkshopJobCustomerHandler,
  assignWorkshopJobHandler,
  cancelWorkshopJobHandler,
  changeWorkshopJobStatusHandler,
  closeWorkshopJobHandler,
  convertWorkshopJobToSaleHandler,
  checkoutWorkshopJobHandler,
  createWorkshopJobHandler,
  deleteWorkshopJobLineHandler,
  finalizeWorkshopJobHandler,
  getWorkshopAvailabilityHandler,
  getWorkshopDashboardHandler,
  getWorkshopJobHandler,
  getWorkshopJobNotesHandler,
  listWorkshopJobsHandler,
  patchWorkshopJobLineHandler,
  patchWorkshopJobHandler,
} from "../controllers/workshopController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const workshopRouter = Router();

workshopRouter.get("/availability", getWorkshopAvailabilityHandler);
workshopRouter.get("/dashboard", getWorkshopDashboardHandler);
workshopRouter.post("/jobs", requireRoleAtLeast("STAFF"), createWorkshopJobHandler);
workshopRouter.get("/jobs", requireRoleAtLeast("STAFF"), listWorkshopJobsHandler);
workshopRouter.get("/jobs/:id", requireRoleAtLeast("STAFF"), getWorkshopJobHandler);
workshopRouter.patch("/jobs/:id", requireRoleAtLeast("STAFF"), patchWorkshopJobHandler);
workshopRouter.patch("/jobs/:id/customer", requireRoleAtLeast("STAFF"), attachWorkshopJobCustomerHandler);
workshopRouter.post("/jobs/:id/lines", requireRoleAtLeast("STAFF"), addWorkshopJobLineHandler);
workshopRouter.patch("/jobs/:id/lines/:lineId", requireRoleAtLeast("STAFF"), patchWorkshopJobLineHandler);
workshopRouter.delete(
  "/jobs/:id/lines/:lineId",
  requireRoleAtLeast("STAFF"),
  deleteWorkshopJobLineHandler,
);
workshopRouter.post("/jobs/:id/finalize", requireRoleAtLeast("STAFF"), finalizeWorkshopJobHandler);
workshopRouter.post("/jobs/:id/close", requireRoleAtLeast("STAFF"), closeWorkshopJobHandler);
workshopRouter.post("/jobs/:id/assign", requireRoleAtLeast("STAFF"), assignWorkshopJobHandler);
workshopRouter.post("/jobs/:id/status", requireRoleAtLeast("STAFF"), changeWorkshopJobStatusHandler);
workshopRouter.post("/jobs/:id/notes", requireRoleAtLeast("STAFF"), addWorkshopJobNoteHandler);
workshopRouter.get("/jobs/:id/notes", requireRoleAtLeast("STAFF"), getWorkshopJobNotesHandler);
workshopRouter.post(
  "/jobs/:id/convert-to-sale",
  requireRoleAtLeast("MANAGER"),
  convertWorkshopJobToSaleHandler,
);
workshopRouter.post("/jobs/:id/checkout", requireRoleAtLeast("STAFF"), checkoutWorkshopJobHandler);
workshopRouter.post("/jobs/:id/cancel", requireRoleAtLeast("STAFF"), cancelWorkshopJobHandler);
