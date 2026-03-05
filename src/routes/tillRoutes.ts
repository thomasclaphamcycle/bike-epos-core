import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import {
  addTillMovementHandler,
  closeCashSessionHandler,
  getCashSessionSummaryCsvHandler,
  getCashSessionSummaryHandler,
  getCurrentCashSessionHandler,
  listCashSessionsHandler,
  openCashSessionHandler,
  recordCashCountHandler,
} from "../controllers/tillController";

export const tillRouter = Router();

tillRouter.post("/sessions/open", requireRoleAtLeast("MANAGER"), openCashSessionHandler);
tillRouter.post("/sessions/:id/movements", requireRoleAtLeast("MANAGER"), addTillMovementHandler);
tillRouter.post("/sessions/:id/count", requireRoleAtLeast("MANAGER"), recordCashCountHandler);
tillRouter.post("/sessions/:id/close", requireRoleAtLeast("MANAGER"), closeCashSessionHandler);
tillRouter.get("/sessions/current", requireRoleAtLeast("MANAGER"), getCurrentCashSessionHandler);
tillRouter.get("/sessions", requireRoleAtLeast("MANAGER"), listCashSessionsHandler);
tillRouter.get("/sessions/:id/summary", requireRoleAtLeast("MANAGER"), getCashSessionSummaryHandler);
tillRouter.get(
  "/sessions/:id/summary.csv",
  requireRoleAtLeast("MANAGER"),
  getCashSessionSummaryCsvHandler,
);
