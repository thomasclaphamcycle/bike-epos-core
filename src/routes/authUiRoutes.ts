import { Router } from "express";
import {
  getLoginPageHandler,
  getNotAuthorizedPageHandler,
} from "../controllers/authUiController";
import { requireAuth } from "../middleware/staffRole";

export const authUiRouter = Router();

authUiRouter.get("/login", getLoginPageHandler);
authUiRouter.get("/not-authorized", requireAuth, getNotAuthorizedPageHandler);
