import { Router } from "express";
import {
  getPurchasingPageHandler,
  getReceivingPageHandler,
  getSuppliersPageHandler,
} from "../controllers/purchasingUiController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const purchasingUiRouter = Router();

purchasingUiRouter.get("/purchasing", requireRoleAtLeast("MANAGER"), getPurchasingPageHandler);
purchasingUiRouter.get("/receiving", requireRoleAtLeast("MANAGER"), getReceivingPageHandler);
purchasingUiRouter.get("/suppliers", requireRoleAtLeast("MANAGER"), getSuppliersPageHandler);
