import { Router } from "express";
import {
  getWorkshopJobPageHandler,
  getWorkshopJobPrintPageHandler,
  getWorkshopPageHandler,
} from "../controllers/workshopUiController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const workshopUiRouter = Router();

workshopUiRouter.get("/workshop", requireRoleAtLeast("STAFF"), getWorkshopPageHandler);
workshopUiRouter.get("/workshop/:id", requireRoleAtLeast("STAFF"), getWorkshopJobPageHandler);
workshopUiRouter.get("/workshop/:id/print", requireRoleAtLeast("STAFF"), getWorkshopJobPrintPageHandler);
workshopUiRouter.get("/w/:id", requireRoleAtLeast("STAFF"), getWorkshopJobPrintPageHandler);
