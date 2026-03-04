import { Router } from "express";
import {
  createProductHandler,
  getProductHandler,
  listProductsHandler,
  patchProductHandler,
} from "../controllers/productController";
import { createVariantForProductHandler } from "../controllers/variantController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const productRouter = Router();

productRouter.get("/", requireRoleAtLeast("STAFF"), listProductsHandler);
productRouter.post("/", requireRoleAtLeast("MANAGER"), createProductHandler);
productRouter.get("/:id", requireRoleAtLeast("STAFF"), getProductHandler);
productRouter.patch("/:id", requireRoleAtLeast("MANAGER"), patchProductHandler);
productRouter.post(
  "/:productId/variants",
  requireRoleAtLeast("MANAGER"),
  createVariantForProductHandler,
);
