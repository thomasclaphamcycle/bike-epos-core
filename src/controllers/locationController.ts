import { Request, Response } from "express";
import { getRequestAuditActor } from "../middleware/staffRole";
import { createLocation, listLocations } from "../services/locationService";
import { HttpError } from "../utils/http";

export const listLocationsHandler = async (_req: Request, res: Response) => {
  const result = await listLocations();
  res.json(result);
};

export const createLocationHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    name?: unknown;
    code?: unknown;
  };

  if (body.name !== undefined && typeof body.name !== "string") {
    throw new HttpError(400, "name must be a string", "INVALID_LOCATION_CREATE");
  }
  if (body.code !== undefined && typeof body.code !== "string") {
    throw new HttpError(400, "code must be a string", "INVALID_LOCATION_CREATE");
  }

  const location = await createLocation(
    {
      name: body.name,
      code: body.code,
    },
    getRequestAuditActor(req),
  );

  res.status(201).json({ location });
};
