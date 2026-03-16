import { Router } from "express";
import {
  activeUsersHandler,
  bootstrapHandler,
  changePinHandler,
  loginHandler,
  logoutHandler,
  meHandler,
  pinLoginHandler,
  pinStatusHandler,
  setPinHandler,
} from "../controllers/authController";
import { requireAuth } from "../middleware/staffRole";
import { pinLoginRateLimit } from "../middleware/pinLoginRateLimit";

export const authRouter = Router();

authRouter.post("/login", loginHandler);
authRouter.post("/pin-login", pinLoginRateLimit, pinLoginHandler);
authRouter.post("/logout", logoutHandler);
authRouter.get("/active-users", activeUsersHandler);
authRouter.get("/me", requireAuth, meHandler);
authRouter.get("/pin-status", requireAuth, pinStatusHandler);
authRouter.post("/pin", requireAuth, setPinHandler);
authRouter.patch("/pin", requireAuth, changePinHandler);
authRouter.post("/bootstrap", bootstrapHandler);
