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
  updateHireAsset,
} from "../services/bikeHireService";
import { HttpError } from "../utils/http";
import { parseOptionalIntegerQuery } from "../utils/requestParsing";

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

const parseOptionalBooleanQuery = (value: unknown, field: string) => {
  if (value === undefined) {
    return undefined;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new HttpError(400, `${field} must be true or false`, "INVALID_HIRE_QUERY");
};

const parseOptionalBooleanBody = (value: unknown, field: string) => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new HttpError(400, `${field} must be a boolean`, "INVALID_HIRE_PAYLOAD");
  }
  return value;
};

const parseHireBookingView = (value: unknown) => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "view must be a string", "INVALID_HIRE_QUERY");
  }

  const normalized = value.trim().toUpperCase();
  if (
    normalized !== "PICKUPS" &&
    normalized !== "ACTIVE" &&
    normalized !== "RETURNS" &&
    normalized !== "OVERDUE" &&
    normalized !== "HISTORY" &&
    normalized !== "TODAY"
  ) {
    throw new HttpError(
      400,
      "view must be one of PICKUPS, ACTIVE, RETURNS, OVERDUE, HISTORY, TODAY",
      "INVALID_HIRE_QUERY",
    );
  }

  return normalized as "PICKUPS" | "ACTIVE" | "RETURNS" | "OVERDUE" | "HISTORY" | "TODAY";
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
    take: parseOptionalIntegerQuery(req.query.take, {
      code: "INVALID_HIRE_QUERY",
      message: "take must be an integer",
    }),
    skip: parseOptionalIntegerQuery(req.query.skip, {
      code: "INVALID_HIRE_QUERY",
      message: "skip must be an integer",
    }),
    availableFrom: typeof req.query.availableFrom === "string" ? req.query.availableFrom : undefined,
    availableTo: typeof req.query.availableTo === "string" ? req.query.availableTo : undefined,
    onlineBookable: parseOptionalBooleanQuery(req.query.onlineBookable, "onlineBookable"),
  });

  res.json(result);
};

export const createHireAssetHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    variantId?: unknown;
    assetTag?: unknown;
    displayName?: unknown;
    notes?: unknown;
    storageLocation?: unknown;
    isOnlineBookable?: unknown;
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
  if (body.storageLocation !== undefined && typeof body.storageLocation !== "string") {
    throw new HttpError(400, "storageLocation must be a string", "INVALID_HIRE_ASSET");
  }
  if (body.isOnlineBookable !== undefined && typeof body.isOnlineBookable !== "boolean") {
    throw new HttpError(400, "isOnlineBookable must be a boolean", "INVALID_HIRE_ASSET");
  }

  const asset = await createHireAsset(
    {
      variantId: body.variantId,
      assetTag: body.assetTag,
      displayName: body.displayName,
      notes: body.notes,
      storageLocation: body.storageLocation,
      isOnlineBookable: body.isOnlineBookable,
    },
    getRequestAuditActor(req),
  );

  res.status(201).json(asset);
};

export const updateHireAssetHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    displayName?: unknown;
    notes?: unknown;
    storageLocation?: unknown;
    isOnlineBookable?: unknown;
    status?: unknown;
  };

  if (body.displayName !== undefined && typeof body.displayName !== "string") {
    throw new HttpError(400, "displayName must be a string", "INVALID_HIRE_ASSET");
  }
  if (body.notes !== undefined && typeof body.notes !== "string") {
    throw new HttpError(400, "notes must be a string", "INVALID_HIRE_ASSET");
  }
  if (body.storageLocation !== undefined && typeof body.storageLocation !== "string") {
    throw new HttpError(400, "storageLocation must be a string", "INVALID_HIRE_ASSET");
  }
  if (body.status !== undefined && body.status !== "AVAILABLE" && body.status !== "MAINTENANCE" && body.status !== "RETIRED") {
    throw new HttpError(
      400,
      "status must be one of AVAILABLE, MAINTENANCE, RETIRED",
      "INVALID_HIRE_ASSET",
    );
  }

  const asset = await updateHireAsset(
    req.params.id,
    {
      displayName: body.displayName as string | undefined,
      notes: body.notes as string | undefined,
      storageLocation: body.storageLocation as string | undefined,
      isOnlineBookable: parseOptionalBooleanBody(body.isOnlineBookable, "isOnlineBookable"),
      status: body.status as "AVAILABLE" | "MAINTENANCE" | "RETIRED" | undefined,
    },
    getRequestAuditActor(req),
  );

  res.json(asset);
};

export const listHireBookingsHandler = async (req: Request, res: Response) => {
  const result = await listHireBookings({
    status: parseHireBookingStatus(req.query.status),
    customerId: typeof req.query.customerId === "string" ? req.query.customerId : undefined,
    hireAssetId: typeof req.query.hireAssetId === "string" ? req.query.hireAssetId : undefined,
    q:
      typeof req.query.q === "string"
        ? req.query.q
        : typeof req.query.query === "string"
          ? req.query.query
          : undefined,
    from: typeof req.query.from === "string" ? req.query.from : undefined,
    to: typeof req.query.to === "string" ? req.query.to : undefined,
    view: parseHireBookingView(req.query.view),
    take: parseOptionalIntegerQuery(req.query.take, {
      code: "INVALID_HIRE_QUERY",
      message: "take must be an integer",
    }),
    skip: parseOptionalIntegerQuery(req.query.skip, {
      code: "INVALID_HIRE_QUERY",
      message: "skip must be an integer",
    }),
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
    pickupNotes?: unknown;
  };

  if (body.depositHeldPence !== undefined && typeof body.depositHeldPence !== "number") {
    throw new HttpError(400, "depositHeldPence must be a number", "INVALID_HIRE_BOOKING_CHECKOUT");
  }
  if (body.pickupNotes !== undefined && typeof body.pickupNotes !== "string") {
    throw new HttpError(400, "pickupNotes must be a string", "INVALID_HIRE_BOOKING_CHECKOUT");
  }

  const booking = await checkoutHireBooking(
    req.params.id,
    {
      depositHeldPence: body.depositHeldPence,
      pickupNotes: body.pickupNotes as string | undefined,
    },
    getRequestAuditActor(req),
  );

  res.json(booking);
};

export const returnHireBookingHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    returnNotes?: unknown;
    damageNotes?: unknown;
    depositOutcome?: unknown;
    markAssetMaintenance?: unknown;
  };

  if (body.returnNotes !== undefined && typeof body.returnNotes !== "string") {
    throw new HttpError(400, "returnNotes must be a string", "INVALID_HIRE_BOOKING_RETURN");
  }
  if (body.damageNotes !== undefined && typeof body.damageNotes !== "string") {
    throw new HttpError(400, "damageNotes must be a string", "INVALID_HIRE_BOOKING_RETURN");
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
      returnNotes: body.returnNotes as string | undefined,
      damageNotes: body.damageNotes as string | undefined,
      depositOutcome: body.depositOutcome as "RETURNED" | "KEPT" | undefined,
      markAssetMaintenance: parseOptionalBooleanBody(
        body.markAssetMaintenance,
        "markAssetMaintenance",
      ),
    },
    getRequestAuditActor(req),
  );

  res.json(booking);
};

export const cancelHireBookingHandler = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    cancellationReason?: unknown;
  };

  if (body.cancellationReason !== undefined && typeof body.cancellationReason !== "string") {
    throw new HttpError(400, "cancellationReason must be a string", "INVALID_HIRE_BOOKING_CANCEL");
  }

  const booking = await cancelHireBooking(
    req.params.id,
    {
      cancellationReason: body.cancellationReason as string | undefined,
    },
    getRequestAuditActor(req),
  );
  res.json(booking);
};
