import { Router } from "express";
import {
  addWorkshopJobPartHandler,
  listWorkshopJobPartsHandler,
  patchWorkshopJobPartHandler,
  removeWorkshopJobPartHandler,
} from "../controllers/workshopPartController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const workshopJobPartRouter = Router();

workshopJobPartRouter.get("/:id/parts", requireRoleAtLeast("STAFF"), listWorkshopJobPartsHandler);
workshopJobPartRouter.post("/:id/parts", requireRoleAtLeast("STAFF"), addWorkshopJobPartHandler);
workshopJobPartRouter.patch(
  "/:id/parts/:partId",
  requireRoleAtLeast("STAFF"),
  patchWorkshopJobPartHandler,
);
workshopJobPartRouter.delete(
  "/:id/parts/:partId",
  requireRoleAtLeast("STAFF"),
  removeWorkshopJobPartHandler,
);
