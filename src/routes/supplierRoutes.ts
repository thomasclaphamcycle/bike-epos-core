import { Router } from "express";
import { createSupplierHandler, listSuppliersHandler, patchSupplierHandler } from "../controllers/supplierController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const supplierRouter = Router();

supplierRouter.post("/", requireRoleAtLeast("MANAGER"), createSupplierHandler);
supplierRouter.patch("/:id", requireRoleAtLeast("MANAGER"), patchSupplierHandler);
supplierRouter.get("/", requireRoleAtLeast("STAFF"), listSuppliersHandler);
