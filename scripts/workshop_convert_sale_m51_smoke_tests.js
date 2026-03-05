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
console.log(`[m51-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m51-smoke] DATABASE_URL=${safeDbUrl}`);

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
  const managerEmail = `m51.manager.${token}@example.com`;
  const managerPassword = `M51Manager!${token}`;

  const created = {
    userId: null,
    customerId: null,
    productId: null,
    variantId: null,
    workshopJobId: null,
    saleId: null,
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
        username: `m51-manager-${token}`,
        name: "M51 Manager",
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
        name: `M51 Customer ${token}`,
      },
      cookie,
    });
    created.customerId = customer.payload.id;

    const product = await apiJson({
      path: "/api/products",
      method: "POST",
      body: {
        name: `M51 Part ${token}`,
      },
      cookie,
    });
    created.productId = product.payload.id;

    const variant = await apiJson({
      path: "/api/variants",
      method: "POST",
      body: {
        productId: created.productId,
        sku: `M51-SKU-${token}`,
        retailPricePence: 1300,
      },
      cookie,
    });
    created.variantId = variant.payload.id;

    const job = await apiJson({
      path: "/api/workshop/jobs",
      method: "POST",
      body: {
        customerId: created.customerId,
        title: `M51 Job ${token}`,
      },
      cookie,
    });
    created.workshopJobId = job.payload.id;

    await apiJson({
      path: `/api/workshop/jobs/${encodeURIComponent(created.workshopJobId)}/lines`,
      method: "POST",
      body: {
        type: "LABOUR",
        description: "Service labour",
        quantity: 1,
        unitPricePence: 4500,
      },
      cookie,
    });

    await apiJson({
      path: `/api/workshop/jobs/${encodeURIComponent(created.workshopJobId)}/lines`,
      method: "POST",
      body: {
        type: "PART",
        productId: created.productId,
        quantity: 2,
        unitPricePence: 1300,
      },
      cookie,
    });

    const converted = await apiJson({
      path: `/api/workshop/jobs/${encodeURIComponent(created.workshopJobId)}/convert-to-sale`,
      method: "POST",
      body: {},
      cookie,
    });

    assert.equal(converted.status, 201);
    assert.equal(converted.payload.idempotent, false);
    assert.ok(converted.payload.saleId, "expected saleId");
    assert.ok(converted.payload.saleUrl?.includes(`/pos?saleId=${converted.payload.saleId}`));
    created.saleId = converted.payload.saleId;

    const jobAfterConvert = await apiJson({
      path: `/api/workshop/jobs/${encodeURIComponent(created.workshopJobId)}`,
      cookie,
    });
    assert.equal(jobAfterConvert.payload.job.saleId, created.saleId);
    assert.equal(jobAfterConvert.payload.lines.length, 2);
    assert.equal(jobAfterConvert.payload.totals.totalPence, 7100);

    const salePayload = await apiJson({
      path: `/api/sales/${encodeURIComponent(created.saleId)}`,
      cookie,
    });
    assert.equal(salePayload.payload.sale.totalPence, 7100);
    assert.equal(salePayload.payload.saleItems.length, 2);
    assert.ok(
      salePayload.payload.saleItems.some(
        (line) => line.quantity === 2 && line.unitPricePence === 1300 && line.variantId === created.variantId,
      ),
      "Expected converted PART sale line",
    );

    const convertAgain = await apiJson({
      path: `/api/workshop/jobs/${encodeURIComponent(created.workshopJobId)}/convert-to-sale`,
      method: "POST",
      body: {},
      cookie,
    });
    assert.equal(convertAgain.status, 200);
    assert.equal(convertAgain.payload.idempotent, true);
    assert.equal(convertAgain.payload.saleId, created.saleId);

    const posPage = await fetch(`${BASE_URL}/pos?saleId=${encodeURIComponent(created.saleId)}`, {
      headers: {
        Cookie: cookie,
        Accept: "text/html",
      },
    });
    assert.equal(posPage.status, 200);
    const posHtml = await posPage.text();
    assert.ok(posHtml.includes("getSaleIdQueryParam"));

    console.log("M51 workshop convert-to-sale smoke tests passed.");
  } finally {
    if (created.saleId) {
      await prisma.saleTender.deleteMany({ where: { saleId: created.saleId } });
      await prisma.paymentIntent.deleteMany({ where: { saleId: created.saleId } });
      await prisma.payment.deleteMany({ where: { saleId: created.saleId } });
      await prisma.receipt.deleteMany({ where: { saleId: created.saleId } });
      await prisma.saleItem.deleteMany({ where: { saleId: created.saleId } });
      await prisma.sale.deleteMany({ where: { id: created.saleId } });
    }
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
