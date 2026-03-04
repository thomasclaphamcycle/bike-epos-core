#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const fetchJson = async (path, options = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, {
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

const serverIsHealthy = async () => {
  try {
    const response = await fetch(HEALTH_URL);
    return response.ok;
  } catch {
    return false;
  }
};

const waitForServer = async () => {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await serverIsHealthy()) {
      return;
    }
    await sleep(500);
  }
  throw new Error("Server did not become healthy on /health");
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
  let startedServer = false;
  let serverProcess = null;
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

      serverProcess.stdout.on("data", () => {});
      serverProcess.stderr.on("data", () => {});
      startedServer = true;
      await waitForServer();
    }

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

      const job = await prisma.workshopJob.create({
        data: {
          customerId: customer.id,
          status: "BOOKING_MADE",
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
        paymentMethod: "CASH",
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
    if (startedServer && serverProcess) {
      serverProcess.kill("SIGTERM");
    }
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
