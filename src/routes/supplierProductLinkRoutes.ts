import { Router } from "express";
import {
  createSupplierProductLinkHandler,
  listSupplierProductLinksHandler,
  patchSupplierProductLinkHandler,
} from "../controllers/supplierProductLinkController";
import { requireRoleAtLeast } from "../middleware/staffRole";

export const supplierProductLinkRouter = Router();

supplierProductLinkRouter.get("/", requireRoleAtLeast("STAFF"), listSupplierProductLinksHandler);
supplierProductLinkRouter.post("/", requireRoleAtLeast("MANAGER"), createSupplierProductLinkHandler);
supplierProductLinkRouter.patch("/:id", requireRoleAtLeast("MANAGER"), patchSupplierProductLinkHandler);
