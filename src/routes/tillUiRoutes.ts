import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import { getTillPageHandler } from "../controllers/tillUiController";

export const tillUiRouter = Router();

tillUiRouter.get("/till", requireRoleAtLeast("MANAGER"), getTillPageHandler);
