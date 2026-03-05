import { Router } from "express";
import { getPosPageHandler } from "../controllers/posUiController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const posUiRouter = Router();

posUiRouter.get("/pos", requireRoleAtLeast("STAFF"), getPosPageHandler);
