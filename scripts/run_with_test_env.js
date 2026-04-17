#!/usr/bin/env node
require("dotenv").config({ path: ".env.test" });

const { applyTestEnvDefaults } = require("./test_env_defaults");
const { applyPlaywrightBridgeEnv } = require("./playwright_bridge_support");
const {
  cleanupNewManagedRepoProcesses,
  installSignalHandlers,
  signalCodeToExitCode,
  snapshotManagedRepoProcesses,
  spawnManagedProcess,
  terminateChildProcess,
} = require("./process_lifecycle");

const command = process.argv[2];
const args = process.argv.slice(3);

if (!command) {
  console.error("Usage: node scripts/run_with_test_env.js <command> [...args]");
  process.exit(1);
}

const env = applyPlaywrightBridgeEnv(applyTestEnvDefaults(process.env));

const log = (message) => {
  console.error(`[run_with_test_env] ${message}`);
};

const run = async () => {
  const beforeSnapshot = snapshotManagedRepoProcesses();
  const child = spawnManagedProcess(command, args, {
    stdio: "inherit",
    env,
  });
  log(`Spawned ${command} as pid ${child.pid}`);

  // Detached children with inherited stdio do not keep the wrapper event loop alive
  // on their own, so hold a lightweight timer until the wrapped command exits.
  const keepAliveTimer = setInterval(() => {}, 1000);
  let releaseSignalHandlers = () => {};
  let finishPromise = null;
  let requestedExitCode = null;

  const finish = async (initialCode) => {
    if (finishPromise) {
      return finishPromise;
    }

    finishPromise = (async () => {
      clearInterval(keepAliveTimer);
      releaseSignalHandlers();

      let finalCode = requestedExitCode ?? initialCode;
      const leakResult = await cleanupNewManagedRepoProcesses(beforeSnapshot, {
        label: `run_with_test_env ${command}`,
        log,
      });

      if (leakResult.leaked.length > 0) {
        if (leakResult.remaining.length > 0) {
          log(
            `${command} leaked ${leakResult.remaining.length} managed repo process(es) after cleanup.`,
          );
        } else {
          log(
            `${command} leaked ${leakResult.cleaned.length} managed repo process(es); cleanup recovered them.`,
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
        resolve(signalCodeToExitCode(signal));
        return;
      }
      resolve(code ?? 1);
    });
  });

  releaseSignalHandlers = installSignalHandlers(async (signal) => {
    requestedExitCode = signalCodeToExitCode(signal);
    log(`Received ${signal}; cleaning up ${command}.`);
    try {
      await terminateChildProcess(child, {
        label: command,
        termSignal: signal,
        log,
      });
    } catch (error) {
      log(
        `Cleanup after ${signal} failed for ${command}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    process.exit(await finish(requestedExitCode));
  });

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
