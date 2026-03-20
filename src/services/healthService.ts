import * as fs from "node:fs";
import * as path from "node:path";
import { prisma } from "../lib/prisma";

type HealthCheckStatus = "ok" | "pending" | "error";

type HealthResponse = {
  httpStatus: number;
  body: Record<string, unknown>;
};

type MigrationRecordRow = {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};

const getLocalMigrationNames = () => {
  const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
  if (!fs.existsSync(migrationsDir)) {
    return [] as string[];
  }

  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
};

const getMigrationHealthCheck = async () => {
  const localMigrationNames = getLocalMigrationNames();
  const rows = await prisma.$queryRaw<MigrationRecordRow[]>`
    SELECT migration_name, finished_at, rolled_back_at
    FROM "_prisma_migrations"
    ORDER BY migration_name ASC
  `;

  const appliedMigrationNames = rows
    .filter((row) => row.finished_at !== null && row.rolled_back_at === null)
    .map((row) => row.migration_name);
  const appliedMigrationSet = new Set(appliedMigrationNames);
  const failedMigrationNames = rows
    .filter((row) => row.finished_at === null && row.rolled_back_at === null)
    .map((row) => row.migration_name);
  const pendingMigrationNames = localMigrationNames.filter(
    (migrationName) => !appliedMigrationSet.has(migrationName),
  );

  let status: HealthCheckStatus = "ok";
  if (failedMigrationNames.length > 0) {
    status = "error";
  } else if (pendingMigrationNames.length > 0) {
    status = "pending";
  }

  return {
    status,
    latestAppliedMigration:
      appliedMigrationNames.length > 0
        ? appliedMigrationNames[appliedMigrationNames.length - 1]
        : null,
    appliedCount: appliedMigrationNames.length,
    pendingCount: pendingMigrationNames.length,
    pendingMigrationNames,
    failedMigrationNames,
  };
};

export const getHealthStatus = async (includeDetails = false): Promise<HealthResponse> => {
  if (!includeDetails) {
    return {
      httpStatus: 200,
      body: { status: "ok" },
    };
  }

  const checks: Record<string, unknown> = {};
  let hasError = false;

  const databaseStartedAt = process.hrtime.bigint();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = {
      status: "ok",
      durationMs: Number(process.hrtime.bigint() - databaseStartedAt) / 1_000_000,
    };
  } catch (error) {
    hasError = true;
    checks.database = {
      status: "error",
      durationMs: Number(process.hrtime.bigint() - databaseStartedAt) / 1_000_000,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const migrationStartedAt = process.hrtime.bigint();
  try {
    const migrationStatus = await getMigrationHealthCheck();
    if (migrationStatus.status !== "ok") {
      hasError = true;
    }
    checks.migrations = {
      ...migrationStatus,
      durationMs: Number(process.hrtime.bigint() - migrationStartedAt) / 1_000_000,
    };
  } catch (error) {
    hasError = true;
    checks.migrations = {
      status: "error",
      durationMs: Number(process.hrtime.bigint() - migrationStartedAt) / 1_000_000,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  checks.runtime = {
    status: "ok",
    pid: process.pid,
    nodeVersion: process.version,
    uptimeSeconds: Number(process.uptime().toFixed(3)),
  };

  return {
    httpStatus: hasError ? 503 : 200,
    body: {
      status: hasError ? "degraded" : "ok",
      checks,
    },
  };
};
