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
console.log(`[m47-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m47-smoke] DATABASE_URL=${safeDbUrl}`);

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

const apiJson = async ({ path, method = "GET", body, cookie, extraHeaders }) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(extraHeaders || {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const payload = await parseJson(response);
  if (!response.ok) {
    throw new Error(`${method} ${path} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return { payload, status: response.status };
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
  const staffEmail = `m47.staff.${token}@example.com`;
  const staffPassword = `M47Staff!${token}`;

  const created = {
    userId: null,
    customerId: null,
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

    const staff = await prisma.user.create({
      data: {
        username: `m47-staff-${token}`,
        name: "M47 Staff",
        email: staffEmail,
        passwordHash: await bcrypt.hash(staffPassword, 10),
        role: "STAFF",
        isActive: true,
      },
    });
    created.userId = staff.id;

    const cookie = await login(staffEmail, staffPassword);

    const createdCustomer = await apiJson({
      path: "/api/customers",
      method: "POST",
      body: {
        name: `M47 Customer ${token}`,
        email: `m47.customer.${token}@example.com`,
        phone: "07000111222",
        notes: "M47 smoke customer",
      },
      cookie,
    });
    assert.equal(createdCustomer.status, 201, JSON.stringify(createdCustomer.payload));
    created.customerId = createdCustomer.payload.id;

    const searchCustomers = await apiJson({
      path: `/api/customers?search=${encodeURIComponent("M47 Customer")}&take=20`,
      cookie,
    });
    assert.ok(Array.isArray(searchCustomers.payload.customers), JSON.stringify(searchCustomers.payload));
    assert.ok(
      searchCustomers.payload.customers.some((entry) => entry.id === created.customerId),
      "Created customer missing from search results",
    );

    const updatedCustomer = await apiJson({
      path: `/api/customers/${encodeURIComponent(created.customerId)}`,
      method: "PATCH",
      body: {
        name: `M47 Customer Updated ${token}`,
        phone: "07000999888",
        notes: "Updated in M47 smoke",
      },
      cookie,
    });
    assert.equal(updatedCustomer.payload.id, created.customerId);
    assert.equal(updatedCustomer.payload.phone, "07000999888");

    const customerById = await apiJson({
      path: `/api/customers/${encodeURIComponent(created.customerId)}`,
      cookie,
    });
    assert.equal(customerById.payload.id, created.customerId);
    assert.ok(customerById.payload.name.includes("Updated"));

    const customersPage = await fetch(`${BASE_URL}/customers`, {
      headers: {
        Cookie: cookie,
        Accept: "text/html",
      },
    });
    assert.equal(customersPage.status, 200);
    const customersHtml = await customersPage.text();
    assert.ok(customersHtml.includes("Customers"));
    assert.ok(customersHtml.includes('data-testid="customers-heading"'));

    const profilePage = await fetch(
      `${BASE_URL}/customers/${encodeURIComponent(created.customerId)}`,
      {
        headers: {
          Cookie: cookie,
          Accept: "text/html",
        },
      },
    );
    assert.equal(profilePage.status, 200);
    const profileHtml = await profilePage.text();
    assert.ok(profileHtml.includes("Customer Profile"));
    assert.ok(profileHtml.includes('data-testid="customer-profile-heading"'));

    console.log("M47 customers smoke tests passed.");
  } finally {
    if (created.customerId) {
      await prisma.creditAccount.deleteMany({ where: { customerId: created.customerId } });
      await prisma.customer.deleteMany({ where: { id: created.customerId } });
    }
    if (created.userId) {
      await prisma.user.deleteMany({ where: { id: created.userId } });
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
