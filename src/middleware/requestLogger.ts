import { NextFunction, Request, Response } from "express";

export const requestLoggerMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  if (process.env.NODE_ENV !== "production") {
    next();
    return;
  }

  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const requestId = req.requestId ?? "unknown";
    const path = req.originalUrl || req.url;

    console.info(
      `[request] requestId=${requestId} method=${req.method} path=${path} status=${res.statusCode} durationMs=${elapsedMs.toFixed(1)}`,
    );
  });

  next();
};
