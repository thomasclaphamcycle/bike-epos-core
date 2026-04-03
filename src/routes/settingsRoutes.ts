import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import {
  listSettingsHandler,
  listStoreInfoHandler,
  removeStoreLogoHandler,
  uploadStoreLogoHandler,
  updateSettingsHandler,
  updateStoreInfoHandler,
} from "../controllers/settingsController";

export const settingsRouter = Router();

settingsRouter.get("/", requireRoleAtLeast("MANAGER"), listSettingsHandler);
settingsRouter.patch("/", requireRoleAtLeast("MANAGER"), updateSettingsHandler);
settingsRouter.get("/store-info", requireRoleAtLeast("ADMIN"), listStoreInfoHandler);
settingsRouter.patch("/store-info", requireRoleAtLeast("ADMIN"), updateStoreInfoHandler);
settingsRouter.post("/store-info/logo", requireRoleAtLeast("ADMIN"), uploadStoreLogoHandler);
settingsRouter.delete("/store-info/logo", requireRoleAtLeast("ADMIN"), removeStoreLogoHandler);
