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

const safeDbUrl = DATABASE_URL.replace(/(postgres(?:ql)?:\/\/[^:/@]+:)[^@]+@/i, "$1***@");
console.log(`[sale-customer-capture-smoke] BASE_URL=${BASE_URL}`);
console.log(`[sale-customer-capture-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});
const serverController = createSmokeServerController({
  label: "sale-customer-capture-smoke",
  baseUrl: BASE_URL,
  databaseUrl: DATABASE_URL,
});

const STAFF_HEADERS = {
  "Content-Type": "application/json",
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": "sale-customer-capture-smoke-manager",
};

let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;

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

const apiJson = async ({ path, method = "GET", body, headers }) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const payload = await parseJson(response);
  return {
    status: response.status,
    payload,
  };
};

const apiJsonOrThrow = async (request) => {
  const result = await apiJson(request);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`${request.method || "GET"} ${request.path} failed (${result.status}): ${JSON.stringify(result.payload)}`);
  }
  return result.payload;
};

const cleanup = async (created) => {
  if (created.sessionIds.size > 0) {
    await prisma.saleCustomerCaptureSession.deleteMany({
      where: { id: { in: Array.from(created.sessionIds) } },
    });
  }

  if (created.saleIds.size > 0) {
    const saleIds = Array.from(created.saleIds);

    await prisma.saleItem.deleteMany({
      where: { saleId: { in: saleIds } },
    });

    await prisma.sale.deleteMany({
      where: { id: { in: saleIds } },
    });
  }

  if (created.basketIds.size > 0) {
    const basketIds = Array.from(created.basketIds);
    await prisma.basketItem.deleteMany({
      where: { basketId: { in: basketIds } },
    });
    await prisma.basket.deleteMany({
      where: { id: { in: basketIds } },
    });
  }

  if (created.variantIds.size > 0) {
    const variantIds = Array.from(created.variantIds);
    await prisma.stockLedgerEntry.deleteMany({
      where: { variantId: { in: variantIds } },
    });
    await prisma.inventoryMovement.deleteMany({
      where: { variantId: { in: variantIds } },
    });
    await prisma.barcode.deleteMany({
      where: { variantId: { in: variantIds } },
    });
    await prisma.variant.deleteMany({
      where: { id: { in: variantIds } },
    });
  }

  if (created.productIds.size > 0) {
    await prisma.product.deleteMany({
      where: { id: { in: Array.from(created.productIds) } },
    });
  }

  if (created.customerIds.size > 0) {
    await prisma.customer.deleteMany({
      where: { id: { in: Array.from(created.customerIds) } },
    });
  }

  if (created.userIds.size > 0) {
    await prisma.user.deleteMany({
      where: { id: { in: Array.from(created.userIds) } },
    });
  }
};

const createSale = async (created, variantId) => {
  const basket = await apiJsonOrThrow({
    path: "/api/baskets",
    method: "POST",
    body: {},
    headers: STAFF_HEADERS,
  });
  created.basketIds.add(basket.id);

  await apiJsonOrThrow({
    path: `/api/baskets/${encodeURIComponent(basket.id)}/lines`,
    method: "POST",
    body: {
      variantId,
      quantity: 1,
    },
    headers: STAFF_HEADERS,
  });

  const checkout = await apiJsonOrThrow({
    path: `/api/baskets/${encodeURIComponent(basket.id)}/checkout`,
    method: "POST",
    body: {},
    headers: STAFF_HEADERS,
  });
  created.saleIds.add(checkout.sale.id);
  return checkout.sale;
};

const createCaptureSession = async (created, saleId) => {
  const payload = await apiJsonOrThrow({
    path: `/api/sales/${encodeURIComponent(saleId)}/customer-capture-sessions`,
    method: "POST",
    body: {},
    headers: STAFF_HEADERS,
  });
  created.sessionIds.add(payload.session.id);
  return payload.session;
};

const run = async () => {
  const created = {
    productIds: new Set(),
    variantIds: new Set(),
    basketIds: new Set(),
    saleIds: new Set(),
    sessionIds: new Set(),
    customerIds: new Set(),
    userIds: new Set(["sale-customer-capture-smoke-manager"]),
  };

  try {
    await serverController.startIfNeeded();

    const token = uniqueRef();
    const product = await apiJsonOrThrow({
      path: "/api/products",
      method: "POST",
      body: {
        name: `Capture Product ${token}`,
        brand: "Capture",
      },
      headers: STAFF_HEADERS,
    });
    created.productIds.add(product.id);

    const variant = await apiJsonOrThrow({
      path: "/api/variants",
      method: "POST",
      body: {
        productId: product.id,
        sku: `CAPTURE-${token}`,
        retailPricePence: 2500,
      },
      headers: STAFF_HEADERS,
    });
    created.variantIds.add(variant.id);

    const emailMatchCustomer = await prisma.customer.create({
      data: {
        name: `Email Match ${token}`,
        firstName: "Email",
        lastName: "Match",
        email: `email-match-${token}@example.com`,
        phone: `07123${token.slice(-6)}`,
      },
    });
    created.customerIds.add(emailMatchCustomer.id);

    const phoneMatchCustomer = await prisma.customer.create({
      data: {
        name: `Phone Match ${token}`,
        firstName: "Phone",
        lastName: "Match",
        email: `phone-match-${token}@example.com`,
        phone: `07999${token.slice(-6)}`,
      },
    });
    created.customerIds.add(phoneMatchCustomer.id);

    const creationSale = await createSale(created, variant.id);
    const creationSession = await createCaptureSession(created, creationSale.id);
    assert.equal(creationSession.saleId, creationSale.id);
    assert.equal(creationSession.status, "ACTIVE");
    assert.ok(creationSession.token);
    assert.match(creationSession.publicPath, /\/customer-capture\//);

    const fetchedSession = await apiJsonOrThrow({
      path: `/api/public/customer-capture/${encodeURIComponent(creationSession.token)}`,
      method: "GET",
    });
    assert.equal(fetchedSession.session.status, "ACTIVE");

    const createdCustomerSale = await createSale(created, variant.id);
    const createdCustomerSession = await createCaptureSession(created, createdCustomerSale.id);
    const createdCustomerSubmit = await apiJsonOrThrow({
      path: `/api/public/customer-capture/${encodeURIComponent(createdCustomerSession.token)}`,
      method: "POST",
      body: {
        firstName: "New",
        lastName: "Customer",
        email: `new-customer-${token}@example.com`,
        phone: `07000${token.slice(-6)}`,
        emailMarketingConsent: true,
        smsMarketingConsent: false,
      },
    });
    assert.equal(createdCustomerSubmit.matchType, "created");
    assert.equal(createdCustomerSubmit.session.status, "COMPLETED");
    created.customerIds.add(createdCustomerSubmit.customer.id);

    const createdCustomerSalePayload = await apiJsonOrThrow({
      path: `/api/sales/${encodeURIComponent(createdCustomerSale.id)}`,
      method: "GET",
      headers: STAFF_HEADERS,
    });
    assert.equal(createdCustomerSalePayload.sale.customer.id, createdCustomerSubmit.customer.id);
    assert.equal(createdCustomerSalePayload.sale.customer.email, `new-customer-${token}@example.com`);

    const completedRetry = await apiJson({
      path: `/api/public/customer-capture/${encodeURIComponent(createdCustomerSession.token)}`,
      method: "POST",
      body: {
        firstName: "Retry",
        lastName: "Customer",
        email: `retry-${token}@example.com`,
      },
    });
    assert.equal(completedRetry.status, 409);
    assert.equal(completedRetry.payload.error.code, "CUSTOMER_CAPTURE_COMPLETED");

    const emailPrioritySale = await createSale(created, variant.id);
    const emailPrioritySession = await createCaptureSession(created, emailPrioritySale.id);
    const emailPrioritySubmit = await apiJsonOrThrow({
      path: `/api/public/customer-capture/${encodeURIComponent(emailPrioritySession.token)}`,
      method: "POST",
      body: {
        firstName: "Email",
        lastName: "Priority",
        email: emailMatchCustomer.email,
        phone: phoneMatchCustomer.phone,
      },
    });
    assert.equal(emailPrioritySubmit.matchType, "email");
    assert.equal(emailPrioritySubmit.customer.id, emailMatchCustomer.id);

    const phonePrioritySale = await createSale(created, variant.id);
    const phonePrioritySession = await createCaptureSession(created, phonePrioritySale.id);
    const phonePrioritySubmit = await apiJsonOrThrow({
      path: `/api/public/customer-capture/${encodeURIComponent(phonePrioritySession.token)}`,
      method: "POST",
      body: {
        firstName: "Phone",
        lastName: "Priority",
        phone: phoneMatchCustomer.phone,
      },
    });
    assert.equal(phonePrioritySubmit.matchType, "phone");
    assert.equal(phonePrioritySubmit.customer.id, phoneMatchCustomer.id);

    const expiredSale = await createSale(created, variant.id);
    const expiredSession = await createCaptureSession(created, expiredSale.id);
    await prisma.saleCustomerCaptureSession.update({
      where: { id: expiredSession.id },
      data: {
        expiresAt: new Date(Date.now() - 60_000),
        status: "ACTIVE",
      },
    });

    const expiredGet = await apiJsonOrThrow({
      path: `/api/public/customer-capture/${encodeURIComponent(expiredSession.token)}`,
      method: "GET",
    });
    assert.equal(expiredGet.session.status, "EXPIRED");

    const expiredSubmit = await apiJson({
      path: `/api/public/customer-capture/${encodeURIComponent(expiredSession.token)}`,
      method: "POST",
      body: {
        firstName: "Late",
        lastName: "Customer",
        email: `expired-${token}@example.com`,
      },
    });
    assert.equal(expiredSubmit.status, 410);
    assert.equal(expiredSubmit.payload.error.code, "CUSTOMER_CAPTURE_EXPIRED");

    console.log("[sale-customer-capture-smoke] sale-linked customer capture passed");
  } finally {
    await cleanup(created);
    await prisma.$disconnect();
    await serverController.stop();
  }
};

run().catch((error) => {
  console.error("[sale-customer-capture-smoke] FAIL", error);
  process.exit(1);
});
