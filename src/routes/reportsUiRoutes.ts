import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import { getReportsPageHandler } from "../controllers/reportsUiController";

export const reportsUiRouter = Router();

reportsUiRouter.get("/reports", requireRoleAtLeast("MANAGER"), getReportsPageHandler);
