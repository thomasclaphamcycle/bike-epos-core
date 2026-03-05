import { Router } from "express";
import { getWorkshopPageHandler } from "../controllers/workshopUiController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const workshopUiRouter = Router();

workshopUiRouter.get("/workshop", requireRoleAtLeast("STAFF"), getWorkshopPageHandler);

