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
    "Refusing to run against non-test database URL. Set TEST_DATABASE_URL or ALLOW_NON_TEST_DB=1.",
  );
}

const safeDbUrl = DATABASE_URL.replace(
  /(postgres(?:ql)?:\/\/[^:/@]+:)[^@]+@/i,
  "$1***@",
);
console.log(`[m12-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m12-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const todayUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

const addDays = (date, days) => {
  const out = new Date(date);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
};

const formatDateOnly = (date) => date.toISOString().slice(0, 10);

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

const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": "m12-smoke-manager",
};

const STAFF_HEADERS = {
  "X-Staff-Role": "STAFF",
  "X-Staff-Id": "m12-smoke-staff",
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

let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;
const ensureMainLocationId = async () => {
  const existing = await prisma.location.findFirst({
    where: {
      code: {
        equals: "MAIN",
        mode: "insensitive",
      },
    },
    select: {
      id: true,
    },
  });
  if (existing) {
    return existing.id;
  }

  const created = await prisma.location.create({
    data: {
      name: "Main",
      code: "MAIN",
      isActive: true,
    },
    select: {
      id: true,
    },
  });
  return created.id;
};

const createOnlineBooking = async (scheduledDate) => {
  const ref = uniqueRef();
  const response = await fetchJson("/api/workshop-bookings", {
    method: "POST",
    body: JSON.stringify({
      firstName: "M12",
      lastName: "User",
      email: `m12.${ref}@example.com`,
      phone: `0777${String(ref).replace(/\D/g, "").slice(-7).padStart(7, "0")}`,
      scheduledDate,
      notes: `M12 booking ${ref}`,
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

const cleanup = async (state) => {
  const workshopJobIds = Array.from(state.workshopJobIds);
  const saleIds = Array.from(state.saleIds);
  const customerIds = Array.from(state.customerIds);
  const paymentIds = Array.from(state.paymentIds);
  const creditAccountIds = Array.from(state.creditAccountIds);
  const creditEntryIds = Array.from(state.creditEntryIds);
  const refundIds = Array.from(state.refundIds);

  if (workshopJobIds.length > 0) {
    const linkedSales = await prisma.sale.findMany({
      where: { workshopJobId: { in: workshopJobIds } },
      select: { id: true },
    });
    linkedSales.forEach((sale) => state.saleIds.add(sale.id));
  }

  if (saleIds.length > 0 || workshopJobIds.length > 0 || paymentIds.length > 0) {
    const linkedPayments = await prisma.payment.findMany({
      where: {
        OR: [
          saleIds.length > 0 ? { saleId: { in: saleIds } } : undefined,
          workshopJobIds.length > 0 ? { workshopJobId: { in: workshopJobIds } } : undefined,
          paymentIds.length > 0 ? { id: { in: paymentIds } } : undefined,
        ].filter(Boolean),
      },
      select: { id: true },
    });
    linkedPayments.forEach((payment) => state.paymentIds.add(payment.id));
  }

  const allPaymentIds = Array.from(state.paymentIds);

  if (workshopJobIds.length > 0 || refundIds.length > 0 || creditAccountIds.length > 0 || creditEntryIds.length > 0) {
    await prisma.workshopCancellation.deleteMany({
      where: {
        OR: [
          workshopJobIds.length > 0 ? { workshopJobId: { in: workshopJobIds } } : undefined,
          refundIds.length > 0 ? { paymentRefundId: { in: refundIds } } : undefined,
          creditAccountIds.length > 0 ? { creditAccountId: { in: creditAccountIds } } : undefined,
          creditEntryIds.length > 0 ? { creditLedgerEntryId: { in: creditEntryIds } } : undefined,
        ].filter(Boolean),
      },
    });
  }

  if (allPaymentIds.length > 0 || refundIds.length > 0) {
    await prisma.paymentRefund.deleteMany({
      where: {
        OR: [
          allPaymentIds.length > 0 ? { paymentId: { in: allPaymentIds } } : undefined,
          refundIds.length > 0 ? { id: { in: refundIds } } : undefined,
        ].filter(Boolean),
      },
    });
  }

  if (allPaymentIds.length > 0 || creditAccountIds.length > 0 || creditEntryIds.length > 0) {
    await prisma.creditLedgerEntry.deleteMany({
      where: {
        OR: [
          allPaymentIds.length > 0 ? { paymentId: { in: allPaymentIds } } : undefined,
          creditAccountIds.length > 0 ? { creditAccountId: { in: creditAccountIds } } : undefined,
          creditEntryIds.length > 0 ? { id: { in: creditEntryIds } } : undefined,
        ].filter(Boolean),
      },
    });
  }

  if (allPaymentIds.length > 0) {
    await prisma.payment.deleteMany({
      where: { id: { in: allPaymentIds } },
    });
  }

  const allSaleIds = Array.from(state.saleIds);
  if (allSaleIds.length > 0) {
    await prisma.saleReturnItem.deleteMany({
      where: {
        saleReturn: {
          saleId: { in: allSaleIds },
        },
      },
    });
    await prisma.saleReturn.deleteMany({
      where: { saleId: { in: allSaleIds } },
    });
    await prisma.saleItem.deleteMany({
      where: { saleId: { in: allSaleIds } },
    });
    await prisma.sale.deleteMany({
      where: { id: { in: allSaleIds } },
    });
  }

  if (workshopJobIds.length > 0) {
    await prisma.workshopJob.deleteMany({
      where: { id: { in: workshopJobIds } },
    });
  }

  if (creditAccountIds.length > 0) {
    await prisma.creditAccount.deleteMany({
      where: { id: { in: creditAccountIds } },
    });
  }

  if (customerIds.length > 0) {
    await prisma.customer.deleteMany({
      where: { id: { in: customerIds } },
    });
  }
};

const run = async () => {
  const state = {
    workshopJobIds: new Set(),
    saleIds: new Set(),
    customerIds: new Set(),
    paymentIds: new Set(),
    creditAccountIds: new Set(),
    creditEntryIds: new Set(),
    refundIds: new Set(),
  };

  let startedServer = false;
  let serverProcess = null;

  const runTest = async (name, fn, results) => {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log(`PASS ${name}`);
    } catch (error) {
      results.push({ name, ok: false, error });
      console.error(`FAIL ${name}`);
      console.error(error instanceof Error ? error.message : String(error));
    }
  };

  try {
    const existing = await serverIsHealthy();
    if (existing && process.env.ALLOW_EXISTING_SERVER !== "1") {
      throw new Error(
        "Refusing to run against an already-running server. Stop it first or set ALLOW_EXISTING_SERVER=1.",
      );
    }

    if (!existing) {
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

    const scheduledDate = formatDateOnly(addDays(todayUtc(), 35));
    const results = [];

    await runTest("cancel by manage token refunds deposit and is idempotent", async () => {
      const booking = await createOnlineBooking(scheduledDate);
      state.workshopJobIds.add(booking.id);
      state.customerIds.add(booking.customer.id);

      const pay = await payDeposit(booking.manageToken, `dep-cancel-${uniqueRef()}`);
      assert.equal(pay.status, 201, JSON.stringify(pay.json));
      state.paymentIds.add(pay.json.payment.id);

      const cancel1 = await fetchJson(`/api/workshop-bookings/manage/${booking.manageToken}/cancel`, {
        method: "POST",
        headers: MANAGER_HEADERS,
        body: JSON.stringify({
          outcome: "REFUND_DEPOSIT",
          notes: "test cancel refund",
          idempotencyKey: `cancel-${uniqueRef()}`,
        }),
      });
      assert.equal(cancel1.status, 201, JSON.stringify(cancel1.json));
      assert.equal(cancel1.json.cancellation.outcome, "REFUND_DEPOSIT");
      assert.equal(cancel1.json.refund.amountPence, 1000);
      state.refundIds.add(cancel1.json.refund.id);

      const cancel2 = await fetchJson(`/api/workshop-bookings/manage/${booking.manageToken}/cancel`, {
        method: "POST",
        headers: MANAGER_HEADERS,
        body: JSON.stringify({
          outcome: "REFUND_DEPOSIT",
          notes: "replay",
        }),
      });
      assert.equal(cancel2.status, 200, JSON.stringify(cancel2.json));
      assert.equal(cancel2.json.idempotent, true);
      assert.equal(cancel2.json.cancellation.id, cancel1.json.cancellation.id);
    }, results);

    await runTest("cancel convert-to-credit creates credit balance", async () => {
      const booking = await createOnlineBooking(scheduledDate);
      state.workshopJobIds.add(booking.id);
      state.customerIds.add(booking.customer.id);

      const pay = await payDeposit(booking.manageToken, `dep-credit-${uniqueRef()}`);
      assert.equal(pay.status, 201, JSON.stringify(pay.json));
      state.paymentIds.add(pay.json.payment.id);

      const cancel = await fetchJson(`/api/workshop-bookings/manage/${booking.manageToken}/cancel`, {
        method: "POST",
        headers: MANAGER_HEADERS,
        body: JSON.stringify({
          outcome: "CONVERT_TO_CREDIT",
          notes: "convert deposit to credit",
          idempotencyKey: `cancel-credit-${uniqueRef()}`,
        }),
      });
      assert.equal(cancel.status, 201, JSON.stringify(cancel.json));
      assert.equal(cancel.json.credit.amountPence, 1000);
      state.creditAccountIds.add(cancel.json.credit.accountId);
      state.creditEntryIds.add(cancel.json.credit.entryId);

      const balance = await fetchJson(
        `/api/credits/balance?email=${encodeURIComponent(booking.customer.email)}&phone=${encodeURIComponent(booking.customer.phone)}`,
        { headers: MANAGER_HEADERS },
      );
      assert.equal(balance.status, 200, JSON.stringify(balance.json));
      assert.ok(balance.json.balancePence >= 1000, JSON.stringify(balance.json));
    }, results);

    await runTest("payment refund endpoint supports idempotency and over-refund protection", async () => {
      const booking = await createOnlineBooking(scheduledDate);
      state.workshopJobIds.add(booking.id);
      state.customerIds.add(booking.customer.id);

      const deposit = await payDeposit(booking.manageToken, `dep-checkout-${uniqueRef()}`);
      assert.equal(deposit.status, 201, JSON.stringify(deposit.json));
      state.paymentIds.add(deposit.json.payment.id);

      const checkout = await checkoutWorkshopJob(booking.id, {
        saleTotalPence: 6999,
        paymentMethod: "CARD",
        amountPence: 5999,
        providerRef: `final-${uniqueRef()}`,
      });
      assert.equal(checkout.status, 201, JSON.stringify(checkout.json));
      state.saleIds.add(checkout.json.sale.id);
      state.paymentIds.add(checkout.json.payment.id);

      const refund1 = await fetchJson(`/api/payments/${checkout.json.payment.id}/refund`, {
        method: "POST",
        headers: MANAGER_HEADERS,
        body: JSON.stringify({
          amountPence: 2000,
          reason: "partial refund",
          idempotencyKey: "m12-refund-1",
        }),
      });
      assert.equal(refund1.status, 201, JSON.stringify(refund1.json));
      state.refundIds.add(refund1.json.refund.id);

      const refundReplay = await fetchJson(`/api/payments/${checkout.json.payment.id}/refund`, {
        method: "POST",
        headers: MANAGER_HEADERS,
        body: JSON.stringify({
          amountPence: 2000,
          reason: "partial refund replay",
          idempotencyKey: "m12-refund-1",
        }),
      });
      assert.equal(refundReplay.status, 200, JSON.stringify(refundReplay.json));
      assert.equal(refundReplay.json.refund.id, refund1.json.refund.id);

      const refundTooMuch = await fetchJson(`/api/payments/${checkout.json.payment.id}/refund`, {
        method: "POST",
        headers: MANAGER_HEADERS,
        body: JSON.stringify({
          amountPence: 5000,
          reason: "too much",
        }),
      });
      assert.equal(refundTooMuch.status, 409, JSON.stringify(refundTooMuch.json));
      assert.equal(refundTooMuch.json.error.code, "REFUND_EXCEEDS_PAYMENT");

      const paymentDetail = await fetchJson(`/api/payments/${checkout.json.payment.id}`, {
        headers: MANAGER_HEADERS,
      });
      assert.equal(paymentDetail.status, 200, JSON.stringify(paymentDetail.json));
      assert.equal(paymentDetail.json.payment.id, checkout.json.payment.id);
      assert.ok(Array.isArray(paymentDetail.json.refunds), JSON.stringify(paymentDetail.json));
      assert.equal(paymentDetail.json.refunds.length, 1, JSON.stringify(paymentDetail.json));
      assert.equal(paymentDetail.json.refunds[0].amountPence, 2000, JSON.stringify(paymentDetail.json));
    }, results);

    await runTest("credit issue + apply clamps to outstanding and supports idempotency", async () => {
      const identityRef = uniqueRef();
      const email = `credit.${identityRef}@example.com`;
      const phone = `0766${String(identityRef).replace(/\\D/g, "").slice(-7).padStart(7, "0")}`;

      const issue = await fetchJson("/api/credits/issue", {
        method: "POST",
        headers: MANAGER_HEADERS,
        body: JSON.stringify({
          email,
          phone,
          amountPence: 1500,
          notes: "manual credit",
          idempotencyKey: `issue-${identityRef}`,
        }),
      });
      assert.equal(issue.status, 201, JSON.stringify(issue.json));
      state.creditAccountIds.add(issue.json.creditAccount.id);
      state.creditEntryIds.add(issue.json.entry.id);
      state.paymentIds.add(issue.json.payment.id);

      const customer = await prisma.customer.create({
        data: {
          firstName: "Credit",
          lastName: "Apply",
          email,
          phone,
        },
      });
      state.customerIds.add(customer.id);
      const locationId = await ensureMainLocationId();

      const job = await prisma.workshopJob.create({
        data: {
          locationId,
          customerId: customer.id,
          status: "BOOKING_MADE",
          source: "IN_STORE",
          scheduledDate: addDays(todayUtc(), 36),
          depositStatus: "NOT_REQUIRED",
          depositRequiredPence: 0,
          notes: `credit apply ${identityRef}`,
        },
      });
      state.workshopJobIds.add(job.id);

      const checkout = await checkoutWorkshopJob(job.id, {
        saleTotalPence: 1200,
      });
      assert.equal(checkout.status, 201, JSON.stringify(checkout.json));
      state.saleIds.add(checkout.json.sale.id);

      const apply1 = await fetchJson("/api/credits/apply", {
        method: "POST",
        headers: MANAGER_HEADERS,
        body: JSON.stringify({
          saleId: checkout.json.sale.id,
          email,
          phone,
          amountPence: 2000,
          idempotencyKey: `apply-${identityRef}`,
        }),
      });
      assert.equal(apply1.status, 201, JSON.stringify(apply1.json));
      assert.equal(apply1.json.appliedPence, 1200);
      assert.equal(apply1.json.outstandingPence, 0);
      state.creditEntryIds.add(apply1.json.entry.id);
      state.paymentIds.add(apply1.json.payment.id);

      const applyReplay = await fetchJson("/api/credits/apply", {
        method: "POST",
        headers: MANAGER_HEADERS,
        body: JSON.stringify({
          saleId: checkout.json.sale.id,
          email,
          phone,
          amountPence: 2000,
          idempotencyKey: `apply-${identityRef}`,
        }),
      });
      assert.equal(applyReplay.status, 200, JSON.stringify(applyReplay.json));
      assert.equal(applyReplay.json.entry.id, apply1.json.entry.id);

      const balance = await fetchJson(
        `/api/credits/balance?email=${encodeURIComponent(email)}&phone=${encodeURIComponent(phone)}`,
        { headers: MANAGER_HEADERS },
      );
      assert.equal(balance.status, 200, JSON.stringify(balance.json));
      assert.equal(balance.json.balancePence, 300);
    }, results);

    await runTest("workshop report endpoints return dashboard JSON", async () => {
      const from = formatDateOnly(addDays(todayUtc(), -1));
      const to = formatDateOnly(addDays(todayUtc(), 2));

      const payments = await fetchJson(
        `/api/reports/workshop/payments?from=${from}&to=${to}`,
        { headers: MANAGER_HEADERS },
      );
      assert.equal(payments.status, 200, JSON.stringify(payments.json));
      assert.ok(Array.isArray(payments.json.totals), JSON.stringify(payments.json));

      const deposits = await fetchJson(
        `/api/reports/workshop/deposits?from=${from}&to=${to}`,
        { headers: MANAGER_HEADERS },
      );
      assert.equal(deposits.status, 200, JSON.stringify(deposits.json));
      assert.ok(typeof deposits.json.required?.count === "number", JSON.stringify(deposits.json));

      const credits = await fetchJson(
        `/api/reports/workshop/credits?from=${from}&to=${to}`,
        { headers: MANAGER_HEADERS },
      );
      assert.equal(credits.status, 200, JSON.stringify(credits.json));
      assert.ok(typeof credits.json.netPence === "number", JSON.stringify(credits.json));
    }, results);

    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await cleanup(state);
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
