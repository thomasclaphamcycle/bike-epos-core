import { Router } from "express";
import {
  createInventoryMovementHandler,
  getInventoryOnHandHandler,
  listInventoryMovementsHandler,
} from "../controllers/inventoryLedgerController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const inventoryLedgerRouter = Router();

inventoryLedgerRouter.post("/movements", createInventoryMovementHandler);
inventoryLedgerRouter.get("/movements", requireRoleAtLeast("MANAGER"), listInventoryMovementsHandler);
inventoryLedgerRouter.get("/on-hand", getInventoryOnHandHandler);

