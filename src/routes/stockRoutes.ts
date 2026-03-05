import { Router } from "express";
import {
  createStockAdjustmentHandler,
  getVariantStockHandler,
} from "../controllers/stockController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const stockRouter = Router();

stockRouter.get("/variants/:variantId", requireRoleAtLeast("STAFF"), getVariantStockHandler);
stockRouter.post("/adjustments", requireRoleAtLeast("MANAGER"), createStockAdjustmentHandler);
