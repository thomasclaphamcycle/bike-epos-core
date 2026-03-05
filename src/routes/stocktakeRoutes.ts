import { Router } from "express";
import {
  cancelStocktakeHandler,
  createStocktakeHandler,
  deleteStocktakeLineHandler,
  finalizeStocktakeHandler,
  getStocktakeHandler,
  listStocktakesHandler,
  postStocktakeHandler,
  upsertStocktakeLineHandler,
} from "../controllers/stocktakeController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const stocktakeRouter = Router();

stocktakeRouter.get("/", requireRoleAtLeast("STAFF"), listStocktakesHandler);
stocktakeRouter.post("/", requireRoleAtLeast("MANAGER"), createStocktakeHandler);
stocktakeRouter.get("/:id", requireRoleAtLeast("STAFF"), getStocktakeHandler);
stocktakeRouter.post("/:id/lines", requireRoleAtLeast("MANAGER"), upsertStocktakeLineHandler);
stocktakeRouter.delete("/:id/lines/:lineId", requireRoleAtLeast("MANAGER"), deleteStocktakeLineHandler);
stocktakeRouter.post("/:id/post", requireRoleAtLeast("MANAGER"), postStocktakeHandler);
stocktakeRouter.post("/:id/finalize", requireRoleAtLeast("MANAGER"), finalizeStocktakeHandler);
stocktakeRouter.post("/:id/cancel", requireRoleAtLeast("MANAGER"), cancelStocktakeHandler);
