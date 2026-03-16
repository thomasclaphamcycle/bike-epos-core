import { Router } from "express";
import {
  getWorkshopPageHandler,
  getWorkshopPrintPageHandler,
} from "../controllers/workshopUiController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const workshopUiRouter = Router();

workshopUiRouter.get("/workshop", requireRoleAtLeast("STAFF"), getWorkshopPageHandler);
workshopUiRouter.get("/workshop/:id/print", requireRoleAtLeast("STAFF"), getWorkshopPrintPageHandler);
