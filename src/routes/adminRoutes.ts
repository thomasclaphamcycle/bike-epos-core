import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import {
  adminCreateUserHandler,
  adminListUsersHandler,
  adminResetUserPinHandler,
  adminResetUserPasswordHandler,
  adminSetUserPinHandler,
  adminUpdateUserHandler,
} from "../controllers/adminUserController";

export const adminRouter = Router();

adminRouter.post("/users", requireRoleAtLeast("ADMIN"), adminCreateUserHandler);
adminRouter.get("/users", requireRoleAtLeast("ADMIN"), adminListUsersHandler);
adminRouter.patch("/users/:id", requireRoleAtLeast("ADMIN"), adminUpdateUserHandler);
adminRouter.post(
  "/users/:id/reset-password",
  requireRoleAtLeast("ADMIN"),
  adminResetUserPasswordHandler,
);
adminRouter.post(
  "/users/:id/reset-pin",
  requireRoleAtLeast("MANAGER"),
  adminResetUserPinHandler,
);
adminRouter.post(
  "/users/:id/set-pin",
  requireRoleAtLeast("MANAGER"),
  adminSetUserPinHandler,
);
