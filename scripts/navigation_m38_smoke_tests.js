#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
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
  throw new Error(
    "Refusing to run against non-test database URL. Set TEST_DATABASE_URL or ALLOW_NON_TEST_DB=1.",
  );
}

const safeDbUrl = DATABASE_URL.replace(/(postgres(?:ql)?:\/\/[^:/@]+:)[^@]+@/i, "$1***@");
console.log(`[m38-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m38-smoke] DATABASE_URL=${safeDbUrl}`);

const APP_REQUEST_RETRIES = 8;
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
  label: "m38-smoke",
  baseUrls: appBaseUrlCandidates,
  databaseUrl: DATABASE_URL,
  captureStartupLog: true,
  startupReadyPattern: /Server running on http:\/\/localhost:\d+/i,
});

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

const fetchFromApp = async (path, options = {}) => {
  let lastError = null;

  for (let attempt = 0; attempt < APP_REQUEST_RETRIES; attempt += 1) {
    try {
      return await fetch(`${serverController.getBaseUrl()}${path}`, options);
    } catch (error) {
      lastError = error;
      await serverController.probeHealthyBaseUrl();
    }
    if (attempt < APP_REQUEST_RETRIES - 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${path}`);
};

const buildAdminBypassHeaders = () => {
  const headers = {
    "Content-Type": "application/json",
    "X-Staff-Role": "ADMIN",
    "X-Staff-Id": "m38-admin-bypass",
  };

  if (process.env.INTERNAL_AUTH_SHARED_SECRET) {
    headers["X-Internal-Auth"] = process.env.INTERNAL_AUTH_SHARED_SECRET;
  }

  return headers;
};

const fetchJson = async (path, options = {}) => {
  const response = await fetchFromApp(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  return {
    status: response.status,
    json: await parseJson(response),
    headers: response.headers,
  };
};

const login = async (email, password) => {
  const response = await fetchFromApp("/api/auth/login", {
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
  const created = {
    userIds: [],
  };

  try {
    await serverController.startIfNeeded();

    const managerCreate = await fetchJson("/api/admin/users", {
      method: "POST",
      headers: buildAdminBypassHeaders(),
      body: JSON.stringify({
        name: "M38 Manager",
        email: managerEmail,
        role: "MANAGER",
        tempPassword: password,
      }),
    });
    assert.equal(managerCreate.status, 201, JSON.stringify(managerCreate.json));
    created.userIds.push(managerCreate.json.user.id);

    const staffCreate = await fetchJson("/api/admin/users", {
      method: "POST",
      headers: buildAdminBypassHeaders(),
      body: JSON.stringify({
        name: "M38 Staff",
        email: staffEmail,
        role: "STAFF",
        tempPassword: password,
      }),
    });
    assert.equal(staffCreate.status, 201, JSON.stringify(staffCreate.json));
    created.userIds.push(staffCreate.json.user.id);

    const unauthPos = await fetchFromApp("/pos", {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "text/html" },
    });
    assert.equal(unauthPos.status, 302);
    assert.ok((unauthPos.headers.get("location") || "").startsWith("/login?next="));

    const unauthRoot = await fetchFromApp("/", {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "text/html" },
    });
    assert.equal(unauthRoot.status, 302);
    assert.equal(unauthRoot.headers.get("location"), "/login");

    const staffLogin = await login(staffEmail, password);

    const staffRoot = await fetchFromApp("/", {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: "text/html",
        Cookie: staffLogin.cookie,
      },
    });
    assert.equal(staffRoot.status, 302);
    assert.equal(staffRoot.headers.get("location"), "/pos");

    const staffPos = await fetchFromApp("/pos", {
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

    const staffAdmin = await fetchFromApp("/admin", {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: "text/html",
        Cookie: staffLogin.cookie,
      },
    });
    assert.equal(staffAdmin.status, 302);
    assert.ok((staffAdmin.headers.get("location") || "").startsWith("/not-authorized"));

    const notAuthorized = await fetchFromApp(
      staffAdmin.headers.get("location") || "/not-authorized",
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
    const managerPos = await fetchFromApp("/pos", {
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
    for (const userId of created.userIds) {
      try {
        await fetchJson(`/api/admin/users/${encodeURIComponent(userId)}`, {
          method: "PATCH",
          headers: buildAdminBypassHeaders(),
          body: JSON.stringify({ isActive: false }),
        });
      } catch {
        // Ignore cleanup failures; unique test identities prevent collisions on later runs.
      }
    }

    await serverController.stop();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
