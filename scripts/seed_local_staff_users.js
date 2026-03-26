#!/usr/bin/env node
require("dotenv/config");

const { spawnSync } = require("child_process");

const result = spawnSync(
  "npx",
  ["ts-node", "--transpile-only", "scripts/dev/restore_local_staff.ts"],
  {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  },
);

process.exit(result.status ?? 1);
