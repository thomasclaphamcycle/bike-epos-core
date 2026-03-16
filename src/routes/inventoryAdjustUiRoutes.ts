import { Router } from "express";
import { getInventoryAdjustPageHandler } from "../controllers/inventoryAdjustUiController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const inventoryAdjustUiRouter = Router();

inventoryAdjustUiRouter.get("/inventory/adjust", requireRoleAtLeast("MANAGER"), getInventoryAdjustPageHandler);
