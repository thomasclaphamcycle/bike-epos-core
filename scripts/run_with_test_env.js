#!/usr/bin/env node
require("dotenv").config({ path: ".env.test" });

const { spawnSync } = require("node:child_process");

const command = process.argv[2];
const args = process.argv.slice(3);

if (!command) {
  console.error("Usage: node scripts/run_with_test_env.js <command> [...args]");
  process.exit(1);
}

const env = {
  ...process.env,
};

if (!env.DATABASE_URL && env.TEST_DATABASE_URL) {
  env.DATABASE_URL = env.TEST_DATABASE_URL;
}
if (!env.TEST_BASE_URL) {
  env.TEST_BASE_URL = "http://localhost:3000";
}
if (!env.NODE_ENV) {
  env.NODE_ENV = "test";
}
if (!env.PORT) {
  env.PORT = "3000";
}
if (!env.JWT_SECRET && !env.AUTH_JWT_SECRET) {
  env.JWT_SECRET = "test-jwt-secret";
}
if (!env.COOKIE_SECRET) {
  env.COOKIE_SECRET = "test-cookie-secret";
}

const result = spawnSync(command, args, {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
