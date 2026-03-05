type RequiredEnvName =
  | "DATABASE_URL"
  | "NODE_ENV"
  | "PORT"
  | "JWT_SECRET"
  | "COOKIE_SECRET";

const readEnv = (name: string) => process.env[name]?.trim();

const readRequiredEnv = (name: RequiredEnvName) => {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`[config] Missing required environment variable: ${name}`);
  }
  return value;
};

export const getDatabaseUrl = () => readRequiredEnv("DATABASE_URL");

export const getJwtSecret = () => {
  const primary = readEnv("JWT_SECRET");
  if (primary) {
    return primary;
  }

  const legacy = readEnv("AUTH_JWT_SECRET");
  if (legacy) {
    return legacy;
  }

  throw new Error(
    "[config] Missing required environment variable: JWT_SECRET (or legacy AUTH_JWT_SECRET)",
  );
};

export const getCookieSecret = () => readRequiredEnv("COOKIE_SECRET");

export const getNodeEnv = () => readRequiredEnv("NODE_ENV");

export const getPort = () => {
  const raw = readRequiredEnv("PORT");
  const parsed = Number.parseInt(raw, 10);

  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`[config] Invalid PORT value "${raw}". Expected an integer between 1 and 65535.`);
  }

  return parsed;
};

export const validateServerEnv = () => ({
  databaseUrl: getDatabaseUrl(),
  jwtSecret: getJwtSecret(),
  cookieSecret: getCookieSecret(),
  nodeEnv: getNodeEnv(),
  port: getPort(),
});
