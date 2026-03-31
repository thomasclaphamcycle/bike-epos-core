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
console.log(`[m40-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m40-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});
const serverController = createSmokeServerController({
  label: "m40-smoke",
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

const run = async () => {
  const token = uniqueRef();
  const managerEmail = `m40.manager.${token}@example.com`;
  const managerPassword = `M40Pass!${token}`;

  const created = {
    userId: null,
    productId: null,
    variantId: null,
    basketIds: new Set(),
    saleIds: new Set(),
    paymentIds: new Set(),
    refundIds: new Set(),
    receiptNumbers: new Set(),
  };

  try {
    await serverController.startIfNeeded();

    const manager = await prisma.user.create({
      data: {
        username: `m40-manager-${token}`,
        name: "M40 Manager",
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
        name: `M40 Product ${token}`,
        brand: "M40",
      },
      cookie,
    });
    created.productId = product.payload.id;

    const variant = await apiJson({
      path: `/api/products/${encodeURIComponent(product.payload.id)}/variants`,
      method: "POST",
      body: {
        sku: `M40-SKU-${token}`,
        name: `M40 Variant ${token}`,
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
        quantityDelta: 20,
        reason: "COUNT_CORRECTION",
        note: "m40 seed",
      },
      cookie,
    });

    const createSaleViaBasket = async (checkoutBody = {}) => {
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
        body: checkoutBody,
        cookie,
      });

      const saleId = checkout.payload.sale?.id;
      assert.ok(saleId, "missing sale id");
      created.saleIds.add(saleId);
      if (checkout.payload.payment?.id) {
        created.paymentIds.add(checkout.payload.payment.id);
      }
      return checkout.payload;
    };

    const tenderSale = await createSaleViaBasket({});

    await apiJson({
      path: `/api/sales/${encodeURIComponent(tenderSale.sale.id)}/tenders`,
      method: "POST",
      body: {
        method: "CARD",
        amountPence: tenderSale.sale.totalPence,
      },
      cookie,
    });

    const completion = await apiJson({
      path: `/api/sales/${encodeURIComponent(tenderSale.sale.id)}/complete`,
      method: "POST",
      body: {},
      cookie,
    });
    assert.ok(completion.payload.completedAt);

    const issuedSale = await apiJson({
      path: "/api/receipts/issue",
      method: "POST",
      body: {
        saleId: tenderSale.sale.id,
      },
      cookie,
    });
    assert.equal(issuedSale.status, 201, JSON.stringify(issuedSale.payload));
    assert.ok(issuedSale.payload.receipt?.receiptNumber);
    created.receiptNumbers.add(issuedSale.payload.receipt.receiptNumber);

    const issuedSaleAgain = await apiJson({
      path: "/api/receipts/issue",
      method: "POST",
      body: {
        saleId: tenderSale.sale.id,
      },
      cookie,
    });
    assert.equal(issuedSaleAgain.status, 200, JSON.stringify(issuedSaleAgain.payload));
    assert.equal(issuedSaleAgain.payload.idempotent, true);
    assert.equal(
      issuedSaleAgain.payload.receipt.receiptNumber,
      issuedSale.payload.receipt.receiptNumber,
    );

    const saleReceipt = await apiJson({
      path: `/api/receipts/${encodeURIComponent(issuedSale.payload.receipt.receiptNumber)}`,
      cookie,
    });
    assert.equal(saleReceipt.payload.type, "SALE");
    assert.equal(saleReceipt.payload.saleId, tenderSale.sale.id);
    assert.equal(Array.isArray(saleReceipt.payload.items), true);
    assert.equal(Array.isArray(saleReceipt.payload.tenders), true);
    assert.equal(saleReceipt.payload.totals.totalPence, tenderSale.sale.totalPence);

    const printable = await fetch(
      `${BASE_URL}/r/${encodeURIComponent(issuedSale.payload.receipt.receiptNumber)}`,
      {
        headers: { Cookie: cookie },
      },
    );
    assert.equal(printable.status, 200);
    const printableHtml = await printable.text();
    assert.ok(printableHtml.includes("Print"));
    assert.ok(printableHtml.includes(issuedSale.payload.receipt.receiptNumber));

    const legacySaleReceipt = await apiJson({
      path: `/api/sales/${encodeURIComponent(tenderSale.sale.id)}/receipt`,
      cookie,
    });
    assert.equal(legacySaleReceipt.payload.saleId, tenderSale.sale.id);

    const paidSale = await createSaleViaBasket({
      paymentMethod: "CARD",
      amountPence: 1500,
      providerRef: `m40-refund-source-${token}`,
    });
    const paymentId = paidSale.payment?.id;
    assert.ok(paymentId, "missing payment id for refund test");

    const refund = await apiJson({
      path: `/api/payments/${encodeURIComponent(paymentId)}/refund`,
      method: "POST",
      body: {
        amountPence: 300,
        reason: "m40 refund smoke",
        idempotencyKey: `m40-refund-${token}`,
      },
      cookie,
    });

    const refundId = refund.payload.refund?.id;
    assert.ok(refundId, "missing refund id");
    created.refundIds.add(refundId);

    const issuedRefund = await apiJson({
      path: "/api/receipts/issue",
      method: "POST",
      body: {
        refundId,
      },
      cookie,
    });
    assert.equal(issuedRefund.status, 201, JSON.stringify(issuedRefund.payload));
    assert.ok(issuedRefund.payload.receipt?.receiptNumber);
    created.receiptNumbers.add(issuedRefund.payload.receipt.receiptNumber);

    const refundReceipt = await apiJson({
      path: `/api/receipts/${encodeURIComponent(issuedRefund.payload.receipt.receiptNumber)}`,
      cookie,
    });
    assert.equal(refundReceipt.payload.type, "REFUND");
    assert.equal(refundReceipt.payload.refundId, refundId);
    assert.equal(refundReceipt.payload.refund?.amountPence, 300);

    console.log("M40 receipts smoke tests passed.");
  } finally {
    const receiptNumbers = Array.from(created.receiptNumbers);
    if (receiptNumbers.length > 0) {
      await prisma.receipt.deleteMany({
        where: { receiptNumber: { in: receiptNumbers } },
      });
    }

    const refundIds = Array.from(created.refundIds);
    if (refundIds.length > 0) {
      await prisma.paymentRefund.deleteMany({
        where: { id: { in: refundIds } },
      });
    }

    const paymentIds = Array.from(created.paymentIds);
    if (paymentIds.length > 0) {
      await prisma.payment.deleteMany({
        where: { id: { in: paymentIds } },
      });
    }

    const saleIds = Array.from(created.saleIds);
    if (saleIds.length > 0) {
      await prisma.saleTender.deleteMany({ where: { saleId: { in: saleIds } } });
      await prisma.paymentIntent.deleteMany({ where: { saleId: { in: saleIds } } });
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
    await serverController.stop();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
