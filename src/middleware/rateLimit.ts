import { Request, Response } from "express";
import { rateLimit } from "express-rate-limit";

const readPositiveInteger = (name: string, defaultValue: number) => {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return defaultValue;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return defaultValue;
  }

  return parsed;
};

const tooManyRequestsHandler = (_req: Request, res: Response) => {
  res.status(429).json({ error: "Too many requests" });
};

export const loginRateLimiter = rateLimit({
  windowMs: readPositiveInteger("RATE_LIMIT_AUTH_LOGIN_WINDOW_MS", 60_000),
  limit: readPositiveInteger("RATE_LIMIT_AUTH_LOGIN_MAX", 10),
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyRequestsHandler,
});

export const workshopManageTokenRateLimiter = rateLimit({
  windowMs: readPositiveInteger("RATE_LIMIT_WORKSHOP_MANAGE_WINDOW_MS", 60_000),
  limit: readPositiveInteger("RATE_LIMIT_WORKSHOP_MANAGE_MAX", 30),
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyRequestsHandler,
});
