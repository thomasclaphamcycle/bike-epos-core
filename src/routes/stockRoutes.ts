import { Router } from "express";
import {
  createStockAdjustmentHandler,
  getVariantStockHandler,
} from "../controllers/stockController";

export const stockRouter = Router();

stockRouter.get("/variants/:variantId", getVariantStockHandler);
stockRouter.post("/adjustments", createStockAdjustmentHandler);
