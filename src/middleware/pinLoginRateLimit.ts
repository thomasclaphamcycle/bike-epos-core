import { NextFunction, Request, Response } from "express";
import { HttpError } from "../utils/http";

type AttemptState = {
  failures: number;
  firstFailureAt: number;
  blockedUntil: number | null;
};

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;
const BLOCK_MS = 10 * 60 * 1000;

const attempts = new Map<string, AttemptState>();

const now = () => Date.now();

export const getPinLoginClientKey = (req: Request) => {
  const ip = req.ip?.trim();
  if (ip) {
    return ip;
  }
  return "unknown";
};

const getState = (clientKey: string) => {
  const current = attempts.get(clientKey);
  const currentTime = now();

  if (!current) {
    return null;
  }

  if (current.blockedUntil && current.blockedUntil <= currentTime) {
    attempts.delete(clientKey);
    return null;
  }

  if (currentTime - current.firstFailureAt > WINDOW_MS && !current.blockedUntil) {
    attempts.delete(clientKey);
    return null;
  }

  return current;
};

export const recordPinLoginFailure = (clientKey: string) => {
  const currentTime = now();
  const existing = getState(clientKey);

  if (!existing) {
    attempts.set(clientKey, {
      failures: 1,
      firstFailureAt: currentTime,
      blockedUntil: null,
    });
    return;
  }

  existing.failures += 1;

  if (existing.failures >= MAX_FAILURES) {
    existing.blockedUntil = currentTime + BLOCK_MS;
  }

  attempts.set(clientKey, existing);
};

export const clearPinLoginFailures = (clientKey: string) => {
  attempts.delete(clientKey);
};

export const pinLoginRateLimit = (req: Request, _res: Response, next: NextFunction) => {
  const clientKey = getPinLoginClientKey(req);
  const existing = getState(clientKey);
  if (existing?.blockedUntil && existing.blockedUntil > now()) {
    return next(
      new HttpError(
        429,
        "Too many PIN login attempts. Try again in 10 minutes.",
        "PIN_RATE_LIMITED",
      ),
    );
  }
  return next();
};
