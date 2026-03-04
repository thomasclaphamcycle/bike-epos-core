import { Router } from "express";
import {
  addWorkshopJobNoteHandler,
  assignWorkshopJobHandler,
  cancelWorkshopJobHandler,
  changeWorkshopJobStatusHandler,
  checkoutWorkshopJobHandler,
  getWorkshopAvailabilityHandler,
  getWorkshopDashboardHandler,
  getWorkshopJobNotesHandler,
} from "../controllers/workshopController";

export const workshopRouter = Router();

workshopRouter.get("/availability", getWorkshopAvailabilityHandler);
workshopRouter.get("/dashboard", getWorkshopDashboardHandler);
workshopRouter.post("/jobs/:id/assign", assignWorkshopJobHandler);
workshopRouter.post("/jobs/:id/status", changeWorkshopJobStatusHandler);
workshopRouter.post("/jobs/:id/notes", addWorkshopJobNoteHandler);
workshopRouter.get("/jobs/:id/notes", getWorkshopJobNotesHandler);
workshopRouter.post("/jobs/:id/checkout", checkoutWorkshopJobHandler);
workshopRouter.post("/jobs/:id/cancel", cancelWorkshopJobHandler);
