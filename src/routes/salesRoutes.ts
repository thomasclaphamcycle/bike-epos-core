import { Router } from "express";
import {
  addSaleTenderHandler,
  attachCustomerToSaleHandler,
  completeSaleHandler,
  createSaleReturnHandler,
  deleteSaleTenderHandler,
  getSaleHandler,
  listSaleTendersHandler,
  listSalesHandler,
} from "../controllers/salesController";
import { requireRoleAtLeast } from "../middleware/staffRole";
import { getSaleReceiptHandler } from "../controllers/receiptController";
import { saleCustomerCaptureRouter } from "./saleCustomerCaptureRoutes";

export const salesRouter = Router();

salesRouter.get("/", requireRoleAtLeast("STAFF"), listSalesHandler);
salesRouter.post("/:saleId/returns", requireRoleAtLeast("MANAGER"), createSaleReturnHandler);
salesRouter.patch("/:saleId/customer", requireRoleAtLeast("STAFF"), attachCustomerToSaleHandler);
salesRouter.use("/:saleId/customer-capture-sessions", saleCustomerCaptureRouter);
salesRouter.get("/:saleId/tenders", requireRoleAtLeast("STAFF"), listSaleTendersHandler);
salesRouter.post("/:saleId/tenders", requireRoleAtLeast("STAFF"), addSaleTenderHandler);
salesRouter.delete(
  "/:saleId/tenders/:tenderId",
  requireRoleAtLeast("STAFF"),
  deleteSaleTenderHandler,
);
salesRouter.post("/:saleId/complete", requireRoleAtLeast("STAFF"), completeSaleHandler);
salesRouter.get("/:saleId/receipt", requireRoleAtLeast("STAFF"), getSaleReceiptHandler);
salesRouter.get("/:id", requireRoleAtLeast("STAFF"), getSaleHandler);
