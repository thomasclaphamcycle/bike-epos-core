#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const DEFAULT_BRANCH = "main";
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_WINDOWS_REPO_PATH = "C:\\CorePOS";
const DEFAULT_WINDOWS_BASE_URL = "http://127.0.0.1:3100";

const usage = `Usage: node scripts/check_sync.js [options]

Compare the local checkout, origin/<branch>, and optionally a live CorePOS runtime.

Options:
  --branch <name>              Branch to compare against on origin (default: main)
  --no-fetch                   Skip "git fetch origin --prune" before comparing
  --timeout-ms <ms>            HTTP timeout for runtime probes (default: 5000)
  --live-base-url <url>        Probe a directly reachable live CorePOS base URL
  --windows-ssh <user@host>    SSH into the Windows host and inspect its runtime locally
  --windows-repo-path <path>   Runtime repo path on Windows (default: C:\\CorePOS)
  --windows-base-url <url>     Base URL to probe from Windows (default: http://127.0.0.1:3100)
  -h, --help                   Show this help

Examples:
  npm run sync:check
  npm run sync:check -- --live-base-url https://corepos.example.com
  npm run sync:check -- --windows-ssh coreposadmin@shop-pc
  npm run sync:check -- --windows-ssh coreposadmin@shop-pc --windows-repo-path D:\\CorePOS
`;

const normalizeBaseUrl = (value) => value.replace(/\/+$/, "");

const preview = (value) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 200 ? `${text.slice(0, 200)}...` : text;
};

const revisionsMatch = (actual, expected) => {
  if (!actual || !expected) {
    return false;
  }

  return actual === expected || actual.startsWith(expected) || expected.startsWith(actual);
};

const parsePositiveInteger = (value, label) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
};

const parseArgs = (argv) => {
  const options = {
    branch: DEFAULT_BRANCH,
    fetchOrigin: true,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    liveBaseUrl: "",
    windowsSsh: "",
    windowsRepoPath: DEFAULT_WINDOWS_REPO_PATH,
    windowsBaseUrl: DEFAULT_WINDOWS_BASE_URL,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--branch":
        index += 1;
        options.branch = argv[index] || "";
        break;
      case "--no-fetch":
        options.fetchOrigin = false;
        break;
      case "--timeout-ms":
        index += 1;
        options.timeoutMs = parsePositiveInteger(argv[index], "--timeout-ms");
        break;
      case "--live-base-url":
        index += 1;
        options.liveBaseUrl = argv[index] || "";
        break;
      case "--windows-ssh":
        index += 1;
        options.windowsSsh = argv[index] || "";
        break;
      case "--windows-repo-path":
        index += 1;
        options.windowsRepoPath = argv[index] || "";
        break;
      case "--windows-base-url":
        index += 1;
        options.windowsBaseUrl = argv[index] || "";
        break;
      case "-h":
      case "--help":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.liveBaseUrl) {
    options.liveBaseUrl = normalizeBaseUrl(options.liveBaseUrl);
  }
  if (options.windowsBaseUrl) {
    options.windowsBaseUrl = normalizeBaseUrl(options.windowsBaseUrl);
  }
  if (!options.branch) {
    throw new Error("--branch requires a value.");
  }
  if (!options.windowsRepoPath) {
    throw new Error("--windows-repo-path requires a value.");
  }
  if (!options.windowsBaseUrl) {
    throw new Error("--windows-base-url requires a value.");
  }

  return options;
};

const formatCommandFailure = (command, args, result) => {
  const details = [result.stderr, result.stdout]
    .map((value) => (value || "").trim())
    .filter(Boolean)
    .join(" ");
  return `${command} ${args.join(" ")} exited with ${result.status ?? "unknown"}${details ? `: ${preview(details)}` : ""}`;
};

const runCommand = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    ...options,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(formatCommandFailure(command, args, result));
  }

  return (result.stdout || "").trim();
};

const parseJson = (label, text) => {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} returned non-JSON content: ${preview(text)}`);
  }
};

const fetchJson = async (label, url, timeoutMs) => {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}: ${preview(text)}`);
  }

  return parseJson(label, text);
};

const escapePowerShellSingleQuoted = (value) => String(value).replace(/'/g, "''");

const encodePowerShellScript = (script) => Buffer.from(script, "utf16le").toString("base64");

const buildWindowsProbeScript = ({ repoPath, baseUrl, timeoutSec }) => `
$ErrorActionPreference = "Stop"
$repoPath = '${escapePowerShellSingleQuoted(repoPath)}'
$baseUrl = '${escapePowerShellSingleQuoted(baseUrl)}'
$dirtyLines = @(git -C $repoPath status --porcelain)
$branchLine = git -C $repoPath status --short --branch | Select-Object -First 1
$repoHead = (git -C $repoPath rev-parse HEAD).Trim()
$version = Invoke-RestMethod -Uri "$baseUrl/api/system/version" -TimeoutSec ${timeoutSec}
$health = Invoke-RestMethod -Uri "$baseUrl/health?details=1" -TimeoutSec ${timeoutSec}
$result = [ordered]@{
  repoPath = $repoPath
  branch = [string]$branchLine
  clean = ($dirtyLines.Count -eq 0)
  dirtyCount = $dirtyLines.Count
  repoHead = [string]$repoHead
  liveVersion = [string]$version.app.version
  liveRevision = [string]$version.app.revision
  healthStatus = [string]$health.status
  databaseStatus = [string]$health.checks.database.status
  migrationsStatus = [string]$health.checks.migrations.status
}
[pscustomobject]$result | ConvertTo-Json -Compress
`;

const parseRemoteJson = (label, text) => {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(`${label} returned empty output.`);
  }

  const candidates = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"));
  const payload = candidates.at(-1) || trimmed;
  return parseJson(label, payload);
};

const results = [];

const addResult = (status, area, name, detail) => {
  results.push({
    status,
    area,
    name,
    detail,
  });
};

const printResults = () => {
  const statusWidth = Math.max(...results.map((result) => result.status.length), "STATUS".length);
  const areaWidth = Math.max(...results.map((result) => result.area.length), "AREA".length);
  const nameWidth = Math.max(...results.map((result) => result.name.length), "CHECK".length);

  console.log("");
  console.log(
    `${"STATUS".padEnd(statusWidth)}  ${"AREA".padEnd(areaWidth)}  ${"CHECK".padEnd(nameWidth)}  DETAIL`,
  );
  console.log(
    `${"-".repeat(statusWidth)}  ${"-".repeat(areaWidth)}  ${"-".repeat(nameWidth)}  ${"-".repeat(40)}`,
  );

  for (const result of results) {
    console.log(
      `${result.status.padEnd(statusWidth)}  ${result.area.padEnd(areaWidth)}  ${result.name.padEnd(nameWidth)}  ${result.detail}`,
    );
  }
};

const collectLocalGitState = (branch, shouldFetch) => {
  if (shouldFetch) {
    runCommand("git", ["fetch", "origin", "--prune"]);
  }

  const currentBranch = runCommand("git", ["branch", "--show-current"]);
  const localHead = runCommand("git", ["rev-parse", "HEAD"]);
  const originHead = runCommand("git", ["rev-parse", `origin/${branch}`]);
  const dirty = runCommand("git", ["status", "--porcelain"]);

  addResult("PASS", "local", "branch", currentBranch || "(detached HEAD)");
  addResult(
    dirty ? "WARN" : "PASS",
    "local",
    "working tree",
    dirty ? "Local checkout has uncommitted changes" : "Local checkout is clean",
  );
  addResult(
    localHead === originHead ? "PASS" : "FAIL",
    "git",
    `HEAD vs origin/${branch}`,
    `${localHead} ${localHead === originHead ? "matches" : "differs from"} origin/${branch} ${originHead}`,
  );

  return { localHead, originHead };
};

const collectLiveHttpState = async (baseUrl, timeoutMs, expectedRevision, areaLabel) => {
  const version = await fetchJson("Version endpoint", `${baseUrl}/api/system/version`, timeoutMs);
  const health = await fetchJson("Detailed health endpoint", `${baseUrl}/health?details=1`, timeoutMs);

  const liveRevision = version.app?.revision || "";
  const liveVersion = version.app?.version || "unknown";
  const healthStatus = health.status || "unknown";
  const databaseStatus = health.checks?.database?.status || "unknown";
  const migrationsStatus = health.checks?.migrations?.status || "unknown";
  const healthOk =
    healthStatus === "ok" && databaseStatus === "ok" && migrationsStatus === "ok";
  const revisionMatches = revisionsMatch(liveRevision, expectedRevision);

  addResult(
    healthOk ? "PASS" : "FAIL",
    areaLabel,
    "runtime health",
    `status=${healthStatus} database=${databaseStatus} migrations=${migrationsStatus}`,
  );
  addResult(
    revisionMatches ? "PASS" : "FAIL",
    areaLabel,
    "live revision",
    `revision=${liveRevision || "missing"} expected=${expectedRevision} version=${liveVersion}`,
  );
};

const collectWindowsSshState = (target, repoPath, baseUrl, timeoutMs, expectedRevision, branch) => {
  const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
  const encodedScript = encodePowerShellScript(
    buildWindowsProbeScript({ repoPath, baseUrl, timeoutSec }),
  );

  const rawOutput = runCommand("ssh", [
    target,
    "powershell",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    encodedScript,
  ]);

  const remote = parseRemoteJson("Windows SSH probe", rawOutput);

  addResult(
    remote.clean ? "PASS" : "WARN",
    "windows",
    "working tree",
    remote.clean
      ? `${remote.repoPath} is clean`
      : `${remote.repoPath} has ${remote.dirtyCount ?? "unknown"} local modification(s)`,
  );
  addResult(
    remote.repoHead === expectedRevision ? "PASS" : "FAIL",
    "windows",
    `HEAD vs origin/${branch}`,
    `${remote.repoHead || "missing"} ${
      remote.repoHead === expectedRevision ? "matches" : "differs from"
    } origin/${branch} ${expectedRevision}`,
  );

  const healthStatus = remote.healthStatus || "unknown";
  const databaseStatus = remote.databaseStatus || "unknown";
  const migrationsStatus = remote.migrationsStatus || "unknown";
  const healthOk =
    healthStatus === "ok" && databaseStatus === "ok" && migrationsStatus === "ok";
  const revisionMatches = revisionsMatch(remote.liveRevision, expectedRevision);

  addResult(
    healthOk ? "PASS" : "FAIL",
    "windows",
    "runtime health",
    `status=${healthStatus} database=${databaseStatus} migrations=${migrationsStatus}`,
  );
  addResult(
    revisionMatches ? "PASS" : "FAIL",
    "windows",
    "live revision",
    `revision=${remote.liveRevision || "missing"} expected=${expectedRevision} version=${remote.liveVersion || "unknown"}`,
  );
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return;
  }

  console.log(
    `[sync-check] Comparing local checkout, origin/${options.branch}, and any requested live runtime state.`,
  );

  const { originHead } = collectLocalGitState(options.branch, options.fetchOrigin);

  if (options.liveBaseUrl) {
    try {
      await collectLiveHttpState(options.liveBaseUrl, options.timeoutMs, originHead, "live");
    } catch (error) {
      addResult(
        "FAIL",
        "live",
        "probe",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  if (options.windowsSsh) {
    try {
      collectWindowsSshState(
        options.windowsSsh,
        options.windowsRepoPath,
        options.windowsBaseUrl,
        options.timeoutMs,
        originHead,
        options.branch,
      );
    } catch (error) {
      addResult(
        "FAIL",
        "windows",
        "ssh probe",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  if (!options.liveBaseUrl && !options.windowsSsh) {
    addResult(
      "WARN",
      "sync",
      "remote runtime",
      "No live runtime was checked. Use --live-base-url or --windows-ssh for deployment verification.",
    );
  }

  printResults();

  const failCount = results.filter((result) => result.status === "FAIL").length;
  const warnCount = results.filter((result) => result.status === "WARN").length;
  const passCount = results.filter((result) => result.status === "PASS").length;

  console.log("");
  console.log(`Sync summary: ${passCount} pass, ${warnCount} warn, ${failCount} fail`);

  if (failCount > 0) {
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(`[sync-check] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
