import { Router } from "express";
import {
  addBasketItemHandler,
  attachCustomerToBasketHandler,
  checkoutBasketHandler,
  createBasketHandler,
  deleteBasketItemHandler,
  getBasketHandler,
  updateBasketItemHandler,
} from "../controllers/basketController";
import { requireRoleAtLeast } from "../middleware/staffRole";
import { basketCustomerCaptureRouter } from "./basketCustomerCaptureRoutes";

export const basketRouter = Router();

basketRouter.post("/", requireRoleAtLeast("STAFF"), createBasketHandler);
basketRouter.get("/:id", requireRoleAtLeast("STAFF"), getBasketHandler);
basketRouter.patch("/:id/customer", requireRoleAtLeast("STAFF"), attachCustomerToBasketHandler);
basketRouter.use("/:basketId/customer-capture-sessions", basketCustomerCaptureRouter);
basketRouter.post("/:id/items", requireRoleAtLeast("STAFF"), addBasketItemHandler);
basketRouter.patch("/:id/items/:itemId", requireRoleAtLeast("STAFF"), updateBasketItemHandler);
basketRouter.delete("/:id/items/:itemId", requireRoleAtLeast("STAFF"), deleteBasketItemHandler);

// M28 contract aliases while preserving existing /items endpoints.
basketRouter.post("/:id/lines", requireRoleAtLeast("STAFF"), addBasketItemHandler);
basketRouter.patch("/:id/lines/:itemId", requireRoleAtLeast("STAFF"), updateBasketItemHandler);
basketRouter.delete("/:id/lines/:itemId", requireRoleAtLeast("STAFF"), deleteBasketItemHandler);

basketRouter.post("/:id/checkout", requireRoleAtLeast("STAFF"), checkoutBasketHandler);
