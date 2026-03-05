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

const safeDbUrl = DATABASE_URL.replace(/(postgres(?:ql)?:\/\/[^:/@]+:)[^@]+@/i, "$1***@");
console.log(`[m43-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m43-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseJson = async (response) => {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

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

const login = async (email, password) => {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  const payload = await parseJson(response);
  assert.equal(response.status, 200, JSON.stringify(payload));

  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie, "missing set-cookie");
  return setCookie.split(";")[0];
};

let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;

const run = async () => {
  const token = uniqueRef();

  const managerEmail = `m43.manager.${token}@example.com`;
  const managerPassword = `M43Manager!${token}`;

  const staffEmail = `m43.staff.${token}@example.com`;
  const staffPassword = `M43Staff!${token}`;

  const created = {
    userIds: [],
  };

  let startedServer = false;
  let serverProcess = null;

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

    const manager = await prisma.user.create({
      data: {
        username: `m43-manager-${token}`,
        name: "M43 Manager",
        email: managerEmail,
        passwordHash: await bcrypt.hash(managerPassword, 10),
        role: "MANAGER",
        isActive: true,
      },
    });
    created.userIds.push(manager.id);

    const staff = await prisma.user.create({
      data: {
        username: `m43-staff-${token}`,
        name: "M43 Staff",
        email: staffEmail,
        passwordHash: await bcrypt.hash(staffPassword, 10),
        role: "STAFF",
        isActive: true,
      },
    });
    created.userIds.push(staff.id);

    const managerCookie = await login(managerEmail, managerPassword);
    const staffCookie = await login(staffEmail, staffPassword);

    const managerCashPage = await fetch(`${BASE_URL}/manager/cash`, {
      headers: {
        Cookie: managerCookie,
        Accept: "text/html",
      },
    });
    assert.equal(managerCashPage.status, 200);
    const managerCashHtml = await managerCashPage.text();
    assert.ok(managerCashHtml.includes("Manager Cash"));
    assert.ok(managerCashHtml.includes("data-testid=\"app-nav-manager-cash\""));

    const managerRefundPage = await fetch(`${BASE_URL}/manager/refunds`, {
      headers: {
        Cookie: managerCookie,
        Accept: "text/html",
      },
    });
    assert.equal(managerRefundPage.status, 200);
    const managerRefundHtml = await managerRefundPage.text();
    assert.ok(managerRefundHtml.includes("Manager Refunds"));
    assert.ok(managerRefundHtml.includes("Recent Completed Refunds"));

    const staffCashPage = await fetch(`${BASE_URL}/manager/cash`, {
      headers: {
        Cookie: staffCookie,
        Accept: "text/html",
      },
      redirect: "manual",
    });
    assert.equal(staffCashPage.status, 302);
    const staffCashRedirect = staffCashPage.headers.get("location") || "";
    assert.ok(staffCashRedirect.startsWith("/not-authorized"));

    const staffRefundPage = await fetch(`${BASE_URL}/manager/refunds`, {
      headers: {
        Cookie: staffCookie,
        Accept: "text/html",
      },
      redirect: "manual",
    });
    assert.equal(staffRefundPage.status, 302);
    const staffRefundRedirect = staffRefundPage.headers.get("location") || "";
    assert.ok(staffRefundRedirect.startsWith("/not-authorized"));

    console.log("M43 manager UI smoke tests passed.");
  } finally {
    if (created.userIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: created.userIds } },
      });
    }

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
