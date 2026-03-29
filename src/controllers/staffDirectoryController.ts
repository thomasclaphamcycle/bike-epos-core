import { Request, Response } from "express";
import { getRequestAuditActor } from "../middleware/staffRole";
import {
  listStaffDirectory,
  updateStaffDirectoryProfile,
  updateUserOperationalRole,
} from "../services/staffDirectoryService";
import { HttpError } from "../utils/http";

export const listStaffDirectoryHandler = async (_req: Request, res: Response) => {
  const result = await listStaffDirectory();
  res.json(result);
};

export const updateUserOperationalRoleHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { operationalRole?: unknown };

  if (
    body.operationalRole !== undefined
    && body.operationalRole !== null
    && typeof body.operationalRole !== "string"
  ) {
    throw new HttpError(400, "operationalRole must be a string or null", "INVALID_OPERATIONAL_ROLE");
  }

  const user = await updateUserOperationalRole(
    req.params.id,
    body.operationalRole as string | null | undefined,
    getRequestAuditActor(req),
  );

  res.json({ user });
};

export const updateStaffDirectoryProfileHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    operationalRole?: unknown;
    isTechnician?: unknown;
  };

  if (
    body.operationalRole !== undefined
    && body.operationalRole !== null
    && typeof body.operationalRole !== "string"
  ) {
    throw new HttpError(400, "operationalRole must be a string or null", "INVALID_STAFF_DIRECTORY_UPDATE");
  }
  if (body.isTechnician !== undefined && typeof body.isTechnician !== "boolean") {
    throw new HttpError(400, "isTechnician must be a boolean", "INVALID_STAFF_DIRECTORY_UPDATE");
  }

  const user = await updateStaffDirectoryProfile(
    req.params.id,
    {
      ...(Object.prototype.hasOwnProperty.call(body, "operationalRole")
        ? { operationalRole: body.operationalRole as string | null | undefined }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body, "isTechnician")
        ? { isTechnician: body.isTechnician as boolean }
        : {}),
    },
    getRequestAuditActor(req),
  );

  res.json({ user });
};
