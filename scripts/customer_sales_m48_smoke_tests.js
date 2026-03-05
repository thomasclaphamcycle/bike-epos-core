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
console.log(`[m48-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m48-smoke] DATABASE_URL=${safeDbUrl}`);

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
  const managerEmail = `m48.manager.${token}@example.com`;
  const managerPassword = `M48Manager!${token}`;

  const created = {
    userId: null,
    customerId: null,
    productId: null,
    variantId: null,
    basketId: null,
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
        username: `m48-manager-${token}`,
        name: "M48 Manager",
        email: managerEmail,
        passwordHash: await bcrypt.hash(managerPassword, 10),
        role: "MANAGER",
        isActive: true,
      },
    });
    created.userId = manager.id;

    const cookie = await login(managerEmail, managerPassword);

    const createdCustomer = await apiJson({
      path: "/api/customers",
      method: "POST",
      body: {
        name: `M48 Customer ${token}`,
        email: `m48.customer.${token}@example.com`,
      },
      cookie,
    });
    created.customerId = createdCustomer.payload.id;

    const product = await apiJson({
      path: "/api/products",
      method: "POST",
      body: {
        name: `M48 Product ${token}`,
      },
      cookie,
    });
    created.productId = product.payload.id;

    const variant = await apiJson({
      path: "/api/variants",
      method: "POST",
      body: {
        productId: product.payload.id,
        sku: `M48-SKU-${token}`,
        retailPricePence: 1800,
      },
      cookie,
    });
    created.variantId = variant.payload.id;

    await apiJson({
      path: "/api/inventory/movements",
      method: "POST",
      body: {
        variantId: variant.payload.id,
        type: "PURCHASE",
        quantity: 10,
        referenceType: "M48_TEST",
        referenceId: `m48_${token}`,
      },
      cookie,
    });

    const basket = await apiJson({
      path: "/api/baskets",
      method: "POST",
      body: {},
      cookie,
    });
    created.basketId = basket.payload.id;

    await apiJson({
      path: `/api/baskets/${encodeURIComponent(basket.payload.id)}/lines`,
      method: "POST",
      body: {
        variantId: variant.payload.id,
        quantity: 1,
      },
      cookie,
    });

    const checkout = await apiJson({
      path: `/api/baskets/${encodeURIComponent(basket.payload.id)}/checkout`,
      method: "POST",
      body: {},
      cookie,
    });
    created.saleId = checkout.payload.sale.id;
    assert.ok(created.saleId, "missing sale id from checkout");

    await apiJson({
      path: `/api/sales/${encodeURIComponent(created.saleId)}/tenders`,
      method: "POST",
      body: {
        method: "CARD",
        amountPence: checkout.payload.sale.totalPence,
      },
      cookie,
    });

    await apiJson({
      path: `/api/sales/${encodeURIComponent(created.saleId)}/complete`,
      method: "POST",
      body: {},
      cookie,
    });

    const attachedByPatch = await apiJson({
      path: `/api/sales/${encodeURIComponent(created.saleId)}`,
      method: "PATCH",
      body: { customerId: created.customerId },
      cookie,
    });
    assert.equal(attachedByPatch.payload.sale.customer.id, created.customerId);

    const detachedByPost = await apiJson({
      path: `/api/sales/${encodeURIComponent(created.saleId)}/customer`,
      method: "POST",
      body: { customerId: null },
      cookie,
    });
    assert.equal(detachedByPost.payload.sale.customer, null);

    const attachedByPost = await apiJson({
      path: `/api/sales/${encodeURIComponent(created.saleId)}/customer`,
      method: "POST",
      body: { customerId: created.customerId },
      cookie,
    });
    assert.equal(attachedByPost.payload.sale.customer.id, created.customerId);

    const issuedReceipt = await apiJson({
      path: "/api/receipts/issue",
      method: "POST",
      body: { saleId: created.saleId },
      cookie,
    });
    assert.ok(issuedReceipt.payload.receipt?.receiptNumber);

    const salesHistory = await apiJson({
      path: `/api/customers/${encodeURIComponent(created.customerId)}/sales`,
      cookie,
    });
    assert.ok(Array.isArray(salesHistory.payload.sales), JSON.stringify(salesHistory.payload));
    const foundSale = salesHistory.payload.sales.find((entry) => entry.id === created.saleId);
    assert.ok(foundSale, "Expected sale in customer history");
    assert.ok(foundSale.receiptNumber, "Expected receipt number in customer history");

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
    assert.ok(profileHtml.includes("Recent Sales"));

    console.log("M48 customer-sales smoke tests passed.");
  } finally {
    if (created.saleId) {
      await prisma.receipt.deleteMany({ where: { saleId: created.saleId } });
      await prisma.saleTender.deleteMany({ where: { saleId: created.saleId } });
      await prisma.paymentIntent.deleteMany({ where: { saleId: created.saleId } });
      await prisma.payment.deleteMany({ where: { saleId: created.saleId } });
      await prisma.saleItem.deleteMany({ where: { saleId: created.saleId } });
      await prisma.sale.deleteMany({ where: { id: created.saleId } });
    }
    if (created.basketId) {
      await prisma.basketItem.deleteMany({ where: { basketId: created.basketId } });
      await prisma.basket.deleteMany({ where: { id: created.basketId } });
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
