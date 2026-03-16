import { Router } from "express";
import { publicReceiptUploadHandler } from "../controllers/managementCashController";

export const publicReceiptUploadRouter = Router();

publicReceiptUploadRouter.post("/receipt-upload/:token", publicReceiptUploadHandler);
