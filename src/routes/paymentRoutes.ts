import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import {
  cancelPaymentIntentHandler,
  capturePaymentIntentHandler,
  createPaymentIntentHandler,
  getPaymentHandler,
  listPaymentIntentsHandler,
  refundPaymentHandler,
} from "../controllers/paymentController";

export const paymentRouter = Router();

paymentRouter.post("/intents", requireRoleAtLeast("STAFF"), createPaymentIntentHandler);
paymentRouter.post("/intents/:id/capture", requireRoleAtLeast("STAFF"), capturePaymentIntentHandler);
paymentRouter.post("/intents/:id/cancel", requireRoleAtLeast("STAFF"), cancelPaymentIntentHandler);
paymentRouter.get("/intents", requireRoleAtLeast("MANAGER"), listPaymentIntentsHandler);

paymentRouter.get("/:id", getPaymentHandler);
paymentRouter.post("/:id/refund", requireRoleAtLeast("MANAGER"), refundPaymentHandler);
