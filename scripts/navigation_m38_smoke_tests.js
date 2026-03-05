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
console.log(`[m38-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m38-smoke] DATABASE_URL=${safeDbUrl}`);

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

const login = async (email, password) => {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  const body = await parseJson(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie, "expected set-cookie header from login");
  return {
    body,
    cookie: setCookie.split(";")[0],
  };
};

let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;

const run = async () => {
  const token = uniqueRef();
  const managerEmail = `m38.manager.${token}@example.com`;
  const staffEmail = `m38.staff.${token}@example.com`;
  const password = `M38Pass!${token}`;

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

    const managerHash = await bcrypt.hash(password, 10);
    const staffHash = await bcrypt.hash(password, 10);

    await prisma.user.createMany({
      data: [
        {
          username: `m38-manager-${token}`,
          name: "M38 Manager",
          email: managerEmail,
          passwordHash: managerHash,
          role: "MANAGER",
          isActive: true,
        },
        {
          username: `m38-staff-${token}`,
          name: "M38 Staff",
          email: staffEmail,
          passwordHash: staffHash,
          role: "STAFF",
          isActive: true,
        },
      ],
    });

    const unauthPos = await fetch(`${BASE_URL}/pos`, {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "text/html" },
    });
    assert.equal(unauthPos.status, 302);
    assert.ok((unauthPos.headers.get("location") || "").startsWith("/login?next="));

    const unauthRoot = await fetch(`${BASE_URL}/`, {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "text/html" },
    });
    assert.equal(unauthRoot.status, 302);
    assert.equal(unauthRoot.headers.get("location"), "/login");

    const staffLogin = await login(staffEmail, password);

    const staffRoot = await fetch(`${BASE_URL}/`, {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: "text/html",
        Cookie: staffLogin.cookie,
      },
    });
    assert.equal(staffRoot.status, 302);
    assert.equal(staffRoot.headers.get("location"), "/pos");

    const staffPos = await fetch(`${BASE_URL}/pos`, {
      method: "GET",
      headers: {
        Accept: "text/html",
        Cookie: staffLogin.cookie,
      },
    });
    const staffPosHtml = await staffPos.text();
    assert.equal(staffPos.status, 200);
    assert.ok(staffPosHtml.includes('data-testid="app-nav-pos"'));
    assert.ok(staffPosHtml.includes('data-testid="app-nav-workshop"'));
    assert.ok(staffPosHtml.includes('data-testid="app-nav-inventory"'));
    assert.ok(!staffPosHtml.includes('data-testid="app-nav-till"'));
    assert.ok(!staffPosHtml.includes('data-testid="app-nav-admin-users"'));

    const staffAdmin = await fetch(`${BASE_URL}/admin`, {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: "text/html",
        Cookie: staffLogin.cookie,
      },
    });
    assert.equal(staffAdmin.status, 302);
    assert.ok((staffAdmin.headers.get("location") || "").startsWith("/not-authorized"));

    const notAuthorized = await fetch(
      `${BASE_URL}${staffAdmin.headers.get("location") || "/not-authorized"}`,
      {
        method: "GET",
        headers: {
          Accept: "text/html",
          Cookie: staffLogin.cookie,
        },
      },
    );
    const notAuthorizedHtml = await notAuthorized.text();
    assert.equal(notAuthorized.status, 200);
    assert.ok(notAuthorizedHtml.includes("Not Authorized"));

    const managerLogin = await login(managerEmail, password);
    const managerPos = await fetch(`${BASE_URL}/pos`, {
      method: "GET",
      headers: {
        Accept: "text/html",
        Cookie: managerLogin.cookie,
      },
    });
    const managerPosHtml = await managerPos.text();
    assert.equal(managerPos.status, 200);
    assert.ok(managerPosHtml.includes('data-testid="app-nav-till"'));
    assert.ok(!managerPosHtml.includes('data-testid="app-nav-admin-users"'));

    console.log("M38 navigation/auth routing smoke tests passed.");
  } finally {
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [managerEmail, staffEmail],
        },
      },
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
