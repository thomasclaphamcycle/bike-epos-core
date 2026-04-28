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
const CAPTURE_STATION_KEY = "TILL_PC";
const CAPTURE_STATION_SLUG = "till-pc";

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
    await prisma.auditEvent.deleteMany({
      where: {
        entityType: "SALE_CUSTOMER_CAPTURE_SESSION",
        entityId: { in: Array.from(created.sessionIds) },
      },
    });
  }

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

  if (created.basketIds.size > 0) {
    await prisma.basket.deleteMany({
      where: { id: { in: Array.from(created.basketIds) } },
    });
  }

  if (created.variantIds.size > 0) {
    const variantIds = Array.from(created.variantIds);

    await prisma.inventoryMovement.deleteMany({
      where: { variantId: { in: variantIds } },
    });
    await prisma.stockLedgerEntry.deleteMany({
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

  if (created.stockLocationIds.size > 0) {
    await prisma.stockLocation.deleteMany({
      where: { id: { in: Array.from(created.stockLocationIds) } },
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

const ensureDefaultStockLocation = async (created) => {
  const existingDefault = await prisma.stockLocation.findFirst({
    where: { isDefault: true },
    orderBy: { createdAt: "asc" },
  });
  if (existingDefault) {
    return existingDefault;
  }

  const location = await prisma.stockLocation.create({
    data: {
      name: `Capture Default Stock ${uniqueRef()}`,
      isDefault: true,
    },
  });
  created.stockLocationIds.add(location.id);
  return location;
};

const createCheckoutReadyVariant = async (created, suffix) => {
  const stockLocation = await ensureDefaultStockLocation(created);
  const product = await prisma.product.create({
    data: {
      name: `Capture Product ${suffix}`,
      brand: "Capture",
      description: "Customer capture smoke checkout product",
    },
  });
  created.productIds.add(product.id);

  const variant = await prisma.variant.create({
    data: {
      productId: product.id,
      sku: `CAPTURE-SKU-${suffix}`,
      barcode: `CAPTURE-BC-${suffix}`,
      name: `Capture Variant ${suffix}`,
      retailPricePence: 2500,
    },
  });
  created.variantIds.add(variant.id);

  await prisma.stockLedgerEntry.create({
    data: {
      variantId: variant.id,
      locationId: stockLocation.id,
      type: "ADJUSTMENT",
      quantityDelta: 10,
      referenceType: "SMOKE_TEST",
      referenceId: `capture_stock_${suffix}`,
      note: "Seed stock for customer capture smoke test",
    },
  });

  return variant;
};

const createBasket = async (created, body = {}) => {
  const payload = await apiJsonOrThrow({
    path: "/api/baskets",
    method: "POST",
    body,
    headers: STAFF_HEADERS,
  });
  created.basketIds.add(payload.id);
  return payload;
};

const addBasketItem = async (basketId, variantId) => {
  return apiJsonOrThrow({
    path: `/api/baskets/${encodeURIComponent(basketId)}/items`,
    method: "POST",
    body: {
      variantId,
      quantity: 1,
    },
    headers: STAFF_HEADERS,
  });
};

const createBasketCaptureSession = async (created, basketId, stationKey = CAPTURE_STATION_KEY) => {
  const payload = await apiJsonOrThrow({
    path: `/api/baskets/${encodeURIComponent(basketId)}/customer-capture-sessions`,
    method: "POST",
    body: {
      stationKey,
    },
    headers: STAFF_HEADERS,
  });
  created.sessionIds.add(payload.session.id);
  return payload;
};

const getCurrentBasketCaptureSession = async (basketId) => {
  return apiJsonOrThrow({
    path: `/api/baskets/${encodeURIComponent(basketId)}/customer-capture-sessions/current`,
    method: "GET",
    headers: STAFF_HEADERS,
  });
};

const createCaptureSession = async (created, saleId, stationKey = CAPTURE_STATION_KEY) => {
  const payload = await apiJsonOrThrow({
    path: `/api/sales/${encodeURIComponent(saleId)}/customer-capture-sessions`,
    method: "POST",
    body: {
      stationKey,
    },
    headers: STAFF_HEADERS,
  });
  created.sessionIds.add(payload.session.id);
  return payload;
};

const getCurrentCaptureSession = async (saleId) => {
  return apiJsonOrThrow({
    path: `/api/sales/${encodeURIComponent(saleId)}/customer-capture-sessions/current`,
    method: "GET",
    headers: STAFF_HEADERS,
  });
};

const getCurrentCaptureStationEntry = async (stationSlug = CAPTURE_STATION_SLUG) => {
  return apiJsonOrThrow({
    path: `/api/public/customer-capture/entry/${encodeURIComponent(stationSlug)}`,
    method: "GET",
  });
};

const clearActiveCaptureSessionsForStation = async (stationKey) => {
  await prisma.saleCustomerCaptureSession.updateMany({
    where: {
      stationKey,
      status: "ACTIVE",
    },
    data: {
      status: "EXPIRED",
      expiresAt: new Date(Date.now() - 60_000),
    },
  });
};

const run = async () => {
  const created = {
    locationIds: new Set(),
    saleIds: new Set(),
    basketIds: new Set(),
    sessionIds: new Set(),
    customerIds: new Set(),
    productIds: new Set(),
    variantIds: new Set(),
    stockLocationIds: new Set(),
  };

  try {
    await serverController.startIfNeeded();
    await clearActiveCaptureSessionsForStation(CAPTURE_STATION_KEY);

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

    const invalidBasketIdCreate = await apiJson({
      path: "/api/baskets/not-a-uuid/customer-capture-sessions",
      method: "POST",
      body: {},
      headers: STAFF_HEADERS,
    });
    assert.equal(invalidBasketIdCreate.status, 400);
    assert.equal(invalidBasketIdCreate.payload.error.code, "INVALID_BASKET_ID");

    const missingBasketCreate = await apiJson({
      path: "/api/baskets/00000000-0000-4000-8000-000000000001/customer-capture-sessions",
      method: "POST",
      body: {},
      headers: STAFF_HEADERS,
    });
    assert.equal(missingBasketCreate.status, 404);
    assert.equal(missingBasketCreate.payload.error.code, "BASKET_NOT_FOUND");

    const attachedBasket = await createBasket(created, {
      customerId: attachedCustomer.id,
    });
    const attachedBasketCreate = await apiJson({
      path: `/api/baskets/${encodeURIComponent(attachedBasket.id)}/customer-capture-sessions`,
      method: "POST",
      body: {
        stationKey: CAPTURE_STATION_KEY,
      },
      headers: STAFF_HEADERS,
    });
    assert.equal(attachedBasketCreate.status, 409);
    assert.equal(attachedBasketCreate.payload.error.code, "BASKET_CUSTOMER_ALREADY_ATTACHED");

    const invalidStationEntry = await apiJson({
      path: "/api/public/customer-capture/entry/not-a-real-station",
      method: "GET",
    });
    assert.equal(invalidStationEntry.status, 404);
    assert.equal(invalidStationEntry.payload.error.code, "CUSTOMER_CAPTURE_STATION_NOT_FOUND");

    const malformedTokenEntry = await apiJson({
      path: "/api/public/customer-capture/not-a-valid-token",
      method: "GET",
    });
    assert.equal(malformedTokenEntry.status, 404);
    assert.equal(malformedTokenEntry.payload.error.code, "CUSTOMER_CAPTURE_NOT_FOUND");

    const checkoutVariant = await createCheckoutReadyVariant(created, token);
    const preSaleBasket = await createBasket(created);
    const emptyCurrentBasketSession = await getCurrentBasketCaptureSession(preSaleBasket.id);
    assert.equal(emptyCurrentBasketSession.session, null);
    const emptyStationEntry = await getCurrentCaptureStationEntry();
    assert.equal(emptyStationEntry.station.key, CAPTURE_STATION_KEY);
    assert.equal(emptyStationEntry.station.entryPath, `/customer-capture/entry/${CAPTURE_STATION_SLUG}`);
    assert.equal(emptyStationEntry.session, null);
    await addBasketItem(preSaleBasket.id, checkoutVariant.id);

    const preSaleSessionPayload = await createBasketCaptureSession(created, preSaleBasket.id);
    assert.equal(preSaleSessionPayload.session.saleId, null);
    assert.equal(preSaleSessionPayload.session.basketId, preSaleBasket.id);
    assert.equal(preSaleSessionPayload.session.ownerType, "basket");
    assert.equal(preSaleSessionPayload.session.station.key, CAPTURE_STATION_KEY);
    assert.equal(
      preSaleSessionPayload.session.station.entryPath,
      `/customer-capture/entry/${CAPTURE_STATION_SLUG}`,
    );

    const activeStationEntry = await getCurrentCaptureStationEntry();
    assert.equal(activeStationEntry.station.key, CAPTURE_STATION_KEY);
    assert.equal(activeStationEntry.session.token, preSaleSessionPayload.session.token);
    assert.equal(activeStationEntry.session.ownerType, "basket");

    const preSaleCurrentSession = await getCurrentBasketCaptureSession(preSaleBasket.id);
    assert.equal(preSaleCurrentSession.session.id, preSaleSessionPayload.session.id);
    assert.equal(preSaleCurrentSession.session.status, "ACTIVE");
    assert.equal(preSaleCurrentSession.session.ownerType, "basket");

    const preSaleState = await apiJsonOrThrow({
      path: `/api/public/customer-capture/${encodeURIComponent(preSaleSessionPayload.session.token)}`,
      method: "GET",
    });
    assert.equal(preSaleState.session.status, "ACTIVE");
    assert.equal(preSaleState.session.ownerType, "basket");

    const preSaleSubmit = await apiJsonOrThrow({
      path: `/api/public/customer-capture/${encodeURIComponent(preSaleSessionPayload.session.token)}`,
      method: "POST",
      body: {
        firstName: "Pre",
        lastName: "Checkout",
        email: `pre-checkout-${token}@example.com`,
      },
    });
    assert.equal(preSaleSubmit.matchType, "created");
    assert.equal(preSaleSubmit.basket.id, preSaleBasket.id);
    assert.equal(preSaleSubmit.sale, null);
    created.customerIds.add(preSaleSubmit.customer.id);

    const preSaleBasketPayload = await apiJsonOrThrow({
      path: `/api/baskets/${encodeURIComponent(preSaleBasket.id)}`,
      method: "GET",
      headers: STAFF_HEADERS,
    });
    assert.equal(preSaleBasketPayload.customer.id, preSaleSubmit.customer.id);

    const preSaleCheckout = await apiJsonOrThrow({
      path: `/api/baskets/${encodeURIComponent(preSaleBasket.id)}/checkout`,
      method: "POST",
      body: {},
      headers: STAFF_HEADERS,
    });
    created.saleIds.add(preSaleCheckout.sale.id);
    assert.equal(preSaleCheckout.sale.customer.id, preSaleSubmit.customer.id);
    assert.equal(preSaleCheckout.sale.customer.email, `pre-checkout-${token}@example.com`);

    const carryForwardBasket = await createBasket(created);
    await addBasketItem(carryForwardBasket.id, checkoutVariant.id);

    const carryForwardSession = await createBasketCaptureSession(created, carryForwardBasket.id);
    const carryForwardCheckout = await apiJsonOrThrow({
      path: `/api/baskets/${encodeURIComponent(carryForwardBasket.id)}/checkout`,
      method: "POST",
      body: {},
      headers: STAFF_HEADERS,
    });
    created.saleIds.add(carryForwardCheckout.sale.id);

    const carryForwardSaleSession = await apiJsonOrThrow({
      path: `/api/sales/${encodeURIComponent(carryForwardCheckout.sale.id)}/customer-capture-sessions/current`,
      method: "GET",
      headers: STAFF_HEADERS,
    });
    assert.equal(carryForwardSaleSession.session.id, carryForwardSession.session.id);
    assert.equal(carryForwardSaleSession.session.saleId, carryForwardCheckout.sale.id);
    assert.equal(carryForwardSaleSession.session.basketId, null);
    assert.equal(carryForwardSaleSession.session.ownerType, "sale");

    const carryForwardSubmit = await apiJsonOrThrow({
      path: `/api/public/customer-capture/${encodeURIComponent(carryForwardSession.session.token)}`,
      method: "POST",
      body: {
        firstName: "Carry",
        lastName: "Forward",
        phone: `07888${token.slice(-6)}`,
      },
    });
    assert.equal(carryForwardSubmit.matchType, "created");
    assert.equal(carryForwardSubmit.sale.id, carryForwardCheckout.sale.id);
    assert.equal(carryForwardSubmit.basket, null);
    created.customerIds.add(carryForwardSubmit.customer.id);

    const carryForwardSalePayload = await apiJsonOrThrow({
      path: `/api/sales/${encodeURIComponent(carryForwardCheckout.sale.id)}`,
      method: "GET",
      headers: STAFF_HEADERS,
    });
    assert.equal(carryForwardSalePayload.sale.customer.id, carryForwardSubmit.customer.id);

    const postCompleteStationEntry = await getCurrentCaptureStationEntry();
    assert.equal(postCompleteStationEntry.session, null);

    const reusableSale = await createSale(created, location.id);
    const emptyCurrentSession = await getCurrentCaptureSession(reusableSale.id);
    assert.equal(emptyCurrentSession.session, null);

    const firstSessionPayload = await createCaptureSession(created, reusableSale.id);
    assert.equal(firstSessionPayload.session.saleId, reusableSale.id);
    assert.equal(firstSessionPayload.session.status, "ACTIVE");
    assert.equal(firstSessionPayload.replacedActiveSessionCount, 0);
    assert.ok(firstSessionPayload.session.token);
    assert.match(firstSessionPayload.session.publicPath, /\/customer-capture\//);

    const firstCurrentSession = await getCurrentCaptureSession(reusableSale.id);
    assert.equal(firstCurrentSession.session.id, firstSessionPayload.session.id);
    assert.equal(firstCurrentSession.session.status, "ACTIVE");

    const secondSessionPayload = await createCaptureSession(created, reusableSale.id);
    assert.equal(secondSessionPayload.replacedActiveSessionCount, 1);
    assert.notEqual(secondSessionPayload.session.id, firstSessionPayload.session.id);

    const secondCurrentSession = await getCurrentCaptureSession(reusableSale.id);
    assert.equal(secondCurrentSession.session.id, secondSessionPayload.session.id);
    assert.equal(secondCurrentSession.session.status, "ACTIVE");

    const firstSessionState = await apiJsonOrThrow({
      path: `/api/public/customer-capture/${encodeURIComponent(firstSessionPayload.session.token)}`,
      method: "GET",
    });
    assert.equal(firstSessionState.session.status, "EXPIRED");
    assert.equal(firstSessionState.session.isReplaced, true);

    const secondSessionState = await apiJsonOrThrow({
      path: `/api/public/customer-capture/${encodeURIComponent(secondSessionPayload.session.token)}`,
      method: "GET",
    });
    assert.equal(secondSessionState.session.status, "ACTIVE");
    assert.equal(secondSessionState.session.isReplaced, false);

    const stationScopedFirstSale = await createSale(created, location.id);
    const stationScopedFirstSession = await createCaptureSession(created, stationScopedFirstSale.id);
    const stationScopedSecondSale = await createSale(created, location.id);
    const stationScopedSecondSession = await createCaptureSession(created, stationScopedSecondSale.id);

    const latestStationEntry = await getCurrentCaptureStationEntry();
    assert.equal(latestStationEntry.session.token, stationScopedSecondSession.session.token);
    assert.equal(latestStationEntry.session.ownerType, "sale");

    const olderStationScopedTokenState = await apiJsonOrThrow({
      path: `/api/public/customer-capture/${encodeURIComponent(stationScopedFirstSession.session.token)}`,
      method: "GET",
    });
    assert.equal(olderStationScopedTokenState.session.status, "ACTIVE");

    const stationScopedSecondSubmit = await apiJsonOrThrow({
      path: `/api/public/customer-capture/${encodeURIComponent(stationScopedSecondSession.session.token)}`,
      method: "POST",
      body: {
        firstName: "Station",
        lastName: "Latest",
        email: `station-latest-${token}@example.com`,
      },
    });
    created.customerIds.add(stationScopedSecondSubmit.customer.id);

    const stationEntryAfterLatestCompleted = await getCurrentCaptureStationEntry();
    assert.equal(stationEntryAfterLatestCompleted.session.token, stationScopedFirstSession.session.token);
    assert.equal(stationEntryAfterLatestCompleted.session.ownerType, "sale");

    const replacedSubmit = await apiJson({
      path: `/api/public/customer-capture/${encodeURIComponent(firstSessionPayload.session.token)}`,
      method: "POST",
      body: {
        firstName: "Late",
        lastName: "Replacement",
        email: `replaced-${token}@example.com`,
      },
    });
    assert.equal(replacedSubmit.status, 409);
    assert.equal(replacedSubmit.payload.error.code, "CUSTOMER_CAPTURE_REPLACED");

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

    const completedCurrentSession = await getCurrentCaptureSession(createdCustomerSale.id);
    assert.equal(completedCurrentSession.session.id, createdCustomerSession.session.id);
    assert.equal(completedCurrentSession.session.status, "COMPLETED");
    assert.equal(completedCurrentSession.session.outcome.matchType, "created");
    assert.equal(completedCurrentSession.session.outcome.customer.id, createdCustomerSubmit.customer.id);

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

    const concurrentSale = await createSale(created, location.id);
    const concurrentSession = await createCaptureSession(created, concurrentSale.id);
    const concurrentResponses = await Promise.all([
      apiJson({
        path: `/api/public/customer-capture/${encodeURIComponent(concurrentSession.session.token)}`,
        method: "POST",
        body: {
          firstName: "Race",
          lastName: "Winner",
          email: `race-winner-${token}@example.com`,
        },
      }),
      apiJson({
        path: `/api/public/customer-capture/${encodeURIComponent(concurrentSession.session.token)}`,
        method: "POST",
        body: {
          firstName: "Race",
          lastName: "Replay",
          email: `race-replay-${token}@example.com`,
        },
      }),
    ]);
    for (const response of concurrentResponses) {
      if (response.status === 201 && response.payload?.customer?.id) {
        created.customerIds.add(response.payload.customer.id);
      }
    }
    const concurrentSuccesses = concurrentResponses.filter((response) => response.status === 201);
    const concurrentConflicts = concurrentResponses.filter((response) => response.status === 409);
    assert.equal(concurrentSuccesses.length, 1);
    assert.equal(concurrentConflicts.length, 1);
    assert.equal(concurrentConflicts[0].payload.error.code, "CUSTOMER_CAPTURE_COMPLETED");

    const concurrentSalePayload = await apiJsonOrThrow({
      path: `/api/sales/${encodeURIComponent(concurrentSale.id)}`,
      method: "GET",
      headers: STAFF_HEADERS,
    });
    assert.equal(concurrentSalePayload.sale.customer.id, concurrentSuccesses[0].payload.customer.id);

    const createdPreviewSale = await createSale(created, location.id);
    const createdPreviewSession = await createCaptureSession(created, createdPreviewSale.id);
    const createdPreview = await apiJsonOrThrow({
      path: `/api/public/customer-capture/${encodeURIComponent(createdPreviewSession.session.token)}/preview`,
      method: "POST",
      body: {
        email: `preview-created-${token}@example.com`,
        phone: `07001${token.slice(-6)}`,
      },
    });
    assert.equal(createdPreview.preview.matchType, "created");
    assert.equal(createdPreview.preview.willUseExistingCustomer, false);
    assert.equal(createdPreview.preview.emailMatched, false);
    assert.equal(createdPreview.preview.phoneMatched, false);
    assert.equal(createdPreview.preview.conflictingMatch, false);

    const emailPrioritySale = await createSale(created, location.id);
    const emailPrioritySession = await createCaptureSession(created, emailPrioritySale.id);
    const emailPriorityPreview = await apiJsonOrThrow({
      path: `/api/public/customer-capture/${encodeURIComponent(emailPrioritySession.session.token)}/preview`,
      method: "POST",
      body: {
        email: emailMatchCustomer.email,
        phone: phoneMatchCustomer.phone,
      },
    });
    assert.equal(emailPriorityPreview.preview.matchType, "email");
    assert.equal(emailPriorityPreview.preview.willUseExistingCustomer, true);
    assert.equal(emailPriorityPreview.preview.emailMatched, true);
    assert.equal(emailPriorityPreview.preview.phoneMatched, true);
    assert.equal(emailPriorityPreview.preview.conflictingMatch, true);
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
    const phonePriorityPreview = await apiJsonOrThrow({
      path: `/api/public/customer-capture/${encodeURIComponent(phonePrioritySession.session.token)}/preview`,
      method: "POST",
      body: {
        phone: phoneMatchCustomer.phone,
      },
    });
    assert.equal(phonePriorityPreview.preview.matchType, "phone");
    assert.equal(phonePriorityPreview.preview.willUseExistingCustomer, true);
    assert.equal(phonePriorityPreview.preview.emailMatched, false);
    assert.equal(phonePriorityPreview.preview.phoneMatched, true);
    assert.equal(phonePriorityPreview.preview.conflictingMatch, false);
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
    assert.equal(expiredGet.session.isReplaced, false);

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

    const auditEvents = await prisma.auditEvent.findMany({
      where: {
        entityType: "SALE_CUSTOMER_CAPTURE_SESSION",
        entityId: { in: Array.from(created.sessionIds) },
      },
      select: {
        entityId: true,
        action: true,
        metadata: true,
      },
    });
    const auditActions = auditEvents.map((event) => event.action);
    assert.ok(auditActions.includes("customer_capture.session_created"));
    assert.ok(auditActions.includes("customer_capture.session_replaced"));
    assert.ok(auditActions.includes("customer_capture.submit_completed"));
    assert.ok(auditActions.includes("customer_capture.submit_rejected"));

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
