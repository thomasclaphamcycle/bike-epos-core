import { Router } from "express";
import {
  createVariantHandler,
  getVariantHandler,
  listVariantsHandler,
  patchVariantHandler,
} from "../controllers/variantController";

export const variantRouter = Router();

variantRouter.get("/", listVariantsHandler);
variantRouter.post("/", createVariantHandler);
variantRouter.get("/:id", getVariantHandler);
variantRouter.patch("/:id", patchVariantHandler);
