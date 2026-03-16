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
  label: "m78-smoke",
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

const toDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const run = async () => {
  const ref = uniqueRef();
  const managerHeaders = {
    "X-Staff-Role": "MANAGER",
    "X-Staff-Id": `m78-manager-${ref}`,
  };
  const staffHeaders = {
    "X-Staff-Role": "STAFF",
    "X-Staff-Id": `m78-staff-${ref}`,
  };

  const created = {
    userIds: [managerHeaders["X-Staff-Id"], staffHeaders["X-Staff-Id"]],
    productId: null,
    variantId: null,
    basketId: null,
    saleId: null,
    cashSessionIds: [],
  };

  try {
    await serverController.startIfNeeded();

    const product = await fetchJson("/api/products", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        name: `M78 Product ${ref}`,
        brand: "M78",
      }),
    });
    assert.equal(product.status, 201, JSON.stringify(product.json));
    created.productId = product.json.id;

    const variant = await fetchJson(`/api/products/${created.productId}/variants`, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        sku: `M78-SKU-${ref}`,
        name: `M78 Variant ${ref}`,
        retailPricePence: 1300,
      }),
    });
    assert.equal(variant.status, 201, JSON.stringify(variant.json));
    created.variantId = variant.json.id;

    const adjustment = await fetchJson("/api/inventory/adjustments", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        variantId: created.variantId,
        quantityDelta: 6,
        reason: "COUNT_CORRECTION",
        note: "m78 seed stock",
      }),
    });
    assert.equal(adjustment.status, 201, JSON.stringify(adjustment.json));

    const basket = await fetchJson("/api/baskets", {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(basket.status, 201, JSON.stringify(basket.json));
    created.basketId = basket.json.id;

    const addLine = await fetchJson(`/api/baskets/${created.basketId}/lines`, {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        variantId: created.variantId,
        quantity: 1,
      }),
    });
    assert.equal(addLine.status, 201, JSON.stringify(addLine.json));

    const checkout = await fetchJson(`/api/baskets/${created.basketId}/checkout`, {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(checkout.status, 201, JSON.stringify(checkout.json));
    created.saleId = checkout.json.sale.id;

    const addTender = await fetchJson(`/api/sales/${created.saleId}/tenders`, {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        method: "CASH",
        amountPence: checkout.json.sale.totalPence,
      }),
    });
    assert.equal(addTender.status, 201, JSON.stringify(addTender.json));

    const complete = await fetchJson(`/api/sales/${created.saleId}/complete`, {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(complete.status, 200, JSON.stringify(complete.json));

    const openFloat = await fetchJson("/api/cash/movements", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        type: "FLOAT",
        amountPence: 1000,
        note: "m78 float open",
      }),
    });
    assert.ok([201, 200].includes(openFloat.status), JSON.stringify(openFloat.json));
    if (openFloat.json?.movement?.sessionId) {
      created.cashSessionIds.push(openFloat.json.movement.sessionId);
    }

    const cashMove = await fetchJson("/api/cash/movements", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        type: "PAID_IN",
        amountPence: 500,
        note: "m78 test paid in",
      }),
    });
    assert.ok([201, 200].includes(cashMove.status), JSON.stringify(cashMove.json));
    if (cashMove.json?.movement?.sessionId) {
      created.cashSessionIds.push(cashMove.json.movement.sessionId);
    }

    const today = toDateKey(new Date());

    const staffForbidden = await fetchJson("/api/reports/daily-close", {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({ date: today }),
    });
    assert.equal(staffForbidden.status, 403, JSON.stringify(staffForbidden.json));

    const runClose = await fetchJson("/api/reports/daily-close", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({ date: today }),
    });
    assert.equal(runClose.status, 201, JSON.stringify(runClose.json));
    assert.equal(runClose.json.date, today);
    assert.ok(runClose.json.sales.count >= 1, JSON.stringify(runClose.json));
    assert.equal(
      runClose.json.netSalesPence,
      runClose.json.sales.grossPence - runClose.json.refunds.totalPence,
      JSON.stringify(runClose.json),
    );

    const readClose = await fetchJson(`/api/reports/daily-close?date=${today}`, {
      headers: managerHeaders,
    });
    assert.equal(readClose.status, 200, JSON.stringify(readClose.json));
    assert.equal(readClose.json.date, today);

    const printResponse = await fetch(`${serverController.getBaseUrl()}/reports/daily-close/print?date=${today}`, {
      headers: managerHeaders,
    });
    assert.equal(printResponse.status, 200);
    const html = await printResponse.text();
    assert.ok(html.includes("Daily Close Report"));
    assert.ok(html.includes(today));

    const staffPrint = await fetch(`${serverController.getBaseUrl()}/reports/daily-close/print?date=${today}`, {
      headers: staffHeaders,
    });
    assert.equal(staffPrint.status, 403);

    const audit = await fetchJson(
      `/api/audit?action=DAILY_CLOSE_RUN&entityType=LOCATION&limit=20`,
      { headers: managerHeaders },
    );
    assert.equal(audit.status, 200, JSON.stringify(audit.json));
    assert.ok(
      audit.json.events.some((event) => event.action === "DAILY_CLOSE_RUN"),
      JSON.stringify(audit.json),
    );

    console.log("M78 daily-close smoke tests passed.");
  } finally {
    if (created.saleId) {
      await prisma.saleTender.deleteMany({ where: { saleId: created.saleId } });
      await prisma.payment.deleteMany({ where: { saleId: created.saleId } });
      await prisma.saleItem.deleteMany({ where: { saleId: created.saleId } });
      await prisma.sale.deleteMany({ where: { id: created.saleId } });
    }

    if (created.basketId) {
      await prisma.basketItem.deleteMany({ where: { basketId: created.basketId } });
      await prisma.basket.deleteMany({ where: { id: created.basketId } });
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

    if (created.cashSessionIds.length > 0) {
      const uniqueSessionIds = Array.from(new Set(created.cashSessionIds));
      await prisma.cashCount.deleteMany({ where: { sessionId: { in: uniqueSessionIds } } });
      await prisma.cashMovement.deleteMany({ where: { sessionId: { in: uniqueSessionIds } } });
      await prisma.cashSession.deleteMany({ where: { id: { in: uniqueSessionIds } } });
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
