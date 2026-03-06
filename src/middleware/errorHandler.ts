import { NextFunction, Request, Response } from "express";
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

  if (err instanceof SyntaxError && isApiRoute) {
    res
      .status(400)
      .json(getApiErrorPayload(req, "INVALID_JSON_BODY", "Request body must be valid JSON"));
    return;
  }

  if (err instanceof HttpError) {
    if (isApiRoute) {
      res.status(err.status).json(getApiErrorPayload(req, err.code, err.message));
      return;
    }

    res.status(err.status).json(getApiErrorPayload(req, err.code, err.message));
    return;
  }

  console.error(err);
  const message = process.env.NODE_ENV === "production"
    ? "Something went wrong"
    : err instanceof Error
      ? err.message
      : "Something went wrong";

  if (isApiRoute) {
    const payload = getApiErrorPayload(req, "INTERNAL_SERVER_ERROR", message);
    if (process.env.NODE_ENV !== "production" && err instanceof Error) {
      res.status(500).json({
        ...payload,
        stack: err.stack,
      });
      return;
    }
    res.status(500).json(payload);
    return;
  }

  res.status(500).json(getApiErrorPayload(req, "INTERNAL_SERVER_ERROR", message));
};
