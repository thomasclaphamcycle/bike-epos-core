#!/usr/bin/env node
require("dotenv").config({ path: ".env.test" });

const { spawnSync } = require("node:child_process");
const { Client } = require("pg");

const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("TEST_DATABASE_URL or DATABASE_URL is required.");
  process.exit(1);
}

if (
  process.env.ALLOW_NON_TEST_DB !== "1" &&
  !DATABASE_URL.toLowerCase().includes("test")
) {
  console.error(
    "Refusing to sync a non-test database. Set TEST_DATABASE_URL or ALLOW_NON_TEST_DB=1.",
  );
  process.exit(1);
}

const runPrismaCommand = (args) => {
  const result = spawnSync("npx", ["prisma", ...args], {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL,
    },
    shell: process.platform === "win32",
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
};

const resetLocalTestDatabase = () => {
  const resetResult = spawnSync("node", ["scripts/reset_test_db.js"], {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });

  if (resetResult.error) {
    throw resetResult.error;
  }

  if ((resetResult.status ?? 1) !== 0) {
    process.exit(resetResult.status ?? 1);
  }
};

const main = async () => {
  const client = new Client({ connectionString: DATABASE_URL });
  let clientClosed = false;

  try {
    await client.connect();

    const { rows: migrationsRows } = await client.query(`
      select 1
      from information_schema.tables
      where table_schema = current_schema()
        and table_name = '_prisma_migrations'
      limit 1
    `);

    const { rows: tableRows } = await client.query(`
      select table_name
      from information_schema.tables
      where table_schema = current_schema()
        and table_type = 'BASE TABLE'
        and table_name <> '_prisma_migrations'
      limit 1
    `);

    const failedMigrationRows =
      migrationsRows.length > 0
        ? (
            await client.query(`
              select 1
              from "_prisma_migrations"
              where finished_at is null
                and rolled_back_at is null
              limit 1
            `)
          ).rows
        : [];

    const hasMigrationHistory = migrationsRows.length > 0;
    const hasExistingSchema = tableRows.length > 0;
    const hasFailedMigration = failedMigrationRows.length > 0;

    if (hasFailedMigration) {
      console.log("[test-db-sync] Found failed Prisma migration state; resetting local test DB...");
      await client.end().catch(() => {});
      clientClosed = true;
      resetLocalTestDatabase();
      runPrismaCommand(["migrate", "deploy"]);
      return;
    }

    if (hasMigrationHistory || !hasExistingSchema) {
      console.log("[test-db-sync] Applying Prisma migrations with migrate deploy...");
      runPrismaCommand(["migrate", "deploy"]);
      return;
    }

    console.log(
      "[test-db-sync] Existing test schema has no Prisma migration history; resetting local test DB before applying migrations...",
    );
    await client.end().catch(() => {});
    clientClosed = true;
    resetLocalTestDatabase();
    runPrismaCommand(["migrate", "deploy"]);
  } finally {
    if (!clientClosed) {
      await client.end().catch(() => {});
    }
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
