import { Router } from "express";
import {
  bootstrapHandler,
  loginHandler,
  logoutHandler,
  meHandler,
} from "../controllers/authController";
import { requireAuth } from "../middleware/staffRole";

export const authRouter = Router();

authRouter.post("/login", loginHandler);
authRouter.post("/logout", logoutHandler);
authRouter.get("/me", requireAuth, meHandler);
authRouter.post("/bootstrap", bootstrapHandler);
