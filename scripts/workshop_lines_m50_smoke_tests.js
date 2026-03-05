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
console.log(`[m50-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m50-smoke] DATABASE_URL=${safeDbUrl}`);

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
  const managerEmail = `m50.manager.${token}@example.com`;
  const managerPassword = `M50Manager!${token}`;

  const created = {
    userId: null,
    customerId: null,
    productId: null,
    variantId: null,
    workshopJobId: null,
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
        username: `m50-manager-${token}`,
        name: "M50 Manager",
        email: managerEmail,
        passwordHash: await bcrypt.hash(managerPassword, 10),
        role: "MANAGER",
        isActive: true,
      },
    });
    created.userId = manager.id;

    const cookie = await login(managerEmail, managerPassword);

    const customer = await apiJson({
      path: "/api/customers",
      method: "POST",
      body: {
        name: `M50 Customer ${token}`,
      },
      cookie,
    });
    created.customerId = customer.payload.id;

    const product = await apiJson({
      path: "/api/products",
      method: "POST",
      body: {
        name: `M50 Product ${token}`,
      },
      cookie,
    });
    created.productId = product.payload.id;

    const variant = await apiJson({
      path: "/api/variants",
      method: "POST",
      body: {
        productId: created.productId,
        sku: `M50-SKU-${token}`,
        retailPricePence: 1499,
      },
      cookie,
    });
    created.variantId = variant.payload.id;

    const workshopJob = await apiJson({
      path: "/api/workshop/jobs",
      method: "POST",
      body: {
        customerId: created.customerId,
        title: `M50 Job ${token}`,
      },
      cookie,
    });
    created.workshopJobId = workshopJob.payload.id;

    const labourLine = await apiJson({
      path: `/api/workshop/jobs/${encodeURIComponent(created.workshopJobId)}/lines`,
      method: "POST",
      body: {
        type: "LABOUR",
        description: "Brake setup labour",
        quantity: 2,
        unitPrice: 30.5,
      },
      cookie,
    });
    assert.equal(labourLine.status, 201);
    assert.equal(labourLine.payload.line.type, "LABOUR");

    const partLine = await apiJson({
      path: `/api/workshop/jobs/${encodeURIComponent(created.workshopJobId)}/lines`,
      method: "POST",
      body: {
        type: "PART",
        productId: created.productId,
        quantity: 1,
        unitPricePence: 1250,
      },
      cookie,
    });
    assert.equal(partLine.status, 201);
    assert.equal(partLine.payload.line.type, "PART");

    const initialJob = await apiJson({
      path: `/api/workshop/jobs/${encodeURIComponent(created.workshopJobId)}`,
      cookie,
    });
    assert.equal(initialJob.payload.totals.subtotalPence, 7350);

    await apiJson({
      path: `/api/workshop/jobs/${encodeURIComponent(created.workshopJobId)}/lines/${encodeURIComponent(
        labourLine.payload.line.id,
      )}`,
      method: "PATCH",
      body: {
        quantity: 3,
        unitPrice: 30.5,
      },
      cookie,
    });

    const patchedJob = await apiJson({
      path: `/api/workshop/jobs/${encodeURIComponent(created.workshopJobId)}`,
      cookie,
    });
    assert.equal(patchedJob.payload.totals.subtotalPence, 10400);

    await apiJson({
      path: `/api/workshop/jobs/${encodeURIComponent(created.workshopJobId)}/lines/${encodeURIComponent(
        partLine.payload.line.id,
      )}`,
      method: "DELETE",
      cookie,
    });

    const deletedJob = await apiJson({
      path: `/api/workshop/jobs/${encodeURIComponent(created.workshopJobId)}`,
      cookie,
    });
    assert.equal(deletedJob.payload.lines.length, 1);
    assert.equal(deletedJob.payload.totals.totalPence, 9150);

    const jobCardPage = await fetch(`${BASE_URL}/workshop/${encodeURIComponent(created.workshopJobId)}`, {
      headers: {
        Cookie: cookie,
        Accept: "text/html",
      },
    });
    assert.equal(jobCardPage.status, 200);
    const html = await jobCardPage.text();
    assert.ok(html.includes("workshop-job-card-heading"));
    assert.ok(html.includes("line-add-btn"));

    console.log("M50 workshop lines smoke tests passed.");
  } finally {
    if (created.workshopJobId) {
      await prisma.workshopJobLine.deleteMany({ where: { jobId: created.workshopJobId } });
      await prisma.workshopJobPart.deleteMany({ where: { workshopJobId: created.workshopJobId } });
      await prisma.workshopJobNote.deleteMany({ where: { workshopJobId: created.workshopJobId } });
      await prisma.payment.deleteMany({ where: { workshopJobId: created.workshopJobId } });
      await prisma.workshopJob.deleteMany({ where: { id: created.workshopJobId } });
    }
    if (created.variantId) {
      await prisma.stockLedgerEntry.deleteMany({ where: { variantId: created.variantId } });
      await prisma.inventoryMovement.deleteMany({ where: { variantId: created.variantId } });
      await prisma.barcode.deleteMany({ where: { variantId: created.variantId } });
      await prisma.variant.deleteMany({ where: { id: created.variantId } });
    }
    if (created.productId) {
      await prisma.product.deleteMany({ where: { id: created.productId } });
    }
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
