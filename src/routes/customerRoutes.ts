import { Router } from "express";
import {
  createCustomerHandler,
  getCustomerHandler,
  listCustomersHandler,
} from "../controllers/customerController";

export const customerRouter = Router();

customerRouter.post("/", createCustomerHandler);
customerRouter.get("/", listCustomersHandler);
customerRouter.get("/:id", getCustomerHandler);
