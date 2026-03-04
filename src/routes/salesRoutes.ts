import { Router } from "express";
import {
  attachCustomerToSaleHandler,
  createSaleReturnHandler,
  getSaleHandler,
  listSalesHandler,
} from "../controllers/salesController";

export const salesRouter = Router();

salesRouter.get("/", listSalesHandler);
salesRouter.post("/:saleId/returns", createSaleReturnHandler);
salesRouter.patch("/:saleId/customer", attachCustomerToSaleHandler);
salesRouter.get("/:id", getSaleHandler);
