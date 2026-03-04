import { Router } from "express";
import { createSupplierHandler, listSuppliersHandler } from "../controllers/supplierController";

export const supplierRouter = Router();

supplierRouter.post("/", createSupplierHandler);
supplierRouter.get("/", listSuppliersHandler);
