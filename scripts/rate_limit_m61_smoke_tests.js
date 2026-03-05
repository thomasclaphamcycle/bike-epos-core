#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const net = require("node:net");
const { spawn } = require("node:child_process");

const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
}
if (process.env.NODE_ENV !== "test") {
  throw new Error("Refusing to run: NODE_ENV must be 'test'.");
}
if (process.env.ALLOW_NON_TEST_DB !== "1" && !DATABASE_URL.toLowerCase().includes("test")) {
  throw new Error(
    "Refusing to run against non-test database URL. Set TEST_DATABASE_URL or ALLOW_NON_TEST_DB=1.",
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const findFreePort = (startPort = 3300, maxAttempts = 100) =>
  new Promise((resolve, reject) => {
    let attempt = 0;
    const tryNext = () => {
      if (attempt >= maxAttempts) {
        reject(new Error("Unable to find a free local port for m61 smoke test"));
        return;
      }

      const port = startPort + attempt;
      attempt += 1;

      const server = net.createServer();
      server.unref();
      server.on("error", () => {
        tryNext();
      });
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve(port));
      });
    };
    tryNext();
  });

const fetchJson = async (baseUrl, path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  return {
    status: response.status,
    json,
  };
};

const serverIsHealthy = async (baseUrl) => {
  try {
    const response = await fetch(`${baseUrl}/health`);
    return response.ok;
  } catch {
    return false;
  }
};

const waitForServer = async (baseUrl) => {
  for (let i = 0; i < 60; i += 1) {
    if (await serverIsHealthy(baseUrl)) {
      return;
    }
    await sleep(500);
  }
  throw new Error("Server did not become healthy on /health");
};

const run = async () => {
  const port = await findFreePort();
  const baseUrl = `http://localhost:${port}`;

  const serverProcess = spawn("npm", ["run", "start"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL,
      PORT: String(port),
      JWT_SECRET: process.env.JWT_SECRET || process.env.AUTH_JWT_SECRET || "test-jwt-secret",
      COOKIE_SECRET: process.env.COOKIE_SECRET || "test-cookie-secret",
      RATE_LIMIT_AUTH_LOGIN_WINDOW_MS: "60000",
      RATE_LIMIT_AUTH_LOGIN_MAX: "2",
      RATE_LIMIT_WORKSHOP_MANAGE_WINDOW_MS: "60000",
      RATE_LIMIT_WORKSHOP_MANAGE_MAX: "3",
    },
  });

  try {
    await waitForServer(baseUrl);

    for (let i = 0; i < 2; i += 1) {
      const loginAttempt = await fetchJson(baseUrl, "/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: "missing.user@example.com",
          password: "wrong-password",
        }),
      });
      assert.notEqual(loginAttempt.status, 429, JSON.stringify(loginAttempt.json));
    }

    const loginBlocked = await fetchJson(baseUrl, "/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "missing.user@example.com",
        password: "wrong-password",
      }),
    });
    assert.equal(loginBlocked.status, 429, JSON.stringify(loginBlocked.json));
    assert.deepEqual(loginBlocked.json, { error: "Too many requests" });

    const token = `missing-token-${Date.now()}`;
    for (let i = 0; i < 3; i += 1) {
      const manageAttempt = await fetchJson(
        baseUrl,
        `/api/workshop-bookings/manage/${encodeURIComponent(token)}`,
      );
      assert.notEqual(manageAttempt.status, 429, JSON.stringify(manageAttempt.json));
    }

    const manageBlocked = await fetchJson(
      baseUrl,
      `/api/workshop-bookings/manage/${encodeURIComponent(token)}`,
    );
    assert.equal(manageBlocked.status, 429, JSON.stringify(manageBlocked.json));
    assert.deepEqual(manageBlocked.json, { error: "Too many requests" });

    console.log("M61 rate-limit smoke tests passed.");
  } finally {
    serverProcess.kill("SIGTERM");
    await sleep(500);
    if (!serverProcess.killed) {
      serverProcess.kill("SIGKILL");
    }
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
