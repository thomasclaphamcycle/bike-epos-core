import { Router } from "express";
import { getLoginPageHandler } from "../controllers/authUiController";

export const authUiRouter = Router();

authUiRouter.get("/login", getLoginPageHandler);
