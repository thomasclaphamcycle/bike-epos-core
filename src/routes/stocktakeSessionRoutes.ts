import { Router } from "express";
import {
  cancelStocktakeHandler,
  createStocktakeHandler,
  deleteStocktakeLineHandler,
  finalizeStocktakeHandler,
  getStocktakeHandler,
  listStocktakesHandler,
  requestStocktakeReviewHandler,
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
stocktakeSessionRouter.delete(
  "/sessions/:id/lines/:lineId",
  requireRoleAtLeast("MANAGER"),
  deleteStocktakeLineHandler,
);
stocktakeSessionRouter.post(
  "/sessions/:id/review",
  requireRoleAtLeast("MANAGER"),
  requestStocktakeReviewHandler,
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
