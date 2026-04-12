#!/usr/bin/env node
require("dotenv").config({ path: ".env.test" });

const { spawnSync } = require("node:child_process");
const { Client } = require("pg");

const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

const formatDatabaseTarget = (databaseUrl) => {
  try {
    const url = new URL(databaseUrl);
    const databaseName = url.pathname.replace(/^\//, "") || "(unknown-db)";
    const host = url.hostname || "(unknown-host)";
    const port = url.port || "5432";
    const username = url.username ? `${decodeURIComponent(url.username)}@` : "";
    return `${username}${host}:${port}/${databaseName}`;
  } catch {
    return "(unparseable database url)";
  }
};

const formatError = (error) => {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const details = [error.message];

  if (typeof error.code === "string") {
    details.push(`code=${error.code}`);
  }

  if (typeof error.severity === "string") {
    details.push(`severity=${error.severity}`);
  }

  if (typeof error.detail === "string" && error.detail.length > 0) {
    details.push(`detail=${error.detail}`);
  }

  if (typeof error.hint === "string" && error.hint.length > 0) {
    details.push(`hint=${error.hint}`);
  }

  return details.join("\n");
};

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

const DATABASE_TARGET = formatDatabaseTarget(DATABASE_URL);

const runPrismaCommand = (args) => {
  const commandLabel = `npx prisma ${args.join(" ")}`;
  const result = spawnSync("npx", ["prisma", ...args], {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL,
    },
    shell: process.platform === "win32",
  });

  if (result.error) {
    const error = new Error(
      `[test-db-sync] Failed to launch ${commandLabel} while syncing ${DATABASE_TARGET}.`,
    );
    error.cause = result.error;
    throw error;
  }

  if (result.signal) {
    throw new Error(
      `[test-db-sync] ${commandLabel} exited via signal ${result.signal} while syncing ${DATABASE_TARGET}.`,
    );
  }

  if ((result.status ?? 1) !== 0) {
    throw new Error(
      `[test-db-sync] ${commandLabel} failed with exit code ${result.status ?? 1} while syncing ${DATABASE_TARGET}.`,
    );
  }
};

const resetLocalTestDatabase = () => {
  const resetResult = spawnSync("node", ["scripts/reset_test_db.js"], {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });

  if (resetResult.error) {
    const error = new Error(
      `[test-db-sync] Failed to launch local test DB reset for ${DATABASE_TARGET}.`,
    );
    error.cause = resetResult.error;
    throw error;
  }

  if (resetResult.signal) {
    throw new Error(
      `[test-db-sync] Local test DB reset exited via signal ${resetResult.signal} for ${DATABASE_TARGET}.`,
    );
  }

  if ((resetResult.status ?? 1) !== 0) {
    throw new Error(
      `[test-db-sync] Local test DB reset failed with exit code ${resetResult.status ?? 1} for ${DATABASE_TARGET}.`,
    );
  }
};

const main = async () => {
  const client = new Client({ connectionString: DATABASE_URL });
  let clientClosed = false;

  try {
    console.log(`[test-db-sync] Checking Prisma test schema state for ${DATABASE_TARGET}...`);
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
  console.error(formatError(error));

  if (error instanceof Error && error.cause) {
    console.error("[test-db-sync] Caused by:");
    console.error(formatError(error.cause));
  }

  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }

  process.exit(1);
});
