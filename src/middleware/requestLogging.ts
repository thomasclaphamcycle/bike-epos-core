import { NextFunction, Request, Response } from "express";

const UUID_SEGMENT_PATTERN =
  /\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/gi;
const LONG_SEGMENT_PATTERN = /\/[a-z0-9_-]{20,}(?=\/|$)/gi;

const getSafePath = (req: Request) => {
  const routePath = req.route?.path;

  if (typeof routePath === "string") {
    return `${req.baseUrl}${routePath}`;
  }

  if (Array.isArray(routePath)) {
    return `${req.baseUrl}${routePath.join("|")}`;
  }

  return req.path
    .replace(UUID_SEGMENT_PATTERN, "/:id")
    .replace(LONG_SEGMENT_PATTERN, "/:id");
};

export const requestLogging = (req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const durationMs = elapsedMs.toFixed(1);
    console.log(`${req.method} ${getSafePath(req)} ${res.statusCode} ${durationMs}ms`);
  });

  next();
};
