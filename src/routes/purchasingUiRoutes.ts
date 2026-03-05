import { Router } from "express";
import {
  getPurchasingPageHandler,
  getReceivingPageHandler,
} from "../controllers/purchasingUiController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const purchasingUiRouter = Router();

purchasingUiRouter.get("/purchasing", requireRoleAtLeast("MANAGER"), getPurchasingPageHandler);
purchasingUiRouter.get("/receiving", requireRoleAtLeast("MANAGER"), getReceivingPageHandler);
