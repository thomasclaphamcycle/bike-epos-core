import { randomUUID } from "node:crypto";
import { NextFunction, Request, Response } from "express";

const REQUEST_ID_HEADER = "X-Request-Id";

const sanitizeRequestId = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 128) {
    return null;
  }

  return trimmed;
};

const createRequestId = () => {
  try {
    return randomUUID();
  } catch {
    return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
};

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const incoming = sanitizeRequestId(req.get(REQUEST_ID_HEADER));
  const requestId = incoming ?? createRequestId();

  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);

  next();
};
