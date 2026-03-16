import { randomUUID } from "node:crypto";
import { NextFunction, Request, Response } from "express";
import { isCorePosDebugEnabled, logCorePosDebug, logCorePosEvent } from "../lib/operationalLogger";

const REQUEST_ID_HEADER = "X-Request-Id";

const getOrCreateRequestId = (req: Request) => {
  const existing = req.header(REQUEST_ID_HEADER)?.trim();
  if (existing) {
    return existing;
  }

  return randomUUID();
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

  res.on("finish", () => writeLog("completed"));
  res.on("close", () => writeLog("aborted"));

  next();
};
