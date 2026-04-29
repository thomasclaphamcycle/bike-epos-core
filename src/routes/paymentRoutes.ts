import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import {
  cancelCardTerminalSessionHandler,
  createCardTerminalSaleSessionHandler,
  getCardTerminalConfigHandler,
  listCardTerminalsHandler,
  refreshCardTerminalSessionHandler,
  respondToCardTerminalSignatureHandler,
} from "../controllers/cardTerminalController";
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
paymentRouter.get("/terminal-config", requireRoleAtLeast("STAFF"), getCardTerminalConfigHandler);
paymentRouter.get("/terminals", requireRoleAtLeast("STAFF"), listCardTerminalsHandler);
paymentRouter.post("/terminal-sessions", requireRoleAtLeast("STAFF"), createCardTerminalSaleSessionHandler);
paymentRouter.get("/terminal-sessions/:id", requireRoleAtLeast("STAFF"), refreshCardTerminalSessionHandler);
paymentRouter.post("/terminal-sessions/:id/cancel", requireRoleAtLeast("STAFF"), cancelCardTerminalSessionHandler);
paymentRouter.post(
  "/terminal-sessions/:id/signature",
  requireRoleAtLeast("STAFF"),
  respondToCardTerminalSignatureHandler,
);

paymentRouter.get("/:id", requireRoleAtLeast("MANAGER"), getPaymentHandler);
paymentRouter.post("/:id/refund", requireRoleAtLeast("MANAGER"), refundPaymentHandler);
