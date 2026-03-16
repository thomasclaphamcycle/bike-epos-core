import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import {
  getDailyClosePrintPageHandler,
  getReportsPageHandler,
} from "../controllers/reportsUiController";

export const reportsUiRouter = Router();

reportsUiRouter.get("/reports", requireRoleAtLeast("MANAGER"), getReportsPageHandler);
reportsUiRouter.get(
  "/reports/daily-close/print",
  requireRoleAtLeast("MANAGER"),
  getDailyClosePrintPageHandler,
);
