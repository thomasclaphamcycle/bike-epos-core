import { Router } from "express";
import { requireRoleAtLeast } from "../middleware/staffRole";
import {
  adminCreateUserHandler,
  adminListUsersHandler,
  adminResetUserPasswordHandler,
  adminUpdateUserHandler,
} from "../controllers/adminUserController";
import {
  exportInventoryCsvHandler,
  exportSalesCsvHandler,
  exportWorkshopCsvHandler,
} from "../controllers/adminExportController";

export const adminRouter = Router();

adminRouter.post("/users", requireRoleAtLeast("ADMIN"), adminCreateUserHandler);
adminRouter.get("/users", requireRoleAtLeast("ADMIN"), adminListUsersHandler);
adminRouter.patch("/users/:id", requireRoleAtLeast("ADMIN"), adminUpdateUserHandler);
adminRouter.get("/export/sales", requireRoleAtLeast("ADMIN"), exportSalesCsvHandler);
adminRouter.get("/export/workshop", requireRoleAtLeast("ADMIN"), exportWorkshopCsvHandler);
adminRouter.get("/export/inventory", requireRoleAtLeast("ADMIN"), exportInventoryCsvHandler);
adminRouter.post(
  "/users/:id/reset-password",
  requireRoleAtLeast("ADMIN"),
  adminResetUserPasswordHandler,
);
