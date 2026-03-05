import { Router } from "express";
import {
  addBasketItemHandler,
  checkoutBasketHandler,
  createBasketHandler,
  deleteBasketItemHandler,
  getBasketHandler,
  updateBasketItemHandler,
} from "../controllers/basketController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const basketRouter = Router();

basketRouter.post("/", requireRoleAtLeast("STAFF"), createBasketHandler);
basketRouter.get("/:id", requireRoleAtLeast("STAFF"), getBasketHandler);
basketRouter.post("/:id/items", requireRoleAtLeast("STAFF"), addBasketItemHandler);
basketRouter.patch("/:id/items/:itemId", requireRoleAtLeast("STAFF"), updateBasketItemHandler);
basketRouter.delete("/:id/items/:itemId", requireRoleAtLeast("STAFF"), deleteBasketItemHandler);

// M28 contract aliases while preserving existing /items endpoints.
basketRouter.post("/:id/lines", requireRoleAtLeast("STAFF"), addBasketItemHandler);
basketRouter.patch("/:id/lines/:itemId", requireRoleAtLeast("STAFF"), updateBasketItemHandler);
basketRouter.delete("/:id/lines/:itemId", requireRoleAtLeast("STAFF"), deleteBasketItemHandler);

basketRouter.post("/:id/checkout", requireRoleAtLeast("STAFF"), checkoutBasketHandler);
