import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import {
  addRefundTenderHandler,
  completeRefundHandler,
  createRefundHandler,
  deleteRefundLineHandler,
  deleteRefundTenderHandler,
  getRefundHandler,
  listRefundsHandler,
  upsertRefundLineHandler,
} from "../controllers/refundController";

export const refundRouter = Router();

refundRouter.post("/", requireRoleAtLeast("MANAGER"), createRefundHandler);
refundRouter.get("/", requireRoleAtLeast("MANAGER"), listRefundsHandler);
refundRouter.get("/:refundId", requireRoleAtLeast("MANAGER"), getRefundHandler);
refundRouter.post("/:refundId/lines", requireRoleAtLeast("MANAGER"), upsertRefundLineHandler);
refundRouter.delete(
  "/:refundId/lines/:refundLineId",
  requireRoleAtLeast("MANAGER"),
  deleteRefundLineHandler,
);
refundRouter.post("/:refundId/tenders", requireRoleAtLeast("MANAGER"), addRefundTenderHandler);
refundRouter.delete(
  "/:refundId/tenders/:tenderId",
  requireRoleAtLeast("MANAGER"),
  deleteRefundTenderHandler,
);
refundRouter.post("/:refundId/complete", requireRoleAtLeast("MANAGER"), completeRefundHandler);
