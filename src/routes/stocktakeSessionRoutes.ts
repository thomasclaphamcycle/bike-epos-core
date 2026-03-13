import { Router } from "express";
import {
  bulkUpsertStocktakeLinesHandler,
  cancelStocktakeHandler,
  createStocktakeHandler,
  deleteStocktakeLineHandler,
  finalizeStocktakeHandler,
  getStocktakeHandler,
  listStocktakesHandler,
  requestStocktakeReviewHandler,
  scanStocktakeLineHandler,
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
  "/sessions/:id/scan",
  requireRoleAtLeast("MANAGER"),
  scanStocktakeLineHandler,
);
stocktakeSessionRouter.post(
  "/sessions/:id/bulk-lines",
  requireRoleAtLeast("MANAGER"),
  bulkUpsertStocktakeLinesHandler,
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
