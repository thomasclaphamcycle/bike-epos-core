import { Router } from "express";
import {
  cancelStocktakeHandler,
  createStocktakeHandler,
  finalizeStocktakeHandler,
  getStocktakeHandler,
  listStocktakesHandler,
  upsertStocktakeLineHandler,
} from "../controllers/stocktakeController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const stocktakeSessionRouter = Router();

stocktakeSessionRouter.get("/sessions", requireRoleAtLeast("STAFF"), listStocktakesHandler);
stocktakeSessionRouter.post("/sessions", requireRoleAtLeast("MANAGER"), createStocktakeHandler);
stocktakeSessionRouter.get("/sessions/:id", requireRoleAtLeast("STAFF"), getStocktakeHandler);
stocktakeSessionRouter.post(
  "/sessions/:id/lines",
  requireRoleAtLeast("MANAGER"),
  upsertStocktakeLineHandler,
);
stocktakeSessionRouter.post(
  "/sessions/:id/finalize",
  requireRoleAtLeast("MANAGER"),
  finalizeStocktakeHandler,
);
stocktakeSessionRouter.post(
  "/sessions/:id/cancel",
  requireRoleAtLeast("MANAGER"),
  cancelStocktakeHandler,
);
