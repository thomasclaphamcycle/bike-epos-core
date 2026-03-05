import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import {
  adminCreateUserHandler,
  adminListUsersHandler,
  adminResetUserPasswordHandler,
  adminUpdateUserHandler,
} from "../controllers/adminUserController";
import {
  getAdminInventoryExportHandler,
  getAdminSalesExportHandler,
  getAdminWorkshopExportHandler,
} from "../controllers/adminExportController";

export const adminRouter = Router();

adminRouter.post("/users", requireRoleAtLeast("ADMIN"), adminCreateUserHandler);
adminRouter.get("/users", requireRoleAtLeast("ADMIN"), adminListUsersHandler);
adminRouter.patch("/users/:id", requireRoleAtLeast("ADMIN"), adminUpdateUserHandler);
adminRouter.post(
  "/users/:id/reset-password",
  requireRoleAtLeast("ADMIN"),
  adminResetUserPasswordHandler,
);

adminRouter.get("/export/sales", requireRoleAtLeast("ADMIN"), getAdminSalesExportHandler);
adminRouter.get("/export/workshop", requireRoleAtLeast("ADMIN"), getAdminWorkshopExportHandler);
adminRouter.get("/export/inventory", requireRoleAtLeast("ADMIN"), getAdminInventoryExportHandler);
