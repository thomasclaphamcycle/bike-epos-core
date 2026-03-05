import { Router } from "express";
import { getReceiptPageHandler } from "../controllers/receiptUiController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const receiptUiRouter = Router();

receiptUiRouter.get("/sales/:saleId/receipt", requireRoleAtLeast("STAFF"), getReceiptPageHandler);
