import { Router } from "express";
import { getCatalogPageHandler } from "../controllers/catalogUiController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const catalogUiRouter = Router();

catalogUiRouter.get("/catalog", requireRoleAtLeast("STAFF"), getCatalogPageHandler);
