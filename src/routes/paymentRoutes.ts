import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import { getPaymentHandler, refundPaymentHandler } from "../controllers/paymentController";

export const paymentRouter = Router();

paymentRouter.get("/:id", getPaymentHandler);
paymentRouter.post("/:id/refund", requireRoleAtLeast("MANAGER"), refundPaymentHandler);
