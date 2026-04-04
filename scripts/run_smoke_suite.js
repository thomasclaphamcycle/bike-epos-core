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

const baselineSteps = [
  // Core historical baseline
  "test:m11",
  "test:m12",
  "test:m13",
  "test:m28",
  "test:m32",
  "test:m34",
  "test:m35",
  "test:m36",
  "test:m37",
  "test:m38",
  "test:m39",
  "test:m40",
  "test:m41",
  "test:m42",
  "test:m43",
  "test:m73",
  "test:m76",
  "test:m77",
  "test:m78",
  "test:m83",
  "test:domain-events",
  "test:security",
  "test:sale-customer-capture",
  "test:customer-accounts",
  "test:workshop-commercial-intelligence",
  // Current management-reporting surfaces
  "test:m119",
  "test:m120",
  "test:m121",
  "test:m122",
  "test:m123",
  "test:m124",
  "test:m125",
  "test:m126",
  "test:m127",
  "test:m128",
  "test:supplier-product-links",
  "test:product-import",
  "test:stock-transfers",
  "test:bike-hire",
  "test:print-agent",
  "test:online-store",
  "test:settings",
  "test:rota-foundation",
  "test:dashboard-weather",
  "test:financial-comparisons",
  "test:financial-reports",
  "test:business-intelligence",
];

const env = applyTestEnvDefaults({
  ...process.env,
  AUTH_MODE: process.env.AUTH_MODE || "real",
  ALLOW_EXISTING_SERVER: process.env.ALLOW_EXISTING_SERVER || "0",
});

const HEALTH_URL = `${env.TEST_BASE_URL.replace(/\/$/, "")}/health`;
const WAIT_INTERVAL_MS = Number.parseInt(process.env.SMOKE_SERVER_WAIT_INTERVAL_MS || "500", 10);
const HEALTH_CHECK_TIMEOUT_MS = Number.parseInt(
  process.env.SMOKE_SERVER_HEALTH_TIMEOUT_MS || "1500",
  10,
);
const SHUTDOWN_TIMEOUT_MS = Number.parseInt(
  process.env.SMOKE_SERVER_SHUTDOWN_TIMEOUT_MS || "15000",
  10,
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (message) => {
  console.log(`[smoke-suite] ${message}`);
};

const serverIsHealthy = async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(HEALTH_URL, {
      signal: controller.signal,
    });
    return response.ok;
  } catch (error) {
    if (error && typeof error === "object" && error.name === "AbortError") {
      log(`Health check timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms for ${HEALTH_URL}`);
      return true;
    }
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

const waitForServerShutdown = async (step) => {
  const startedAt = Date.now();
  let attempt = 0;

  log(`Waiting for API server shutdown after ${step}`);

  while (Date.now() - startedAt < SHUTDOWN_TIMEOUT_MS) {
    attempt += 1;
    if (!(await serverIsHealthy())) {
      log(`API server shutdown confirmed after ${step} (${Date.now() - startedAt}ms, ${attempt} checks)`);
      return;
    }

    if (attempt === 1 || attempt % 5 === 0) {
      log(`API server still responding after ${step}; waiting... (${Date.now() - startedAt}ms elapsed)`);
    }

    await sleep(WAIT_INTERVAL_MS);
  }

  log(`Timed out waiting for API server shutdown after ${step}`);
  throw new Error(
    `Smoke suite timed out after ${SHUTDOWN_TIMEOUT_MS}ms waiting for API server shutdown after ${step}. A smoke test likely did not shut its server down cleanly.`,
  );
};

const main = async () => {
  const beforeSnapshot = snapshotManagedRepoProcesses();
  const existing = await serverIsHealthy();
  if (existing && env.ALLOW_EXISTING_SERVER !== "1") {
    throw new Error(
      "Refusing to run against an already-running server. Stop it first or set ALLOW_EXISTING_SERVER=1.",
    );
  }

  let currentChild = null;
  let currentStep = null;
  let finishPromise = null;
  let releaseSignalHandlers = () => {};
  let requestedExitCode = null;
  const keepAliveTimer = setInterval(() => {}, 1000);

  const finish = async (initialCode) => {
    if (finishPromise) {
      return finishPromise;
    }

    finishPromise = (async () => {
      clearInterval(keepAliveTimer);
      releaseSignalHandlers();

      let finalCode = requestedExitCode ?? initialCode;
      const leakResult = await cleanupNewManagedRepoProcesses(beforeSnapshot, {
        label: "run_smoke_suite",
        log,
      });

      if (leakResult.leaked.length > 0) {
        if (leakResult.remaining.length > 0) {
          log(
            `Smoke suite leaked ${leakResult.remaining.length} managed repo process(es) after cleanup.`,
          );
        } else {
          log(
            `Smoke suite leaked ${leakResult.cleaned.length} managed repo process(es); cleanup recovered them.`,
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

  const runStep = async (step) => {
    currentStep = step;
    currentChild = spawnManagedProcess("npm", ["run", step], {
      stdio: "inherit",
      env,
    });

    return new Promise((resolve) => {
      currentChild.once("error", (error) => {
        console.error(error);
        resolve(1);
      });

      currentChild.once("exit", (code, signal) => {
        currentChild = null;
        currentStep = null;
        if (signal) {
          resolve(signalCodeToExitCode(signal));
          return;
        }
        resolve(code ?? 1);
      });
    });
  };

  releaseSignalHandlers = installSignalHandlers(async (signal) => {
    requestedExitCode = signalCodeToExitCode(signal);

    if (currentChild && currentStep) {
      log(`Received ${signal}; cleaning up ${currentStep}.`);
      try {
        await terminateChildProcess(currentChild, {
          label: currentStep,
          termSignal: signal,
          log,
        });
      } catch (error) {
        log(
          `Cleanup after ${signal} failed for ${currentStep}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    process.exit(await finish(requestedExitCode));
  });

  for (const step of baselineSteps) {
    log(`Starting ${step}`);
    const exitCode = await runStep(step);

    if (exitCode !== 0) {
      process.exit(await finish(exitCode));
    }

    log(`Completed ${step}`);

    if (env.ALLOW_EXISTING_SERVER !== "1") {
      await waitForServerShutdown(step);
    }
  }

  process.exit(await finish(0));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
