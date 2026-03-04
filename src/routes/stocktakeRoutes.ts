import { Router } from "express";
import {
  cancelStocktakeHandler,
  createStocktakeHandler,
  deleteStocktakeLineHandler,
  getStocktakeHandler,
  postStocktakeHandler,
  upsertStocktakeLineHandler,
} from "../controllers/stocktakeController";

export const stocktakeRouter = Router();

stocktakeRouter.post("/", createStocktakeHandler);
stocktakeRouter.get("/:id", getStocktakeHandler);
stocktakeRouter.post("/:id/lines", upsertStocktakeLineHandler);
stocktakeRouter.delete("/:id/lines/:lineId", deleteStocktakeLineHandler);
stocktakeRouter.post("/:id/post", postStocktakeHandler);
stocktakeRouter.post("/:id/cancel", cancelStocktakeHandler);
