import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import {
  getReceiptByNumberHandler,
  issueReceiptHandler,
} from "../controllers/receiptController";

export const receiptRouter = Router();

receiptRouter.post("/issue", requireRoleAtLeast("STAFF"), issueReceiptHandler);
receiptRouter.get("/:receiptNumber", requireRoleAtLeast("STAFF"), getReceiptByNumberHandler);
