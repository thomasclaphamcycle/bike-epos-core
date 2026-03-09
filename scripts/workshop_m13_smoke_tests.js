#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { ensureMainLocationId } = require("./default_location_helper");

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
console.log(`[m13-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m13-smoke] DATABASE_URL=${safeDbUrl}`);

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

let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;

const RUN_REF = uniqueRef();
const STAFF_ACTOR_ID = `m13-smoke-staff-${RUN_REF}`;
const MANAGER_ACTOR_ID = `m13-smoke-manager-${RUN_REF}`;
const STAFF_HEADERS = {
  "X-Staff-Role": "STAFF",
  "X-Staff-Id": STAFF_ACTOR_ID,
};
const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": MANAGER_ACTOR_ID,
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
  for (let i = 0; i < 60; i++) {
    if (await serverIsHealthy()) {
      return;
    }
    await sleep(500);
  }
  throw new Error("Server did not become healthy on /health");
};

const createOnlineBooking = async (scheduledDate) => {
  const ref = uniqueRef();
  const response = await fetchJson("/api/workshop-bookings", {
    method: "POST",
    body: JSON.stringify({
      firstName: "M13",
      lastName: "Customer",
      email: `m13.${ref}@example.com`,
      phone: `0755${String(ref).replace(/\D/g, "").slice(-7).padStart(7, "0")}`,
      scheduledDate,
      notes: `m13 booking ${ref}`,
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
    headers: STAFF_HEADERS,
    body: JSON.stringify({
      method: "CARD",
      providerRef,
    }),
  });
};

const checkoutWorkshopJob = async (jobId, payload, headers = STAFF_HEADERS) => {
  return fetchJson(`/api/workshop/jobs/${jobId}/checkout`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
};

const getAuditForEntity = async (entityType, entityId) => {
  return fetchJson(
    `/api/audit?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}&limit=200`,
    {
      headers: MANAGER_HEADERS,
    },
  );
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
  const allSaleIds = Array.from(state.saleIds);

  await prisma.auditEvent.deleteMany({
    where: {
      actorId: { in: [STAFF_ACTOR_ID, MANAGER_ACTOR_ID] },
    },
  });

  if (
    workshopJobIds.length > 0 ||
    refundIds.length > 0 ||
    creditAccountIds.length > 0 ||
    creditEntryIds.length > 0
  ) {
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

    const results = [];
    const baseDate = todayUtc();

    await runTest("dashboard returns list + summary with filters", async () => {
      const booking = await createOnlineBooking(formatDateOnly(addDays(baseDate, 40)));
      state.workshopJobIds.add(booking.id);
      state.customerIds.add(booking.customer.id);

      const customer = await prisma.customer.create({
        data: {
          firstName: "Dash",
          lastName: "Board",
          email: `dashboard.${uniqueRef()}@example.com`,
          phone: `0744${String(uniqueRef()).replace(/\D/g, "").slice(-7).padStart(7, "0")}`,
        },
      });
      state.customerIds.add(customer.id);
      const locationId = await ensureMainLocationId(prisma);

      const inStoreJob = await prisma.workshopJob.create({
        data: {
          customerId: customer.id,
          locationId,
          status: "BIKE_READY",
          source: "IN_STORE",
          scheduledDate: addDays(baseDate, 41),
          depositStatus: "NOT_REQUIRED",
          depositRequiredPence: 0,
          notes: "dashboard filter check",
        },
      });
      state.workshopJobIds.add(inStoreJob.id);

      const dashboard = await fetchJson(
        "/api/workshop/dashboard?status=BOOKING_MADE,BIKE_READY&source=ONLINE,IN_STORE&limit=50",
        { headers: STAFF_HEADERS },
      );
      assert.equal(dashboard.status, 200, JSON.stringify(dashboard.json));
      assert.ok(Array.isArray(dashboard.json.jobs), JSON.stringify(dashboard.json));
      assert.ok(typeof dashboard.json.summary.totalJobs === "number", JSON.stringify(dashboard.json));

      const readyOnly = await fetchJson("/api/workshop/dashboard?status=BIKE_READY&limit=50", {
        headers: STAFF_HEADERS,
      });
      assert.equal(readyOnly.status, 200, JSON.stringify(readyOnly.json));
      assert.ok(
        readyOnly.json.jobs.every((job) => job.status === "BIKE_READY"),
        JSON.stringify(readyOnly.json),
      );
    }, results);

    await runTest("permission checks enforce MANAGER+ on restricted money endpoints", async () => {
      const booking = await createOnlineBooking(formatDateOnly(addDays(baseDate, 42)));
      state.workshopJobIds.add(booking.id);
      state.customerIds.add(booking.customer.id);

      const deposit = await payDeposit(booking.manageToken, `m13-dep-${uniqueRef()}`);
      assert.equal(deposit.status, 201, JSON.stringify(deposit.json));
      state.paymentIds.add(deposit.json.payment.id);

      const checkout = await checkoutWorkshopJob(booking.id, {
        saleTotalPence: 6999,
        paymentMethod: "CARD",
        amountPence: 5999,
        providerRef: `m13-final-${uniqueRef()}`,
      });
      assert.equal(checkout.status, 201, JSON.stringify(checkout.json));
      state.saleIds.add(checkout.json.sale.id);
      state.paymentIds.add(checkout.json.payment.id);

      const refundAsStaff = await fetchJson(`/api/payments/${checkout.json.payment.id}/refund`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          amountPence: 500,
          reason: "not allowed for staff",
          idempotencyKey: `m13-staff-refund-${uniqueRef()}`,
        }),
      });
      assert.equal(refundAsStaff.status, 403, JSON.stringify(refundAsStaff.json));
      assert.equal(refundAsStaff.json.error.code, "INSUFFICIENT_ROLE");

      const issueAsStaff = await fetchJson("/api/credits/issue", {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          email: `staff.blocked.${uniqueRef()}@example.com`,
          phone: "07000000001",
          amountPence: 1000,
          idempotencyKey: `m13-staff-credit-${uniqueRef()}`,
        }),
      });
      assert.equal(issueAsStaff.status, 403, JSON.stringify(issueAsStaff.json));
      assert.equal(issueAsStaff.json.error.code, "INSUFFICIENT_ROLE");

      const applyAsStaff = await fetchJson("/api/credits/apply", {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          saleId: checkout.json.sale.id,
          amountPence: 100,
          idempotencyKey: `m13-staff-apply-${uniqueRef()}`,
        }),
      });
      assert.equal(applyAsStaff.status, 403, JSON.stringify(applyAsStaff.json));
      assert.equal(applyAsStaff.json.error.code, "INSUFFICIENT_ROLE");

      const cancelRefundAsStaff = await fetchJson(
        `/api/workshop-bookings/manage/${booking.manageToken}/cancel`,
        {
          method: "POST",
          headers: STAFF_HEADERS,
          body: JSON.stringify({
            outcome: "REFUND_DEPOSIT",
            idempotencyKey: `m13-staff-cancel-refund-${uniqueRef()}`,
          }),
        },
      );
      assert.equal(cancelRefundAsStaff.status, 403, JSON.stringify(cancelRefundAsStaff.json));
      assert.equal(cancelRefundAsStaff.json.error.code, "INSUFFICIENT_ROLE");
    }, results);

    await runTest("status transitions and audit events are written for checkout/cancel/refund", async () => {
      const customer = await prisma.customer.create({
        data: {
          firstName: "Ops",
          lastName: "User",
          email: `ops.${uniqueRef()}@example.com`,
          phone: `0733${String(uniqueRef()).replace(/\D/g, "").slice(-7).padStart(7, "0")}`,
        },
      });
      state.customerIds.add(customer.id);
      const locationId = await ensureMainLocationId(prisma);

      const job = await prisma.workshopJob.create({
        data: {
          customerId: customer.id,
          locationId,
          status: "BOOKING_MADE",
          source: "IN_STORE",
          scheduledDate: addDays(baseDate, 43),
          depositStatus: "NOT_REQUIRED",
          depositRequiredPence: 0,
          notes: "m13 checkout transition",
        },
      });
      state.workshopJobIds.add(job.id);

      const checkout = await checkoutWorkshopJob(job.id, {
        saleTotalPence: 2000,
        paymentMethod: "CASH",
        amountPence: 2000,
        providerRef: `m13-cash-${uniqueRef()}`,
      });
      assert.equal(checkout.status, 201, JSON.stringify(checkout.json));
      state.saleIds.add(checkout.json.sale.id);
      state.paymentIds.add(checkout.json.payment.id);

      const jobAfterCheckout = await prisma.workshopJob.findUnique({ where: { id: job.id } });
      assert.equal(jobAfterCheckout?.status, "COMPLETED");

      const refund = await fetchJson(`/api/payments/${checkout.json.payment.id}/refund`, {
        method: "POST",
        headers: MANAGER_HEADERS,
        body: JSON.stringify({
          amountPence: 300,
          reason: "m13 refund",
          idempotencyKey: `m13-refund-${uniqueRef()}`,
        }),
      });
      assert.equal(refund.status, 201, JSON.stringify(refund.json));
      state.refundIds.add(refund.json.refund.id);

      const checkoutAudit = await getAuditForEntity("WORKSHOP_JOB", job.id);
      assert.equal(checkoutAudit.status, 200, JSON.stringify(checkoutAudit.json));
      assert.ok(
        checkoutAudit.json.events.some((event) => event.action === "WORKSHOP_CHECKOUT_COMPLETED"),
        JSON.stringify(checkoutAudit.json),
      );

      const refundAudit = await getAuditForEntity("PAYMENT", checkout.json.payment.id);
      assert.equal(refundAudit.status, 200, JSON.stringify(refundAudit.json));
      assert.ok(
        refundAudit.json.events.some((event) => event.action === "PAYMENT_REFUNDED"),
        JSON.stringify(refundAudit.json),
      );

      const booking = await createOnlineBooking(formatDateOnly(addDays(baseDate, 44)));
      state.workshopJobIds.add(booking.id);
      state.customerIds.add(booking.customer.id);

      const dep = await payDeposit(booking.manageToken, `m13-cancel-${uniqueRef()}`);
      assert.equal(dep.status, 201, JSON.stringify(dep.json));
      state.paymentIds.add(dep.json.payment.id);

      const cancel = await fetchJson(`/api/workshop-bookings/manage/${booking.manageToken}/cancel`, {
        method: "POST",
        headers: MANAGER_HEADERS,
        body: JSON.stringify({
          outcome: "REFUND_DEPOSIT",
          idempotencyKey: `m13-cancel-${uniqueRef()}`,
        }),
      });
      assert.equal(cancel.status, 201, JSON.stringify(cancel.json));
      state.refundIds.add(cancel.json.refund.id);

      const cancelledJob = await prisma.workshopJob.findUnique({ where: { id: booking.id } });
      assert.equal(cancelledJob?.status, "CANCELLED");

      const cancellationAudit = await getAuditForEntity("WORKSHOP_JOB", booking.id);
      assert.equal(cancellationAudit.status, 200, JSON.stringify(cancellationAudit.json));
      assert.ok(
        cancellationAudit.json.events.some((event) => event.action === "WORKSHOP_CANCELLED"),
        JSON.stringify(cancellationAudit.json),
      );
    }, results);

    await runTest("audit endpoint supports date queries", async () => {
      const today = formatDateOnly(todayUtc());
      const audit = await fetchJson(`/api/audit?from=${today}&to=${today}&limit=200`, {
        headers: MANAGER_HEADERS,
      });
      assert.equal(audit.status, 200, JSON.stringify(audit.json));
      assert.ok(Array.isArray(audit.json.events), JSON.stringify(audit.json));
      assert.ok(
        audit.json.events.some(
          (event) => event.actorId === STAFF_ACTOR_ID || event.actorId === MANAGER_ACTOR_ID,
        ),
        JSON.stringify(audit.json),
      );
    }, results);

    const failed = results.filter((result) => !result.ok);
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
