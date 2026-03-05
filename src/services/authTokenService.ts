import * as jwt from "jsonwebtoken";
import { UserRole } from "@prisma/client";

export const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "bike_epos_auth";

const DEFAULT_AUTH_SECRET = "dev-only-auth-secret-change-me";
const DEFAULT_TTL_SECONDS = 60 * 60 * 12;

const getAuthSecret = () => {
  const configured = process.env.AUTH_JWT_SECRET?.trim();
  if (configured) {
    return configured;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_JWT_SECRET is required in production");
  }
  return DEFAULT_AUTH_SECRET;
};

const parseTtlSeconds = () => {
  const raw = process.env.AUTH_TOKEN_TTL_SECONDS?.trim();
  if (!raw) {
    return DEFAULT_TTL_SECONDS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 300 || parsed > 60 * 60 * 24 * 30) {
    return DEFAULT_TTL_SECONDS;
  }
  return parsed;
};

const AUTH_JWT_SECRET = getAuthSecret();
const AUTH_TOKEN_TTL_SECONDS = parseTtlSeconds();

type AuthJwtClaims = {
  sub: string;
  role: UserRole;
};

export const issueAuthToken = (input: { userId: string; role: UserRole }) =>
  jwt.sign(
    {
      sub: input.userId,
      role: input.role,
    } satisfies AuthJwtClaims,
    AUTH_JWT_SECRET,
    {
      expiresIn: AUTH_TOKEN_TTL_SECONDS,
      issuer: "bike-epos-core",
      audience: "bike-epos-core-users",
    },
  );

export const verifyAuthToken = (token: string): AuthJwtClaims | null => {
  try {
    const decoded = jwt.verify(token, AUTH_JWT_SECRET, {
      issuer: "bike-epos-core",
      audience: "bike-epos-core-users",
    }) as jwt.JwtPayload;

    if (!decoded || typeof decoded !== "object") {
      return null;
    }
    const sub = typeof decoded.sub === "string" ? decoded.sub : undefined;
    const role = decoded.role;
    if (!sub || (role !== "STAFF" && role !== "MANAGER" && role !== "ADMIN")) {
      return null;
    }

    return {
      sub,
      role,
    };
  } catch {
    return null;
  }
};

export const getAuthCookieMaxAgeMs = () => AUTH_TOKEN_TTL_SECONDS * 1000;
