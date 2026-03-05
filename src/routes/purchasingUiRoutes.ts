import { Router } from "express";
import { getPurchasingPageHandler } from "../controllers/purchasingUiController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const purchasingUiRouter = Router();

purchasingUiRouter.get("/purchasing", requireRoleAtLeast("STAFF"), getPurchasingPageHandler);
