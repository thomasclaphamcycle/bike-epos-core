import { randomUUID } from "node:crypto";
import { NextFunction, Request, Response } from "express";
import { isCorePosDebugEnabled, logCorePosDebug, logCorePosEvent } from "../lib/operationalLogger";
import { runWithRequestContext } from "../lib/requestContext";

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

const getOrCreateRequestId = (req: Request) => {
  const existing = sanitizeRequestId(req.header(REQUEST_ID_HEADER));
  if (existing) {
    return existing;
  }

  return createRequestId();
};

const getRouteLabel = (req: Request) => {
  if (req.route?.path) {
    const routePath =
      typeof req.route.path === "string" ? req.route.path : JSON.stringify(req.route.path);
    return `${req.baseUrl || ""}${routePath}`;
  }

  return req.originalUrl || req.url;
};

export const requestLoggingMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const requestId = getOrCreateRequestId(req);
  const startedAt = process.hrtime.bigint();
  let logged = false;

  req.requestId = requestId;
  res.locals.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);

  const writeLog = (resultStatus: "completed" | "aborted") => {
    if (logged) {
      return;
    }
    logged = true;

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const payload: Record<string, unknown> = {
      requestId,
      method: req.method,
      route: getRouteLabel(req),
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      resultStatus,
    };

    if (isCorePosDebugEnabled()) {
      payload.ip = req.ip;
      payload.userId = req.user?.id ?? null;
      payload.userAgent = req.get("user-agent") ?? null;
      payload.contentLength = res.getHeader("content-length") ?? null;
      logCorePosDebug("http.request.detail", payload);
    }

    logCorePosEvent("http.request", payload, res.statusCode >= 500 ? "error" : "info");
  };

  runWithRequestContext(
    {
      requestId,
      method: req.method,
      route: req.originalUrl || req.url,
    },
    () => {
      res.on("finish", () => writeLog("completed"));
      res.on("close", () => writeLog("aborted"));
      next();
    },
  );
};
