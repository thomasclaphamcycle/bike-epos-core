import { Router } from "express";
import {
  addPurchaseOrderItemsHandler,
  createPurchaseOrderHandler,
  getPurchaseOrderHandler,
  receivePurchaseOrderHandler,
} from "../controllers/purchaseOrderController";

export const purchaseOrderRouter = Router();

purchaseOrderRouter.post("/", createPurchaseOrderHandler);
purchaseOrderRouter.get("/:id", getPurchaseOrderHandler);
purchaseOrderRouter.post("/:id/items", addPurchaseOrderItemsHandler);
purchaseOrderRouter.post("/:id/receive", receivePurchaseOrderHandler);
