#!/usr/bin/env node
require("dotenv").config({ path: ".env.test" });

const { applyTestEnvDefaults } = require("./test_env_defaults");
const {
  cleanupNewManagedRepoProcesses,
  installSignalHandlers,
  signalCodeToExitCode,
  snapshotManagedRepoProcesses,
  spawnManagedProcess,
  terminateChildProcess,
} = require("./process_lifecycle");

const smokeScript = process.argv[2];
const smokeArgs = process.argv.slice(3);

if (!smokeScript) {
  console.error("Usage: node scripts/run_smoke_test.js <script-path> [...args]");
  process.exit(1);
}

const env = applyTestEnvDefaults({
  ...process.env,
  AUTH_MODE: process.env.AUTH_MODE || "real",
  ALLOW_EXISTING_SERVER: process.env.ALLOW_EXISTING_SERVER || "0",
});

const SMOKE_TEST_TIMEOUT_MS = Number.parseInt(
  process.env.SMOKE_TEST_TIMEOUT_MS || "300000",
  10,
);
const SMOKE_TEST_KILL_WAIT_MS = Number.parseInt(
  process.env.SMOKE_TEST_KILL_WAIT_MS || "2000",
  10,
);

const formatDuration = (durationMs) => {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  const totalSeconds = durationMs / 1000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}m ${seconds.toFixed(1)}s`;
};

const log = (message) => {
  console.error(`[run_smoke_test] ${message}`);
};

const run = async () => {
  const beforeSnapshot = snapshotManagedRepoProcesses();
  const startedAt = Date.now();
  const child = spawnManagedProcess(process.execPath, [smokeScript, ...smokeArgs], {
    stdio: "inherit",
    env,
  });
  log(`Spawned ${smokeScript} as pid ${child.pid}`);

  let timeoutTimer = null;
  let releaseSignalHandlers = () => {};
  let finishPromise = null;
  let requestedExitCode = null;

  const finish = async (initialCode) => {
    if (finishPromise) {
      return finishPromise;
    }

    finishPromise = (async () => {
      clearTimeout(timeoutTimer);
      releaseSignalHandlers();

      let finalCode = requestedExitCode ?? initialCode;
      const leakResult = await cleanupNewManagedRepoProcesses(beforeSnapshot, {
        label: `run_smoke_test ${smokeScript}`,
        log,
      });

      if (leakResult.leaked.length > 0) {
        if (leakResult.remaining.length > 0) {
          log(
            `${smokeScript} leaked ${leakResult.remaining.length} managed repo process(es) after cleanup.`,
          );
        } else {
          log(
            `${smokeScript} leaked ${leakResult.cleaned.length} managed repo process(es); cleanup recovered them.`,
          );
        }
        if (finalCode === 0) {
          finalCode = 1;
        }
      }

      return finalCode;
    })();

    return finishPromise;
  };

  const exitCodePromise = new Promise((resolve) => {
    child.once("error", (error) => {
      console.error(error);
      resolve(1);
    });

    child.once("exit", (code, signal) => {
      if (signal) {
        const exitCode = signalCodeToExitCode(signal);
        log(`${smokeScript} exited via ${signal} after ${formatDuration(Date.now() - startedAt)}`);
        resolve(exitCode);
        return;
      }
      const exitCode = code ?? 1;
      const durationMs = Date.now() - startedAt;
      if (exitCode === 0) {
        log(`${smokeScript} completed in ${formatDuration(durationMs)}`);
      } else {
        log(`${smokeScript} failed with exit code ${exitCode} after ${formatDuration(durationMs)}`);
      }
      resolve(exitCode);
    });
  });

  releaseSignalHandlers = installSignalHandlers(async (signal) => {
    requestedExitCode = signalCodeToExitCode(signal);
    log(`Received ${signal}; cleaning up ${smokeScript}.`);
    try {
      await terminateChildProcess(child, {
        label: smokeScript,
        termSignal: signal,
        termTimeoutMs: SMOKE_TEST_KILL_WAIT_MS,
        killTimeoutMs: SMOKE_TEST_KILL_WAIT_MS,
        log,
      });
    } catch (error) {
      log(
        `Cleanup after ${signal} failed for ${smokeScript}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    process.exit(await finish(requestedExitCode));
  });

  timeoutTimer = setTimeout(async () => {
    requestedExitCode = 1;
    log(`${smokeScript} exceeded ${SMOKE_TEST_TIMEOUT_MS}ms; forcing shutdown.`);
    try {
      await terminateChildProcess(child, {
        label: smokeScript,
        termTimeoutMs: SMOKE_TEST_KILL_WAIT_MS,
        killTimeoutMs: SMOKE_TEST_KILL_WAIT_MS,
        log,
      });
    } catch (error) {
      log(
        `Forced shutdown failed for ${smokeScript}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    process.exit(await finish(requestedExitCode));
  }, SMOKE_TEST_TIMEOUT_MS);

  return finish(await exitCodePromise);
};

run()
  .then((code) => {
    process.exit(code);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
