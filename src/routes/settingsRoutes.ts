import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import { listSettingsHandler, updateSettingsHandler } from "../controllers/settingsController";

export const settingsRouter = Router();

settingsRouter.get("/", requireRoleAtLeast("MANAGER"), listSettingsHandler);
settingsRouter.patch("/", requireRoleAtLeast("MANAGER"), updateSettingsHandler);
