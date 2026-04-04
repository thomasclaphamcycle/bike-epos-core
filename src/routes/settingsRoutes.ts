import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import {
  createRegisteredPrinterHandler,
  listRegisteredPrintersHandler,
  listSettingsHandler,
  listStoreInfoHandler,
  removeStoreLogoHandler,
  setDefaultShippingLabelPrinterHandler,
  uploadStoreLogoHandler,
  updateRegisteredPrinterHandler,
  updateSettingsHandler,
  updateStoreInfoHandler,
} from "../controllers/settingsController";

export const settingsRouter = Router();

settingsRouter.get("/", requireRoleAtLeast("MANAGER"), listSettingsHandler);
settingsRouter.patch("/", requireRoleAtLeast("MANAGER"), updateSettingsHandler);
settingsRouter.get("/printers", requireRoleAtLeast("MANAGER"), listRegisteredPrintersHandler);
settingsRouter.post("/printers", requireRoleAtLeast("ADMIN"), createRegisteredPrinterHandler);
settingsRouter.patch("/printers/:printerId", requireRoleAtLeast("ADMIN"), updateRegisteredPrinterHandler);
settingsRouter.put("/printers/default-shipping-label", requireRoleAtLeast("ADMIN"), setDefaultShippingLabelPrinterHandler);
settingsRouter.get("/store-info", requireRoleAtLeast("ADMIN"), listStoreInfoHandler);
settingsRouter.patch("/store-info", requireRoleAtLeast("ADMIN"), updateStoreInfoHandler);
settingsRouter.post("/store-info/logo", requireRoleAtLeast("ADMIN"), uploadStoreLogoHandler);
settingsRouter.delete("/store-info/logo", requireRoleAtLeast("ADMIN"), removeStoreLogoHandler);
