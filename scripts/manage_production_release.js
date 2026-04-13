#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const STATE_SCHEMA_VERSION = 1;
const STATE_DIR_NAME = ".corepos-runtime";
const SUCCESS_HISTORY_FILENAME = "successful-releases.json";
const CURRENT_RELEASE_FILENAME = "current-release.json";
const LAST_RESULT_FILENAME = "last-release-result.json";
const LAST_SUMMARY_FILENAME = "last-release-summary.md";
const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const ROLLBACK_WORKFLOW_NAME = "Rollback CorePOS Production";
const HEALTHCHECK_SCRIPT_PATH = path.join(__dirname, "deploy_health_check.js");
const PACKAGE_JSON_PATH = "package.json";
const MIGRATIONS_TREE_PATH = "prisma/migrations";

const usage = () => {
  console.error(`Usage:
  node scripts/manage_production_release.js deploy
  node scripts/manage_production_release.js rollback [--target previous_successful|specific_sha] [--sha <commit>]

Required environment:
  COREPOS_REPO_PATH          Runtime checkout path (for example C:\\CorePOS)
  COREPOS_DEPLOY_ENTRYPOINT  Windows deploy entrypoint used for build/restart handoff

Optional:
  COREPOS_RELEASE_SKIP_ENTRYPOINT=1     Skip the external entrypoint (for dry-run validation only)
  COREPOS_DEPLOY_BASE_URL               Base URL for production health probes (default http://127.0.0.1:3000)
  COREPOS_RELEASE_STATE_DIR             Override the durable release-state folder
  COREPOS_ROLLBACK_WORKFLOW_NAME        Override the workflow name shown in summaries
`);
};

const parseArgs = (argv) => {
  const [operation, ...rest] = argv;

  if (!operation || operation === "--help" || operation === "-h") {
    usage();
    process.exit(operation ? 0 : 1);
  }

  if (!["deploy", "rollback"].includes(operation)) {
    throw new Error(`Unsupported operation: ${operation}`);
  }

  const options = {
    operation,
    targetMode: "previous_successful",
    specificSha: "",
    skipEntrypoint: process.env.COREPOS_RELEASE_SKIP_ENTRYPOINT === "1",
  };

  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];

    if (argument === "--target") {
      const value = rest[index + 1];
      if (!value) {
        throw new Error("--target requires a value.");
      }
      if (!["previous_successful", "specific_sha"].includes(value)) {
        throw new Error(`Unsupported rollback target mode: ${value}`);
      }
      options.targetMode = value;
      index += 1;
      continue;
    }

    if (argument === "--sha") {
      const value = rest[index + 1];
      if (!value) {
        throw new Error("--sha requires a commit value.");
      }
      options.specificSha = value.trim();
      index += 1;
      continue;
    }

    throw new Error(`Unsupported argument: ${argument}`);
  }

  if (options.operation === "rollback" && options.targetMode === "specific_sha" && !options.specificSha) {
    throw new Error("Rollback target mode specific_sha requires --sha <commit>.");
  }

  return options;
};

const normalizeBaseUrl = (value) => value.replace(/\/+$/, "");

const baseUrl = normalizeBaseUrl(process.env.COREPOS_DEPLOY_BASE_URL || DEFAULT_BASE_URL);

const resolveConfig = (options) => {
  const repoPath = process.env.COREPOS_REPO_PATH?.trim();
  if (!repoPath) {
    throw new Error("COREPOS_REPO_PATH must be set.");
  }

  if (!fs.existsSync(repoPath)) {
    throw new Error(`Runtime checkout was not found at ${repoPath}`);
  }

  const entrypointPath = process.env.COREPOS_DEPLOY_ENTRYPOINT?.trim() || "";
  if (!entrypointPath && !options.skipEntrypoint) {
    throw new Error("COREPOS_DEPLOY_ENTRYPOINT must be set unless COREPOS_RELEASE_SKIP_ENTRYPOINT=1.");
  }

  const stateDir = process.env.COREPOS_RELEASE_STATE_DIR?.trim() || path.join(repoPath, STATE_DIR_NAME);
  return {
    ...options,
    repoPath,
    entrypointPath,
    stateDir,
    historyPath: path.join(stateDir, SUCCESS_HISTORY_FILENAME),
    currentReleasePath: path.join(stateDir, CURRENT_RELEASE_FILENAME),
    resultPath: path.join(stateDir, LAST_RESULT_FILENAME),
    summaryPath: path.join(stateDir, LAST_SUMMARY_FILENAME),
    rollbackWorkflowName:
      process.env.COREPOS_ROLLBACK_WORKFLOW_NAME?.trim() || ROLLBACK_WORKFLOW_NAME,
  };
};

const ensureStateDir = (stateDir) => {
  fs.mkdirSync(stateDir, { recursive: true });
};

const writeFileAtomic = (filePath, content) => {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, content);
  fs.renameSync(tempPath, filePath);
};

const writeJsonAtomic = (filePath, value) => {
  writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const serializeCommand = (command, args) => [command, ...args].join(" ");

const runCommand = (command, args, options = {}) => {
  const {
    cwd,
    capture = false,
    allowFailure = false,
    env = process.env,
    echoCaptured = false,
  } = options;

  const serialized = serializeCommand(command, args);
  console.log(`[corepos-release] ${serialized}`);

  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });

  if (capture && echoCaptured) {
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
  }

  if (result.error) {
    if (allowFailure) {
      return result;
    }
    throw result.error;
  }

  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${serialized} exited with code ${result.status ?? "unknown"}.`);
  }

  return result;
};

const runGitCapture = (repoPath, args, options = {}) =>
  runCommand("git", ["-C", repoPath, ...args], {
    capture: true,
    ...options,
  });

const runGit = (repoPath, args) =>
  runCommand("git", ["-C", repoPath, ...args]);

const runGitStdout = (repoPath, args) => {
  const result = runGitCapture(repoPath, args);
  return (result.stdout || "").trim();
};

const readJsonFile = (filePath, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
};

const readSuccessHistory = (historyPath) => {
  const fallback = {
    schemaVersion: STATE_SCHEMA_VERSION,
    updatedAt: null,
    releases: [],
  };
  const history = readJsonFile(historyPath, fallback);
  if (!Array.isArray(history.releases)) {
    return fallback;
  }
  return history;
};

const readPackageVersionFromString = (raw, fallback = null) => {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed.version === "string" && parsed.version.trim() ? parsed.version.trim() : fallback;
  } catch {
    return fallback;
  }
};

const readPackageVersionFromCheckout = (repoPath) => {
  const packageJsonPath = path.join(repoPath, PACKAGE_JSON_PATH);
  try {
    return readPackageVersionFromString(fs.readFileSync(packageJsonPath, "utf8"), null);
  } catch {
    return null;
  }
};

const resolveCommitInfo = (repoPath, ref = "HEAD") => {
  const commit = runGitStdout(repoPath, ["rev-parse", ref]);
  const shortCommit = runGitStdout(repoPath, ["rev-parse", "--short", ref]);
  return {
    commit,
    shortCommit,
  };
};

const readReleaseInfoFromCheckout = (repoPath, ref = "HEAD") => {
  const commitInfo = resolveCommitInfo(repoPath, ref);
  return {
    ...commitInfo,
    version: readPackageVersionFromCheckout(repoPath),
  };
};

const readReleaseInfoAtRef = (repoPath, ref) => {
  const commitInfo = resolveCommitInfo(repoPath, ref);
  const packageJson = runGitStdout(repoPath, ["show", `${ref}:${PACKAGE_JSON_PATH}`]);
  return {
    ...commitInfo,
    version: readPackageVersionFromString(packageJson, null),
  };
};

const formatRelease = (release) => {
  if (!release) {
    return "unknown";
  }

  const version = release.version ? `v${release.version}` : "version unknown";
  const shortCommit = release.shortCommit || (release.commit ? release.commit.slice(0, 7) : "commit unknown");
  return `${version} (${shortCommit})`;
};

const readMigrationNamesAtRef = (repoPath, ref) => {
  const result = runGitCapture(repoPath, ["ls-tree", "-d", "--name-only", `${ref}:${MIGRATIONS_TREE_PATH}`], {
    allowFailure: true,
  });

  if (result.status !== 0) {
    return [];
  }

  return (result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
};

const compareMigrationSets = (currentMigrationNames, targetMigrationNames) => {
  const targetSet = new Set(targetMigrationNames);
  const missingFromTarget = currentMigrationNames.filter((name) => !targetSet.has(name));
  if (missingFromTarget.length === 0) {
    return null;
  }

  const listedNames =
    missingFromTarget.length > 6
      ? `${missingFromTarget.slice(0, 6).join(", ")} (+${missingFromTarget.length - 6} more)`
      : missingFromTarget.join(", ");

  return `Target release is missing ${missingFromTarget.length} migration ${missingFromTarget.length === 1 ? "directory" : "directories"} present in the current checkout (${listedNames}). If any of those migrations ran in production, restore the verified database backup before reopening the app on the rolled-back code.`;
};

const resolveVersionEndpointUrl = () =>
  process.env.COREPOS_DEPLOY_VERSION_URL || `${baseUrl}/api/system/version`;

const fetchJson = async (url) => {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
    },
    signal: AbortSignal.timeout(Number.parseInt(process.env.COREPOS_DEPLOY_REQUEST_TIMEOUT_MS || "5000", 10)),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}: ${body.slice(0, 400)}`);
  }

  return JSON.parse(body);
};

const readLiveVersionInfo = async () => {
  try {
    const json = await fetchJson(resolveVersionEndpointUrl());
    return {
      version: typeof json?.app?.version === "string" ? json.app.version : null,
      revision: typeof json?.app?.revision === "string" ? json.app.revision : null,
      raw: json,
    };
  } catch (error) {
    return {
      version: null,
      revision: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const probePm2Status = () => {
  const result = runCommand("pm2", ["jlist"], {
    capture: true,
    allowFailure: true,
  });

  if (result.error || result.status !== 0) {
    return {
      available: false,
      found: false,
      processName: "corepos",
      status: null,
    };
  }

  try {
    const processes = JSON.parse(result.stdout || "[]");
    const coreposProcess = Array.isArray(processes)
      ? processes.find((processInfo) => {
          if (!processInfo || typeof processInfo !== "object") {
            return false;
          }
          const topLevelName =
            typeof processInfo.name === "string" ? processInfo.name : "";
          const pm2EnvName =
            processInfo.pm2_env && typeof processInfo.pm2_env.name === "string"
              ? processInfo.pm2_env.name
              : "";
          return topLevelName === "corepos" || pm2EnvName === "corepos";
        })
      : null;

    return {
      available: true,
      found: Boolean(coreposProcess),
      processName: "corepos",
      status:
        coreposProcess &&
        coreposProcess.pm2_env &&
        typeof coreposProcess.pm2_env.status === "string"
          ? coreposProcess.pm2_env.status
          : null,
    };
  } catch {
    return {
      available: true,
      found: false,
      processName: "corepos",
      status: null,
    };
  }
};

const runEntrypoint = (config) => {
  if (config.skipEntrypoint) {
    console.log("[corepos-release] Skipping external deploy entrypoint by request.");
    return {
      outcome: "skipped",
      exitCode: null,
    };
  }

  const entrypointCommand =
    process.platform === "win32"
      ? {
          command: "cmd.exe",
          args: ["/d", "/s", "/c", config.entrypointPath],
        }
      : {
          command: config.entrypointPath,
          args: [],
        };

  const result = runCommand(entrypointCommand.command, entrypointCommand.args, {
    cwd: config.repoPath,
    allowFailure: true,
  });

  if (result.error || result.status !== 0) {
    const message = result.error
      ? result.error.message
      : `Deploy entrypoint exited with code ${result.status ?? "unknown"}.`;
    throw new Error(message);
  }

  return {
    outcome: "succeeded",
    exitCode: result.status ?? 0,
  };
};

const runHealthCheck = () => {
  const result = runCommand(process.execPath, [HEALTHCHECK_SCRIPT_PATH], {
    allowFailure: true,
  });

  if (result.error || result.status !== 0) {
    const message = result.error
      ? result.error.message
      : `Deployment health checks exited with code ${result.status ?? "unknown"}.`;
    throw new Error(message);
  }

  return {
    outcome: "passed",
    exitCode: result.status ?? 0,
  };
};

const createReleaseEntry = ({ operation, currentBefore, finalRelease, targetRelease, pm2Status }) => ({
  recordedAt: new Date().toISOString(),
  operation,
  commit: finalRelease.commit,
  shortCommit: finalRelease.shortCommit,
  version: finalRelease.version,
  healthStatus: "passed",
  currentBeforeCommit: currentBefore.commit,
  currentBeforeVersion: currentBefore.version,
  targetCommit: targetRelease.commit,
  targetVersion: targetRelease.version,
  pm2Status: pm2Status.status,
});

const updateKnownGoodState = (config, releaseEntry) => {
  ensureStateDir(config.stateDir);
  const history = readSuccessHistory(config.historyPath);
  const nextHistory = {
    schemaVersion: STATE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    releases: [...history.releases, releaseEntry],
  };

  writeJsonAtomic(config.historyPath, nextHistory);
  writeJsonAtomic(config.currentReleasePath, {
    schemaVersion: STATE_SCHEMA_VERSION,
    updatedAt: nextHistory.updatedAt,
    release: releaseEntry,
  });
};

const summarizeWarnings = (warnings) => {
  if (!Array.isArray(warnings) || warnings.length === 0) {
    return "";
  }

  return [
    "",
    "### Warnings",
    ...warnings.map((warning) => `- ${warning}`),
  ].join("\n");
};

const buildSummaryMarkdown = (config, result) => {
  const summaryLines = [
    `## CorePOS ${result.operation}`,
    "",
    `- Result: ${result.result}`,
    `- Runtime checkout: ${config.repoPath}`,
    `- Current release before ${result.operation}: ${formatRelease(result.currentBefore)} (${result.currentBefore.commit || "unknown"})`,
    `- Target release: ${formatRelease(result.targetRelease)} (${result.targetRelease?.commit || "unknown"})`,
    `- Entrypoint outcome: ${result.entrypoint.outcome}`,
    `- PM2 status after entrypoint: ${result.pm2.available ? (result.pm2.found ? result.pm2.status || "unknown" : "corepos process not found") : "pm2 unavailable"}`,
    `- Health-check result: ${result.healthCheck.outcome}`,
    `- Final deployed release: ${result.finalRelease ? `${formatRelease(result.finalRelease)} (${result.finalRelease.commit})` : "not confirmed"}`,
    `- Known-good release history updated: ${result.historyUpdated ? "yes" : "no"}`,
  ];

  if (result.liveRelease?.version || result.liveRelease?.revision || result.liveRelease?.error) {
    summaryLines.push(
      `- Live version endpoint: ${
        result.liveRelease.error
          ? `unavailable (${result.liveRelease.error})`
          : `v${result.liveRelease.version || "unknown"} (${result.liveRelease.revision || "unknown"})`
      }`,
    );
  }

  summaryLines.push(
    "",
    "### Health probes",
    `- ${baseUrl}/health?details=1`,
    `- ${resolveVersionEndpointUrl()}`,
    `- ${process.env.COREPOS_DEPLOY_FRONTEND_URL || `${baseUrl}/login`}`,
  );

  if (result.operation === "deploy") {
    summaryLines.push(
      "",
      "### Manual rollback",
      `- Use the \`${config.rollbackWorkflowName}\` workflow to restore the previous known-good release or a specific SHA that already passed health checks.`,
    );
  }

  if (result.operation === "rollback" && result.rollbackSelection) {
    summaryLines.push(
      "",
      "### Rollback target source",
      `- ${result.rollbackSelection}`,
    );
  }

  const warningsSection = summarizeWarnings(result.warnings);
  if (warningsSection) {
    summaryLines.push(warningsSection);
  }

  if (result.error) {
    summaryLines.push(
      "",
      "### Failure detail",
      `- ${result.error}`,
    );
  }

  return `${summaryLines.join("\n")}\n`;
};

const writeArtifacts = (config, result) => {
  ensureStateDir(config.stateDir);
  result.finishedAt = new Date().toISOString();
  writeJsonAtomic(config.resultPath, result);
  writeFileAtomic(config.summaryPath, buildSummaryMarkdown(config, result));
};

const findReleaseIndexForCommit = (history, commit) => {
  for (let index = history.releases.length - 1; index >= 0; index -= 1) {
    if (history.releases[index]?.commit === commit) {
      return index;
    }
  }
  return -1;
};

const resolveRollbackTarget = (config, currentBefore) => {
  const history = readSuccessHistory(config.historyPath);
  if (history.releases.length === 0) {
    throw new Error("No known-good release history is recorded yet, so rollback is unsafe.");
  }

  if (config.targetMode === "specific_sha") {
    const targetCommit = runGitStdout(config.repoPath, ["rev-parse", "--verify", `${config.specificSha}^{commit}`]);
    const targetRelease = history.releases.find((release) => release.commit === targetCommit);
    if (!targetRelease) {
      throw new Error(
        `Commit ${targetCommit} is not present in the known-good release history, so rollback was refused.`,
      );
    }
    return {
      targetRelease,
      selection: `specific known-good SHA ${targetCommit}`,
    };
  }

  const currentIndex = findReleaseIndexForCommit(history, currentBefore.commit);
  if (currentIndex === -1) {
    throw new Error(
      `Current checkout commit ${currentBefore.commit} does not appear in the known-good release history, so previous-successful rollback is ambiguous.`,
    );
  }

  if (currentIndex === 0) {
    throw new Error("There is no earlier known-good release recorded before the current checkout.");
  }

  return {
    targetRelease: history.releases[currentIndex - 1],
    selection: `previous known-good release before ${currentBefore.commit}`,
  };
};

const checkoutTarget = (repoPath, targetCommit) => {
  runGit(repoPath, ["reset", "--hard", targetCommit]);
  runGit(repoPath, ["clean", "-fd"]);
};

const fetchOriginMain = (repoPath) => {
  runGit(repoPath, ["fetch", "origin", "--prune"]);
};

const executeDeploy = async (config) => {
  const currentBefore = readReleaseInfoFromCheckout(config.repoPath);
  const result = {
    schemaVersion: STATE_SCHEMA_VERSION,
    operation: "deploy",
    result: "failure",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    currentBefore,
    targetRelease: null,
    finalRelease: null,
    liveRelease: null,
    entrypoint: {
      path: config.entrypointPath || null,
      outcome: config.skipEntrypoint ? "skipped" : "not_run",
    },
    healthCheck: {
      outcome: "not_run",
    },
    pm2: {
      available: false,
      found: false,
      processName: "corepos",
      status: null,
    },
    rollbackSelection: null,
    historyUpdated: false,
    warnings: [],
    error: null,
  };

  try {
    fetchOriginMain(config.repoPath);
    const targetRelease = readReleaseInfoAtRef(config.repoPath, "origin/main");
    result.targetRelease = targetRelease;

    checkoutTarget(config.repoPath, targetRelease.commit);

    result.entrypoint = {
      path: config.entrypointPath || null,
      ...runEntrypoint(config),
    };
    result.pm2 = probePm2Status();
    result.healthCheck = runHealthCheck();
    result.liveRelease = await readLiveVersionInfo();
    result.finalRelease = readReleaseInfoFromCheckout(config.repoPath);

    const releaseEntry = createReleaseEntry({
      operation: "deploy",
      currentBefore,
      finalRelease: result.finalRelease,
      targetRelease,
      pm2Status: result.pm2,
    });
    updateKnownGoodState(config, releaseEntry);
    result.historyUpdated = true;
    result.result = "success";
    return result;
  } catch (error) {
    result.pm2 = probePm2Status();
    result.liveRelease = await readLiveVersionInfo();
    result.finalRelease = readReleaseInfoFromCheckout(config.repoPath);
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  }
};

const executeRollback = async (config) => {
  const currentBefore = readReleaseInfoFromCheckout(config.repoPath);
  const result = {
    schemaVersion: STATE_SCHEMA_VERSION,
    operation: "rollback",
    result: "failure",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    currentBefore,
    targetRelease: null,
    finalRelease: null,
    liveRelease: null,
    entrypoint: {
      path: config.entrypointPath || null,
      outcome: config.skipEntrypoint ? "skipped" : "not_run",
    },
    healthCheck: {
      outcome: "not_run",
    },
    pm2: {
      available: false,
      found: false,
      processName: "corepos",
      status: null,
    },
    rollbackSelection: null,
    historyUpdated: false,
    warnings: [],
    error: null,
  };

  try {
    fetchOriginMain(config.repoPath);

    const { targetRelease: knownGoodTarget, selection } = resolveRollbackTarget(config, currentBefore);
    const targetRelease = readReleaseInfoAtRef(config.repoPath, knownGoodTarget.commit);
    if (targetRelease.commit === currentBefore.commit) {
      throw new Error("Rollback target resolves to the current checkout, so no rollback was performed.");
    }

    result.targetRelease = targetRelease;
    result.rollbackSelection = selection;

    const currentMigrationNames = readMigrationNamesAtRef(config.repoPath, currentBefore.commit);
    const targetMigrationNames = readMigrationNamesAtRef(config.repoPath, targetRelease.commit);
    const rollbackWarning = compareMigrationSets(currentMigrationNames, targetMigrationNames);
    if (rollbackWarning) {
      result.warnings.push(rollbackWarning);
    }

    checkoutTarget(config.repoPath, targetRelease.commit);

    result.entrypoint = {
      path: config.entrypointPath || null,
      ...runEntrypoint(config),
    };
    result.pm2 = probePm2Status();
    result.healthCheck = runHealthCheck();
    result.liveRelease = await readLiveVersionInfo();
    result.finalRelease = readReleaseInfoFromCheckout(config.repoPath);

    const releaseEntry = createReleaseEntry({
      operation: "rollback",
      currentBefore,
      finalRelease: result.finalRelease,
      targetRelease,
      pm2Status: result.pm2,
    });
    updateKnownGoodState(config, releaseEntry);
    result.historyUpdated = true;
    result.result = "success";
    return result;
  } catch (error) {
    result.pm2 = probePm2Status();
    result.liveRelease = await readLiveVersionInfo();
    result.finalRelease = readReleaseInfoFromCheckout(config.repoPath);
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  }
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const config = resolveConfig(options);
  ensureStateDir(config.stateDir);

  const result =
    options.operation === "deploy"
      ? await executeDeploy(config)
      : await executeRollback(config);

  writeArtifacts(config, result);
  process.stdout.write(fs.readFileSync(config.summaryPath, "utf8"));

  if (result.result !== "success") {
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(`[corepos-release] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
