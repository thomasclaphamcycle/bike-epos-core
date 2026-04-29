import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import {
  createVoucherProviderHandler,
  createRegisteredPrinterHandler,
  listBikeTagPrintAgentSettingsHandler,
  listProductLabelPrintAgentSettingsHandler,
  listReceiptPrintAgentSettingsHandler,
  listReceiptPrintStationsHandler,
  listRegisteredPrintersHandler,
  listShippingPrintAgentSettingsHandler,
  listShippingProvidersHandler,
  listSettingsHandler,
  listStoreInfoHandler,
  listVoucherProvidersHandler,
  removeStoreLogoHandler,
  setDefaultBikeTagPrinterHandler,
  setDefaultProductLabelPrinterHandler,
  setDefaultReceiptPrinterHandler,
  setDefaultShippingProviderHandler,
  setDefaultShippingLabelPrinterHandler,
  uploadStoreLogoHandler,
  updateBikeTagPrintAgentSettingsHandler,
  updateProductLabelPrintAgentSettingsHandler,
  updateReceiptPrintAgentSettingsHandler,
  updateReceiptPrintStationsHandler,
  updateRegisteredPrinterHandler,
  updateShippingPrintAgentSettingsHandler,
  updateShippingProviderSettingsHandler,
  updateSettingsHandler,
  updateStoreInfoHandler,
  updateVoucherProviderHandler,
} from "../controllers/settingsController";

export const settingsRouter = Router();

settingsRouter.get("/", requireRoleAtLeast("MANAGER"), listSettingsHandler);
settingsRouter.patch("/", requireRoleAtLeast("MANAGER"), updateSettingsHandler);
settingsRouter.get("/voucher-providers", requireRoleAtLeast("STAFF"), listVoucherProvidersHandler);
settingsRouter.post("/voucher-providers", requireRoleAtLeast("ADMIN"), createVoucherProviderHandler);
settingsRouter.patch("/voucher-providers/:providerId", requireRoleAtLeast("ADMIN"), updateVoucherProviderHandler);
settingsRouter.get("/shipping-providers", requireRoleAtLeast("MANAGER"), listShippingProvidersHandler);
settingsRouter.put("/shipping-providers/default", requireRoleAtLeast("ADMIN"), setDefaultShippingProviderHandler);
settingsRouter.put("/shipping-providers/:providerKey", requireRoleAtLeast("ADMIN"), updateShippingProviderSettingsHandler);
settingsRouter.get("/shipping-print-agent", requireRoleAtLeast("MANAGER"), listShippingPrintAgentSettingsHandler);
settingsRouter.put("/shipping-print-agent", requireRoleAtLeast("ADMIN"), updateShippingPrintAgentSettingsHandler);
settingsRouter.get("/bike-tag-print-agent", requireRoleAtLeast("MANAGER"), listBikeTagPrintAgentSettingsHandler);
settingsRouter.put("/bike-tag-print-agent", requireRoleAtLeast("ADMIN"), updateBikeTagPrintAgentSettingsHandler);
settingsRouter.get("/product-label-print-agent", requireRoleAtLeast("MANAGER"), listProductLabelPrintAgentSettingsHandler);
settingsRouter.put("/product-label-print-agent", requireRoleAtLeast("ADMIN"), updateProductLabelPrintAgentSettingsHandler);
settingsRouter.get("/receipt-print-agent", requireRoleAtLeast("MANAGER"), listReceiptPrintAgentSettingsHandler);
settingsRouter.put("/receipt-print-agent", requireRoleAtLeast("ADMIN"), updateReceiptPrintAgentSettingsHandler);
settingsRouter.get("/receipt-workstations", requireRoleAtLeast("MANAGER"), listReceiptPrintStationsHandler);
settingsRouter.put("/receipt-workstations", requireRoleAtLeast("ADMIN"), updateReceiptPrintStationsHandler);
settingsRouter.get("/printers", requireRoleAtLeast("MANAGER"), listRegisteredPrintersHandler);
settingsRouter.post("/printers", requireRoleAtLeast("ADMIN"), createRegisteredPrinterHandler);
settingsRouter.patch("/printers/:printerId", requireRoleAtLeast("ADMIN"), updateRegisteredPrinterHandler);
settingsRouter.put("/printers/default-bike-tag", requireRoleAtLeast("ADMIN"), setDefaultBikeTagPrinterHandler);
settingsRouter.put("/printers/default-product-label", requireRoleAtLeast("ADMIN"), setDefaultProductLabelPrinterHandler);
settingsRouter.put("/printers/default-receipt", requireRoleAtLeast("ADMIN"), setDefaultReceiptPrinterHandler);
settingsRouter.put("/printers/default-shipping-label", requireRoleAtLeast("ADMIN"), setDefaultShippingLabelPrinterHandler);
settingsRouter.get("/store-info", requireRoleAtLeast("ADMIN"), listStoreInfoHandler);
settingsRouter.patch("/store-info", requireRoleAtLeast("ADMIN"), updateStoreInfoHandler);
settingsRouter.post("/store-info/logo", requireRoleAtLeast("ADMIN"), uploadStoreLogoHandler);
settingsRouter.delete("/store-info/logo", requireRoleAtLeast("ADMIN"), removeStoreLogoHandler);
