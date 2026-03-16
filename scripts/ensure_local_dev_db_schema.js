#!/usr/bin/env node
require("dotenv/config");

const { spawnSync } = require("node:child_process");
const { Client } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const targetUrl = new URL(DATABASE_URL);
const host = targetUrl.hostname;
const databaseName = targetUrl.pathname.replace(/^\//, "");

if (!["localhost", "127.0.0.1"].includes(host)) {
  console.error(`Refusing to sync non-local database host: ${host}`);
  process.exit(1);
}

if (!databaseName) {
  console.error("DATABASE_URL must include a database name.");
  process.exit(1);
}

if (["postgres", "template0", "template1"].includes(databaseName)) {
  console.error(`Refusing to sync reserved database: ${databaseName}`);
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

const main = async () => {
  const client = new Client({ connectionString: DATABASE_URL });

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
              select migration_name
              from "_prisma_migrations"
              where finished_at is null
                and rolled_back_at is null
              order by started_at asc
            `)
          ).rows
        : [];

    const hasMigrationHistory = migrationsRows.length > 0;
    const hasExistingSchema = tableRows.length > 0;

    if (failedMigrationRows.length > 0) {
      console.log(
        "[dev-db-sync] Found failed Prisma migration state; marking failed migrations rolled back before retrying migrate deploy...",
      );

      for (const row of failedMigrationRows) {
        runPrismaCommand(["migrate", "resolve", "--rolled-back", row.migration_name]);
      }
    }

    if (hasMigrationHistory || !hasExistingSchema) {
      console.log("[dev-db-sync] Applying Prisma migrations with migrate deploy...");
      runPrismaCommand(["migrate", "deploy"]);
      return;
    }

    console.error(
      "[dev-db-sync] Existing local dev schema has no Prisma migration history. Run `node scripts/reset_local_dev_db.js` before reseeding.",
    );
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
