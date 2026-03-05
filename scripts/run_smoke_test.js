#!/usr/bin/env node
require("dotenv").config({ path: ".env.test" });

const { spawnSync } = require("node:child_process");

const smokeScript = process.argv[2];
const smokeArgs = process.argv.slice(3);

if (!smokeScript) {
  console.error("Usage: node scripts/run_smoke_test.js <script-path> [...args]");
  process.exit(1);
}

const env = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || "test",
  AUTH_MODE: process.env.AUTH_MODE || "real",
  ALLOW_EXISTING_SERVER: process.env.ALLOW_EXISTING_SERVER || "1",
  TEST_BASE_URL: process.env.TEST_BASE_URL || "http://localhost:3000",
  PORT: process.env.PORT || "3000",
  JWT_SECRET: process.env.JWT_SECRET || process.env.AUTH_JWT_SECRET || "test-jwt-secret",
  COOKIE_SECRET: process.env.COOKIE_SECRET || "test-cookie-secret",
};

if (!env.DATABASE_URL && env.TEST_DATABASE_URL) {
  env.DATABASE_URL = env.TEST_DATABASE_URL;
}

const result = spawnSync("node", [smokeScript, ...smokeArgs], {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
