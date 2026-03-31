import { Request, Response } from "express";
import { HttpError } from "../utils/http";
import {
  isSupportedTimelineEntityType,
  listTimelineEvents,
} from "../services/timelineFormatter";

const parseLimitQuery = (raw: unknown): number | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new HttpError(400, "limit must be an integer", "INVALID_FILTER");
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new HttpError(400, "limit must be an integer between 1 and 100", "INVALID_FILTER");
  }

  return parsed;
};

export const getEventsHandler = async (req: Request, res: Response) => {
  const entityTypeRaw = typeof req.query.entityType === "string" ? req.query.entityType.trim().toUpperCase() : "";
  const entityIdRaw = typeof req.query.entityId === "string" ? req.query.entityId.trim() : "";
  const limit = parseLimitQuery(req.query.limit);

  if (!entityTypeRaw) {
    throw new HttpError(400, "entityType is required", "INVALID_FILTER");
  }
  if (!isSupportedTimelineEntityType(entityTypeRaw)) {
    throw new HttpError(400, "entityType is not supported", "INVALID_FILTER");
  }
  if (!entityIdRaw) {
    throw new HttpError(400, "entityId is required", "INVALID_FILTER");
  }

  res.json({
    entityType: entityTypeRaw,
    entityId: entityIdRaw,
    events: await listTimelineEvents({
      entityType: entityTypeRaw,
      entityId: entityIdRaw,
      limit,
    }),
  });
};
