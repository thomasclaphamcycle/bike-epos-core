#!/usr/bin/env node
require("dotenv").config({ path: ".env.test" });

const { spawnSync } = require("node:child_process");

const baselineSteps = ["test:m11", "test:m12", "test:m13", "test:m28", "test:m32", "test:m34"];

const env = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || "test",
  AUTH_MODE: process.env.AUTH_MODE || "header",
  ALLOW_EXISTING_SERVER: process.env.ALLOW_EXISTING_SERVER || "1",
};

if (!env.DATABASE_URL && env.TEST_DATABASE_URL) {
  env.DATABASE_URL = env.TEST_DATABASE_URL;
}
if (!env.TEST_BASE_URL) {
  env.TEST_BASE_URL = "http://localhost:3000";
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
