import { Router } from "express";
import {
  attachCustomerToSaleHandler,
  completeSaleHandler,
  createSaleReturnHandler,
  getSaleHandler,
  listSalesHandler,
} from "../controllers/salesController";
import { requireRoleAtLeast } from "../middleware/staffRole";
import { getSaleReceiptHandler } from "../controllers/receiptController";

export const salesRouter = Router();

salesRouter.get("/", requireRoleAtLeast("STAFF"), listSalesHandler);
salesRouter.post("/:saleId/returns", requireRoleAtLeast("MANAGER"), createSaleReturnHandler);
salesRouter.patch("/:saleId/customer", requireRoleAtLeast("STAFF"), attachCustomerToSaleHandler);
salesRouter.post("/:saleId/complete", requireRoleAtLeast("STAFF"), completeSaleHandler);
salesRouter.get("/:saleId/receipt", requireRoleAtLeast("STAFF"), getSaleReceiptHandler);
salesRouter.get("/:id", requireRoleAtLeast("STAFF"), getSaleHandler);
