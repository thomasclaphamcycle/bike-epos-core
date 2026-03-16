import { NextFunction, Request, Response } from "express";
import { isCorePosDebugEnabled, logCorePosDebug, logCorePosEvent } from "../lib/operationalLogger";
import { HttpError } from "../utils/http";

const getApiErrorPayload = (req: Request, code: string, message: string) => ({
  error: {
    code,
    message,
    requestId: req.requestId ?? "unknown",
  },
});

export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const isApiRoute = req.path.startsWith("/api");
  const requestId = req.requestId ?? null;
  const basePayload = {
    requestId,
    method: req.method,
    route: req.originalUrl || req.url,
  };

  if (err instanceof SyntaxError && isApiRoute) {
    logCorePosEvent(
      "http.error",
      {
        ...basePayload,
        resultStatus: "handled",
        statusCode: 400,
        errorCode: "INVALID_JSON_BODY",
        message: err.message,
      },
      "warn",
    );
    res
      .status(400)
      .json(getApiErrorPayload(req, "INVALID_JSON_BODY", "Request body must be valid JSON"));
    return;
  }

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

    const payload = getApiErrorPayload(req, err.code, err.message);
    res.status(err.status).json(isApiRoute ? payload : payload);
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
    ...getApiErrorPayload(req, "INTERNAL_SERVER_ERROR", "Something went wrong"),
  });
};
