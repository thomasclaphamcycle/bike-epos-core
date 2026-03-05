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
console.log(`[m37-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m37-smoke] DATABASE_URL=${safeDbUrl}`);

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
  const managerEmail = `m37.manager.${runRef}@example.com`;
  const managerPassword = `ManagerPass!${runRef}`;

  const created = {
    userEmail: managerEmail,
    productId: null,
    variantId: null,
    basketId: null,
    saleId: null,
    paymentId: null,
    cashSessionId: null,
  };

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
        username: `m37-manager-${runRef}`,
        email: managerEmail,
        name: "M37 Manager",
        passwordHash: await bcrypt.hash(managerPassword, 10),
        role: "MANAGER",
        isActive: true,
      },
    });

    const managerCookie = await loginAs(managerEmail, managerPassword);

    const open = await fetchJson("/api/till/sessions/open", {
      method: "POST",
      headers: { Cookie: managerCookie },
      body: JSON.stringify({ openingFloatPence: 1000 }),
    });
    assert.equal(open.status, 201, JSON.stringify(open.json));
    created.cashSessionId = open.json.session.id;

    const paidIn = await fetchJson(`/api/till/sessions/${created.cashSessionId}/movements`, {
      method: "POST",
      headers: { Cookie: managerCookie },
      body: JSON.stringify({ type: "PAID_IN", amountPence: 200, ref: `paid-in-${runRef}` }),
    });
    assert.equal(paidIn.status, 201, JSON.stringify(paidIn.json));

    const paidOut = await fetchJson(`/api/till/sessions/${created.cashSessionId}/movements`, {
      method: "POST",
      headers: { Cookie: managerCookie },
      body: JSON.stringify({ type: "PAID_OUT", amountPence: 50, ref: `paid-out-${runRef}` }),
    });
    assert.equal(paidOut.status, 201, JSON.stringify(paidOut.json));

    const product = await fetchJson("/api/products", {
      method: "POST",
      headers: { Cookie: managerCookie },
      body: JSON.stringify({ name: `M37 Product ${runRef}`, brand: "Smoke", description: "Till test" }),
    });
    assert.equal(product.status, 201, JSON.stringify(product.json));
    created.productId = product.json.id;

    const variant = await fetchJson(`/api/products/${created.productId}/variants`, {
      method: "POST",
      headers: { Cookie: managerCookie },
      body: JSON.stringify({ sku: `M37-${runRef}`, name: `M37 Variant ${runRef}`, retailPricePence: 500 }),
    });
    assert.equal(variant.status, 201, JSON.stringify(variant.json));
    created.variantId = variant.json.id;

    const stockAdjust = await fetchJson("/api/inventory/adjustments", {
      method: "POST",
      headers: { Cookie: managerCookie },
      body: JSON.stringify({
        variantId: created.variantId,
        quantityDelta: 10,
        reason: "COUNT_CORRECTION",
        note: "m37 seed",
      }),
    });
    assert.equal(stockAdjust.status, 201, JSON.stringify(stockAdjust.json));

    const basket = await fetchJson("/api/baskets", {
      method: "POST",
      headers: { Cookie: managerCookie },
      body: JSON.stringify({}),
    });
    assert.equal(basket.status, 201, JSON.stringify(basket.json));
    created.basketId = basket.json.id;

    const addLine = await fetchJson(`/api/baskets/${created.basketId}/lines`, {
      method: "POST",
      headers: { Cookie: managerCookie },
      body: JSON.stringify({ variantId: created.variantId, quantity: 2 }),
    });
    assert.equal(addLine.status, 201, JSON.stringify(addLine.json));

    const checkout = await fetchJson(`/api/baskets/${created.basketId}/checkout`, {
      method: "POST",
      headers: { Cookie: managerCookie },
      body: JSON.stringify({
        paymentMethod: "CASH",
        amountPence: 1000,
        providerRef: `m37-cash-sale-${runRef}`,
      }),
    });
    assert.equal(checkout.status, 201, JSON.stringify(checkout.json));
    created.saleId = checkout.json.sale.id;
    created.paymentId = checkout.json.payment.id;

    const refund = await fetchJson(`/api/payments/${created.paymentId}/refund`, {
      method: "POST",
      headers: { Cookie: managerCookie },
      body: JSON.stringify({
        amountPence: 300,
        reason: "M37 test refund",
        idempotencyKey: `m37-refund-${runRef}`,
      }),
    });
    assert.equal(refund.status, 201, JSON.stringify(refund.json));

    const count = await fetchJson(`/api/till/sessions/${created.cashSessionId}/count`, {
      method: "POST",
      headers: { Cookie: managerCookie },
      body: JSON.stringify({
        countedCashPence: 1840,
        notes: "counted in smoke",
      }),
    });
    assert.equal(count.status, 201, JSON.stringify(count.json));

    const close = await fetchJson(`/api/till/sessions/${created.cashSessionId}/close`, {
      method: "POST",
      headers: { Cookie: managerCookie },
      body: JSON.stringify({}),
    });
    assert.equal(close.status, 201, JSON.stringify(close.json));

    const summary = await fetchJson(`/api/till/sessions/${created.cashSessionId}/summary`, {
      headers: { Cookie: managerCookie },
    });
    assert.equal(summary.status, 200, JSON.stringify(summary.json));

    assert.equal(summary.json.totals.openingFloatPence, 1000);
    assert.equal(summary.json.totals.paidInPence, 200);
    assert.equal(summary.json.totals.paidOutPence, 50);
    assert.equal(summary.json.totals.cashSalesPence, 1000);
    assert.equal(summary.json.totals.cashRefundsPence, 300);
    assert.equal(summary.json.totals.expectedCashPence, 1850);
    assert.equal(summary.json.totals.countedCashPence, 1840);
    assert.equal(summary.json.totals.variancePence, -10);

    const csv = await fetch(`${BASE_URL}/api/till/sessions/${created.cashSessionId}/summary.csv`, {
      headers: { Cookie: managerCookie },
    });
    assert.equal(csv.status, 200);
    const csvBody = await csv.text();
    assert.ok(csvBody.includes("expectedCashPence"));

    console.log("M37 till smoke tests passed.");
  } finally {
    if (created.saleId) {
      await prisma.saleReturnItem.deleteMany({ where: { saleReturn: { saleId: created.saleId } } });
      await prisma.saleReturn.deleteMany({ where: { saleId: created.saleId } });
      if (created.paymentId) {
        await prisma.paymentRefund.deleteMany({ where: { paymentId: created.paymentId } });
      }
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
      await prisma.variant.deleteMany({ where: { id: created.variantId } });
    }
    if (created.productId) {
      await prisma.product.deleteMany({ where: { id: created.productId } });
    }
    if (created.cashSessionId) {
      await prisma.cashCount.deleteMany({ where: { sessionId: created.cashSessionId } });
      await prisma.cashMovement.deleteMany({ where: { sessionId: created.cashSessionId } });
      await prisma.cashSession.deleteMany({ where: { id: created.cashSessionId } });
    }
    await prisma.user.deleteMany({ where: { email: created.userEmail } });

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
