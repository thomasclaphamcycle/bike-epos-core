import { Router } from "express";
import {
  addWorkshopJobPartHandler,
  listWorkshopJobPartsHandler,
  patchWorkshopJobPartHandler,
  removeWorkshopJobPartHandler,
} from "../controllers/workshopPartController";

export const workshopJobPartRouter = Router();

workshopJobPartRouter.get("/:id/parts", listWorkshopJobPartsHandler);
workshopJobPartRouter.post("/:id/parts", addWorkshopJobPartHandler);
workshopJobPartRouter.patch("/:id/parts/:partId", patchWorkshopJobPartHandler);
workshopJobPartRouter.delete("/:id/parts/:partId", removeWorkshopJobPartHandler);
