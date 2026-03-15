#!/usr/bin/env node
require("dotenv/config");

const { spawnSync } = require("child_process");

const DEFAULT_ADMIN_ENV = {
  ADMIN_NAME: process.env.ADMIN_NAME || "Admin User",
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || "admin@example.com",
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "ChangeMe123!",
  ADMIN_PIN: process.env.ADMIN_PIN || "1234",
};

const runStep = (label, command, args, extraEnv = {}) => {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      ...extraEnv,
    },
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const main = () => {
  runStep("Reset local dev database", "node", ["scripts/reset_local_dev_db.js"]);
  runStep("Generate Prisma client", "npm", ["run", "prisma:generate"]);
  runStep("Apply local Prisma migrations", "npx", ["prisma", "migrate", "dev"]);
  runStep("Seed base local dev data", "npm", ["run", "db:seed:dev"]);
  runStep("Seed local admin login", "npm", ["run", "auth:seed-admin"], DEFAULT_ADMIN_ENV);
  runStep("Seed local staff roster", "npm", ["run", "auth:seed-local-staff"]);

  console.log("\nLocal dev reset and reseed complete.");
  console.log(`- Admin: ${DEFAULT_ADMIN_ENV.ADMIN_EMAIL} (PIN ${DEFAULT_ADMIN_ENV.ADMIN_PIN})`);
  console.log("- Staff: Dom, Eric, Mike, Thomas");
  console.log("- Test DB remains separate; continue using npm run test:db:up for test verification.");
};

main();
