import { Router } from "express";
import { getInventoryPageHandler } from "../controllers/inventoryUiController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const inventoryUiRouter = Router();

inventoryUiRouter.get("/inventory", requireRoleAtLeast("STAFF"), getInventoryPageHandler);
