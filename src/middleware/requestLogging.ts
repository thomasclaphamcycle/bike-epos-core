import { NextFunction, Request, Response } from "express";

export const requestLogging = (req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const durationMs = elapsedMs.toFixed(1);
    console.log(`${req.method} ${req.path} ${res.statusCode} ${durationMs}ms`);
  });

  next();
};
