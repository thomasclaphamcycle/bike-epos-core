import { Request, Response } from "express";
import { getAuditEvents } from "../services/auditService";
import { HttpError } from "../utils/http";

const parseLimitQuery = (raw: unknown): number | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new HttpError(400, "limit must be an integer", "INVALID_FILTER");
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new HttpError(400, "limit must be an integer", "INVALID_FILTER");
  }
  return parsed;
};

export const getAuditEventsHandler = async (req: Request, res: Response) => {
  const entityType = typeof req.query.entityType === "string" ? req.query.entityType : undefined;
  const entityId = typeof req.query.entityId === "string" ? req.query.entityId : undefined;
  const action = typeof req.query.action === "string" ? req.query.action : undefined;
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const limit = parseLimitQuery(req.query.limit);

  const result = await getAuditEvents({
    entityType,
    entityId,
    action,
    from,
    to,
    limit,
  });

  res.json(result);
};
