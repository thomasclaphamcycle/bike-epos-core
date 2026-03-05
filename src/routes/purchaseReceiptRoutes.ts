import { Router } from "express";
import { getPurchaseReceiptHandler } from "../controllers/purchaseReceiptController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const purchaseReceiptRouter = Router();

purchaseReceiptRouter.get("/:id", requireRoleAtLeast("MANAGER"), getPurchaseReceiptHandler);
