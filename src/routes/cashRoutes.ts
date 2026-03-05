import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import {
  createCashMovementHandler,
  getCashSummaryHandler,
  listCashMovementsHandler,
} from "../controllers/cashController";

export const cashRouter = Router();

cashRouter.post("/movements", requireRoleAtLeast("MANAGER"), createCashMovementHandler);
cashRouter.get("/movements", requireRoleAtLeast("MANAGER"), listCashMovementsHandler);
cashRouter.get("/summary", requireRoleAtLeast("MANAGER"), getCashSummaryHandler);
