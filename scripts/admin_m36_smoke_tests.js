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
console.log(`[m36-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m36-smoke] DATABASE_URL=${safeDbUrl}`);

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

  return { status: response.status, json, headers: response.headers };
};

let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;

const loginAs = async (email, password) => {
  const login = await fetchJson("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  assert.equal(login.status, 200, JSON.stringify(login.json));
  const cookie = login.headers.get("set-cookie");
  assert.ok(cookie, `Missing auth cookie for ${email}`);
  return cookie;
};

const run = async () => {
  let startedServer = false;
  let serverProcess = null;

  const runRef = uniqueRef();
  const adminEmail = `m36.admin.${runRef}@example.com`;
  const adminPassword = `AdminPass!${runRef}`;
  const staffEmail = `m36.staff.${runRef}@example.com`;
  const staffPassword = `StaffPass!${runRef}`;
  const createdEmails = [adminEmail, staffEmail];

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

    await prisma.user.create({
      data: {
        username: `m36-admin-${runRef}`,
        email: adminEmail,
        name: "M36 Admin",
        passwordHash: await bcrypt.hash(adminPassword, 10),
        role: "ADMIN",
        isActive: true,
      },
    });

    const adminCookie = await loginAs(adminEmail, adminPassword);

    const createStaff = await fetchJson("/api/admin/users", {
      method: "POST",
      headers: { Cookie: adminCookie },
      body: JSON.stringify({
        name: "M36 Staff",
        email: staffEmail,
        role: "STAFF",
        tempPassword: staffPassword,
      }),
    });
    assert.equal(createStaff.status, 201, JSON.stringify(createStaff.json));
    const staffId = createStaff.json.user.id;
    assert.ok(staffId, "Expected created staff id");

    const listUsers = await fetchJson("/api/admin/users", {
      headers: { Cookie: adminCookie },
    });
    assert.equal(listUsers.status, 200, JSON.stringify(listUsers.json));
    assert.ok(
      listUsers.json.users.some((user) => user.email === staffEmail),
      "Expected created staff in list",
    );

    const promoteStaff = await fetchJson(`/api/admin/users/${staffId}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie },
      body: JSON.stringify({
        role: "MANAGER",
        isActive: true,
        name: "M36 Staff Updated",
      }),
    });
    assert.equal(promoteStaff.status, 200, JSON.stringify(promoteStaff.json));
    assert.equal(promoteStaff.json.user.role, "MANAGER");

    const managerCookie = await loginAs(staffEmail, staffPassword);

    const managerDirectory = await fetchJson("/api/staff-directory", {
      headers: { Cookie: managerCookie },
    });
    assert.equal(managerDirectory.status, 200, JSON.stringify(managerDirectory.json));
    assert.ok(
      managerDirectory.json.users.some((user) => user.id === staffId),
      "Expected promoted manager in staff directory",
    );

    const tagWorkshop = await fetchJson(`/api/staff-directory/${staffId}/operational-role`, {
      method: "PATCH",
      headers: { Cookie: managerCookie },
      body: JSON.stringify({ operationalRole: "WORKSHOP" }),
    });
    assert.equal(tagWorkshop.status, 200, JSON.stringify(tagWorkshop.json));
    assert.equal(tagWorkshop.json.user.operationalRole, "WORKSHOP");

    const resetPassword = await fetchJson(`/api/admin/users/${staffId}/reset-password`, {
      method: "POST",
      headers: { Cookie: adminCookie },
      body: JSON.stringify({ tempPassword: `${staffPassword}!2` }),
    });
    assert.equal(resetPassword.status, 200, JSON.stringify(resetPassword.json));

    const disableStaff = await fetchJson(`/api/admin/users/${staffId}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie },
      body: JSON.stringify({ isActive: false, role: "MANAGER", name: "M36 Staff Updated" }),
    });
    assert.equal(disableStaff.status, 200, JSON.stringify(disableStaff.json));
    assert.equal(disableStaff.json.user.isActive, false);

    const disabledLogin = await fetchJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: staffEmail, password: `${staffPassword}!2` }),
    });
    assert.equal(disabledLogin.status, 401, JSON.stringify(disabledLogin.json));

    const enableStaff = await fetchJson(`/api/admin/users/${staffId}`, {
      method: "PATCH",
      headers: { Cookie: adminCookie },
      body: JSON.stringify({ isActive: true, role: "STAFF", name: "M36 Staff Updated" }),
    });
    assert.equal(enableStaff.status, 200, JSON.stringify(enableStaff.json));

    const staffCookie = await loginAs(staffEmail, `${staffPassword}!2`);

    const deniedAdminAccess = await fetchJson("/api/admin/users", {
      headers: { Cookie: staffCookie },
    });
    assert.equal(deniedAdminAccess.status, 403, JSON.stringify(deniedAdminAccess.json));

    const deniedDirectoryUpdate = await fetchJson(`/api/staff-directory/${encodeURIComponent(staffId)}/operational-role`, {
      method: "PATCH",
      headers: { Cookie: staffCookie },
      body: JSON.stringify({ operationalRole: "SALES" }),
    });
    assert.equal(deniedDirectoryUpdate.status, 403, JSON.stringify(deniedDirectoryUpdate.json));

    const selfDisable = await fetchJson(`/api/admin/users/${createStaff.json.user.id}`, {
      method: "PATCH",
      headers: { Cookie: staffCookie },
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(selfDisable.status, 403, JSON.stringify(selfDisable.json));

    console.log("M36 admin smoke tests passed.");
  } finally {
    await prisma.user.deleteMany({
      where: {
        email: {
          in: createdEmails,
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
