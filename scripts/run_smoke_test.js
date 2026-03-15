#!/usr/bin/env node
require("dotenv").config({ path: ".env.test" });

const { spawn } = require("node:child_process");

const smokeScript = process.argv[2];
const smokeArgs = process.argv.slice(3);

if (!smokeScript) {
  console.error("Usage: node scripts/run_smoke_test.js <script-path> [...args]");
  process.exit(1);
}

const env = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || "test",
  AUTH_MODE: process.env.AUTH_MODE || "real",
  ALLOW_EXISTING_SERVER: process.env.ALLOW_EXISTING_SERVER || "0",
  TEST_BASE_URL: process.env.TEST_BASE_URL || "http://localhost:3100",
};

if (
  env.ALLOW_EXISTING_SERVER !== "1" &&
  /^http:\/\/localhost:3000\/?$/i.test(env.TEST_BASE_URL)
) {
  env.TEST_BASE_URL = "http://localhost:3100";
}

if (!env.DATABASE_URL && env.TEST_DATABASE_URL) {
  env.DATABASE_URL = env.TEST_DATABASE_URL;
}

if (!env.PORT) {
  try {
    const parsed = new URL(env.TEST_BASE_URL);
    if (parsed.port) {
      env.PORT = parsed.port;
    }
  } catch {
    // Keep default server port behavior if TEST_BASE_URL is not a valid URL.
  }
}

const SMOKE_TEST_TIMEOUT_MS = Number.parseInt(
  process.env.SMOKE_TEST_TIMEOUT_MS || "300000",
  10,
);
const SMOKE_TEST_KILL_WAIT_MS = Number.parseInt(
  process.env.SMOKE_TEST_KILL_WAIT_MS || "2000",
  10,
);
const useProcessGroup = process.platform !== "win32";

const sendSignal = (child, signal) => {
  if (!child?.pid) {
    return;
  }

  const target = useProcessGroup ? -child.pid : child.pid;
  try {
    process.kill(target, signal);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ESRCH") {
      return;
    }
    throw error;
  }
};

const run = async () =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [smokeScript, ...smokeArgs], {
      stdio: "inherit",
      env,
      shell: process.platform === "win32",
      detached: useProcessGroup,
    });

    let settled = false;
    let killTimer = null;
    let failSafeTimer = null;

    const settle = (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutTimer);
      if (killTimer) {
        clearTimeout(killTimer);
      }
      if (failSafeTimer) {
        clearTimeout(failSafeTimer);
      }
      resolve(code);
    };

    const timeoutTimer = setTimeout(() => {
      console.error(
        `[run_smoke_test] ${smokeScript} exceeded ${SMOKE_TEST_TIMEOUT_MS}ms; sending SIGTERM.`,
      );
      try {
        sendSignal(child, "SIGTERM");
      } catch (error) {
        console.error(
          `[run_smoke_test] Failed to send SIGTERM to ${smokeScript}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      killTimer = setTimeout(() => {
        console.error(
          `[run_smoke_test] ${smokeScript} did not exit after SIGTERM; sending SIGKILL.`,
        );
        try {
          sendSignal(child, "SIGKILL");
        } catch (error) {
          console.error(
            `[run_smoke_test] Failed to send SIGKILL to ${smokeScript}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }, SMOKE_TEST_KILL_WAIT_MS);

      failSafeTimer = setTimeout(() => {
        console.error(
          `[run_smoke_test] ${smokeScript} still did not exit after forced shutdown; failing smoke wrapper.`,
        );
        settle(1);
      }, SMOKE_TEST_KILL_WAIT_MS + 1000);
    }, SMOKE_TEST_TIMEOUT_MS);

    child.once("error", (error) => {
      console.error(error);
      settle(1);
    });

    child.once("exit", (code, signal) => {
      if (signal) {
        settle(code ?? 1);
        return;
      }
      settle(code ?? 1);
    });
  });

run().then((code) => {
  process.exit(code);
});
