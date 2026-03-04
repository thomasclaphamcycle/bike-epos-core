import { Router } from "express";
import {
  cancelWorkshopBookingByManageTokenHandler,
  createOnlineWorkshopBookingHandler,
  getWorkshopBookingByManageTokenHandler,
  payWorkshopBookingDepositByManageTokenHandler,
  updateWorkshopBookingByManageTokenHandler,
} from "../controllers/workshopController";

export const workshopBookingRouter = Router();

workshopBookingRouter.post("/", createOnlineWorkshopBookingHandler);
workshopBookingRouter.get("/manage/:token", getWorkshopBookingByManageTokenHandler);
workshopBookingRouter.patch("/manage/:token", updateWorkshopBookingByManageTokenHandler);
workshopBookingRouter.post(
  "/manage/:token/pay-deposit",
  payWorkshopBookingDepositByManageTokenHandler,
);
workshopBookingRouter.post(
  "/manage/:token/cancel",
  cancelWorkshopBookingByManageTokenHandler,
);
