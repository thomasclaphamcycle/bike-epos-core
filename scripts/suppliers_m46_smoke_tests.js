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
console.log(`[m46-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m46-smoke] DATABASE_URL=${safeDbUrl}`);

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

const apiJson = async ({ path, method = "GET", body, cookie }) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
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
  const managerEmail = `m46.manager.${token}@example.com`;
  const managerPassword = `M46Manager!${token}`;
  const staffEmail = `m46.staff.${token}@example.com`;
  const staffPassword = `M46Staff!${token}`;

  const created = {
    userIds: [],
    supplierId: null,
    purchaseOrderId: null,
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
        username: `m46-manager-${token}`,
        name: "M46 Manager",
        email: managerEmail,
        passwordHash: await bcrypt.hash(managerPassword, 10),
        role: "MANAGER",
        isActive: true,
      },
    });
    created.userIds.push(manager.id);

    const staff = await prisma.user.create({
      data: {
        username: `m46-staff-${token}`,
        name: "M46 Staff",
        email: staffEmail,
        passwordHash: await bcrypt.hash(staffPassword, 10),
        role: "STAFF",
        isActive: true,
      },
    });
    created.userIds.push(staff.id);

    const managerCookie = await login(managerEmail, managerPassword);
    const staffCookie = await login(staffEmail, staffPassword);

    const createdSupplier = await apiJson({
      path: "/api/suppliers",
      method: "POST",
      body: {
        name: `M46 Supplier ${token}`,
        email: `m46.${token}@supplier.test`,
        phone: "02070000000",
        leadTimeDays: 5,
        notes: "M46 create",
      },
      cookie: managerCookie,
    });
    assert.equal(createdSupplier.status, 201, JSON.stringify(createdSupplier.payload));
    created.supplierId = createdSupplier.payload.id;

    const searched = await apiJson({
      path: `/api/suppliers?search=${encodeURIComponent("M46 Supplier")}`,
      cookie: managerCookie,
    });
    assert.equal(Array.isArray(searched.payload.suppliers), true);
    assert.ok(searched.payload.suppliers.some((supplier) => supplier.id === created.supplierId));

    const fetched = await apiJson({
      path: `/api/suppliers/${encodeURIComponent(created.supplierId)}`,
      cookie: managerCookie,
    });
    assert.equal(fetched.payload.id, created.supplierId);
    assert.equal(fetched.payload.leadTimeDays, 5);

    const updated = await apiJson({
      path: `/api/suppliers/${encodeURIComponent(created.supplierId)}`,
      method: "PATCH",
      body: {
        name: `M46 Supplier Updated ${token}`,
        leadTimeDays: 9,
        notes: "M46 updated",
      },
      cookie: managerCookie,
    });
    assert.equal(updated.payload.id, created.supplierId);
    assert.equal(updated.payload.leadTimeDays, 9);
    assert.equal(updated.payload.name.includes("Updated"), true);

    const po = await apiJson({
      path: "/api/purchase-orders",
      method: "POST",
      body: {
        supplierId: created.supplierId,
        notes: "m46 supplier po list",
      },
      cookie: managerCookie,
    });
    created.purchaseOrderId = po.payload.id;

    const supplierPos = await apiJson({
      path: `/api/suppliers/${encodeURIComponent(created.supplierId)}/purchase-orders`,
      cookie: managerCookie,
    });
    assert.equal(Array.isArray(supplierPos.payload.purchaseOrders), true);
    assert.ok(supplierPos.payload.purchaseOrders.some((row) => row.id === created.purchaseOrderId));

    const suppliersPage = await fetch(`${BASE_URL}/suppliers`, {
      headers: {
        Cookie: managerCookie,
        Accept: "text/html",
      },
    });
    assert.equal(suppliersPage.status, 200);
    const suppliersHtml = await suppliersPage.text();
    assert.ok(suppliersHtml.includes("Suppliers"));
    assert.ok(suppliersHtml.includes('data-testid="suppliers-heading"'));
    assert.ok(suppliersHtml.includes('data-testid="app-nav-suppliers"'));

    const purchasingPage = await fetch(`${BASE_URL}/purchasing`, {
      headers: {
        Cookie: managerCookie,
        Accept: "text/html",
      },
    });
    assert.equal(purchasingPage.status, 200);
    const purchasingHtml = await purchasingPage.text();
    assert.ok(purchasingHtml.includes('id="po-create-supplier"'));
    assert.ok(purchasingHtml.includes('/api/suppliers'));

    const staffSuppliersPage = await fetch(`${BASE_URL}/suppliers`, {
      headers: {
        Cookie: staffCookie,
        Accept: "text/html",
      },
      redirect: "manual",
    });
    assert.equal(staffSuppliersPage.status, 302);
    assert.ok((staffSuppliersPage.headers.get("location") || "").startsWith("/not-authorized"));

    console.log("M46 suppliers smoke tests passed.");
  } finally {
    if (created.purchaseOrderId) {
      await prisma.purchaseOrder.deleteMany({ where: { id: created.purchaseOrderId } });
    }

    if (created.supplierId) {
      await prisma.supplier.deleteMany({ where: { id: created.supplierId } });
    }

    if (created.userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
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
