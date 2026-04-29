#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
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

const safeDbUrl = DATABASE_URL.replace(/(postgres(?:ql)?:\/\/[^:/@]+:)[^@]+@/i, "$1***@");
console.log(`[layaway-smoke] BASE_URL=${BASE_URL}`);
console.log(`[layaway-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});
const serverController = createSmokeServerController({
  label: "layaway-smoke",
  baseUrl: BASE_URL,
  databaseUrl: DATABASE_URL,
});

let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;
const token = uniqueRef();
const managerId = `layaway-manager-${token}`;
const headers = {
  "Content-Type": "application/json",
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": managerId,
};

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

const apiJson = async ({ path, method = "GET", body, expectedStatus }) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await parseJson(response);

  if (expectedStatus !== undefined) {
    assert.equal(response.status, expectedStatus, `${method} ${path}: ${JSON.stringify(payload)}`);
    return payload;
  }

  if (!response.ok) {
    throw new Error(`${method} ${path} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
};

const stockOnHand = async (variantId) => {
  const aggregate = await prisma.stockLedgerEntry.aggregate({
    where: { variantId },
    _sum: { quantityDelta: true },
  });
  return aggregate._sum.quantityDelta ?? 0;
};

const closeCurrentCashSession = async (note) => {
  const current = await apiJson({ path: "/api/till/sessions/current" });
  if (!current?.session?.id) {
    return;
  }

  await apiJson({
    path: `/api/till/sessions/${encodeURIComponent(current.session.id)}/count`,
    method: "POST",
    body: {
      countedCashPence: current.totals?.expectedCashPence ?? 0,
      notes: note,
    },
  });
  await apiJson({
    path: `/api/till/sessions/${encodeURIComponent(current.session.id)}/close`,
    method: "POST",
    body: {},
  });
};

const run = async () => {
  const created = {
    productId: null,
    variantId: null,
    basketIds: new Set(),
    saleIds: new Set(),
    layawayIds: new Set(),
    sessionIds: new Set(),
  };

  const createBasketWithItem = async (quantity) => {
    const basket = await apiJson({
      path: "/api/baskets",
      method: "POST",
      body: {},
    });
    created.basketIds.add(basket.id);

    await apiJson({
      path: `/api/baskets/${encodeURIComponent(basket.id)}/lines`,
      method: "POST",
      body: {
        variantId: created.variantId,
        quantity,
      },
    });

    return basket;
  };

  try {
    await serverController.startIfNeeded();

    const product = await apiJson({
      path: "/api/products",
      method: "POST",
      body: {
        name: `Layaway Smoke Product ${token}`,
        brand: "Layaway",
      },
    });
    created.productId = product.id;

    const variant = await apiJson({
      path: "/api/variants",
      method: "POST",
      body: {
        productId: product.id,
        sku: `LAYAWAY-SMOKE-${token}`,
        retailPricePence: 1200,
      },
    });
    created.variantId = variant.id;

    await apiJson({
      path: "/api/inventory/movements",
      method: "POST",
      body: {
        variantId: variant.id,
        type: "PURCHASE",
        quantity: 3,
        referenceType: "LAYAWAY_SMOKE",
        referenceId: `seed_${token}`,
      },
    });
    assert.equal(await stockOnHand(variant.id), 3);

    const releaseBasket = await createBasketWithItem(1);
    const releaseLayaway = await apiJson({
      path: `/api/baskets/${encodeURIComponent(releaseBasket.id)}/layaway`,
      method: "POST",
      body: {
        expiryDays: 14,
        notes: "Unpaid layaway cancellation smoke",
      },
    });
    created.layawayIds.add(releaseLayaway.layaway.id);
    created.saleIds.add(releaseLayaway.layaway.saleId);
    assert.equal(releaseLayaway.layaway.status, "ACTIVE");
    assert.equal(await stockOnHand(variant.id), 2);

    const cancelled = await apiJson({
      path: `/api/layaways/${encodeURIComponent(releaseLayaway.layaway.id)}/cancel`,
      method: "POST",
      body: {},
    });
    assert.equal(cancelled.layaway.status, "CANCELLED");
    assert.ok(cancelled.layaway.stockReleasedAt);
    assert.equal(await stockOnHand(variant.id), 3);

    await closeCurrentCashSession("layaway smoke pre-close");
    const openedSession = await apiJson({
      path: "/api/till/sessions/open",
      method: "POST",
      body: { openingFloatPence: 1000 },
    });
    assert.ok(openedSession.session?.id);
    created.sessionIds.add(openedSession.session.id);

    const partPaidBasket = await createBasketWithItem(1);
    const partPaidLayaway = await apiJson({
      path: `/api/baskets/${encodeURIComponent(partPaidBasket.id)}/layaway`,
      method: "POST",
      body: {
        expiryDays: 14,
        deposit: {
          paymentMethod: "CASH",
          amountPence: 500,
          providerRef: "LAYAWAY_SMOKE_DEPOSIT",
        },
        notes: "Part-paid layaway review smoke",
      },
    });
    created.layawayIds.add(partPaidLayaway.layaway.id);
    created.saleIds.add(partPaidLayaway.layaway.saleId);
    assert.equal(partPaidLayaway.layaway.status, "PART_PAID");
    assert.equal(partPaidLayaway.layaway.depositPaidPence, 500);
    assert.equal(partPaidLayaway.layaway.remainingPence, 700);
    assert.equal(await stockOnHand(variant.id), 2);

    const afterDepositSession = await apiJson({ path: "/api/till/sessions/current" });
    assert.equal(afterDepositSession.totals.cashSalesPence, 500);

    await prisma.layaway.update({
      where: { id: partPaidLayaway.layaway.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const overdueList = await apiJson({ path: "/api/layaways" });
    const overdue = overdueList.layaways.find((layaway) => layaway.id === partPaidLayaway.layaway.id);
    assert.ok(overdue, "part-paid overdue layaway should remain listed");
    assert.equal(overdue.status, "PART_PAID");
    assert.equal(overdue.requiresReview, true);
    assert.equal(overdue.stockReleasedAt, null);
    assert.equal(await stockOnHand(variant.id), 2);

    const blockedRelease = await apiJson({
      path: `/api/layaways/${encodeURIComponent(partPaidLayaway.layaway.id)}/cancel`,
      method: "POST",
      body: {},
      expectedStatus: 409,
    });
    assert.equal(blockedRelease.error?.code, "LAYAWAY_PAYMENT_REVIEW_REQUIRED");

    await apiJson({
      path: `/api/sales/${encodeURIComponent(partPaidLayaway.layaway.saleId)}/tenders`,
      method: "POST",
      body: {
        method: "CASH",
        amountPence: 700,
      },
    });
    const completed = await apiJson({
      path: `/api/layaways/${encodeURIComponent(partPaidLayaway.layaway.id)}/complete`,
      method: "POST",
      body: {},
    });
    assert.equal(completed.layaway.status, "COMPLETED");
    assert.ok(completed.layaway.completedAt);
    assert.equal(completed.layaway.remainingPence, 0);
    assert.equal(await stockOnHand(variant.id), 2);

    const afterCompletionSession = await apiJson({ path: "/api/till/sessions/current" });
    assert.equal(afterCompletionSession.totals.cashSalesPence, 1200);

    const expiredBasket = await createBasketWithItem(1);
    const expiringLayaway = await apiJson({
      path: `/api/baskets/${encodeURIComponent(expiredBasket.id)}/layaway`,
      method: "POST",
      body: {
        expiryDays: 14,
        notes: "Unpaid expiry release smoke",
      },
    });
    created.layawayIds.add(expiringLayaway.layaway.id);
    created.saleIds.add(expiringLayaway.layaway.saleId);
    assert.equal(await stockOnHand(variant.id), 1);

    await prisma.layaway.update({
      where: { id: expiringLayaway.layaway.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const expired = await apiJson({
      path: `/api/layaways/${encodeURIComponent(expiringLayaway.layaway.id)}`,
    });
    assert.equal(expired.layaway.status, "EXPIRED");
    assert.ok(expired.layaway.stockReleasedAt);
    assert.equal(await stockOnHand(variant.id), 2);

    await closeCurrentCashSession("layaway smoke close");

    console.log("Layaway stock hold, deposit, overdue review, and expiry smoke tests passed.");
  } finally {
    if (created.variantId) {
      const saleItems = await prisma.saleItem.findMany({
        where: { variantId: created.variantId },
        select: { saleId: true },
      });
      for (const item of saleItems) {
        created.saleIds.add(item.saleId);
      }

      const basketItems = await prisma.basketItem.findMany({
        where: { variantId: created.variantId },
        select: { basketId: true },
      });
      for (const item of basketItems) {
        created.basketIds.add(item.basketId);
      }
    }

    const cashSessions = await prisma.cashSession.findMany({
      where: {
        OR: [
          { openedByStaffId: managerId },
          { closedByStaffId: managerId },
        ],
      },
      select: { id: true },
    });
    for (const session of cashSessions) {
      created.sessionIds.add(session.id);
    }

    const saleIds = Array.from(created.saleIds);
    if (saleIds.length > 0) {
      const layaways = await prisma.layaway.findMany({
        where: { saleId: { in: saleIds } },
        select: { id: true },
      });
      for (const layaway of layaways) {
        created.layawayIds.add(layaway.id);
      }
    }

    const sessionIds = Array.from(created.sessionIds);
    const layawayIds = Array.from(created.layawayIds);
    const basketIds = Array.from(created.basketIds);

    if (sessionIds.length > 0) {
      await prisma.cashCount.deleteMany({ where: { sessionId: { in: sessionIds } } });
      await prisma.cashMovement.deleteMany({ where: { sessionId: { in: sessionIds } } });
      await prisma.cashSession.deleteMany({ where: { id: { in: sessionIds } } });
    }

    if (layawayIds.length > 0) {
      await prisma.layawayReservation.deleteMany({ where: { layawayId: { in: layawayIds } } });
      await prisma.layaway.deleteMany({ where: { id: { in: layawayIds } } });
    }

    if (saleIds.length > 0) {
      await prisma.saleTender.deleteMany({ where: { saleId: { in: saleIds } } });
      await prisma.paymentIntent.deleteMany({ where: { saleId: { in: saleIds } } });
      await prisma.payment.deleteMany({ where: { saleId: { in: saleIds } } });
      await prisma.saleItem.deleteMany({ where: { saleId: { in: saleIds } } });
      await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
    }

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

    await prisma.user.deleteMany({ where: { id: managerId } });
    await prisma.$disconnect();
    await serverController.stop();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
