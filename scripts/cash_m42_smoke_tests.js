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
  throw new Error(
    "Refusing to run against non-test database URL. Set TEST_DATABASE_URL or ALLOW_NON_TEST_DB=1.",
  );
}

const safeDbUrl = DATABASE_URL.replace(/(postgres(?:ql)?:\/\/[^:/@]+:)[^@]+@/i, "$1***@");
console.log(`[m42-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m42-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});
const serverController = createSmokeServerController({
  label: "m42-smoke",
  baseUrl: BASE_URL,
  databaseUrl: DATABASE_URL,
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

const utcToday = () => new Date().toISOString().slice(0, 10);

const run = async () => {
  const token = uniqueRef();
  const managerEmail = `m42.manager.${token}@example.com`;
  const managerPassword = `M42Pass!${token}`;

  const created = {
    userId: null,
    productId: null,
    variantId: null,
    basketIds: new Set(),
    saleIds: new Set(),
    refundIds: new Set(),
    sessionIds: new Set(),
  };

  try {
    await serverController.startIfNeeded();

    const manager = await prisma.user.create({
      data: {
        username: `m42-manager-${token}`,
        name: "M42 Manager",
        email: managerEmail,
        passwordHash: await bcrypt.hash(managerPassword, 10),
        role: "MANAGER",
        isActive: true,
      },
    });
    created.userId = manager.id;

    const cookie = await login(managerEmail, managerPassword);

    const currentSession = await apiJson({
      path: "/api/till/sessions/current",
      cookie,
    });
    if (currentSession.payload?.session?.id) {
      await apiJson({
        path: `/api/till/sessions/${encodeURIComponent(currentSession.payload.session.id)}/count`,
        method: "POST",
        body: {
          countedCashPence: currentSession.payload.totals?.expectedCashPence ?? 0,
          notes: "m42 pre-close",
        },
        cookie,
      });
      await apiJson({
        path: `/api/till/sessions/${encodeURIComponent(currentSession.payload.session.id)}/close`,
        method: "POST",
        body: {},
        cookie,
      });
    }

    const today = utcToday();

    const baselineSummary = await apiJson({
      path: `/api/cash/summary?from=${today}&to=${today}`,
      cookie,
    });

    const floatMovement = await apiJson({
      path: "/api/cash/movements",
      method: "POST",
      body: {
        type: "FLOAT",
        amountPence: 1000,
        note: "m42 opening float",
      },
      cookie,
    });
    assert.equal(floatMovement.status, 201, JSON.stringify(floatMovement.payload));
    assert.equal(floatMovement.payload.movement.type, "FLOAT");
    assert.ok(floatMovement.payload.movement.sessionId);
    created.sessionIds.add(floatMovement.payload.movement.sessionId);

    const product = await apiJson({
      path: "/api/products",
      method: "POST",
      body: {
        name: `M42 Product ${token}`,
        brand: "M42",
      },
      cookie,
    });
    created.productId = product.payload.id;

    const variant = await apiJson({
      path: `/api/products/${encodeURIComponent(product.payload.id)}/variants`,
      method: "POST",
      body: {
        sku: `M42-SKU-${token}`,
        name: `M42 Variant ${token}`,
        retailPricePence: 1500,
      },
      cookie,
    });
    created.variantId = variant.payload.id;

    await apiJson({
      path: "/api/inventory/adjustments",
      method: "POST",
      body: {
        variantId: created.variantId,
        quantityDelta: 10,
        reason: "COUNT_CORRECTION",
        note: "m42 seed",
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

    const saleId = checkout.payload.sale?.id;
    assert.ok(saleId, "missing sale id");
    created.saleIds.add(saleId);

    await apiJson({
      path: `/api/sales/${encodeURIComponent(saleId)}/tenders`,
      method: "POST",
      body: {
        method: "CASH",
        amountPence: checkout.payload.sale.totalPence,
      },
      cookie,
    });

    await apiJson({
      path: `/api/sales/${encodeURIComponent(saleId)}/complete`,
      method: "POST",
      body: {},
      cookie,
    });

    const saleDetail = await apiJson({
      path: `/api/sales/${encodeURIComponent(saleId)}`,
      cookie,
    });
    const saleLineId = saleDetail.payload.saleItems[0]?.id;
    assert.ok(saleLineId, "missing sale line for refund");

    const createdRefund = await apiJson({
      path: "/api/refunds",
      method: "POST",
      body: {
        saleId,
      },
      cookie,
    });
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

    await apiJson({
      path: `/api/refunds/${encodeURIComponent(refundId)}/tenders`,
      method: "POST",
      body: {
        tenderType: "CASH",
        amountPence: refundTotalPence,
      },
      cookie,
    });

    await apiJson({
      path: `/api/refunds/${encodeURIComponent(refundId)}/complete`,
      method: "POST",
      body: {},
      cookie,
    });

    const movementList = await apiJson({
      path: `/api/cash/movements?from=${today}&to=${today}`,
      cookie,
    });
    assert.equal(Array.isArray(movementList.payload.movements), true);
    assert.ok(
      movementList.payload.movements.some((movement) => movement.id === floatMovement.payload.movement.id),
    );
    assert.ok(
      movementList.payload.movements.some(
        (movement) => movement.type === "CASH_SALE" && movement.relatedSaleId === saleId,
      ),
    );
    assert.ok(
      movementList.payload.movements.some(
        (movement) => movement.type === "CASH_REFUND" && movement.relatedRefundId === refundId,
      ),
    );

    const summaryAfter = await apiJson({
      path: `/api/cash/summary?from=${today}&to=${today}`,
      cookie,
    });

    const beforeTotals = baselineSummary.payload.totals;
    const afterTotals = summaryAfter.payload.totals;

    const deltaFloat = afterTotals.floatPence - beforeTotals.floatPence;
    const deltaCashSales = afterTotals.cashSalesPence - beforeTotals.cashSalesPence;
    const deltaCashRefunds = afterTotals.cashRefundsPence - beforeTotals.cashRefundsPence;
    const deltaExpected = afterTotals.expectedCashOnHandPence - beforeTotals.expectedCashOnHandPence;

    assert.equal(deltaFloat, 1000);
    assert.equal(deltaCashSales, checkout.payload.sale.totalPence);
    assert.equal(deltaCashRefunds, refundTotalPence);
    assert.equal(deltaExpected, 1000 + checkout.payload.sale.totalPence - refundTotalPence);

    console.log("M42 cash management smoke tests passed.");
  } finally {
    const refundIds = Array.from(created.refundIds);
    if (refundIds.length > 0) {
      await prisma.receipt.deleteMany({ where: { saleRefundId: { in: refundIds } } });
      await prisma.refund.deleteMany({ where: { id: { in: refundIds } } });
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

    const sessionIds = Array.from(created.sessionIds);
    if (sessionIds.length > 0) {
      await prisma.cashCount.deleteMany({ where: { sessionId: { in: sessionIds } } });
      await prisma.cashMovement.deleteMany({ where: { sessionId: { in: sessionIds } } });
      await prisma.cashSession.deleteMany({ where: { id: { in: sessionIds } } });
    }

    if (created.userId) {
      await prisma.user.deleteMany({ where: { id: created.userId } });
    }

    await prisma.$disconnect();
    await serverController.stop();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
