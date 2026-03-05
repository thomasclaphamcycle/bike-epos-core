import { Router } from "express";
import {
  getReceiptShortLinkHandler,
  getReceiptPageBySaleIdHandler,
} from "../controllers/receiptUiController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const receiptUiRouter = Router();

receiptUiRouter.get(
  "/sales/:saleId/receipt",
  requireRoleAtLeast("STAFF"),
  getReceiptPageBySaleIdHandler,
);
receiptUiRouter.get("/r/:saleOrReceiptRef", requireRoleAtLeast("STAFF"), getReceiptShortLinkHandler);
