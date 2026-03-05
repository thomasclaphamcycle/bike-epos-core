import { Router } from "express";
import {
  createSupplierHandler,
  getSupplierHandler,
  listSupplierPurchaseOrdersHandler,
  listSuppliersHandler,
  patchSupplierHandler,
} from "../controllers/supplierController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const supplierRouter = Router();

supplierRouter.post("/", requireRoleAtLeast("MANAGER"), createSupplierHandler);
supplierRouter.get("/", requireRoleAtLeast("MANAGER"), listSuppliersHandler);
supplierRouter.get("/:id/purchase-orders", requireRoleAtLeast("MANAGER"), listSupplierPurchaseOrdersHandler);
supplierRouter.get("/:id", requireRoleAtLeast("MANAGER"), getSupplierHandler);
supplierRouter.patch("/:id", requireRoleAtLeast("MANAGER"), patchSupplierHandler);
