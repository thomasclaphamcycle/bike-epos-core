import { Router } from "express";
import {
  createInventoryMovementHandler,
  getInventoryOnHandHandler,
  listInventoryOnHandHandler,
  listInventoryMovementsHandler,
} from "../controllers/inventoryLedgerController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const inventoryLedgerRouter = Router();

inventoryLedgerRouter.post("/movements", requireRoleAtLeast("MANAGER"), createInventoryMovementHandler);
inventoryLedgerRouter.get("/movements", requireRoleAtLeast("MANAGER"), listInventoryMovementsHandler);
inventoryLedgerRouter.get("/on-hand/search", requireRoleAtLeast("STAFF"), listInventoryOnHandHandler);
inventoryLedgerRouter.get("/on-hand", requireRoleAtLeast("STAFF"), getInventoryOnHandHandler);
