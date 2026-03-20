#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
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

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;

const appBaseUrlCandidates = (() => {
  const primary = new URL(BASE_URL).toString().replace(/\/$/, "");
  const urls = [primary];

  try {
    const fallback = new URL(primary);
    if (fallback.hostname === "localhost") {
      fallback.hostname = "127.0.0.1";
      urls.push(fallback.toString().replace(/\/$/, ""));
    }
  } catch {
    // Ignore malformed URL handling here; the primary URL will surface the failure.
  }

  return urls;
})();

const serverController = createSmokeServerController({
  label: "m77-smoke",
  baseUrls: appBaseUrlCandidates,
  databaseUrl: DATABASE_URL,
  captureStartupLog: true,
  startupReadyPattern: /Server running on http:\/\/localhost:\d+/i,
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

const fetchJson = async (path, options = {}) => {
  const response = await fetch(`${serverController.getBaseUrl()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  return {
    status: response.status,
    json: await parseJson(response),
  };
};

const run = async () => {
  const ref = uniqueRef();
  const managerHeaders = {
    "X-Staff-Role": "MANAGER",
    "X-Staff-Id": `m77-manager-${ref}`,
  };
  const staffHeaders = {
    "X-Staff-Role": "STAFF",
    "X-Staff-Id": `m77-staff-${ref}`,
  };

  const created = {
    userIds: [managerHeaders["X-Staff-Id"], staffHeaders["X-Staff-Id"]],
    productId: null,
    variantId: null,
    basketIds: [],
    saleIds: [],
    refundId: null,
  };

  try {
    await serverController.startIfNeeded();

    const product = await fetchJson("/api/products", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        name: `M77 Product ${ref}`,
        brand: "M77",
      }),
    });
    assert.equal(product.status, 201, JSON.stringify(product.json));
    created.productId = product.json.id;

    const variant = await fetchJson(`/api/products/${created.productId}/variants`, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        sku: `M77-SKU-${ref}`,
        name: `M77 Variant ${ref}`,
        retailPricePence: 1500,
      }),
    });
    assert.equal(variant.status, 201, JSON.stringify(variant.json));
    created.variantId = variant.json.id;

    const adjustment = await fetchJson("/api/inventory/adjustments", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        variantId: created.variantId,
        quantityDelta: 10,
        reason: "COUNT_CORRECTION",
        note: "m77 seed stock",
      }),
    });
    assert.equal(adjustment.status, 201, JSON.stringify(adjustment.json));

    const basket = await fetchJson("/api/baskets", {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(basket.status, 201, JSON.stringify(basket.json));
    created.basketIds.push(basket.json.id);

    const addLine = await fetchJson(`/api/baskets/${basket.json.id}/lines`, {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        variantId: created.variantId,
        quantity: 2,
      }),
    });
    assert.equal(addLine.status, 201, JSON.stringify(addLine.json));

    const checkout = await fetchJson(`/api/baskets/${basket.json.id}/checkout`, {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(checkout.status, 201, JSON.stringify(checkout.json));
    const saleId = checkout.json.sale.id;
    created.saleIds.push(saleId);

    const addTender = await fetchJson(`/api/sales/${saleId}/tenders`, {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        method: "CARD",
        amountPence: checkout.json.sale.totalPence,
      }),
    });
    assert.equal(addTender.status, 201, JSON.stringify(addTender.json));

    const completedSale = await fetchJson(`/api/sales/${saleId}/complete`, {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(completedSale.status, 200, JSON.stringify(completedSale.json));
    assert.ok(completedSale.json.completedAt, JSON.stringify(completedSale.json));

    const onHandBefore = await fetchJson(
      `/api/inventory/on-hand?variantId=${encodeURIComponent(created.variantId)}`,
      { headers: staffHeaders },
    );
    assert.equal(onHandBefore.status, 200, JSON.stringify(onHandBefore.json));
    assert.equal(onHandBefore.json.onHand, 8);

    const staffRefundDenied = await fetchJson("/api/refunds", {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({ saleId }),
    });
    assert.equal(staffRefundDenied.status, 403, JSON.stringify(staffRefundDenied.json));

    const createRefund = await fetchJson("/api/refunds", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({ saleId }),
    });
    assert.equal(createRefund.status, 201, JSON.stringify(createRefund.json));
    created.refundId = createRefund.json.refund.id;

    const saleDetail = await fetchJson(`/api/sales/${saleId}`, {
      headers: staffHeaders,
    });
    assert.equal(saleDetail.status, 200, JSON.stringify(saleDetail.json));
    const saleLineId = saleDetail.json.saleItems[0].id;

    const refundLine = await fetchJson(`/api/refunds/${created.refundId}/lines`, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        saleLineId,
        quantity: 1,
      }),
    });
    assert.equal(refundLine.status, 201, JSON.stringify(refundLine.json));
    const refundLineId = refundLine.json.line.id;
    const refundTotal = refundLine.json.refund.computedTotalPence;

    const refundTender = await fetchJson(`/api/refunds/${created.refundId}/tenders`, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        tenderType: "CARD",
        amountPence: refundTotal,
      }),
    });
    assert.equal(refundTender.status, 201, JSON.stringify(refundTender.json));

    const completeRefund = await fetchJson(`/api/refunds/${created.refundId}/complete`, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({ returnToStock: true }),
    });
    assert.equal(completeRefund.status, 201, JSON.stringify(completeRefund.json));
    assert.equal(completeRefund.json.refund.status, "COMPLETED");
    assert.equal(completeRefund.json.refund.returnToStock, true);
    assert.ok(completeRefund.json.refund.returnedToStockAt);

    const movementsAfterComplete = await fetchJson(
      `/api/inventory/movements?variantId=${encodeURIComponent(created.variantId)}`,
      { headers: managerHeaders },
    );
    assert.equal(movementsAfterComplete.status, 200, JSON.stringify(movementsAfterComplete.json));
    const returnMovements = movementsAfterComplete.json.movements.filter(
      (movement) =>
        movement.referenceType === "SALE_REFUND_LINE" && movement.referenceId === refundLineId,
    );
    assert.equal(returnMovements.length, 1, JSON.stringify(movementsAfterComplete.json.movements));

    const onHandAfterRefund = await fetchJson(
      `/api/inventory/on-hand?variantId=${encodeURIComponent(created.variantId)}`,
      { headers: staffHeaders },
    );
    assert.equal(onHandAfterRefund.status, 200, JSON.stringify(onHandAfterRefund.json));
    assert.equal(onHandAfterRefund.json.onHand, 9);

    const reduceStockBeforeExchange = await fetchJson("/api/inventory/adjustments", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        variantId: created.variantId,
        quantityDelta: -8,
        reason: "COUNT_CORRECTION",
        note: "m77 reduce stock before exchange",
      }),
    });
    assert.equal(reduceStockBeforeExchange.status, 201, JSON.stringify(reduceStockBeforeExchange.json));

    const completeAgain = await fetchJson(`/api/refunds/${created.refundId}/complete`, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({ returnToStock: true }),
    });
    assert.equal(completeAgain.status, 200, JSON.stringify(completeAgain.json));
    assert.equal(completeAgain.json.idempotent, true);

    const movementsAfterIdempotent = await fetchJson(
      `/api/inventory/movements?variantId=${encodeURIComponent(created.variantId)}`,
      { headers: managerHeaders },
    );
    const returnMovementsAfterIdempotent = movementsAfterIdempotent.json.movements.filter(
      (movement) =>
        movement.referenceType === "SALE_REFUND_LINE" && movement.referenceId === refundLineId,
    );
    assert.equal(
      returnMovementsAfterIdempotent.length,
      1,
      JSON.stringify(movementsAfterIdempotent.json.movements),
    );

    const createExchange = await fetchJson(`/api/sales/${saleId}/exchange`, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(createExchange.status, 409, JSON.stringify(createExchange.json));
    assert.equal(createExchange.json.error.code, "EXCHANGE_INSUFFICIENT_STOCK");

    const restockForExchange = await fetchJson("/api/inventory/adjustments", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        variantId: created.variantId,
        quantityDelta: 1,
        reason: "COUNT_CORRECTION",
        note: "m77 restore stock for exchange",
      }),
    });
    assert.equal(restockForExchange.status, 201, JSON.stringify(restockForExchange.json));

    const createExchangeAfterRestock = await fetchJson(`/api/sales/${saleId}/exchange`, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(createExchangeAfterRestock.status, 201, JSON.stringify(createExchangeAfterRestock.json));
    const exchangeSaleId = createExchangeAfterRestock.json.saleId;
    created.saleIds.push(exchangeSaleId);

    const createExchangeAgain = await fetchJson(`/api/sales/${saleId}/exchange`, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(createExchangeAgain.status, 200, JSON.stringify(createExchangeAgain.json));
    assert.equal(createExchangeAgain.json.idempotent, true);
    assert.equal(createExchangeAgain.json.saleId, exchangeSaleId);

    const exchangeSale = await fetchJson(`/api/sales/${exchangeSaleId}`, {
      headers: staffHeaders,
    });
    assert.equal(exchangeSale.status, 200, JSON.stringify(exchangeSale.json));
    assert.equal(exchangeSale.json.sale.exchangeFromSaleId, saleId);
    if (exchangeSale.json.sale.basketId) {
      created.basketIds.push(exchangeSale.json.sale.basketId);
    }

    const auditRefund = await fetchJson(
      `/api/audit?action=REFUND_ISSUED&entityId=${encodeURIComponent(created.refundId)}&limit=20`,
      { headers: managerHeaders },
    );
    assert.equal(auditRefund.status, 200, JSON.stringify(auditRefund.json));
    assert.ok(
      auditRefund.json.events.some((entry) => entry.action === "REFUND_ISSUED"),
      JSON.stringify(auditRefund.json),
    );

    const auditReturn = await fetchJson(
      `/api/audit?action=RETURN_TO_STOCK&entityId=${encodeURIComponent(created.refundId)}&limit=20`,
      { headers: managerHeaders },
    );
    assert.equal(auditReturn.status, 200, JSON.stringify(auditReturn.json));
    assert.ok(
      auditReturn.json.events.some((entry) => entry.action === "RETURN_TO_STOCK"),
      JSON.stringify(auditReturn.json),
    );

    const auditExchange = await fetchJson(
      `/api/audit?action=EXCHANGE_CREATED&entityId=${encodeURIComponent(exchangeSaleId)}&limit=20`,
      { headers: managerHeaders },
    );
    assert.equal(auditExchange.status, 200, JSON.stringify(auditExchange.json));
    assert.ok(
      auditExchange.json.events.some((entry) => entry.action === "EXCHANGE_CREATED"),
      JSON.stringify(auditExchange.json),
    );

    console.log("M77 refunds/exchanges smoke tests passed.");
  } finally {
    if (created.refundId) {
      await prisma.refundTender.deleteMany({ where: { refundId: created.refundId } });
      await prisma.refundLine.deleteMany({ where: { refundId: created.refundId } });
      await prisma.receipt.deleteMany({ where: { saleRefundId: created.refundId } });
      await prisma.refund.deleteMany({ where: { id: created.refundId } });
    }

    if (created.saleIds.length > 0) {
      await prisma.saleTender.deleteMany({ where: { saleId: { in: created.saleIds } } });
      await prisma.payment.deleteMany({ where: { saleId: { in: created.saleIds } } });
      await prisma.saleItem.deleteMany({ where: { saleId: { in: created.saleIds } } });
      await prisma.sale.deleteMany({ where: { id: { in: created.saleIds } } });
    }

    if (created.basketIds.length > 0) {
      await prisma.basketItem.deleteMany({ where: { basketId: { in: created.basketIds } } });
      await prisma.basket.deleteMany({ where: { id: { in: created.basketIds } } });
    }

    if (created.variantId) {
      await prisma.inventoryMovement.deleteMany({ where: { variantId: created.variantId } });
      await prisma.stockLedgerEntry.deleteMany({ where: { variantId: created.variantId } });
      await prisma.barcode.deleteMany({ where: { variantId: created.variantId } });
      await prisma.variant.deleteMany({ where: { id: created.variantId } });
    }

    if (created.productId) {
      await prisma.product.deleteMany({ where: { id: created.productId } });
    }

    if (created.userIds.length > 0) {
      await prisma.user.deleteMany({
        where: {
          id: {
            in: created.userIds,
          },
        },
      });
    }

    await prisma.$disconnect();
    await serverController.stop();
  }
};

run().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
