#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const HEALTH_URL = `${BASE_URL}/health`;
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

const safeDbUrl = DATABASE_URL.replace(
  /(postgres(?:ql)?:\/\/[^:/@]+:)[^@]+@/i,
  "$1***@",
);
console.log(`[m35-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m35-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const serverIsHealthy = async () => {
  try {
    const response = await fetch(HEALTH_URL);
    return response.ok;
  } catch {
    return false;
  }
};

const waitForServer = async () => {
  for (let i = 0; i < 60; i++) {
    if (await serverIsHealthy()) {
      return;
    }
    await sleep(500);
  }
  throw new Error("Server did not become healthy on /health");
};

const fetchJson = async (path, options = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, {
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
    headers: response.headers,
  };
};

let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;

const run = async () => {
  let startedServer = false;
  let serverProcess = null;

  const unique = uniqueRef();
  const userEmail = `m35.${unique}@example.com`;
  const userPassword = `TestPass!${unique}`;

  try {
    const alreadyHealthy = await serverIsHealthy();
    if (alreadyHealthy && process.env.ALLOW_EXISTING_SERVER !== "1") {
      throw new Error(
        "Refusing to run against an already-running server. Stop it first or set ALLOW_EXISTING_SERVER=1.",
      );
    }

    if (!alreadyHealthy) {
      serverProcess = spawn("npm", ["run", "dev"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          NODE_ENV: "test",
          DATABASE_URL,
        },
      });
      startedServer = true;
      await waitForServer();
    }

    const passwordHash = await bcrypt.hash(userPassword, 10);
    await prisma.user.create({
      data: {
        username: `m35-user-${unique}`,
        email: userEmail,
        name: "M35 Smoke",
        passwordHash,
        role: "ADMIN",
        isActive: true,
      },
    });

    const loginResponse = await fetchJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: userEmail,
        password: userPassword,
      }),
    });
    assert.equal(loginResponse.status, 200, JSON.stringify(loginResponse.json));
    assert.equal(loginResponse.json.user.email, userEmail);

    const setCookie = loginResponse.headers.get("set-cookie");
    assert.ok(setCookie, "Expected auth cookie from login");

    const meResponse = await fetchJson("/api/auth/me", {
      headers: {
        Cookie: setCookie,
      },
    });
    assert.equal(meResponse.status, 200, JSON.stringify(meResponse.json));
    assert.equal(meResponse.json.user.email, userEmail);

    const logoutResponse = await fetchJson("/api/auth/logout", {
      method: "POST",
      headers: {
        Cookie: setCookie,
      },
      body: JSON.stringify({}),
    });
    assert.equal(logoutResponse.status, 204, JSON.stringify(logoutResponse.json));
    const clearedCookie = logoutResponse.headers.get("set-cookie");
    assert.ok(clearedCookie, "Expected cleared auth cookie from logout");

    const meAfterLogout = await fetchJson("/api/auth/me", {
      headers: {
        Cookie: clearedCookie,
      },
    });
    assert.equal(meAfterLogout.status, 401, JSON.stringify(meAfterLogout.json));

    const headerFallbackResponse = await fetchJson("/api/payments/intents", {
      headers: {
        "X-Staff-Role": "MANAGER",
        "X-Staff-Id": `m35-header-${unique}`,
      },
    });
    assert.equal(headerFallbackResponse.status, 200, JSON.stringify(headerFallbackResponse.json));

    console.log("M35 auth smoke tests passed.");
  } finally {
    await prisma.user.deleteMany({
      where: { email: userEmail },
    });

    await prisma.$disconnect();

    if (startedServer && serverProcess) {
      serverProcess.kill("SIGTERM");
      await sleep(400);
      if (!serverProcess.killed) {
        serverProcess.kill("SIGKILL");
      }
    }
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
