import * as jwt from "jsonwebtoken";

export const CUSTOMER_AUTH_COOKIE_NAME =
  process.env.CUSTOMER_AUTH_COOKIE_NAME || "bike_epos_customer";

const DEFAULT_CUSTOMER_AUTH_SECRET = "dev-only-customer-auth-secret-change-me";
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30;

const getCustomerAuthSecret = () => {
  const configured =
    process.env.CUSTOMER_AUTH_JWT_SECRET?.trim() || process.env.AUTH_JWT_SECRET?.trim();
  if (configured) {
    return configured;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("CUSTOMER_AUTH_JWT_SECRET or AUTH_JWT_SECRET is required in production");
  }
  return DEFAULT_CUSTOMER_AUTH_SECRET;
};

const parseCustomerAuthTtlSeconds = () => {
  const raw = process.env.CUSTOMER_AUTH_TOKEN_TTL_SECONDS?.trim();
  if (!raw) {
    return DEFAULT_TTL_SECONDS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 300 || parsed > 60 * 60 * 24 * 90) {
    return DEFAULT_TTL_SECONDS;
  }
  return parsed;
};

const CUSTOMER_AUTH_JWT_SECRET = getCustomerAuthSecret();
const CUSTOMER_AUTH_TOKEN_TTL_SECONDS = parseCustomerAuthTtlSeconds();

type CustomerAuthJwtClaims = {
  sub: string;
  customerId: string;
  email: string;
};

export const issueCustomerAuthToken = (input: {
  customerAccountId: string;
  customerId: string;
  email: string;
}) =>
  jwt.sign(
    {
      sub: input.customerAccountId,
      customerId: input.customerId,
      email: input.email,
    } satisfies CustomerAuthJwtClaims,
    CUSTOMER_AUTH_JWT_SECRET,
    {
      expiresIn: CUSTOMER_AUTH_TOKEN_TTL_SECONDS,
      issuer: "bike-epos-core",
      audience: "bike-epos-core-customers",
    },
  );

export const verifyCustomerAuthToken = (token: string): CustomerAuthJwtClaims | null => {
  try {
    const decoded = jwt.verify(token, CUSTOMER_AUTH_JWT_SECRET, {
      issuer: "bike-epos-core",
      audience: "bike-epos-core-customers",
    }) as jwt.JwtPayload;

    if (!decoded || typeof decoded !== "object") {
      return null;
    }

    const sub = typeof decoded.sub === "string" ? decoded.sub : undefined;
    const customerId = typeof decoded.customerId === "string" ? decoded.customerId : undefined;
    const email = typeof decoded.email === "string" ? decoded.email : undefined;
    if (!sub || !customerId || !email) {
      return null;
    }

    return {
      sub,
      customerId,
      email,
    };
  } catch {
    return null;
  }
};

export const getCustomerAuthCookieMaxAgeMs = () => CUSTOMER_AUTH_TOKEN_TTL_SECONDS * 1000;
