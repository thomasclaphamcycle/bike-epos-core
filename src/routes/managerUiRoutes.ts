import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import {
  getManagerCashPageHandler,
  getManagerRefundsPageHandler,
} from "../controllers/managerUiController";

export const managerUiRouter = Router();

managerUiRouter.get("/manager/cash", requireRoleAtLeast("MANAGER"), getManagerCashPageHandler);
managerUiRouter.get(
  "/manager/refunds",
  requireRoleAtLeast("MANAGER"),
  getManagerRefundsPageHandler,
);
