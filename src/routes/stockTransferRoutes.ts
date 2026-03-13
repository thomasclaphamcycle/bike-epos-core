import { Router } from "express";
import {
  cancelStockTransferHandler,
  createStockTransferHandler,
  getStockTransferHandler,
  listStockTransfersHandler,
  receiveStockTransferHandler,
  sendStockTransferHandler,
} from "../controllers/stockTransferController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const stockTransferRouter = Router();

stockTransferRouter.get("/", requireRoleAtLeast("MANAGER"), listStockTransfersHandler);
stockTransferRouter.post("/", requireRoleAtLeast("MANAGER"), createStockTransferHandler);
stockTransferRouter.get("/:id", requireRoleAtLeast("MANAGER"), getStockTransferHandler);
stockTransferRouter.post("/:id/send", requireRoleAtLeast("MANAGER"), sendStockTransferHandler);
stockTransferRouter.post("/:id/receive", requireRoleAtLeast("MANAGER"), receiveStockTransferHandler);
stockTransferRouter.post("/:id/cancel", requireRoleAtLeast("MANAGER"), cancelStockTransferHandler);
