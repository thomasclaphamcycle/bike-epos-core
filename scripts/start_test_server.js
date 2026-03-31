#!/usr/bin/env node
require("dotenv").config({ path: ".env.test", override: true });

const path = require("node:path");
const { register } = require("ts-node");
const { applyTestEnvDefaults } = require("./test_env_defaults");

const env = applyTestEnvDefaults(process.env);
for (const [key, value] of Object.entries(env)) {
  if (typeof value === "string") {
    process.env[key] = value;
  }
}

register({
  transpileOnly: true,
});

require(path.join(__dirname, "..", "src", "server.ts"));
