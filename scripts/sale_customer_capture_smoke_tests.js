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
    throw new Error(
      `${request.method || "GET"} ${request.path} failed (${result.status}): ${JSON.stringify(result.payload)}`,
    );
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

    await prisma.sale.deleteMany({
      where: { id: { in: saleIds } },
    });
  }

  if (created.locationIds.size > 0) {
    await prisma.location.deleteMany({
      where: { id: { in: Array.from(created.locationIds) } },
    });
  }

  if (created.customerIds.size > 0) {
    await prisma.customer.deleteMany({
      where: { id: { in: Array.from(created.customerIds) } },
    });
  }
};

const createSale = async (created, locationId) => {
  const sale = await prisma.sale.create({
    data: {
      locationId,
      subtotalPence: 2500,
      taxPence: 0,
      totalPence: 2500,
      changeDuePence: 0,
    },
    select: {
      id: true,
      completedAt: true,
      customerId: true,
    },
  });
  created.saleIds.add(sale.id);
  return sale;
};

const createCaptureSession = async (created, saleId) => {
  const payload = await apiJsonOrThrow({
    path: `/api/sales/${encodeURIComponent(saleId)}/customer-capture-sessions`,
    method: "POST",
    body: {},
    headers: STAFF_HEADERS,
  });
  created.sessionIds.add(payload.session.id);
  return payload;
};

const run = async () => {
  const created = {
    locationIds: new Set(),
    saleIds: new Set(),
    sessionIds: new Set(),
    customerIds: new Set(),
  };

  try {
    await serverController.startIfNeeded();

    const token = uniqueRef();
    const location = await prisma.location.create({
      data: {
        name: `Capture Location ${token}`,
        code: `CAPTURE_${token.slice(-8)}`,
      },
    });
    created.locationIds.add(location.id);

    const invalidSaleIdCreate = await apiJson({
      path: "/api/sales/not-a-uuid/customer-capture-sessions",
      method: "POST",
      body: {},
      headers: STAFF_HEADERS,
    });
    assert.equal(invalidSaleIdCreate.status, 400);
    assert.equal(invalidSaleIdCreate.payload.error.code, "INVALID_SALE_ID");

    const missingSaleCreate = await apiJson({
      path: "/api/sales/00000000-0000-4000-8000-000000000001/customer-capture-sessions",
      method: "POST",
      body: {},
      headers: STAFF_HEADERS,
    });
    assert.equal(missingSaleCreate.status, 404);
    assert.equal(missingSaleCreate.payload.error.code, "SALE_NOT_FOUND");

    const completedSale = await createSale(created, location.id);
    await prisma.sale.update({
      where: { id: completedSale.id },
      data: { completedAt: new Date() },
    });
    const completedSaleCreate = await apiJson({
      path: `/api/sales/${encodeURIComponent(completedSale.id)}/customer-capture-sessions`,
      method: "POST",
      body: {},
      headers: STAFF_HEADERS,
    });
    assert.equal(completedSaleCreate.status, 409);
    assert.equal(completedSaleCreate.payload.error.code, "SALE_ALREADY_COMPLETED");

    const attachedCustomer = await prisma.customer.create({
      data: {
        firstName: "Attached",
        lastName: "Customer",
        email: `attached-${token}@example.com`,
      },
    });
    created.customerIds.add(attachedCustomer.id);

    const customerAttachedSale = await createSale(created, location.id);
    await prisma.sale.update({
      where: { id: customerAttachedSale.id },
      data: { customerId: attachedCustomer.id },
    });
    const attachedSaleCreate = await apiJson({
      path: `/api/sales/${encodeURIComponent(customerAttachedSale.id)}/customer-capture-sessions`,
      method: "POST",
      body: {},
      headers: STAFF_HEADERS,
    });
    assert.equal(attachedSaleCreate.status, 409);
    assert.equal(attachedSaleCreate.payload.error.code, "SALE_CUSTOMER_ALREADY_ATTACHED");

    const reusableSale = await createSale(created, location.id);
    const firstSessionPayload = await createCaptureSession(created, reusableSale.id);
    assert.equal(firstSessionPayload.session.saleId, reusableSale.id);
    assert.equal(firstSessionPayload.session.status, "ACTIVE");
    assert.equal(firstSessionPayload.replacedActiveSessionCount, 0);
    assert.ok(firstSessionPayload.session.token);
    assert.match(firstSessionPayload.session.publicPath, /\/customer-capture\//);

    const secondSessionPayload = await createCaptureSession(created, reusableSale.id);
    assert.equal(secondSessionPayload.replacedActiveSessionCount, 1);
    assert.notEqual(secondSessionPayload.session.id, firstSessionPayload.session.id);

    const firstSessionState = await apiJsonOrThrow({
      path: `/api/public/customer-capture/${encodeURIComponent(firstSessionPayload.session.token)}`,
      method: "GET",
    });
    assert.equal(firstSessionState.session.status, "EXPIRED");

    const secondSessionState = await apiJsonOrThrow({
      path: `/api/public/customer-capture/${encodeURIComponent(secondSessionPayload.session.token)}`,
      method: "GET",
    });
    assert.equal(secondSessionState.session.status, "ACTIVE");

    const invalidSubmitMissingName = await apiJson({
      path: `/api/public/customer-capture/${encodeURIComponent(secondSessionPayload.session.token)}`,
      method: "POST",
      body: {
        lastName: "Missing First",
        email: `missing-first-${token}@example.com`,
      },
    });
    assert.equal(invalidSubmitMissingName.status, 400);
    assert.equal(invalidSubmitMissingName.payload.error.code, "INVALID_CUSTOMER_CAPTURE");

    const invalidSubmitMissingContact = await apiJson({
      path: `/api/public/customer-capture/${encodeURIComponent(secondSessionPayload.session.token)}`,
      method: "POST",
      body: {
        firstName: "No",
        lastName: "Contact",
      },
    });
    assert.equal(invalidSubmitMissingContact.status, 400);
    assert.equal(invalidSubmitMissingContact.payload.error.code, "INVALID_CUSTOMER_CAPTURE");

    const emailMatchCustomer = await prisma.customer.create({
      data: {
        firstName: "Email",
        lastName: "Match",
        email: `email-match-${token}@example.com`,
        phone: `07123${token.slice(-6)}`,
      },
    });
    created.customerIds.add(emailMatchCustomer.id);

    const phoneMatchCustomer = await prisma.customer.create({
      data: {
        firstName: "Phone",
        lastName: "Match",
        email: `phone-match-${token}@example.com`,
        phone: `07999${token.slice(-6)}`,
      },
    });
    created.customerIds.add(phoneMatchCustomer.id);

    const createdCustomerSale = await createSale(created, location.id);
    const createdCustomerSession = await createCaptureSession(created, createdCustomerSale.id);
    const createdCustomerSubmit = await apiJsonOrThrow({
      path: `/api/public/customer-capture/${encodeURIComponent(createdCustomerSession.session.token)}`,
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
    assert.equal(
      createdCustomerSalePayload.sale.customer.email,
      `new-customer-${token}@example.com`,
    );

    const completedRetry = await apiJson({
      path: `/api/public/customer-capture/${encodeURIComponent(createdCustomerSession.session.token)}`,
      method: "POST",
      body: {
        firstName: "Retry",
        lastName: "Customer",
        email: `retry-${token}@example.com`,
      },
    });
    assert.equal(completedRetry.status, 409);
    assert.equal(completedRetry.payload.error.code, "CUSTOMER_CAPTURE_COMPLETED");

    const emailPrioritySale = await createSale(created, location.id);
    const emailPrioritySession = await createCaptureSession(created, emailPrioritySale.id);
    const emailPrioritySubmit = await apiJsonOrThrow({
      path: `/api/public/customer-capture/${encodeURIComponent(emailPrioritySession.session.token)}`,
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

    const phonePrioritySale = await createSale(created, location.id);
    const phonePrioritySession = await createCaptureSession(created, phonePrioritySale.id);
    const phonePrioritySubmit = await apiJsonOrThrow({
      path: `/api/public/customer-capture/${encodeURIComponent(phonePrioritySession.session.token)}`,
      method: "POST",
      body: {
        firstName: "Phone",
        lastName: "Priority",
        phone: phoneMatchCustomer.phone,
      },
    });
    assert.equal(phonePrioritySubmit.matchType, "phone");
    assert.equal(phonePrioritySubmit.customer.id, phoneMatchCustomer.id);

    const expiredSale = await createSale(created, location.id);
    const expiredSession = await createCaptureSession(created, expiredSale.id);
    await prisma.saleCustomerCaptureSession.update({
      where: { id: expiredSession.session.id },
      data: {
        expiresAt: new Date(Date.now() - 60_000),
        status: "ACTIVE",
      },
    });

    const expiredGet = await apiJsonOrThrow({
      path: `/api/public/customer-capture/${encodeURIComponent(expiredSession.session.token)}`,
      method: "GET",
    });
    assert.equal(expiredGet.session.status, "EXPIRED");

    const expiredSubmit = await apiJson({
      path: `/api/public/customer-capture/${encodeURIComponent(expiredSession.session.token)}`,
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
