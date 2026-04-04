import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import {
  bulkCreateShipmentLabelsHandler,
  bulkDispatchShipmentsHandler,
  bulkPrintShipmentLabelsHandler,
  cancelShipmentHandler,
  createOnlineStoreOrderHandler,
  createShipmentLabelHandler,
  dispatchShipmentHandler,
  getOnlineStoreOrderDetailHandler,
  getOnlineStoreOrderShipmentHandler,
  getShipmentLabelContentHandler,
  getShipmentLabelPayloadHandler,
  listOnlineStoreOrdersHandler,
  prepareShipmentLabelPrintHandler,
  printShipmentLabelViaAgentHandler,
  refreshShipmentProviderStateHandler,
  regenerateShipmentLabelHandler,
  recordShipmentPrintedHandler,
  setOnlineStoreOrderPackedStateHandler,
} from "../controllers/onlineStoreController";

export const onlineStoreRouter = Router();

onlineStoreRouter.get("/orders", requireRoleAtLeast("MANAGER"), listOnlineStoreOrdersHandler);
onlineStoreRouter.post("/orders", requireRoleAtLeast("MANAGER"), createOnlineStoreOrderHandler);
onlineStoreRouter.post("/orders/bulk/shipments", requireRoleAtLeast("MANAGER"), bulkCreateShipmentLabelsHandler);
onlineStoreRouter.post("/orders/bulk/print", requireRoleAtLeast("MANAGER"), bulkPrintShipmentLabelsHandler);
onlineStoreRouter.post("/orders/bulk/dispatch", requireRoleAtLeast("MANAGER"), bulkDispatchShipmentsHandler);
onlineStoreRouter.get("/orders/:id", requireRoleAtLeast("MANAGER"), getOnlineStoreOrderDetailHandler);
onlineStoreRouter.get("/orders/:id/shipment", requireRoleAtLeast("MANAGER"), getOnlineStoreOrderShipmentHandler);
onlineStoreRouter.post("/orders/:id/packing", requireRoleAtLeast("MANAGER"), setOnlineStoreOrderPackedStateHandler);
onlineStoreRouter.post("/orders/:id/shipments", requireRoleAtLeast("MANAGER"), createShipmentLabelHandler);
onlineStoreRouter.get("/shipments/:shipmentId/label", requireRoleAtLeast("MANAGER"), getShipmentLabelPayloadHandler);
onlineStoreRouter.get("/shipments/:shipmentId/label/content", requireRoleAtLeast("MANAGER"), getShipmentLabelContentHandler);
onlineStoreRouter.post("/shipments/:shipmentId/refresh", requireRoleAtLeast("MANAGER"), refreshShipmentProviderStateHandler);
onlineStoreRouter.post("/shipments/:shipmentId/cancel", requireRoleAtLeast("MANAGER"), cancelShipmentHandler);
onlineStoreRouter.post("/shipments/:shipmentId/regenerate", requireRoleAtLeast("MANAGER"), regenerateShipmentLabelHandler);
onlineStoreRouter.post("/shipments/:shipmentId/prepare-print", requireRoleAtLeast("MANAGER"), prepareShipmentLabelPrintHandler);
onlineStoreRouter.post("/shipments/:shipmentId/print", requireRoleAtLeast("MANAGER"), printShipmentLabelViaAgentHandler);
onlineStoreRouter.post("/shipments/:shipmentId/record-printed", requireRoleAtLeast("MANAGER"), recordShipmentPrintedHandler);
onlineStoreRouter.post("/shipments/:shipmentId/dispatch", requireRoleAtLeast("MANAGER"), dispatchShipmentHandler);
