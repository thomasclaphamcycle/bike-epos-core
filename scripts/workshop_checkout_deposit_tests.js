#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { ensureMainLocationId } = require("./default_location_helper");
const { createSmokeServerController } = require("./smoke_server_helper");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3100";
const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const portFromBaseUrl = () => {
  const url = new URL(BASE_URL);
  return url.port || (url.protocol === "https:" ? "443" : "80");
};

if (!DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
}
if (process.env.NODE_ENV !== "test") {
  throw new Error("Refusing to run: NODE_ENV must be 'test'.");
}
if (process.env.ALLOW_NON_TEST_DB !== "1" && !DATABASE_URL.toLowerCase().includes("test")) {
  throw new Error(
    "Refusing to run against non-test database URL. Set TEST_DATABASE_URL to a test DB or set ALLOW_NON_TEST_DB=1 explicitly.",
  );
}

const safeDbUrl = DATABASE_URL.replace(
  /(postgres(?:ql)?:\/\/[^:/@]+:)[^@]+@/i,
  "$1***@",
);

console.log(`[m11-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m11-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const STAFF_HEADERS = {
  "X-Staff-Role": "STAFF",
  "X-Staff-Id": "m11-smoke-staff",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const APP_REQUEST_RETRIES = 8;
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
    // Keep the primary URL only if parsing fails unexpectedly.
  }

  return urls;
})();
let activeAppBaseUrl = appBaseUrlCandidates[0];
const serverController = createSmokeServerController({
  label: "m11-smoke",
  baseUrls: appBaseUrlCandidates,
  databaseUrl: DATABASE_URL,
      startup: {
        command: "node",
        args: ["scripts/start_test_server.js"],
      },
  captureStartupLog: true,
  startupReadyPattern: /Server running on http:\/\/localhost:\d+/i,
  envOverrides: {
    PORT: portFromBaseUrl(),
  },
});

const todayUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

const formatDateOnly = (date) => date.toISOString().slice(0, 10);

const addDays = (date, days) => {
  const out = new Date(date);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
};

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
      await sleep(250);
    }
  }

  if (lastError instanceof Error) {
    lastError.message = `${lastError.message} while requesting ${activeAppBaseUrl}${path}`;
    throw lastError;
  }

  throw new Error(`Failed to fetch ${activeAppBaseUrl}${path}`);
};

const fetchJson = async (path, options = {}) => {
  const response = await fetchFromApp(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
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

let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;

const createOnlineBooking = async (scheduledDate) => {
  const ref = uniqueRef();
  const response = await fetchJson("/api/workshop-bookings", {
    method: "POST",
    body: JSON.stringify({
      firstName: "Test",
      lastName: "Rider",
      email: `test.${ref}@example.com`,
      phone: `0799${String(ref).replace(/\D/g, "").slice(-7).padStart(7, "0")}`,
      scheduledDate,
      notes: `Automated test ${ref}`,
    }),
  });

  assert.equal(
    response.status,
    201,
    `create booking failed: ${response.status} ${JSON.stringify(response.json)}`,
  );
  return response.json;
};

const payDeposit = async (token, providerRef) => {
  return fetchJson(`/api/workshop-bookings/manage/${token}/pay-deposit`, {
    method: "POST",
    body: JSON.stringify({
      method: "CARD",
      providerRef,
    }),
  });
};

const checkoutWorkshopJob = async (workshopJobId, payload) => {
  return fetchJson(`/api/workshop/jobs/${workshopJobId}/checkout`, {
    method: "POST",
    headers: STAFF_HEADERS,
    body: JSON.stringify(payload),
  });
};

const cleanupTestData = async (workshopJobIds, customerIds, saleIds) => {
  const workshopIds = Array.from(workshopJobIds);
  const customerIdList = Array.from(customerIds);
  const saleIdSet = new Set(saleIds);

  if (workshopIds.length > 0) {
    const linkedSales = await prisma.sale.findMany({
      where: { workshopJobId: { in: workshopIds } },
      select: { id: true },
    });
    for (const sale of linkedSales) {
      saleIdSet.add(sale.id);
    }
  }

  const saleIdsAll = Array.from(saleIdSet);

  if (saleIdsAll.length > 0 || workshopIds.length > 0) {
    const paymentOr = [];
    if (saleIdsAll.length > 0) {
      paymentOr.push({ saleId: { in: saleIdsAll } });
    }
    if (workshopIds.length > 0) {
      paymentOr.push({ workshopJobId: { in: workshopIds } });
    }
    await prisma.payment.deleteMany({ where: { OR: paymentOr } });
  }

  if (saleIdsAll.length > 0) {
    await prisma.saleReturnItem.deleteMany({
      where: {
        saleReturn: {
          saleId: { in: saleIdsAll },
        },
      },
    });
    await prisma.saleReturn.deleteMany({
      where: { saleId: { in: saleIdsAll } },
    });
    await prisma.saleItem.deleteMany({
      where: { saleId: { in: saleIdsAll } },
    });
    await prisma.sale.deleteMany({
      where: { id: { in: saleIdsAll } },
    });
  }

  if (workshopIds.length > 0) {
    await prisma.workshopJob.deleteMany({
      where: { id: { in: workshopIds } },
    });
  }

  if (customerIdList.length > 0) {
    await prisma.customer.deleteMany({
      where: { id: { in: customerIdList } },
    });
  }
};

const run = async () => {
  const createdWorkshopJobIds = new Set();
  const createdCustomerIds = new Set();
  const createdSaleIds = new Set();

  const trackBooking = (booking) => {
    if (booking?.id) {
      createdWorkshopJobIds.add(booking.id);
    }
    if (booking?.customer?.id) {
      createdCustomerIds.add(booking.customer.id);
    }
  };

  const trackCheckout = (checkoutResponse) => {
    const saleId = checkoutResponse?.json?.sale?.id;
    if (saleId) {
      createdSaleIds.add(saleId);
    }
  };

  try {
    await serverController.startIfNeeded();
    activeAppBaseUrl = serverController.getBaseUrl();

    await prisma.bookingSettings.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        minBookableDate: todayUtc(),
        maxBookingsPerDay: 999,
        defaultDepositPence: 1000,
      },
      update: {
        minBookableDate: todayUtc(),
        maxBookingsPerDay: 999,
        defaultDepositPence: 1000,
      },
    });

    const scheduledDate = formatDateOnly(addDays(todayUtc(), 30));
    const testResults = [];

    const runTest = async (name, fn) => {
      try {
        await fn();
        testResults.push({ name, ok: true });
        console.log(`PASS ${name}`);
      } catch (error) {
        testResults.push({ name, ok: false, error });
        console.error(`FAIL ${name}`);
        console.error(error instanceof Error ? error.message : String(error));
      }
    };

    await runTest("pay-deposit called twice is idempotent", async () => {
      const booking = await createOnlineBooking(scheduledDate);
      trackBooking(booking);

      const first = await payDeposit(booking.manageToken, `dep-first-${uniqueRef()}`);
      assert.equal(first.status, 201, JSON.stringify(first.json));
      assert.equal(first.json.idempotent, false, JSON.stringify(first.json));
      assert.ok(first.json.payment?.id, JSON.stringify(first.json));

      const second = await payDeposit(booking.manageToken, `dep-second-${uniqueRef()}`);
      assert.equal(second.status, 200, JSON.stringify(second.json));
      assert.equal(second.json.idempotent, true, JSON.stringify(second.json));
      assert.equal(second.json.payment?.id, first.json.payment.id);
    });

    await runTest("checkout concurrent requests are idempotent", async () => {
      const booking = await createOnlineBooking(scheduledDate);
      trackBooking(booking);

      const deposit = await payDeposit(booking.manageToken, `dep-concurrent-${uniqueRef()}`);
      assert.equal(deposit.status, 201, JSON.stringify(deposit.json));

      const payload = {
        saleTotalPence: 6999,
        paymentMethod: "CARD",
        amountPence: 5999,
        providerRef: `final-concurrent-${uniqueRef()}`,
      };

      const responses = await Promise.all(
        Array.from({ length: 6 }, () => checkoutWorkshopJob(booking.id, payload)),
      );

      for (const response of responses) {
        assert.ok(
          response.status === 200 || response.status === 201,
          `unexpected status ${response.status}: ${JSON.stringify(response.json)}`,
        );
        trackCheckout(response);
      }

      const created = responses.filter((response) => response.status === 201);
      const idempotent = responses.filter((response) => response.status === 200);
      assert.equal(created.length, 1, "expected exactly one created checkout");
      assert.ok(idempotent.length >= 1, "expected idempotent checkout responses");

      const saleIds = new Set(responses.map((response) => response.json.sale?.id));
      assert.equal(saleIds.size, 1, "all checkout responses must reference same sale");
    });

    await runTest("checkout with required unpaid deposit returns 409", async () => {
      const booking = await createOnlineBooking(scheduledDate);
      trackBooking(booking);

      const response = await checkoutWorkshopJob(booking.id, {
        saleTotalPence: 6999,
        paymentMethod: "CARD",
        amountPence: 6999,
      });

      assert.equal(response.status, 409, JSON.stringify(response.json));
      assert.equal(response.json?.error?.code, "DEPOSIT_REQUIRED", JSON.stringify(response.json));
    });

    await runTest("checkout succeeds when deposit is not required", async () => {
      const ref = uniqueRef();
      const customer = await prisma.customer.create({
        data: {
          firstName: "InStore",
          lastName: "Customer",
          email: `instore.${ref}@example.com`,
          phone: `0788${String(ref).replace(/\D/g, "").slice(-7).padStart(7, "0")}`,
        },
      });
      createdCustomerIds.add(customer.id);
      const locationId = await ensureMainLocationId(prisma);

      const job = await prisma.workshopJob.create({
        data: {
          locationId,
          customerId: customer.id,
          status: "BOOKED",
          source: "IN_STORE",
          scheduledDate: addDays(todayUtc(), 31),
          depositStatus: "NOT_REQUIRED",
          depositRequiredPence: 0,
          notes: `In-store test ${ref}`,
        },
      });
      createdWorkshopJobIds.add(job.id);

      const response = await checkoutWorkshopJob(job.id, {
        saleTotalPence: 1999,
        paymentMethod: "CARD",
        amountPence: 1999,
      });

      assert.equal(response.status, 201, JSON.stringify(response.json));
      assert.equal(response.json.idempotent, false, JSON.stringify(response.json));
      assert.equal(response.json.outstandingPence, 1999, JSON.stringify(response.json));
      trackCheckout(response);
    });

    await runTest("deposit paid greater than total results in zero outstanding", async () => {
      const booking = await createOnlineBooking(scheduledDate);
      trackBooking(booking);

      const deposit = await payDeposit(booking.manageToken, `dep-credit-${uniqueRef()}`);
      assert.equal(deposit.status, 201, JSON.stringify(deposit.json));

      const checkout = await checkoutWorkshopJob(booking.id, {
        saleTotalPence: 500,
      });
      trackCheckout(checkout);

      assert.equal(checkout.status, 201, JSON.stringify(checkout.json));
      assert.equal(checkout.json.depositPaidPence, 1000, JSON.stringify(checkout.json));
      assert.equal(checkout.json.creditPence, 500, JSON.stringify(checkout.json));
      assert.equal(checkout.json.outstandingPence, 0, JSON.stringify(checkout.json));
      assert.equal(checkout.json.payment, null, JSON.stringify(checkout.json));

      const payments = await prisma.payment.findMany({
        where: { saleId: checkout.json.sale.id },
      });
      const amounts = payments.map((payment) => payment.amountPence).sort((a, b) => a - b);
      assert.deepEqual(amounts, [1000], JSON.stringify(payments));
    });

    const failed = testResults.filter((result) => !result.ok);
    if (failed.length > 0) {
      process.exitCode = 1;
      return;
    }
  } finally {
    await cleanupTestData(createdWorkshopJobIds, createdCustomerIds, createdSaleIds);
    await prisma.$disconnect();
    await serverController.stop();
  }
};

run()
  .then(() => {
    process.exit(process.exitCode ?? 0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
