#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const dotenv = require("dotenv");

const DEFAULT_WINDOWS_BACKUP_DIR = "C:\\CorePOSBackups";
const DEFAULT_STATE_DIR_NAME = ".corepos-runtime";
const LAST_BACKUP_FILENAME = "last-backup.json";

const isWindows = process.platform === "win32";

const log = (message) => {
  console.log(`[deploy-backup] ${message}`);
};

const fail = (message) => {
  console.error(`[deploy-backup] ${message}`);
  process.exit(1);
};

const normalizeOptionalText = (value) => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : null;
};

const resolveRepoPath = () =>
  normalizeOptionalText(process.env.COREPOS_REPO_PATH) || process.cwd();

const readRuntimeEnv = (repoPath) => {
  const envPath = path.join(repoPath, ".env");
  if (!fs.existsSync(envPath)) {
    return {};
  }
  return dotenv.parse(fs.readFileSync(envPath));
};

const resolveDatabaseUrl = (repoPath) => {
  const envDatabaseUrl = normalizeOptionalText(process.env.DATABASE_URL);
  if (envDatabaseUrl) {
    return envDatabaseUrl;
  }

  const runtimeEnv = readRuntimeEnv(repoPath);
  const fileDatabaseUrl = normalizeOptionalText(runtimeEnv.DATABASE_URL);
  if (fileDatabaseUrl) {
    return fileDatabaseUrl;
  }

  fail(`DATABASE_URL was not set and ${path.join(repoPath, ".env")} did not contain one.`);
};

const commandExists = (command) => {
  const check = spawnSync(isWindows ? "where" : "command", isWindows ? [command] : ["-v", command], {
    encoding: "utf8",
    shell: !isWindows,
    stdio: "pipe",
  });
  return check.status === 0 ? check.stdout.split(/\r?\n/)[0].trim() : null;
};

const windowsPgDumpCandidates = () => {
  const roots = ["C:\\Program Files\\PostgreSQL", "C:\\Program Files (x86)\\PostgreSQL"];
  const discovered = [];

  for (const root of roots) {
    try {
      for (const version of fs.readdirSync(root)) {
        discovered.push(path.join(root, version, "bin", "pg_dump.exe"));
        discovered.push(path.join(root, version, "pgAdmin 4", "runtime", "pg_dump.exe"));
      }
    } catch {
      // Optional install location.
    }
  }

  return discovered;
};

const resolvePgDump = () => {
  const configured = normalizeOptionalText(process.env.PG_DUMP_BIN);
  if (configured) {
    if (!fs.existsSync(configured)) {
      fail(`PG_DUMP_BIN points to a missing file: ${configured}`);
    }
    return configured;
  }

  const fromPath = commandExists("pg_dump");
  if (fromPath) {
    return fromPath;
  }

  const candidates = isWindows
    ? windowsPgDumpCandidates()
    : [
        "/opt/homebrew/bin/pg_dump",
        "/opt/homebrew/opt/libpq/bin/pg_dump",
        "/usr/local/bin/pg_dump",
        "/usr/local/opt/libpq/bin/pg_dump",
      ];

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (found) {
    return found;
  }

  fail("pg_dump is required but was not found on PATH or common install paths.");
};

const runGit = (repoPath, args, fallback = "unknown") => {
  const result = spawnSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    return fallback;
  }
  return result.stdout.trim() || fallback;
};

const resolveBackupDir = (repoPath) =>
  normalizeOptionalText(process.env.COREPOS_BACKUP_DIR) ||
  (isWindows ? DEFAULT_WINDOWS_BACKUP_DIR : path.join(repoPath, "backups"));

const resolveStateDir = (repoPath) =>
  normalizeOptionalText(process.env.COREPOS_RELEASE_STATE_DIR) ||
  path.join(repoPath, DEFAULT_STATE_DIR_NAME);

const runPgDump = ({ pgDumpBin, databaseUrl, outputPath }) => {
  const args = [
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    `--file=${outputPath}`,
    databaseUrl,
  ];

  log(`Running pg_dump to ${outputPath}`);
  const result = spawnSync(pgDumpBin, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    fail(`pg_dump exited with code ${result.status ?? "unknown"}.`);
  }
};

const writeBackupMetadata = ({ metadataPath, outputPath, commit }) => {
  const payload = {
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    path: outputPath,
    commit,
  };

  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  fs.writeFileSync(metadataPath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
  });

  // Fail early if the marker is not valid JSON for the release guard.
  JSON.parse(fs.readFileSync(metadataPath, "utf8").replace(/^\uFEFF/, ""));
  return payload;
};

const main = () => {
  const repoPath = path.resolve(resolveRepoPath());
  if (!fs.existsSync(repoPath)) {
    fail(`Runtime checkout was not found at ${repoPath}`);
  }

  const databaseUrl = resolveDatabaseUrl(repoPath);
  const pgDumpBin = resolvePgDump();
  const backupDir = resolveBackupDir(repoPath);
  const stateDir = resolveStateDir(repoPath);
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const outputPath = path.join(backupDir, `corepos_pre_deploy_${timestamp}.dump`);
  const metadataPath = path.join(stateDir, LAST_BACKUP_FILENAME);
  const commit = runGit(repoPath, ["rev-parse", "HEAD"]);

  fs.mkdirSync(backupDir, { recursive: true });
  runPgDump({ pgDumpBin, databaseUrl, outputPath });

  const stat = fs.statSync(outputPath);
  if (!stat.isFile() || stat.size <= 0) {
    fail(`Backup file was not created correctly at ${outputPath}`);
  }

  const metadata = writeBackupMetadata({ metadataPath, outputPath, commit });
  log(`Backup metadata written to ${metadataPath}`);
  log(`Backup ready: ${metadata.path}`);
};

main();
