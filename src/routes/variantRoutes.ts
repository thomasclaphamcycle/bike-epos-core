import { Router } from "express";
import {
  createVariantHandler,
  getVariantBikeTagDocumentHandler,
  getVariantHandler,
  getVariantProductLabelDocumentHandler,
  listVariantsHandler,
  printVariantBikeTagDirectHandler,
  printVariantProductLabelDirectHandler,
  patchVariantHandler,
} from "../controllers/variantController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const variantRouter = Router();

variantRouter.get("/", requireRoleAtLeast("STAFF"), listVariantsHandler);
variantRouter.post("/", requireRoleAtLeast("MANAGER"), createVariantHandler);
variantRouter.get("/:id", requireRoleAtLeast("STAFF"), getVariantHandler);
variantRouter.get("/:id/bike-tag/document", requireRoleAtLeast("STAFF"), getVariantBikeTagDocumentHandler);
variantRouter.post("/:id/bike-tag/print", requireRoleAtLeast("STAFF"), printVariantBikeTagDirectHandler);
variantRouter.get("/:id/product-label/document", requireRoleAtLeast("STAFF"), getVariantProductLabelDocumentHandler);
variantRouter.post("/:id/product-label/print", requireRoleAtLeast("STAFF"), printVariantProductLabelDirectHandler);
variantRouter.patch("/:id", requireRoleAtLeast("MANAGER"), patchVariantHandler);
