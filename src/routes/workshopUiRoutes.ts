import { Router } from "express";
import {
  getWorkshopJobPageHandler,
  getWorkshopPageHandler,
} from "../controllers/workshopUiController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const workshopUiRouter = Router();

workshopUiRouter.get("/workshop", requireRoleAtLeast("STAFF"), getWorkshopPageHandler);
workshopUiRouter.get("/workshop/:id", requireRoleAtLeast("STAFF"), getWorkshopJobPageHandler);
