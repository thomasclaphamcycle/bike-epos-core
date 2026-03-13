import { HireAssetStatus, HireBookingStatus } from "@prisma/client";
import { Request, Response } from "express";
import { getRequestAuditActor } from "../middleware/staffRole";
import {
  cancelHireBooking,
  checkoutHireBooking,
  createHireAsset,
  createHireBooking,
  listHireAssets,
  listHireBookings,
  returnHireBooking,
} from "../services/bikeHireService";
import { HttpError } from "../utils/http";

const parseHireAssetStatus = (value: unknown): HireAssetStatus | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "status must be a string", "INVALID_HIRE_QUERY");
  }

  const normalized = value.trim().toUpperCase();
  if (
    normalized !== "AVAILABLE" &&
    normalized !== "RESERVED" &&
    normalized !== "ON_HIRE" &&
    normalized !== "MAINTENANCE" &&
    normalized !== "RETIRED"
  ) {
    throw new HttpError(
      400,
      "status must be one of AVAILABLE, RESERVED, ON_HIRE, MAINTENANCE, RETIRED",
      "INVALID_HIRE_QUERY",
    );
  }

  return normalized as HireAssetStatus;
};

const parseHireBookingStatus = (value: unknown): HireBookingStatus | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "status must be a string", "INVALID_HIRE_QUERY");
  }

  const normalized = value.trim().toUpperCase();
  if (
    normalized !== "RESERVED" &&
    normalized !== "CHECKED_OUT" &&
    normalized !== "RETURNED" &&
    normalized !== "CANCELLED"
  ) {
    throw new HttpError(
      400,
      "status must be one of RESERVED, CHECKED_OUT, RETURNED, CANCELLED",
      "INVALID_HIRE_QUERY",
    );
  }

  return normalized as HireBookingStatus;
};

const parseOptionalIntQuery = (value: unknown, field: "take" | "skip") => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${field} must be an integer`, "INVALID_HIRE_QUERY");
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new HttpError(400, `${field} must be an integer`, "INVALID_HIRE_QUERY");
  }

  return parsed;
};

export const listHireAssetsHandler = async (req: Request, res: Response) => {
  const result = await listHireAssets({
    status: parseHireAssetStatus(req.query.status),
    q:
      typeof req.query.q === "string"
        ? req.query.q
        : typeof req.query.query === "string"
          ? req.query.query
          : undefined,
    take: parseOptionalIntQuery(req.query.take, "take"),
    skip: parseOptionalIntQuery(req.query.skip, "skip"),
  });

  res.json(result);
};

export const createHireAssetHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    variantId?: unknown;
    assetTag?: unknown;
    displayName?: unknown;
    notes?: unknown;
  };

  if (body.variantId !== undefined && typeof body.variantId !== "string") {
    throw new HttpError(400, "variantId must be a string", "INVALID_HIRE_ASSET");
  }
  if (body.assetTag !== undefined && typeof body.assetTag !== "string") {
    throw new HttpError(400, "assetTag must be a string", "INVALID_HIRE_ASSET");
  }
  if (body.displayName !== undefined && typeof body.displayName !== "string") {
    throw new HttpError(400, "displayName must be a string", "INVALID_HIRE_ASSET");
  }
  if (body.notes !== undefined && typeof body.notes !== "string") {
    throw new HttpError(400, "notes must be a string", "INVALID_HIRE_ASSET");
  }

  const asset = await createHireAsset(
    {
      variantId: body.variantId,
      assetTag: body.assetTag,
      displayName: body.displayName,
      notes: body.notes,
    },
    getRequestAuditActor(req),
  );

  res.status(201).json(asset);
};

export const listHireBookingsHandler = async (req: Request, res: Response) => {
  const result = await listHireBookings({
    status: parseHireBookingStatus(req.query.status),
    take: parseOptionalIntQuery(req.query.take, "take"),
    skip: parseOptionalIntQuery(req.query.skip, "skip"),
  });

  res.json(result);
};

export const createHireBookingHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    hireAssetId?: unknown;
    customerId?: unknown;
    startsAt?: unknown;
    dueBackAt?: unknown;
    hirePricePence?: unknown;
    depositPence?: unknown;
    notes?: unknown;
  };

  if (body.hireAssetId !== undefined && typeof body.hireAssetId !== "string") {
    throw new HttpError(400, "hireAssetId must be a string", "INVALID_HIRE_BOOKING");
  }
  if (body.customerId !== undefined && typeof body.customerId !== "string") {
    throw new HttpError(400, "customerId must be a string", "INVALID_HIRE_BOOKING");
  }
  if (body.startsAt !== undefined && typeof body.startsAt !== "string") {
    throw new HttpError(400, "startsAt must be a string", "INVALID_HIRE_BOOKING");
  }
  if (body.dueBackAt !== undefined && typeof body.dueBackAt !== "string") {
    throw new HttpError(400, "dueBackAt must be a string", "INVALID_HIRE_BOOKING");
  }
  if (body.hirePricePence !== undefined && typeof body.hirePricePence !== "number") {
    throw new HttpError(400, "hirePricePence must be a number", "INVALID_HIRE_BOOKING");
  }
  if (body.depositPence !== undefined && typeof body.depositPence !== "number") {
    throw new HttpError(400, "depositPence must be a number", "INVALID_HIRE_BOOKING");
  }
  if (body.notes !== undefined && typeof body.notes !== "string") {
    throw new HttpError(400, "notes must be a string", "INVALID_HIRE_BOOKING");
  }

  const booking = await createHireBooking(
    {
      hireAssetId: body.hireAssetId,
      customerId: body.customerId,
      startsAt: body.startsAt,
      dueBackAt: body.dueBackAt,
      hirePricePence: body.hirePricePence,
      depositPence: body.depositPence,
      notes: body.notes,
    },
    getRequestAuditActor(req),
  );

  res.status(201).json(booking);
};

export const checkoutHireBookingHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    depositHeldPence?: unknown;
  };

  if (body.depositHeldPence !== undefined && typeof body.depositHeldPence !== "number") {
    throw new HttpError(400, "depositHeldPence must be a number", "INVALID_HIRE_BOOKING_CHECKOUT");
  }

  const booking = await checkoutHireBooking(
    req.params.id,
    {
      depositHeldPence: body.depositHeldPence,
    },
    getRequestAuditActor(req),
  );

  res.json(booking);
};

export const returnHireBookingHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    notes?: unknown;
    depositOutcome?: unknown;
  };

  if (body.notes !== undefined && typeof body.notes !== "string") {
    throw new HttpError(400, "notes must be a string", "INVALID_HIRE_BOOKING_RETURN");
  }
  if (
    body.depositOutcome !== undefined &&
    body.depositOutcome !== "RETURNED" &&
    body.depositOutcome !== "KEPT"
  ) {
    throw new HttpError(
      400,
      "depositOutcome must be RETURNED or KEPT",
      "INVALID_HIRE_BOOKING_RETURN",
    );
  }

  const booking = await returnHireBooking(
    req.params.id,
    {
      notes: body.notes,
      depositOutcome: body.depositOutcome as "RETURNED" | "KEPT" | undefined,
    },
    getRequestAuditActor(req),
  );

  res.json(booking);
};

export const cancelHireBookingHandler = async (req: Request, res: Response) => {
  const booking = await cancelHireBooking(req.params.id, getRequestAuditActor(req));
  res.json(booking);
};
