import { Router } from "express";
import {
  addBasketItemHandler,
  checkoutBasketHandler,
  createBasketHandler,
  deleteBasketItemHandler,
  getBasketHandler,
  updateBasketItemHandler,
} from "../controllers/basketController";

export const basketRouter = Router();

basketRouter.post("/", createBasketHandler);
basketRouter.get("/:id", getBasketHandler);
basketRouter.post("/:id/items", addBasketItemHandler);
basketRouter.patch("/:id/items/:itemId", updateBasketItemHandler);
basketRouter.delete("/:id/items/:itemId", deleteBasketItemHandler);
basketRouter.post("/:id/checkout", checkoutBasketHandler);
