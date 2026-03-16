import { Router } from "express";
import { createInventoryAdjustmentHandler } from "../controllers/inventoryAdjustmentController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const inventoryAdjustmentRouter = Router();

inventoryAdjustmentRouter.post(
  "/adjustments",
  requireRoleAtLeast("MANAGER"),
  createInventoryAdjustmentHandler,
);
