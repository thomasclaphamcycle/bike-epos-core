import { Router } from "express";
import { getSystemVersionHandler } from "../controllers/systemController";

export const systemRouter = Router();

systemRouter.get("/version", getSystemVersionHandler);
