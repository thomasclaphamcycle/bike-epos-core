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

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const RUN_REF = `hire_${Date.now()}`;
const MANAGER_ID = `hire-manager-${RUN_REF}`;
const STAFF_ID = `hire-staff-${RUN_REF}`;
const safeDbUrl = DATABASE_URL.replace(/(postgres(?:ql)?:\/\/[^:/@]+:)[^@]+@/i, "$1***@");
console.log(`[hire-smoke] BASE_URL=${BASE_URL}`);
console.log(`[hire-smoke] DATABASE_URL=${safeDbUrl}`);

const APP_REQUEST_RETRIES = 8;

const managerHeaders = {
  "Content-Type": "application/json",
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": MANAGER_ID,
};

const staffHeaders = {
  "Content-Type": "application/json",
  "X-Staff-Role": "STAFF",
  "X-Staff-Id": STAFF_ID,
};

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
    // Keep primary only if URL parsing fails.
  }

  return urls;
})();

let activeAppBaseUrl = appBaseUrlCandidates[0];
const serverController = createSmokeServerController({
  label: "hire-smoke",
  baseUrls: appBaseUrlCandidates,
  databaseUrl: DATABASE_URL,
  startup: {
    command: "node",
    args: ["scripts/start_test_server.js"],
  },
  captureStartupLog: true,
  envOverrides: {
    PORT: new URL(BASE_URL).port || "3100",
  },
});

const fetchFromApp = async (path, options = {}) => {
  let lastError = null;

  for (let attempt = 0; attempt < APP_REQUEST_RETRIES; attempt += 1) {
    try {
      activeAppBaseUrl = serverController.getBaseUrl();
      return await fetch(`${activeAppBaseUrl}${path}`, options);
    } catch (error) {
      lastError = error;
      const healthyBaseUrl = await serverController.probeHealthyBaseUrl();
      if (healthyBaseUrl) {
        activeAppBaseUrl = healthyBaseUrl;
      }
    }

    if (attempt < APP_REQUEST_RETRIES - 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  if (lastError instanceof Error) {
    lastError.message = `${lastError.message} while requesting ${activeAppBaseUrl}${path}`;
    throw lastError;
  }

  throw new Error(`Failed to fetch ${activeAppBaseUrl}${path}`);
};

const fetchJson = async (path, options = {}, headers = managerHeaders) => {
  const response = await fetchFromApp(path, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json };
};

const addHoursToIso = (isoValue, hoursToAdd) => {
  const value = new Date(isoValue);
  value.setTime(value.getTime() + (hoursToAdd * 60 * 60 * 1000));
  return value.toISOString();
};

const cleanup = async (state) => {
  if (state.bookingIds.length > 0) {
    await prisma.hireBooking.deleteMany({
      where: {
        id: {
          in: state.bookingIds,
        },
      },
    });
  }

  if (state.assetIds.length > 0) {
    await prisma.hireAsset.deleteMany({
      where: {
        id: {
          in: state.assetIds,
        },
      },
    });
  }

  if (state.variantIds.length > 0) {
    await prisma.barcode.deleteMany({
      where: {
        variantId: {
          in: state.variantIds,
        },
      },
    });
    await prisma.variant.deleteMany({
      where: {
        id: {
          in: state.variantIds,
        },
      },
    });
  }

  if (state.productIds.length > 0) {
    await prisma.product.deleteMany({
      where: {
        id: {
          in: state.productIds,
        },
      },
    });
  }

  if (state.customerIds.length > 0) {
    await prisma.customer.deleteMany({
      where: {
        id: {
          in: state.customerIds,
        },
      },
    });
  }

  if (state.userIds.length > 0) {
    await prisma.user.deleteMany({
      where: {
        id: {
          in: state.userIds,
        },
      },
    });
  }
};

const main = async () => {
  const state = {
    bookingIds: [],
    assetIds: [],
    variantIds: [],
    productIds: [],
    customerIds: [],
    userIds: [MANAGER_ID, STAFF_ID],
  };

  try {
    await serverController.startIfNeeded();
    activeAppBaseUrl = serverController.getBaseUrl();

    const product = await prisma.product.create({
      data: {
        name: `Hire Hardtail ${RUN_REF}`,
        brand: "CorePOS",
        variants: {
          create: {
            sku: `HIRE-${RUN_REF}`,
            barcode: `HIRE-${RUN_REF}`,
            retailPricePence: 4500,
          },
        },
      },
      include: {
        variants: true,
      },
    });
    state.productIds.push(product.id);
    state.variantIds.push(product.variants[0].id);

    const customer = await prisma.customer.create({
      data: {
        firstName: "Hire",
        lastName: `Customer ${RUN_REF}`,
        email: `hire-${RUN_REF}@corepos.test`,
        phone: "07700900900",
      },
    });
    state.customerIds.push(customer.id);

    const createAssetRes = await fetchJson(
      "/api/hire/assets",
      {
        method: "POST",
        body: JSON.stringify({
          variantId: product.variants[0].id,
          assetTag: `HIRE-ASSET-${RUN_REF}`,
          displayName: "Demo hire bike",
          notes: "Front suspension checked",
          storageLocation: "Front hire rack",
          isOnlineBookable: true,
        }),
      },
      managerHeaders,
    );
    assert.equal(createAssetRes.status, 201);
    assert.equal(createAssetRes.json.status, "AVAILABLE");
    assert.equal(createAssetRes.json.storageLocation, "Front hire rack");
    assert.equal(createAssetRes.json.isOnlineBookable, true);
    state.assetIds.push(createAssetRes.json.id);
    const assetTagQuery = encodeURIComponent(createAssetRes.json.assetTag);

    const listAssetsRes = await fetchJson("/api/hire/assets?onlineBookable=true&take=20", { method: "GET" }, staffHeaders);
    assert.equal(listAssetsRes.status, 200);
    assert.ok(
      listAssetsRes.json.assets.some((asset) => asset.id === createAssetRes.json.id && asset.isOnlineBookable === true),
      "expected created hire asset in online-bookable fleet list",
    );

    const startsAt = new Date(Date.now() + (60 * 60 * 1000)).toISOString();
    const dueBackAt = addHoursToIso(startsAt, 23);
    const createBookingRes = await fetchJson(
      "/api/hire/bookings",
      {
        method: "POST",
        body: JSON.stringify({
          hireAssetId: createAssetRes.json.id,
          customerId: customer.id,
          startsAt,
          dueBackAt,
          hirePricePence: 4500,
          depositPence: 15000,
          notes: "Passport checked",
        }),
      },
      staffHeaders,
    );
    assert.equal(createBookingRes.status, 201);
    assert.equal(createBookingRes.json.status, "RESERVED");
    assert.equal(createBookingRes.json.customer.id, customer.id);
    state.bookingIds.push(createBookingRes.json.id);

    const overlapBookingRes = await fetchJson(
      "/api/hire/bookings",
      {
        method: "POST",
        body: JSON.stringify({
          hireAssetId: createAssetRes.json.id,
          customerId: customer.id,
          startsAt: addHoursToIso(startsAt, 1),
          dueBackAt: addHoursToIso(startsAt, 25),
          hirePricePence: 3000,
          depositPence: 5000,
        }),
      },
      staffHeaders,
    );
    assert.equal(overlapBookingRes.status, 409);
    assert.equal(overlapBookingRes.json.error.code, "HIRE_ASSET_ALREADY_BOOKED");

    const secondStartsAt = addHoursToIso(startsAt, 71);
    const secondDueBackAt = addHoursToIso(startsAt, 95);
    const secondBookingRes = await fetchJson(
      "/api/hire/bookings",
      {
        method: "POST",
        body: JSON.stringify({
          hireAssetId: createAssetRes.json.id,
          customerId: customer.id,
          startsAt: secondStartsAt,
          dueBackAt: secondDueBackAt,
          hirePricePence: 3500,
          depositPence: 10000,
          notes: "Second future reservation",
        }),
      },
      staffHeaders,
    );
    assert.equal(secondBookingRes.status, 201);
    assert.equal(secondBookingRes.json.status, "RESERVED");
    state.bookingIds.push(secondBookingRes.json.id);

    const unavailableWindowRes = await fetchJson(
      `/api/hire/assets?availableFrom=${encodeURIComponent(startsAt)}&availableTo=${encodeURIComponent(dueBackAt)}&take=20`,
      { method: "GET" },
      staffHeaders,
    );
    assert.equal(unavailableWindowRes.status, 200);
    assert.ok(
      unavailableWindowRes.json.assets.every((asset) => asset.id !== createAssetRes.json.id),
      "expected asset to be unavailable for overlapping requested dates",
    );

    const availableLaterFrom = addHoursToIso(startsAt, 119);
    const availableLaterTo = addHoursToIso(startsAt, 143);
    const availableLaterWindowRes = await fetchJson(
      `/api/hire/assets?q=${assetTagQuery}&availableFrom=${encodeURIComponent(availableLaterFrom)}&availableTo=${encodeURIComponent(availableLaterTo)}&take=20`,
      { method: "GET" },
      staffHeaders,
    );
    assert.equal(availableLaterWindowRes.status, 200);
    assert.ok(
      availableLaterWindowRes.json.assets.some((asset) => asset.id === createAssetRes.json.id),
      "expected asset to be available after existing future reservations end",
    );

    const insufficientCheckoutRes = await fetchJson(
      `/api/hire/bookings/${encodeURIComponent(createBookingRes.json.id)}/checkout`,
      {
        method: "POST",
        body: JSON.stringify({
          depositHeldPence: 5000,
        }),
      },
      staffHeaders,
    );
    assert.equal(insufficientCheckoutRes.status, 409);
    assert.equal(insufficientCheckoutRes.json.error.code, "HIRE_DEPOSIT_REQUIRED");

    const blockedMaintenanceRes = await fetchJson(
      `/api/hire/assets/${encodeURIComponent(createAssetRes.json.id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status: "MAINTENANCE",
        }),
      },
      managerHeaders,
    );
    assert.equal(blockedMaintenanceRes.status, 200);
    assert.equal(blockedMaintenanceRes.json.status, "MAINTENANCE");

    const blockedCheckoutRes = await fetchJson(
      `/api/hire/bookings/${encodeURIComponent(createBookingRes.json.id)}/checkout`,
      {
        method: "POST",
        body: JSON.stringify({
          depositHeldPence: 15000,
        }),
      },
      staffHeaders,
    );
    assert.equal(blockedCheckoutRes.status, 409);
    assert.equal(blockedCheckoutRes.json.error.code, "HIRE_ASSET_UNAVAILABLE");

    const reopenAssetRes = await fetchJson(
      `/api/hire/assets/${encodeURIComponent(createAssetRes.json.id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status: "AVAILABLE",
          storageLocation: "Ready rack",
        }),
      },
      managerHeaders,
    );
    assert.equal(reopenAssetRes.status, 200);
    assert.equal(reopenAssetRes.json.storageLocation, "Ready rack");
    assert.equal(reopenAssetRes.json.status, "RESERVED");

    const checkoutRes = await fetchJson(
      `/api/hire/bookings/${encodeURIComponent(createBookingRes.json.id)}/checkout`,
      {
        method: "POST",
        body: JSON.stringify({
          depositHeldPence: 15000,
          pickupNotes: "ID checked and helmet issued",
        }),
      },
      staffHeaders,
    );
    assert.equal(checkoutRes.status, 200);
    assert.equal(checkoutRes.json.status, "CHECKED_OUT");
    assert.equal(checkoutRes.json.depositStatus, "HELD");
    assert.equal(checkoutRes.json.pickupNotes, "ID checked and helmet issued");

    const onHireAssetsRes = await fetchJson("/api/hire/assets?status=ON_HIRE&take=20", { method: "GET" }, staffHeaders);
    assert.equal(onHireAssetsRes.status, 200);
    assert.ok(
      onHireAssetsRes.json.assets.some((asset) => asset.id === createAssetRes.json.id),
      "expected checked-out asset in ON_HIRE fleet list",
    );

    const returnRes = await fetchJson(
      `/api/hire/bookings/${encodeURIComponent(createBookingRes.json.id)}/return`,
      {
        method: "POST",
        body: JSON.stringify({
          depositOutcome: "RETURNED",
          returnNotes: "Returned clean",
          damageNotes: "Minor brake rub to inspect",
          markAssetMaintenance: true,
        }),
      },
      staffHeaders,
    );
    assert.equal(returnRes.status, 200);
    assert.equal(returnRes.json.status, "RETURNED");
    assert.equal(returnRes.json.depositStatus, "RETURNED");
    assert.equal(returnRes.json.damageNotes, "Minor brake rub to inspect");

    const maintenanceAssetsRes = await fetchJson("/api/hire/assets?status=MAINTENANCE&take=20", { method: "GET" }, staffHeaders);
    assert.equal(maintenanceAssetsRes.status, 200);
    assert.ok(
      maintenanceAssetsRes.json.assets.some((asset) => asset.id === createAssetRes.json.id),
      "expected returned asset in MAINTENANCE list after flagged return",
    );

    const reopenAfterMaintenanceRes = await fetchJson(
      `/api/hire/assets/${encodeURIComponent(createAssetRes.json.id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status: "AVAILABLE",
          notes: "Brake rub resolved and bike ready",
        }),
      },
      managerHeaders,
    );
    assert.equal(reopenAfterMaintenanceRes.status, 200);
    assert.equal(reopenAfterMaintenanceRes.json.status, "RESERVED");

    const cancelRes = await fetchJson(
      `/api/hire/bookings/${encodeURIComponent(secondBookingRes.json.id)}/cancel`,
      {
        method: "POST",
        body: JSON.stringify({
          cancellationReason: "Customer moved trip dates",
        }),
      },
      staffHeaders,
    );
    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.json.status, "CANCELLED");
    assert.equal(cancelRes.json.cancellationReason, "Customer moved trip dates");

    const bookingListRes = await fetchJson(
      `/api/hire/bookings?customerId=${encodeURIComponent(customer.id)}&view=HISTORY&take=20`,
      { method: "GET" },
      staffHeaders,
    );
    assert.equal(bookingListRes.status, 200);
    assert.ok(
      bookingListRes.json.bookings.some((booking) => booking.id === createBookingRes.json.id && booking.status === "RETURNED"),
      "expected returned booking in customer history view",
    );
    assert.ok(
      bookingListRes.json.bookings.some((booking) => booking.id === secondBookingRes.json.id && booking.status === "CANCELLED"),
      "expected cancelled booking in customer history view",
    );

    const availableAssetsRes = await fetchJson(
      `/api/hire/assets?status=AVAILABLE&q=${assetTagQuery}&take=20`,
      { method: "GET" },
      staffHeaders,
    );
    assert.equal(availableAssetsRes.status, 200);
    assert.ok(
      availableAssetsRes.json.assets.some((asset) => asset.id === createAssetRes.json.id),
      "expected asset back in AVAILABLE list once future reservation is cancelled",
    );

    console.log("PASS bike hire assets can be created with fleet metadata and filtered for online readiness");
    console.log("PASS rental bookings enforce overlap-safe availability rather than a single global reserve flag");
    console.log("PASS deposits, pickup notes, maintenance returns, and cancellation reasons flow through the full hire lifecycle");
  } finally {
    try {
      await cleanup(state);
    } finally {
      await serverController.stop();
      await prisma.$disconnect();
    }
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
