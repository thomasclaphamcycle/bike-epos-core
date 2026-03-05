import { Router } from "express";
import {
  getReceiptPageByNumberHandler,
  getReceiptPageBySaleIdHandler,
} from "../controllers/receiptUiController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const receiptUiRouter = Router();

receiptUiRouter.get(
  "/sales/:saleId/receipt",
  requireRoleAtLeast("STAFF"),
  getReceiptPageBySaleIdHandler,
);
receiptUiRouter.get("/r/:receiptNumber", requireRoleAtLeast("STAFF"), getReceiptPageByNumberHandler);
