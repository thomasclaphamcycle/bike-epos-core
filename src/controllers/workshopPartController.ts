import { Request, Response } from "express";
import { WorkshopJobPartStatus } from "@prisma/client";
import { getRequestAuditActor, getRequestStaffActorId } from "../middleware/staffRole";
import {
  addWorkshopJobPart,
  listWorkshopJobParts,
  removeWorkshopJobPart,
  updateWorkshopJobPart,
} from "../services/workshopPartService";
import { HttpError } from "../utils/http";

const parsePartStatus = (value: string | undefined): WorkshopJobPartStatus | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (value !== "PLANNED" && value !== "USED" && value !== "RETURNED") {
    throw new HttpError(
      400,
      "status must be PLANNED, USED, or RETURNED",
      "INVALID_WORKSHOP_PART_STATUS",
    );
  }

  return value;
};

export const listWorkshopJobPartsHandler = async (req: Request, res: Response) => {
  const result = await listWorkshopJobParts(req.params.id);
  res.json(result);
};

export const addWorkshopJobPartHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    variantId?: string;
    quantity?: number;
    unitPriceAtTime?: number;
    costPriceAtTime?: number | null;
    status?: string;
    locationId?: string;
    note?: string;
  };

  if (body.variantId !== undefined && typeof body.variantId !== "string") {
    throw new HttpError(400, "variantId must be a string", "INVALID_WORKSHOP_PART");
  }
  if (body.quantity !== undefined && typeof body.quantity !== "number") {
    throw new HttpError(400, "quantity must be a number", "INVALID_WORKSHOP_PART");
  }
  if (body.unitPriceAtTime !== undefined && typeof body.unitPriceAtTime !== "number") {
    throw new HttpError(400, "unitPriceAtTime must be a number", "INVALID_WORKSHOP_PART");
  }
  if (
    body.costPriceAtTime !== undefined &&
    body.costPriceAtTime !== null &&
    typeof body.costPriceAtTime !== "number"
  ) {
    throw new HttpError(400, "costPriceAtTime must be a number or null", "INVALID_WORKSHOP_PART");
  }
  if (body.locationId !== undefined && typeof body.locationId !== "string") {
    throw new HttpError(400, "locationId must be a string", "INVALID_WORKSHOP_PART");
  }
  if (body.note !== undefined && typeof body.note !== "string") {
    throw new HttpError(400, "note must be a string", "INVALID_WORKSHOP_PART");
  }

  const result = await addWorkshopJobPart(
    req.params.id,
    {
      ...(body.variantId !== undefined ? { variantId: body.variantId } : {}),
      ...(body.quantity !== undefined ? { quantity: body.quantity } : {}),
      ...(body.unitPriceAtTime !== undefined ? { unitPriceAtTime: body.unitPriceAtTime } : {}),
      ...(Object.prototype.hasOwnProperty.call(body, "costPriceAtTime")
        ? { costPriceAtTime: body.costPriceAtTime }
        : {}),
      ...(body.status !== undefined ? { status: parsePartStatus(body.status) } : {}),
      ...(body.locationId !== undefined ? { locationId: body.locationId } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
      ...(getRequestStaffActorId(req) ? { createdByStaffId: getRequestStaffActorId(req) } : {}),
    },
    getRequestAuditActor(req),
  );

  res.status(201).json(result);
};

export const patchWorkshopJobPartHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    quantity?: number;
    unitPriceAtTime?: number;
    costPriceAtTime?: number | null;
    status?: string;
    locationId?: string;
    note?: string;
  };

  if (body.quantity !== undefined && typeof body.quantity !== "number") {
    throw new HttpError(400, "quantity must be a number", "INVALID_WORKSHOP_PART_UPDATE");
  }
  if (body.unitPriceAtTime !== undefined && typeof body.unitPriceAtTime !== "number") {
    throw new HttpError(
      400,
      "unitPriceAtTime must be a number",
      "INVALID_WORKSHOP_PART_UPDATE",
    );
  }
  if (
    body.costPriceAtTime !== undefined &&
    body.costPriceAtTime !== null &&
    typeof body.costPriceAtTime !== "number"
  ) {
    throw new HttpError(
      400,
      "costPriceAtTime must be a number or null",
      "INVALID_WORKSHOP_PART_UPDATE",
    );
  }
  if (body.locationId !== undefined && typeof body.locationId !== "string") {
    throw new HttpError(400, "locationId must be a string", "INVALID_WORKSHOP_PART_UPDATE");
  }
  if (body.note !== undefined && typeof body.note !== "string") {
    throw new HttpError(400, "note must be a string", "INVALID_WORKSHOP_PART_UPDATE");
  }

  const result = await updateWorkshopJobPart(
    req.params.id,
    req.params.partId,
    {
      ...(body.quantity !== undefined ? { quantity: body.quantity } : {}),
      ...(body.unitPriceAtTime !== undefined ? { unitPriceAtTime: body.unitPriceAtTime } : {}),
      ...(Object.prototype.hasOwnProperty.call(body, "costPriceAtTime")
        ? { costPriceAtTime: body.costPriceAtTime }
        : {}),
      ...(body.status !== undefined ? { status: parsePartStatus(body.status) } : {}),
      ...(body.locationId !== undefined ? { locationId: body.locationId } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
      ...(getRequestStaffActorId(req) ? { createdByStaffId: getRequestStaffActorId(req) } : {}),
    },
    getRequestAuditActor(req),
  );

  res.status(200).json(result);
};

export const removeWorkshopJobPartHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    locationId?: string;
    note?: string;
  };

  if (body.locationId !== undefined && typeof body.locationId !== "string") {
    throw new HttpError(400, "locationId must be a string", "INVALID_WORKSHOP_PART_DELETE");
  }
  if (body.note !== undefined && typeof body.note !== "string") {
    throw new HttpError(400, "note must be a string", "INVALID_WORKSHOP_PART_DELETE");
  }

  const result = await removeWorkshopJobPart(
    req.params.id,
    req.params.partId,
    {
      ...(body.locationId !== undefined ? { locationId: body.locationId } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
      ...(getRequestStaffActorId(req) ? { createdByStaffId: getRequestStaffActorId(req) } : {}),
    },
    getRequestAuditActor(req),
  );

  res.json(result);
};
