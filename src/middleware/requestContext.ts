import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export type RequestContext = {
  requestId: string;
  method: string;
  route: string;
  actorStaffId?: string;
};

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export const REQUEST_ID_HEADER = "X-Request-Id";

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

export const getOrCreateRequestId = (req: Request) => {
  const existingHeaderId = sanitizeRequestId(req.header(REQUEST_ID_HEADER));
  if (existingHeaderId) {
    return existingHeaderId;
  }

  const existingRequestId = sanitizeRequestId(req.requestId);
  if (existingRequestId) {
    return existingRequestId;
  }

  return createRequestId();
};

export const buildRequestContext = (req: Request, requestId = getOrCreateRequestId(req)): RequestContext => ({
  requestId,
  method: req.method,
  route: req.originalUrl || req.url,
});

export const runWithRequestContext = <T>(context: RequestContext, fn: () => T): T =>
  requestContextStorage.run(context, fn);

export const getRequestContext = (): RequestContext | null =>
  requestContextStorage.getStore() ?? null;

export const updateRequestContext = (updates: Partial<RequestContext>) => {
  const current = requestContextStorage.getStore();
  if (!current) {
    return null;
  }

  const nextContext = {
    ...current,
    ...updates,
  };
  requestContextStorage.enterWith(nextContext);
  return nextContext;
};

export const requestContextMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const requestId = getOrCreateRequestId(req);

  req.requestId = requestId;
  res.locals.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);

  runWithRequestContext(buildRequestContext(req, requestId), () => {
    next();
  });
};
