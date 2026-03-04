import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import {
  applyCreditHandler,
  getCreditBalanceHandler,
  issueCreditHandler,
} from "../controllers/creditController";

export const creditRouter = Router();

creditRouter.get("/balance", getCreditBalanceHandler);
creditRouter.post("/issue", requireRoleAtLeast("MANAGER"), issueCreditHandler);
creditRouter.post("/apply", requireRoleAtLeast("MANAGER"), applyCreditHandler);
