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
  createWorkshopJobHandler,
  finalizeWorkshopJobHandler,
  getWorkshopAvailabilityHandler,
  getWorkshopDashboardHandler,
  getWorkshopJobHandler,
  getWorkshopJobNotesHandler,
  listWorkshopJobsHandler,
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
workshopRouter.post("/jobs/:id/finalize", requireRoleAtLeast("STAFF"), finalizeWorkshopJobHandler);
workshopRouter.post("/jobs/:id/close", requireRoleAtLeast("STAFF"), closeWorkshopJobHandler);
workshopRouter.post("/jobs/:id/assign", assignWorkshopJobHandler);
workshopRouter.post("/jobs/:id/status", changeWorkshopJobStatusHandler);
workshopRouter.post("/jobs/:id/notes", addWorkshopJobNoteHandler);
workshopRouter.get("/jobs/:id/notes", getWorkshopJobNotesHandler);
workshopRouter.post("/jobs/:id/checkout", checkoutWorkshopJobHandler);
workshopRouter.post("/jobs/:id/cancel", cancelWorkshopJobHandler);
