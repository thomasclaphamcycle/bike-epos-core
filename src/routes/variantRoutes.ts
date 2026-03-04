import { Router } from "express";
import {
  createVariantHandler,
  getVariantHandler,
  listVariantsHandler,
  patchVariantHandler,
} from "../controllers/variantController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const variantRouter = Router();

variantRouter.get("/", requireRoleAtLeast("STAFF"), listVariantsHandler);
variantRouter.post("/", requireRoleAtLeast("MANAGER"), createVariantHandler);
variantRouter.get("/:id", requireRoleAtLeast("STAFF"), getVariantHandler);
variantRouter.patch("/:id", requireRoleAtLeast("MANAGER"), patchVariantHandler);
