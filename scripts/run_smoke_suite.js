#!/usr/bin/env node
require("dotenv").config({ path: ".env.test" });

const { spawnSync } = require("node:child_process");

const baselineSteps = [
  "test:m11",
  "test:m12",
  "test:m13",
  "test:m28",
  "test:m32",
  "test:m34",
  "test:m35",
  "test:m36",
  "test:m37",
  "test:m38",
  "test:m39",
  "test:m40",
  "test:m41",
  "test:m42",
  "test:m43",
  "test:m119",
  "test:m120",
  "test:m121",
  "test:m122",
  "test:m123",
];

const env = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || "test",
  AUTH_MODE: process.env.AUTH_MODE || "real",
  ALLOW_EXISTING_SERVER: process.env.ALLOW_EXISTING_SERVER || "0",
};

if (!env.DATABASE_URL && env.TEST_DATABASE_URL) {
  env.DATABASE_URL = env.TEST_DATABASE_URL;
}
if (!env.TEST_BASE_URL) {
  env.TEST_BASE_URL = "http://localhost:3100";
}

if (
  env.ALLOW_EXISTING_SERVER !== "1" &&
  /^http:\/\/localhost:3000\/?$/i.test(env.TEST_BASE_URL)
) {
  env.TEST_BASE_URL = "http://localhost:3100";
}

if (!env.PORT) {
  try {
    const parsed = new URL(env.TEST_BASE_URL);
    if (parsed.port) {
      env.PORT = parsed.port;
    }
  } catch {
    // Keep default server port behavior if TEST_BASE_URL is not a valid URL.
  }
}

for (const step of baselineSteps) {
  const result = spawnSync("npm", ["run", step], {
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  });

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}
