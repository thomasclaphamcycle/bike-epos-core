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
console.log(`[m41-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m41-smoke] DATABASE_URL=${safeDbUrl}`);

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
  const managerEmail = `m41.manager.${token}@example.com`;
  const managerPassword = `M41Pass!${token}`;

  const created = {
    userId: null,
    productId: null,
    variantId: null,
    basketIds: new Set(),
    saleIds: new Set(),
    refundIds: new Set(),
    receiptNumbers: new Set(),
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
        username: `m41-manager-${token}`,
        name: "M41 Manager",
        email: managerEmail,
        passwordHash: await bcrypt.hash(managerPassword, 10),
        role: "MANAGER",
        isActive: true,
      },
    });
    created.userId = manager.id;

    const cookie = await login(managerEmail, managerPassword);

    const product = await apiJson({
      path: "/api/products",
      method: "POST",
      body: {
        name: `M41 Product ${token}`,
        brand: "M41",
      },
      cookie,
    });
    created.productId = product.payload.id;

    const variant = await apiJson({
      path: `/api/products/${encodeURIComponent(product.payload.id)}/variants`,
      method: "POST",
      body: {
        sku: `M41-SKU-${token}`,
        name: `M41 Variant ${token}`,
        retailPricePence: 1200,
      },
      cookie,
    });
    created.variantId = variant.payload.id;

    await apiJson({
      path: "/api/inventory/adjustments",
      method: "POST",
      body: {
        variantId: created.variantId,
        quantityDelta: 20,
        reason: "COUNT_CORRECTION",
        note: "m41 seed",
      },
      cookie,
    });

    const basket = await apiJson({
      path: "/api/baskets",
      method: "POST",
      body: {},
      cookie,
    });
    created.basketIds.add(basket.payload.id);

    await apiJson({
      path: `/api/baskets/${encodeURIComponent(basket.payload.id)}/lines`,
      method: "POST",
      body: {
        variantId: created.variantId,
        quantity: 2,
      },
      cookie,
    });

    const checkout = await apiJson({
      path: `/api/baskets/${encodeURIComponent(basket.payload.id)}/checkout`,
      method: "POST",
      body: {},
      cookie,
    });

    const saleId = checkout.payload.sale?.id;
    assert.ok(saleId, "missing sale id");
    created.saleIds.add(saleId);

    await apiJson({
      path: `/api/sales/${encodeURIComponent(saleId)}/tenders`,
      method: "POST",
      body: {
        method: "CARD",
        amountPence: checkout.payload.sale.totalPence,
      },
      cookie,
    });

    const completedSale = await apiJson({
      path: `/api/sales/${encodeURIComponent(saleId)}/complete`,
      method: "POST",
      body: {},
      cookie,
    });
    assert.ok(completedSale.payload.completedAt);

    const saleDetail = await apiJson({
      path: `/api/sales/${encodeURIComponent(saleId)}`,
      cookie,
    });
    assert.equal(Array.isArray(saleDetail.payload.saleItems), true);
    assert.ok(saleDetail.payload.saleItems.length > 0, "sale must include at least one line");

    const saleLineId = saleDetail.payload.saleItems[0].id;

    const createdRefund = await apiJson({
      path: "/api/refunds",
      method: "POST",
      body: {
        saleId,
      },
      cookie,
    });
    assert.equal(createdRefund.status, 201, JSON.stringify(createdRefund.payload));

    const refundId = createdRefund.payload.refund?.id;
    assert.ok(refundId, "missing refund id");
    created.refundIds.add(refundId);

    const withLine = await apiJson({
      path: `/api/refunds/${encodeURIComponent(refundId)}/lines`,
      method: "POST",
      body: {
        saleLineId,
        quantity: 1,
      },
      cookie,
    });

    const refundTotalPence = withLine.payload.refund?.computedTotalPence;
    assert.ok(Number.isInteger(refundTotalPence), JSON.stringify(withLine.payload));
    assert.ok(refundTotalPence > 0, JSON.stringify(withLine.payload));

    await apiJson({
      path: `/api/refunds/${encodeURIComponent(refundId)}/tenders`,
      method: "POST",
      body: {
        tenderType: "CARD",
        amountPence: refundTotalPence,
        meta: {
          providerRef: `m41-refund-${token}`,
        },
      },
      cookie,
    });

    const completedRefund = await apiJson({
      path: `/api/refunds/${encodeURIComponent(refundId)}/complete`,
      method: "POST",
      body: {},
      cookie,
    });
    assert.equal(completedRefund.status, 201, JSON.stringify(completedRefund.payload));
    assert.equal(completedRefund.payload.refund.status, "COMPLETED");

    const audit = await apiJson({
      path: `/api/audit?entityType=REFUND&entityId=${encodeURIComponent(refundId)}&action=REFUND_COMPLETED&limit=20`,
      cookie,
    });
    assert.equal(audit.status, 200, JSON.stringify(audit.payload));
    assert.ok(Array.isArray(audit.payload.events), JSON.stringify(audit.payload));
    assert.ok(audit.payload.events.length >= 1, JSON.stringify(audit.payload));

    const issuedReceipt = await apiJson({
      path: "/api/receipts/issue",
      method: "POST",
      body: {
        refundId,
      },
      cookie,
    });
    assert.equal(issuedReceipt.status, 201, JSON.stringify(issuedReceipt.payload));
    assert.ok(issuedReceipt.payload.receipt?.receiptNumber);
    assert.equal(issuedReceipt.payload.receipt?.saleRefundId, refundId);
    created.receiptNumbers.add(issuedReceipt.payload.receipt.receiptNumber);

    const issuedAgain = await apiJson({
      path: "/api/receipts/issue",
      method: "POST",
      body: {
        refundId,
      },
      cookie,
    });
    assert.equal(issuedAgain.status, 200, JSON.stringify(issuedAgain.payload));
    assert.equal(issuedAgain.payload.idempotent, true);

    const receiptJson = await apiJson({
      path: `/api/receipts/${encodeURIComponent(issuedReceipt.payload.receipt.receiptNumber)}`,
      cookie,
    });
    assert.equal(receiptJson.payload.type, "REFUND");
    assert.equal(receiptJson.payload.refundId, refundId);
    assert.equal(receiptJson.payload.refund?.kind, "SALE_REFUND");
    assert.equal(receiptJson.payload.totals.totalPence, refundTotalPence);
    assert.equal(Array.isArray(receiptJson.payload.items), true);
    assert.equal(Array.isArray(receiptJson.payload.tenders), true);
    assert.ok(receiptJson.payload.items.length >= 1);
    assert.ok(receiptJson.payload.tenders.length >= 1);

    const printable = await fetch(
      `${BASE_URL}/r/${encodeURIComponent(issuedReceipt.payload.receipt.receiptNumber)}`,
      {
        headers: { Cookie: cookie },
      },
    );
    assert.equal(printable.status, 200);
    const printableHtml = await printable.text();
    assert.ok(printableHtml.includes("REFUND"));
    assert.ok(printableHtml.includes(issuedReceipt.payload.receipt.receiptNumber));

    console.log("M41 refunds smoke tests passed.");
  } finally {
    const receiptNumbers = Array.from(created.receiptNumbers);
    if (receiptNumbers.length > 0) {
      await prisma.receipt.deleteMany({
        where: { receiptNumber: { in: receiptNumbers } },
      });
    }

    const refundIds = Array.from(created.refundIds);
    if (refundIds.length > 0) {
      await prisma.auditEvent.deleteMany({
        where: { entityType: "REFUND", entityId: { in: refundIds } },
      });
      await prisma.refund.deleteMany({
        where: { id: { in: refundIds } },
      });
    }

    const saleIds = Array.from(created.saleIds);
    if (saleIds.length > 0) {
      await prisma.saleTender.deleteMany({ where: { saleId: { in: saleIds } } });
      await prisma.paymentIntent.deleteMany({ where: { saleId: { in: saleIds } } });
      await prisma.payment.deleteMany({ where: { saleId: { in: saleIds } } });
      await prisma.saleItem.deleteMany({ where: { saleId: { in: saleIds } } });
      await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
    }

    const basketIds = Array.from(created.basketIds);
    if (basketIds.length > 0) {
      await prisma.basketItem.deleteMany({ where: { basketId: { in: basketIds } } });
      await prisma.basket.deleteMany({ where: { id: { in: basketIds } } });
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
