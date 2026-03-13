import { NextFunction, Request, Response } from "express";
import { isCorePosDebugEnabled, logCorePosDebug, logCorePosEvent } from "../lib/operationalLogger";
import { HttpError } from "../utils/http";

export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const requestId = req.requestId ?? null;
  const basePayload = {
    requestId,
    method: req.method,
    route: req.originalUrl || req.url,
  };

  if (err instanceof HttpError) {
    if (err.status >= 500 || isCorePosDebugEnabled()) {
      logCorePosEvent(
        "http.error",
        {
          ...basePayload,
          resultStatus: "handled",
          statusCode: err.status,
          errorCode: err.code,
          message: err.message,
        },
        err.status >= 500 ? "error" : "warn",
      );
    }
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
      },
    });
    return;
  }

  const error =
    err instanceof Error
      ? err
      : new Error(typeof err === "string" ? err : "Unexpected non-error thrown");
  logCorePosEvent(
    "http.error",
    {
      ...basePayload,
      resultStatus: "unhandled",
      statusCode: 500,
      errorCode: "INTERNAL_SERVER_ERROR",
      message: error.message,
    },
    "error",
  );
  if (isCorePosDebugEnabled()) {
    logCorePosDebug("http.error.detail", {
      ...basePayload,
      name: error.name,
      stack: error.stack ?? null,
    });
  }
  res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Something went wrong",
    },
  });
};
