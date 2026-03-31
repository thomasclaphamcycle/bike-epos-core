#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createSmokeServerController } = require("./smoke_server_helper");
const {
  listListeningPidsForPort,
  pidExists,
  signalCodeToExitCode,
  waitForPortFree,
} = require("./process_lifecycle");

const FIXTURE_WRAPPER = path.join(
  __dirname,
  "fixtures",
  "process_lifecycle",
  "wrapper_process_fixture.js",
);
const FIXTURE_TS_SERVER = path.join(
  __dirname,
  "fixtures",
  "process_lifecycle",
  "server_process_fixture.ts",
);
const START_TEST_SERVER = path.join(__dirname, "start_test_server.js");
const TMP_ROOT = path.join(__dirname, "..", "tmp", "process-lifecycle-regression");

let portSequence = 0;

const nextPort = () => 36100 + portSequence++;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForFile = async (filePath, timeoutMs = 5000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (fs.existsSync(filePath)) {
      return;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${filePath}`);
};

const waitForHealth = async (baseUrl, timeoutMs = 15000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling.
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for health at ${baseUrl}/health`);
};

const waitForExit = (child) =>
  new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve({
        code: signal ? signalCodeToExitCode(signal) : code ?? 1,
        signal,
      });
    });
  });

const readPid = (filePath) =>
  Number.parseInt(fs.readFileSync(filePath, "utf8").trim(), 10);

const assertClean = async (port, markerDir) => {
  const wrapperPid = readPid(path.join(markerDir, "wrapper.pid"));
  const serverPid = readPid(path.join(markerDir, "server.pid"));
  const portFreed = await waitForPortFree(port, 5000);

  assert.equal(portFreed, true, `Expected port ${port} to be released`);
  assert.equal(listListeningPidsForPort(port).length, 0, `Expected no listener on ${port}`);
  assert.equal(pidExists(wrapperPid), false, `Expected wrapper pid ${wrapperPid} to exit`);
  assert.equal(pidExists(serverPid), false, `Expected server pid ${serverPid} to exit`);
};

const createMarkerDir = (name) => {
  const markerDir = path.join(TMP_ROOT, name);
  fs.rmSync(markerDir, { recursive: true, force: true });
  fs.mkdirSync(markerDir, { recursive: true });
  return markerDir;
};

const runControllerCleanupRegression = async () => {
  const port = nextPort();
  const markerDir = createMarkerDir("controller-stop");
  const baseUrl = `http://127.0.0.1:${port}`;
  const controller = createSmokeServerController({
    label: "process-lifecycle-controller",
    baseUrl,
    startup: {
      command: process.execPath,
      args: [FIXTURE_WRAPPER, String(port), markerDir],
    },
    envOverrides: {
      IGNORE_TERM: "1",
    },
    captureStartupLog: true,
  });

  await controller.startIfNeeded();
  await waitForFile(path.join(markerDir, "wrapper.pid"));
  await waitForFile(path.join(markerDir, "server.pid"));
  await controller.stop();
  await assertClean(port, markerDir);
};

const runSmokeWrapperSignalRegression = async () => {
  const port = nextPort();
  const markerDir = createMarkerDir("run-smoke-test-signal");
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [
      path.join(__dirname, "run_smoke_test.js"),
      FIXTURE_WRAPPER,
      String(port),
      markerDir,
    ],
    {
      cwd: path.join(__dirname, ".."),
      stdio: "inherit",
      env: {
        ...process.env,
        TEST_BASE_URL: baseUrl,
        SMOKE_TEST_TIMEOUT_MS: "30000",
      },
    },
  );

  await waitForHealth(baseUrl);
  process.kill(child.pid, "SIGINT");
  const result = await waitForExit(child);

  assert.equal(result.code, 130, "Expected run_smoke_test SIGINT exit code");
  await assertClean(port, markerDir);
};

const runTestEnvSignalRegression = async () => {
  const port = nextPort();
  const markerDir = createMarkerDir("run-with-test-env-signal");
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [
      path.join(__dirname, "run_with_test_env.js"),
      process.execPath,
      FIXTURE_WRAPPER,
      String(port),
      markerDir,
    ],
    {
      cwd: path.join(__dirname, ".."),
      stdio: "inherit",
      env: {
        ...process.env,
        TEST_BASE_URL: baseUrl,
      },
    },
  );

  await waitForHealth(baseUrl);
  process.kill(child.pid, "SIGTERM");
  const result = await waitForExit(child);

  assert.equal(result.code, 143, "Expected run_with_test_env SIGTERM exit code");
  await assertClean(port, markerDir);
};

const runTestEnvTsNodeRegression = async () => {
  const port = nextPort();
  const markerDir = createMarkerDir("run-with-test-env-ts-node");
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverPidFile = path.join(markerDir, "server.pid");
  const child = spawn(
    process.execPath,
    [
      path.join(__dirname, "run_with_test_env.js"),
      "npx",
      "ts-node",
      "--transpile-only",
      FIXTURE_TS_SERVER,
      String(port),
      serverPidFile,
    ],
    {
      cwd: path.join(__dirname, ".."),
      stdio: "inherit",
      env: {
        ...process.env,
        TEST_BASE_URL: baseUrl,
      },
    },
  );

  await waitForHealth(baseUrl);
  await waitForFile(serverPidFile);

  assert.equal(
    pidExists(child.pid),
    true,
    "Expected run_with_test_env wrapper to stay alive for ts-node server",
  );

  process.kill(child.pid, "SIGTERM");
  const result = await waitForExit(child);
  const serverPid = readPid(serverPidFile);

  assert.equal(result.code, 143, "Expected ts-node run_with_test_env SIGTERM exit code");
  assert.equal(await waitForPortFree(port, 5000), true, `Expected port ${port} to be released`);
  assert.equal(pidExists(serverPid), false, `Expected ts-node server pid ${serverPid} to exit`);
};

const runStartTestServerSignalRegression = async () => {
  const port = nextPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [START_TEST_SERVER], {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit",
    env: {
      ...process.env,
      TEST_BASE_URL: baseUrl,
      PORT: String(port),
    },
  });

  await waitForHealth(baseUrl);
  assert.equal(pidExists(child.pid), true, "Expected start_test_server process to stay alive");

  process.kill(child.pid, "SIGTERM");
  const result = await waitForExit(child);

  assert.equal(result.code, 0, "Expected start_test_server SIGTERM to exit cleanly");
  assert.equal(await waitForPortFree(port, 5000), true, `Expected port ${port} to be released`);
};

const main = async () => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TMP_ROOT, { recursive: true });

  console.log("[process-lifecycle] controller stop regression");
  await runControllerCleanupRegression();

  console.log("[process-lifecycle] run_smoke_test signal regression");
  await runSmokeWrapperSignalRegression();

  console.log("[process-lifecycle] run_with_test_env signal regression");
  await runTestEnvSignalRegression();

  console.log("[process-lifecycle] run_with_test_env ts-node regression");
  await runTestEnvTsNodeRegression();

  console.log("[process-lifecycle] start_test_server signal regression");
  await runStartTestServerSignalRegression();

  console.log("[process-lifecycle] all regressions passed");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
