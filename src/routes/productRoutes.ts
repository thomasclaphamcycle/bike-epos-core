import { Router } from "express";
import {
  createProductHandler,
  getProductHandler,
  listProductsHandler,
  patchProductHandler,
} from "../controllers/productController";

export const productRouter = Router();

productRouter.get("/", listProductsHandler);
productRouter.post("/", createProductHandler);
productRouter.get("/:id", getProductHandler);
productRouter.patch("/:id", patchProductHandler);
