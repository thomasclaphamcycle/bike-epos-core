import { NextFunction, Request, Response } from "express";
import { isCorePosDebugEnabled, logCorePosError } from "../lib/operationalLogger";
import { HttpError } from "../utils/http";

const getApiErrorPayload = (req: Request, code: string, message: string) => ({
  error: {
    code,
    message,
    requestId: req.requestId ?? "unknown",
  },
});

const getBodyDescriptor = (body: unknown) => {
  if (Array.isArray(body)) {
    return {
      bodyType: "array",
      bodyItemCount: body.length,
    };
  }

  if (body && typeof body === "object") {
    return {
      bodyType: "object",
      bodyKeys: Object.keys(body).sort(),
    };
  }

  return {
    bodyType: typeof body,
  };
};

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
    userId: req.user?.id ?? null,
    userRole: req.user?.role ?? null,
    queryKeys: Object.keys(req.query ?? {}).sort(),
    ...getBodyDescriptor(req.body),
  };

  if (err instanceof SyntaxError && isApiRoute) {
    logCorePosError(
      "http.error",
      err,
      {
        ...basePayload,
        resultStatus: "handled",
        statusCode: 400,
        errorCode: "INVALID_JSON_BODY",
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
      logCorePosError(
        "http.error",
        err,
        {
          ...basePayload,
          resultStatus: "handled",
          statusCode: err.status,
          errorCode: err.code,
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
  logCorePosError(
    "http.error",
    error,
    {
      ...basePayload,
      resultStatus: "unhandled",
      statusCode: 500,
      errorCode: "INTERNAL_SERVER_ERROR",
    },
    "error",
  );
  res.status(500).json({
    ...getApiErrorPayload(req, "INTERNAL_SERVER_ERROR", "Something went wrong"),
  });
};
