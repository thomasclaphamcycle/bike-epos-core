#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { createSmokeServerController } = require("./smoke_server_helper");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
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
console.log(`[m39-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m39-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});
const serverController = createSmokeServerController({
  label: "m39-smoke",
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
  return payload;
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
  const email = `m39.manager.${token}@example.com`;
  const password = `M39Pass!${token}`;

  const created = {
    userId: null,
    productId: null,
    variantId: null,
    basketIds: new Set(),
    saleIds: new Set(),
    sessionIds: new Set(),
  };

  try {
    await serverController.startIfNeeded();

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        username: `m39-manager-${token}`,
        name: "M39 Manager",
        email,
        passwordHash,
        role: "MANAGER",
        isActive: true,
      },
    });
    created.userId = user.id;

    const cookie = await login(email, password);

    const currentSession = await apiJson({
      path: "/api/till/sessions/current",
      cookie,
    });
    if (currentSession?.session?.id) {
      await apiJson({
        path: `/api/till/sessions/${encodeURIComponent(currentSession.session.id)}/count`,
        method: "POST",
        body: {
          countedCashPence: currentSession.totals?.expectedCashPence ?? 0,
          notes: "m39 pre-close",
        },
        cookie,
      });
      await apiJson({
        path: `/api/till/sessions/${encodeURIComponent(currentSession.session.id)}/close`,
        method: "POST",
        body: {},
        cookie,
      });
    }

    const openedSession = await apiJson({
      path: "/api/till/sessions/open",
      method: "POST",
      body: { openingFloatPence: 100 },
      cookie,
    });
    assert.ok(openedSession.session?.id);
    created.sessionIds.add(openedSession.session.id);

    const product = await apiJson({
      path: "/api/products",
      method: "POST",
      body: {
        name: `M39 Product ${token}`,
        brand: "M39",
      },
      cookie,
    });
    created.productId = product.id;

    const variant = await apiJson({
      path: "/api/variants",
      method: "POST",
      body: {
        productId: product.id,
        sku: `M39-SKU-${token}`,
        retailPricePence: 1500,
      },
      cookie,
    });
    created.variantId = variant.id;

    await apiJson({
      path: "/api/inventory/movements",
      method: "POST",
      body: {
        variantId: variant.id,
        type: "PURCHASE",
        quantity: 5,
        unitCost: 900,
        referenceType: "M39_SEED",
        referenceId: token,
      },
      cookie,
    });

    const createSale = async () => {
      const basket = await apiJson({
        path: "/api/baskets",
        method: "POST",
        body: {},
        cookie,
      });
      created.basketIds.add(basket.id);

      await apiJson({
        path: `/api/baskets/${encodeURIComponent(basket.id)}/lines`,
        method: "POST",
        body: {
          variantId: variant.id,
          quantity: 1,
        },
        cookie,
      });

      const checkout = await apiJson({
        path: `/api/baskets/${encodeURIComponent(basket.id)}/checkout`,
        method: "POST",
        body: {},
        cookie,
      });
      assert.ok(checkout.sale?.id);
      created.saleIds.add(checkout.sale.id);
      return checkout.sale;
    };

    const sale1 = await createSale();
    const sale1Tender = await apiJson({
      path: `/api/sales/${encodeURIComponent(sale1.id)}/tenders`,
      method: "POST",
      body: {
        method: "CASH",
        amountPence: sale1.totalPence,
      },
      cookie,
    });
    assert.equal(sale1Tender.summary.remainingPence, 0);

    const sale1Complete = await apiJson({
      path: `/api/sales/${encodeURIComponent(sale1.id)}/complete`,
      method: "POST",
      body: {},
      cookie,
    });
    assert.ok(sale1Complete.completedAt);
    assert.equal(sale1Complete.changeDuePence, 0);

    const sale2 = await createSale();
    await apiJson({
      path: `/api/sales/${encodeURIComponent(sale2.id)}/tenders`,
      method: "POST",
      body: {
        method: "CASH",
        amountPence: 400,
      },
      cookie,
    });
    const extraTender = await apiJson({
      path: `/api/sales/${encodeURIComponent(sale2.id)}/tenders`,
      method: "POST",
      body: {
        method: "VOUCHER",
        amountPence: 50,
      },
      cookie,
    });
    assert.ok(extraTender.tender?.id);

    const afterDelete = await apiJson({
      path: `/api/sales/${encodeURIComponent(sale2.id)}/tenders/${encodeURIComponent(extraTender.tender.id)}`,
      method: "DELETE",
      cookie,
    });
    assert.equal(afterDelete.tenderedPence, 400);

    await apiJson({
      path: `/api/sales/${encodeURIComponent(sale2.id)}/tenders`,
      method: "POST",
      body: {
        method: "CARD",
        amountPence: sale2.totalPence - 400,
      },
      cookie,
    });

    const sale2List = await apiJson({
      path: `/api/sales/${encodeURIComponent(sale2.id)}/tenders`,
      cookie,
    });
    assert.equal(sale2List.remainingPence, 0);
    assert.equal(sale2List.cashTenderedPence, 400);
    assert.equal(sale2List.tenders.length, 2);

    const sale2Complete = await apiJson({
      path: `/api/sales/${encodeURIComponent(sale2.id)}/complete`,
      method: "POST",
      body: {},
      cookie,
    });
    assert.ok(sale2Complete.completedAt);
    assert.equal(sale2Complete.changeDuePence, 0);

    const sale3 = await createSale();
    await apiJson({
      path: `/api/sales/${encodeURIComponent(sale3.id)}/tenders`,
      method: "POST",
      body: {
        method: "CASH",
        amountPence: sale3.totalPence + 500,
      },
      cookie,
    });

    const sale3Complete = await apiJson({
      path: `/api/sales/${encodeURIComponent(sale3.id)}/complete`,
      method: "POST",
      body: {},
      cookie,
    });
    assert.ok(sale3Complete.completedAt);
    assert.equal(sale3Complete.changeDuePence, 500);

    const current = await apiJson({ path: "/api/till/sessions/current", cookie });
    assert.ok(current?.session?.id);
    const expectedCashSales = sale1.totalPence + 400 + sale3.totalPence;
    assert.equal(current.totals.cashSalesPence, expectedCashSales);

    await apiJson({
      path: `/api/till/sessions/${encodeURIComponent(current.session.id)}/count`,
      method: "POST",
      body: {
        countedCashPence: current.totals.expectedCashPence,
        notes: "m39 close",
      },
      cookie,
    });
    await apiJson({
      path: `/api/till/sessions/${encodeURIComponent(current.session.id)}/close`,
      method: "POST",
      body: {},
      cookie,
    });

    console.log("M39 sale tenders + change due smoke tests passed.");
  } finally {
    const saleIds = Array.from(created.saleIds);
    const basketIds = Array.from(created.basketIds);

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

    if (created.userId) {
      await prisma.user.deleteMany({ where: { id: created.userId } });
    }

    const sessionIds = Array.from(created.sessionIds);
    if (sessionIds.length > 0) {
      await prisma.cashCount.deleteMany({ where: { sessionId: { in: sessionIds } } });
      await prisma.cashMovement.deleteMany({ where: { sessionId: { in: sessionIds } } });
      await prisma.cashSession.deleteMany({ where: { id: { in: sessionIds } } });
    }

    await prisma.$disconnect();
    await serverController.stop();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
