import { Router } from "express";
import {
  createProductHandler,
  getProductByBarcodeHandler,
  getProductHandler,
  listProductsHandler,
  patchProductHandler,
  searchProductsHandler,
} from "../controllers/productController";
import { createVariantForProductHandler } from "../controllers/variantController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const productRouter = Router();

productRouter.get("/", requireRoleAtLeast("STAFF"), listProductsHandler);
productRouter.get("/search", requireRoleAtLeast("STAFF"), searchProductsHandler);
productRouter.get("/barcode/:code", requireRoleAtLeast("STAFF"), getProductByBarcodeHandler);
productRouter.post("/", requireRoleAtLeast("MANAGER"), createProductHandler);
productRouter.get("/:id", requireRoleAtLeast("STAFF"), getProductHandler);
productRouter.patch("/:id", requireRoleAtLeast("MANAGER"), patchProductHandler);
productRouter.post(
  "/:productId/variants",
  requireRoleAtLeast("MANAGER"),
  createVariantForProductHandler,
);
