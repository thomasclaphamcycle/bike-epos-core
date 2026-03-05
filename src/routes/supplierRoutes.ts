import { Router } from "express";
import { createSupplierHandler, listSuppliersHandler } from "../controllers/supplierController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const supplierRouter = Router();

supplierRouter.post("/", requireRoleAtLeast("MANAGER"), createSupplierHandler);
supplierRouter.get("/", requireRoleAtLeast("STAFF"), listSuppliersHandler);
