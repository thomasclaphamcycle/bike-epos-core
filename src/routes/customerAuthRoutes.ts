import { Router } from "express";
import {
  consumeCustomerAccessLinkHandler,
  customerLogoutHandler,
  customerSessionHandler,
  requestCustomerAccessLinkHandler,
} from "../controllers/customerAuthController";
import { attachCustomerAccountIfPresent } from "../middleware/customerAccountAuth";

export const customerAuthRouter = Router();

customerAuthRouter.post("/request-link", requestCustomerAccessLinkHandler);
customerAuthRouter.post("/consume", consumeCustomerAccessLinkHandler);
customerAuthRouter.post("/logout", customerLogoutHandler);
customerAuthRouter.get("/session", attachCustomerAccountIfPresent, customerSessionHandler);
