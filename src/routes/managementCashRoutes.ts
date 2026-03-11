import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import {
  closeRegisterHandler,
  createCashMovementReceiptTokenHandler,
  createManagementCashMovementHandler,
  getCurrentRegisterHandler,
  getRegisterHistoryHandler,
  listManagementCashMovementsHandler,
  openRegisterHandler,
} from "../controllers/managementCashController";

export const managementCashRouter = Router();

managementCashRouter.post("/register/open", requireRoleAtLeast("MANAGER"), openRegisterHandler);
managementCashRouter.post("/register/close", requireRoleAtLeast("MANAGER"), closeRegisterHandler);
managementCashRouter.get("/register/current", requireRoleAtLeast("MANAGER"), getCurrentRegisterHandler);
managementCashRouter.get("/register/history", requireRoleAtLeast("MANAGER"), getRegisterHistoryHandler);
managementCashRouter.post("/movements", requireRoleAtLeast("MANAGER"), createManagementCashMovementHandler);
managementCashRouter.get("/movements", requireRoleAtLeast("MANAGER"), listManagementCashMovementsHandler);
managementCashRouter.post(
  "/movements/:id/receipt-token",
  requireRoleAtLeast("MANAGER"),
  createCashMovementReceiptTokenHandler,
);
