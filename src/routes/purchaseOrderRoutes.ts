import { Router } from "express";
import {
  addPurchaseOrderItemsHandler,
  cancelPurchaseOrderHandler,
  createPurchaseOrderHandler,
  deletePurchaseOrderLineHandler,
  getPurchaseOrderHandler,
  listPurchaseOrderReceiptsHandler,
  listPurchaseOrdersHandler,
  patchPurchaseOrderHandler,
  patchPurchaseOrderItemHandler,
  receivePurchaseOrderHandler,
  submitPurchaseOrderHandler,
  upsertPurchaseOrderLineHandler,
} from "../controllers/purchaseOrderController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const purchaseOrderRouter = Router();

purchaseOrderRouter.get("/", requireRoleAtLeast("STAFF"), listPurchaseOrdersHandler);
purchaseOrderRouter.post("/", requireRoleAtLeast("MANAGER"), createPurchaseOrderHandler);
purchaseOrderRouter.get("/:id", requireRoleAtLeast("STAFF"), getPurchaseOrderHandler);
purchaseOrderRouter.get("/:id/receipts", requireRoleAtLeast("MANAGER"), listPurchaseOrderReceiptsHandler);
purchaseOrderRouter.patch("/:id", requireRoleAtLeast("MANAGER"), patchPurchaseOrderHandler);
purchaseOrderRouter.post("/:id/items", requireRoleAtLeast("MANAGER"), addPurchaseOrderItemsHandler);
purchaseOrderRouter.post("/:id/lines", requireRoleAtLeast("MANAGER"), upsertPurchaseOrderLineHandler);
purchaseOrderRouter.patch(
  "/:id/lines/:lineId",
  requireRoleAtLeast("MANAGER"),
  patchPurchaseOrderItemHandler,
);
purchaseOrderRouter.delete(
  "/:id/lines/:lineId",
  requireRoleAtLeast("MANAGER"),
  deletePurchaseOrderLineHandler,
);
purchaseOrderRouter.post("/:id/submit", requireRoleAtLeast("MANAGER"), submitPurchaseOrderHandler);
purchaseOrderRouter.post("/:id/cancel", requireRoleAtLeast("MANAGER"), cancelPurchaseOrderHandler);
purchaseOrderRouter.post("/:id/receive", requireRoleAtLeast("MANAGER"), receivePurchaseOrderHandler);
