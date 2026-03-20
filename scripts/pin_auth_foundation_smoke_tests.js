#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { createSmokeServerController } = require("./smoke_server_helper");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3100";
const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
}
if (process.env.NODE_ENV !== "test") {
  throw new Error("Refusing to run: NODE_ENV must be 'test'.");
}
if (process.env.ALLOW_NON_TEST_DB !== "1" && !DATABASE_URL.toLowerCase().includes("test")) {
  throw new Error("Refusing to run against non-test database URL.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const appBaseUrlCandidates = (() => {
  const primary = new URL(BASE_URL).toString().replace(/\/$/, "");
  const urls = [primary];

  try {
    const fallback = new URL(primary);
    if (fallback.hostname === "localhost") {
      fallback.hostname = "127.0.0.1";
      urls.push(fallback.toString().replace(/\/$/, ""));
    }
  } catch {
    // Ignore malformed URL handling here; the primary URL will surface the failure.
  }

  return urls;
})();

const serverController = createSmokeServerController({
  label: "pin-auth-smoke",
  baseUrls: appBaseUrlCandidates,
  databaseUrl: DATABASE_URL,
  captureStartupLog: true,
  startupReadyPattern: /Server running on http:\/\/localhost:\d+/i,
});

const RUN_REF = `pin_${Date.now()}`;
const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": `pin-manager-${RUN_REF}`,
};
const ADMIN_HEADERS = {
  "X-Staff-Role": "ADMIN",
  "X-Staff-Id": `pin-admin-${RUN_REF}`,
};

const toCookieHeader = (response) => {
  const raw = response.headers.get("set-cookie");
  if (!raw) {
    return "";
  }
  return raw.split(";")[0];
};

const fetchJson = async (path, init = {}) => {
  const response = await fetch(`${serverController.getBaseUrl()}${path}`, init);
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, json, response };
};

const main = async () => {
  await serverController.startIfNeeded();

  const password = "temp-pass-123";
  const managerSetPin = "2468";
  const user = await prisma.user.create({
    data: {
      username: `pin-${RUN_REF}`,
      email: `pin-${RUN_REF}@local`,
      name: `PIN Test ${RUN_REF}`,
      passwordHash: await bcrypt.hash(password, 12),
      role: "STAFF",
      isActive: true,
    },
  });
  const secondUser = await prisma.user.create({
    data: {
      username: `pin-secondary-${RUN_REF}`,
      email: `pin-secondary-${RUN_REF}@local`,
      name: `PIN Secondary ${RUN_REF}`,
      passwordHash: await bcrypt.hash(password, 12),
      pinHash: await bcrypt.hash(managerSetPin, 12),
      role: "STAFF",
      isActive: true,
    },
  });

  try {
    const activeUsersResult = await fetchJson("/api/auth/active-users");
    assert.equal(activeUsersResult.status, 200);
    assert.ok(Array.isArray(activeUsersResult.json.users));
    const listedUser = activeUsersResult.json.users.find((row) => row.id === user.id);
    assert.ok(listedUser);
    assert.equal(typeof listedUser.displayName, "string");
    assert.equal(listedUser.role, "STAFF");
    assert.equal(listedUser.hasPin, false);
    assert.equal(Object.prototype.hasOwnProperty.call(listedUser, "email"), false);

    const loginResult = await fetchJson("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, password }),
    });
    assert.equal(loginResult.status, 200);
    const passwordCookie = toCookieHeader(loginResult.response);
    assert.ok(passwordCookie.includes("bike_epos_auth"));

    const initialStatus = await fetchJson("/api/auth/pin-status", {
      headers: { cookie: passwordCookie },
    });
    assert.equal(initialStatus.status, 200);
    assert.equal(initialStatus.json.hasPin, false);

    const setPinResult = await fetchJson("/api/auth/pin", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: passwordCookie },
      body: JSON.stringify({ pin: "1234" }),
    });
    assert.equal(setPinResult.status, 201);
    assert.equal(setPinResult.json.hasPin, true);

    const changedPinResult = await fetchJson("/api/auth/pin", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: passwordCookie },
      body: JSON.stringify({ currentPin: "1234", nextPin: "5678" }),
    });
    assert.equal(changedPinResult.status, 200);
    assert.equal(changedPinResult.json.hasPin, true);

    const pinLoginResult = await fetchJson("/api/auth/pin-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id, pin: "5678" }),
    });
    assert.equal(pinLoginResult.status, 200);
    const pinCookie = toCookieHeader(pinLoginResult.response);
    assert.ok(pinCookie.includes("bike_epos_auth"));

    const meResult = await fetchJson("/api/auth/me", {
      headers: { cookie: pinCookie },
    });
    assert.equal(meResult.status, 200);
    assert.equal(meResult.json.user.id, user.id);
    assert.equal(meResult.json.user.hasPin, true);

    const setByManagerResult = await fetchJson(`/api/admin/users/${user.id}/set-pin`, {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ pin: "9999" }),
    });
    assert.equal(setByManagerResult.status, 200);

    const oldPinResult = await fetchJson("/api/auth/pin-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id, pin: "5678" }),
    });
    assert.equal(oldPinResult.status, 401);

    const setPinResultByManager = await fetchJson(`/api/admin/users/${user.id}/set-pin`, {
      method: "POST",
      headers: { ...MANAGER_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ pin: managerSetPin }),
    });
    assert.equal(setPinResultByManager.status, 200);

    const reloginResult = await fetchJson("/api/auth/pin-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id, pin: managerSetPin }),
    });
    assert.equal(reloginResult.status, 200);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const retry = await fetchJson("/api/auth/pin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, pin: "0000" }),
      });
      assert.equal(retry.status, 401);
    }

    const limitedResult = await fetchJson("/api/auth/pin-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id, pin: "0000" }),
    });
    assert.equal(limitedResult.status, 429);

    const secondUserPinLogin = await fetchJson("/api/auth/pin-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: secondUser.id, pin: managerSetPin }),
    });
    assert.equal(secondUserPinLogin.status, 200);
    const secondUserCookie = toCookieHeader(secondUserPinLogin.response);
    assert.ok(secondUserCookie.includes("bike_epos_auth"));

    const disableResult = await fetchJson(`/api/admin/users/${secondUser.id}`, {
      method: "PATCH",
      headers: { ...ADMIN_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(disableResult.status, 200);
    assert.equal(disableResult.json.user.isActive, false);

    const activeUsersAfterDisable = await fetchJson("/api/auth/active-users");
    assert.equal(activeUsersAfterDisable.status, 200);
    assert.equal(
      activeUsersAfterDisable.json.users.some((row) => row.id === secondUser.id),
      false,
    );

    const disabledPasswordResult = await fetchJson("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: secondUser.email, password }),
    });
    assert.equal(disabledPasswordResult.status, 401);

    const disabledPinResult = await fetchJson("/api/auth/pin-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: secondUser.id, pin: managerSetPin }),
    });
    assert.equal(disabledPinResult.status, 401);

    const meAfterDisable = await fetchJson("/api/auth/me", {
      headers: { cookie: secondUserCookie },
    });
    assert.equal(meAfterDisable.status, 401);

    console.log("[pin-auth-smoke] pin auth foundation passed");
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: secondUser.id } }).catch(() => {});
    await prisma.$disconnect();
    await serverController.stop().catch(() => {});
  }
};

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  await serverController.stop().catch(() => {});
  process.exit(1);
});
