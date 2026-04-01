import { Router } from "express";
import { customerDashboardHandler } from "../controllers/customerAuthController";
import { requireCustomerAccountAuth } from "../middleware/customerAccountAuth";

export const customerAccountRouter = Router();

customerAccountRouter.get("/dashboard", requireCustomerAccountAuth, customerDashboardHandler);
