import { Request, Response } from "express";
import { getRequestStaffActorId, getRequestStaffRole } from "../middleware/staffRole";
import {
  approveHolidayRequest,
  cancelHolidayRequest,
  type HolidayRequestStatusFilter,
  listHolidayRequests,
  rejectHolidayRequest,
  submitHolidayRequest,
} from "../services/holidayRequestService";
import { HttpError } from "../utils/http";

const HOLIDAY_STATUS_FILTERS = new Set<HolidayRequestStatusFilter>([
  "ALL",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
]);

const getHolidayActor = (req: Request) => {
  const actorId = getRequestStaffActorId(req);
  if (!actorId) {
    throw new HttpError(401, "Authenticated staff user required", "UNAUTHORIZED");
  }

  return {
    actorId,
    role: getRequestStaffRole(req),
  };
};

const parseRequestBody = (body: unknown) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "holiday request body must be an object", "INVALID_HOLIDAY_REQUEST");
  }

  return body as {
    startDate?: unknown;
    endDate?: unknown;
    requestNotes?: unknown;
    decisionNotes?: unknown;
  };
};

export const submitHolidayRequestHandler = async (req: Request, res: Response) => {
  const body = parseRequestBody(req.body);
  if (typeof body.startDate !== "string" || typeof body.endDate !== "string") {
    throw new HttpError(400, "startDate and endDate must be strings", "INVALID_HOLIDAY_REQUEST");
  }
  if (body.requestNotes !== undefined && typeof body.requestNotes !== "string") {
    throw new HttpError(400, "requestNotes must be a string", "INVALID_HOLIDAY_REQUEST");
  }

  const request = await submitHolidayRequest({
    actor: getHolidayActor(req),
    startDate: body.startDate,
    endDate: body.endDate,
    requestNotes: body.requestNotes,
  });

  res.status(201).json({ request });
};

export const listHolidayRequestsHandler = async (req: Request, res: Response) => {
  const scope = req.query.scope === "mine" ? "mine" : req.query.scope === "all" ? "all" : undefined;
  let status: HolidayRequestStatusFilter | undefined;
  if (typeof req.query.status === "string") {
    const normalizedStatus = req.query.status.trim().toUpperCase() as HolidayRequestStatusFilter;
    if (!HOLIDAY_STATUS_FILTERS.has(normalizedStatus)) {
      throw new HttpError(400, "status must be one of ALL, PENDING, APPROVED, REJECTED, or CANCELLED", "INVALID_HOLIDAY_REQUEST");
    }
    status = normalizedStatus;
  }

  const payload = await listHolidayRequests({
    actor: getHolidayActor(req),
    scope,
    status,
  });

  res.json(payload);
};

export const approveHolidayRequestHandler = async (req: Request, res: Response) => {
  const body = parseRequestBody(req.body ?? {});
  if (body.decisionNotes !== undefined && typeof body.decisionNotes !== "string") {
    throw new HttpError(400, "decisionNotes must be a string", "INVALID_HOLIDAY_REQUEST");
  }

  const result = await approveHolidayRequest({
    actor: getHolidayActor(req),
    id: req.params.id,
    decisionNotes: body.decisionNotes,
  });

  res.json(result);
};

export const rejectHolidayRequestHandler = async (req: Request, res: Response) => {
  const body = parseRequestBody(req.body ?? {});
  if (body.decisionNotes !== undefined && typeof body.decisionNotes !== "string") {
    throw new HttpError(400, "decisionNotes must be a string", "INVALID_HOLIDAY_REQUEST");
  }

  const request = await rejectHolidayRequest({
    actor: getHolidayActor(req),
    id: req.params.id,
    decisionNotes: body.decisionNotes,
  });

  res.json({ request });
};

export const cancelHolidayRequestHandler = async (req: Request, res: Response) => {
  const request = await cancelHolidayRequest({
    actor: getHolidayActor(req),
    id: req.params.id,
  });

  res.json({ request });
};
