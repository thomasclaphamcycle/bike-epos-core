import { Router } from "express";
import {
  addPurchaseOrderItemsHandler,
  createPurchaseOrderHandler,
  getPurchaseOrderHandler,
  listPurchaseOrdersHandler,
  patchPurchaseOrderHandler,
  patchPurchaseOrderItemHandler,
  receivePurchaseOrderHandler,
} from "../controllers/purchaseOrderController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const purchaseOrderRouter = Router();

purchaseOrderRouter.get("/", requireRoleAtLeast("STAFF"), listPurchaseOrdersHandler);
purchaseOrderRouter.post("/", requireRoleAtLeast("MANAGER"), createPurchaseOrderHandler);
purchaseOrderRouter.get("/:id", requireRoleAtLeast("STAFF"), getPurchaseOrderHandler);
purchaseOrderRouter.patch("/:id", requireRoleAtLeast("MANAGER"), patchPurchaseOrderHandler);
purchaseOrderRouter.post("/:id/items", requireRoleAtLeast("MANAGER"), addPurchaseOrderItemsHandler);
purchaseOrderRouter.patch(
  "/:id/lines/:lineId",
  requireRoleAtLeast("MANAGER"),
  patchPurchaseOrderItemHandler,
);
purchaseOrderRouter.post("/:id/receive", requireRoleAtLeast("MANAGER"), receivePurchaseOrderHandler);
