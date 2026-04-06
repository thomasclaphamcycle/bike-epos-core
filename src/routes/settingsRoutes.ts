import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import {
  createRegisteredPrinterHandler,
  listProductLabelPrintAgentSettingsHandler,
  listRegisteredPrintersHandler,
  listShippingPrintAgentSettingsHandler,
  listShippingProvidersHandler,
  listSettingsHandler,
  listStoreInfoHandler,
  removeStoreLogoHandler,
  setDefaultProductLabelPrinterHandler,
  setDefaultShippingProviderHandler,
  setDefaultShippingLabelPrinterHandler,
  uploadStoreLogoHandler,
  updateProductLabelPrintAgentSettingsHandler,
  updateRegisteredPrinterHandler,
  updateShippingPrintAgentSettingsHandler,
  updateShippingProviderSettingsHandler,
  updateSettingsHandler,
  updateStoreInfoHandler,
} from "../controllers/settingsController";

export const settingsRouter = Router();

settingsRouter.get("/", requireRoleAtLeast("MANAGER"), listSettingsHandler);
settingsRouter.patch("/", requireRoleAtLeast("MANAGER"), updateSettingsHandler);
settingsRouter.get("/shipping-providers", requireRoleAtLeast("MANAGER"), listShippingProvidersHandler);
settingsRouter.put("/shipping-providers/default", requireRoleAtLeast("ADMIN"), setDefaultShippingProviderHandler);
settingsRouter.put("/shipping-providers/:providerKey", requireRoleAtLeast("ADMIN"), updateShippingProviderSettingsHandler);
settingsRouter.get("/shipping-print-agent", requireRoleAtLeast("MANAGER"), listShippingPrintAgentSettingsHandler);
settingsRouter.put("/shipping-print-agent", requireRoleAtLeast("ADMIN"), updateShippingPrintAgentSettingsHandler);
settingsRouter.get("/product-label-print-agent", requireRoleAtLeast("MANAGER"), listProductLabelPrintAgentSettingsHandler);
settingsRouter.put("/product-label-print-agent", requireRoleAtLeast("ADMIN"), updateProductLabelPrintAgentSettingsHandler);
settingsRouter.get("/printers", requireRoleAtLeast("MANAGER"), listRegisteredPrintersHandler);
settingsRouter.post("/printers", requireRoleAtLeast("ADMIN"), createRegisteredPrinterHandler);
settingsRouter.patch("/printers/:printerId", requireRoleAtLeast("ADMIN"), updateRegisteredPrinterHandler);
settingsRouter.put("/printers/default-product-label", requireRoleAtLeast("ADMIN"), setDefaultProductLabelPrinterHandler);
settingsRouter.put("/printers/default-shipping-label", requireRoleAtLeast("ADMIN"), setDefaultShippingLabelPrinterHandler);
settingsRouter.get("/store-info", requireRoleAtLeast("ADMIN"), listStoreInfoHandler);
settingsRouter.patch("/store-info", requireRoleAtLeast("ADMIN"), updateStoreInfoHandler);
settingsRouter.post("/store-info/logo", requireRoleAtLeast("ADMIN"), uploadStoreLogoHandler);
settingsRouter.delete("/store-info/logo", requireRoleAtLeast("ADMIN"), removeStoreLogoHandler);
