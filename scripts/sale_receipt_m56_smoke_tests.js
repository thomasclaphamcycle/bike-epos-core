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
console.log(`[m56-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m56-smoke] DATABASE_URL=${safeDbUrl}`);

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

const apiJson = async ({ path, method = "GET", body, cookie, expectStatus }) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const payload = await parseJson(response);
  if (expectStatus !== undefined) {
    assert.equal(response.status, expectStatus, JSON.stringify(payload));
    return { payload, status: response.status };
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return { payload, status: response.status };
};

const fetchHtml = async (path, cookie, redirect = "follow") => {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Cookie: cookie,
      Accept: "text/html",
    },
    redirect,
  });
  const html = await response.text();
  return { status: response.status, html, headers: response.headers };
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
  const managerEmail = `m56.manager.${token}@example.com`;
  const managerPassword = `M56Manager!${token}`;

  const created = {
    userId: null,
    productId: null,
    variantId: null,
    basketId: null,
    saleId: null,
    receiptNumber: null,
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
        username: `m56-manager-${token}`,
        name: "M56 Manager",
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
        name: `M56 Product ${token}`,
        brand: "M56",
      },
      cookie,
    });
    created.productId = product.payload.id;

    const variant = await apiJson({
      path: `/api/products/${encodeURIComponent(created.productId)}/variants`,
      method: "POST",
      body: {
        sku: `M56-SKU-${token}`,
        name: `M56 Variant ${token}`,
        retailPricePence: 2500,
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
        note: "m56 seed stock",
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
      path: `/api/baskets/${encodeURIComponent(created.basketId)}/lines`,
      method: "POST",
      body: {
        variantId: created.variantId,
        quantity: 1,
      },
      cookie,
    });

    const checkout = await apiJson({
      path: `/api/baskets/${encodeURIComponent(created.basketId)}/checkout`,
      method: "POST",
      body: {},
      cookie,
    });
    created.saleId = checkout.payload.sale?.id;
    assert.ok(created.saleId, "missing sale id");

    const draftReceiptPage = await apiJson({
      path: `/sales/${encodeURIComponent(created.saleId)}/receipt`,
      cookie,
      expectStatus: 409,
    });
    assert.equal(draftReceiptPage.payload?.error?.code, "SALE_NOT_COMPLETED");
    assert.match(
      draftReceiptPage.payload?.error?.message ?? "",
      /not completed|cannot print a draft/i,
    );

    await apiJson({
      path: `/api/sales/${encodeURIComponent(created.saleId)}/tenders`,
      method: "POST",
      body: {
        method: "CASH",
        amountPence: checkout.payload.sale.totalPence,
      },
      cookie,
    });

    const completion = await apiJson({
      path: `/api/sales/${encodeURIComponent(created.saleId)}/complete`,
      method: "POST",
      body: {},
      cookie,
    });
    assert.ok(completion.payload.completedAt);
    assert.equal(completion.payload.receiptUrl, `/r/${created.saleId}`);

    const completionRepeat = await apiJson({
      path: `/api/sales/${encodeURIComponent(created.saleId)}/complete`,
      method: "POST",
      body: {},
      cookie,
    });
    assert.equal(completionRepeat.payload.receiptUrl, completion.payload.receiptUrl);

    const receiptPage = await fetchHtml(`/sales/${encodeURIComponent(created.saleId)}/receipt`, cookie);
    assert.equal(receiptPage.status, 200);
    assert.match(receiptPage.html, /Sale Receipt/i);
    assert.match(receiptPage.html, new RegExp(created.saleId));
    assert.match(receiptPage.html, /Payment Summary/i);

    const shortLink = await fetchHtml(`/r/${encodeURIComponent(created.saleId)}`, cookie, "manual");
    assert.equal(shortLink.status, 302);
    assert.equal(
      shortLink.headers.get("location"),
      `/sales/${encodeURIComponent(created.saleId)}/receipt`,
    );

    const shortLinkFollow = await fetchHtml(`/r/${encodeURIComponent(created.saleId)}`, cookie);
    assert.equal(shortLinkFollow.status, 200);
    assert.match(shortLinkFollow.html, /Sale Receipt/i);

    const issued = await apiJson({
      path: "/api/receipts/issue",
      method: "POST",
      body: {
        saleId: created.saleId,
      },
      cookie,
    });
    created.receiptNumber = issued.payload.receipt?.receiptNumber ?? null;
    assert.ok(created.receiptNumber, "missing receipt number");

    const legacyShortLink = await fetchHtml(
      `/r/${encodeURIComponent(created.receiptNumber)}`,
      cookie,
      "manual",
    );
    assert.equal(legacyShortLink.status, 200);
    assert.match(legacyShortLink.html, /Receipt/i);
    assert.match(legacyShortLink.html, new RegExp(created.receiptNumber));

    console.log("M56 sale receipt print smoke tests passed.");
  } finally {
    if (created.receiptNumber) {
      await prisma.receipt.deleteMany({ where: { receiptNumber: created.receiptNumber } });
    }

    if (created.saleId) {
      await prisma.cashMovement.deleteMany({ where: { relatedSaleId: created.saleId } });
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
      await prisma.stockReservation.deleteMany({ where: { variantId: created.variantId } });
      await prisma.stockLedgerEntry.deleteMany({ where: { variantId: created.variantId } });
      await prisma.inventoryMovement.deleteMany({ where: { variantId: created.variantId } });
      await prisma.barcode.deleteMany({ where: { variantId: created.variantId } });
      await prisma.variant.deleteMany({ where: { id: created.variantId } });
    }

    if (created.productId) {
      await prisma.stockReservation.deleteMany({ where: { productId: created.productId } });
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
  process.exitCode = 1;
});
