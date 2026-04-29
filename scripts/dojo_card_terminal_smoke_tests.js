#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { createSmokeServerController } = require("./smoke_server_helper");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3100";
const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const DOJO_TEST_TERMINAL_ID = "dojo-smoke-terminal";

if (!DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
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
console.log(`[dojo-card-terminal-smoke] BASE_URL=${BASE_URL}`);
console.log(`[dojo-card-terminal-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});
const serverController = createSmokeServerController({
  label: "dojo-card-terminal-smoke",
  baseUrl: BASE_URL,
  databaseUrl: DATABASE_URL,
  captureStartupLog: true,
  envOverrides: {
    DOJO_MOCK_MODE: "1",
    DOJO_DEFAULT_TERMINAL_ID: DOJO_TEST_TERMINAL_ID,
    DOJO_TERMINAL_B_ID: "dojo-smoke-terminal-b",
    COREPOS_TILL_POINT_IP_HINTS: "TILL_2=127.0.0.1",
  },
});

let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;

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

const cleanup = async (state) => {
  const saleIds = Array.from(state.saleIds);
  const userIds = Array.from(state.userIds);
  const locationIds = Array.from(state.locationIds);

  if (saleIds.length > 0) {
    await prisma.cardTerminalSession.deleteMany({
      where: { saleId: { in: saleIds } },
    });
    await prisma.paymentIntent.deleteMany({
      where: { saleId: { in: saleIds } },
    });
    await prisma.payment.deleteMany({
      where: { saleId: { in: saleIds } },
    });
    await prisma.saleTender.deleteMany({
      where: { saleId: { in: saleIds } },
    });
    await prisma.sale.deleteMany({
      where: { id: { in: saleIds } },
    });
  }

  if (locationIds.length > 0) {
    await prisma.location.deleteMany({
      where: { id: { in: locationIds } },
    });
  }

  if (userIds.length > 0) {
    await prisma.user.deleteMany({
      where: { id: { in: userIds } },
    });
  }
};

const createDraftSale = async (state, input) => {
  const sale = await prisma.sale.create({
    data: {
      locationId: input.locationId,
      subtotalPence: input.amountPence,
      taxPence: 0,
      totalPence: input.amountPence,
      createdByStaffId: input.staffId,
    },
  });
  state.saleIds.add(sale.id);
  return sale;
};

const run = async () => {
  const state = {
    saleIds: new Set(),
    userIds: new Set(),
    locationIds: new Set(),
  };

  try {
    await serverController.startIfNeeded();

    const token = uniqueRef();
    const staff = await prisma.user.create({
      data: {
        username: `dojo-card-staff-${token}`,
        passwordHash: "dojo-card-smoke",
        role: "STAFF",
      },
    });
    state.userIds.add(staff.id);

    const location = await prisma.location.create({
      data: {
        name: `Dojo Card Smoke ${token}`,
        code: `DOJO_${token.slice(-8)}`,
      },
    });
    state.locationIds.add(location.id);

    const staffHeaders = {
      "X-Staff-Role": "STAFF",
      "X-Staff-Id": staff.id,
    };

    const configRes = await fetchJson("/api/payments/terminal-config", {
      headers: staffHeaders,
    });
    assert.equal(configRes.status, 200, JSON.stringify(configRes.json));
    assert.equal(configRes.json.config.provider, "DOJO");
    assert.equal(configRes.json.config.enabled, true);
    assert.equal(configRes.json.config.configured, true);
    assert.equal(configRes.json.config.mockMode, true);
    assert.equal(configRes.json.config.terminalRoutes[0].routeId, "TERMINAL_A");
    assert.equal(configRes.json.config.terminalRoutes[0].terminalId, DOJO_TEST_TERMINAL_ID);
    assert.equal(configRes.json.config.terminalRoutes[1].routeId, "TERMINAL_B");
    assert.equal(configRes.json.config.terminalRoutes[1].terminalId, "dojo-smoke-terminal-b");
    assert.equal(configRes.json.config.workstationHint.suggestedTillPointId, "TILL_2");

    const terminalsRes = await fetchJson("/api/payments/terminals", {
      headers: staffHeaders,
    });
    assert.equal(terminalsRes.status, 200, JSON.stringify(terminalsRes.json));
    assert.equal(terminalsRes.json.terminals[0].terminalId, DOJO_TEST_TERMINAL_ID);
    assert.equal(terminalsRes.json.terminals[1].terminalId, "dojo-smoke-terminal-b");

    const sale = await createDraftSale(state, {
      locationId: location.id,
      staffId: staff.id,
      amountPence: 1299,
    });

    const startRes = await fetchJson("/api/payments/terminal-sessions", {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        saleId: sale.id,
        amountPence: 1299,
        terminalId: DOJO_TEST_TERMINAL_ID,
      }),
    });
    assert.equal(startRes.status, 201, JSON.stringify(startRes.json));
    assert.equal(startRes.json.session.status, "INITIATED");
    assert.equal(startRes.json.session.amountPence, 1299);
    assert.ok(startRes.json.session.corePaymentIntentId);

    const captureRes = await fetchJson(`/api/payments/terminal-sessions/${startRes.json.session.id}`, {
      headers: staffHeaders,
    });
    assert.equal(captureRes.status, 200, JSON.stringify(captureRes.json));
    assert.equal(captureRes.json.session.status, "CAPTURED");
    assert.equal(captureRes.json.session.isFinal, true);
    assert.ok(captureRes.json.session.saleTenderId);

    const completedSale = await prisma.sale.findUnique({
      where: { id: sale.id },
      select: { completedAt: true, changeDuePence: true },
    });
    assert.ok(completedSale?.completedAt);
    assert.equal(completedSale.changeDuePence, 0);

    const capturedIntent = await prisma.paymentIntent.findUnique({
      where: { id: startRes.json.session.corePaymentIntentId },
      select: { status: true, externalRef: true },
    });
    assert.equal(capturedIntent?.status, "CAPTURED");
    assert.ok(capturedIntent.externalRef?.startsWith("pi_mock_"));

    const tenderCount = await prisma.saleTender.count({
      where: { saleId: sale.id, method: "CARD", amountPence: 1299 },
    });
    assert.equal(tenderCount, 1);

    const paymentCount = await prisma.payment.count({
      where: { saleId: sale.id, method: "CARD", amountPence: 1299 },
    });
    assert.equal(paymentCount, 1);

    const replayRes = await fetchJson(`/api/payments/terminal-sessions/${startRes.json.session.id}`, {
      headers: staffHeaders,
    });
    assert.equal(replayRes.status, 200, JSON.stringify(replayRes.json));
    assert.equal(replayRes.json.session.status, "CAPTURED");
    assert.equal(
      await prisma.saleTender.count({ where: { saleId: sale.id, method: "CARD" } }),
      1,
    );

    const canceledSale = await createDraftSale(state, {
      locationId: location.id,
      staffId: staff.id,
      amountPence: 550,
    });
    const cancelStartRes = await fetchJson("/api/payments/terminal-sessions", {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        saleId: canceledSale.id,
        amountPence: 550,
        terminalId: DOJO_TEST_TERMINAL_ID,
      }),
    });
    assert.equal(cancelStartRes.status, 201, JSON.stringify(cancelStartRes.json));

    const cancelRes = await fetchJson(
      `/api/payments/terminal-sessions/${cancelStartRes.json.session.id}/cancel`,
      {
        method: "POST",
        headers: staffHeaders,
        body: JSON.stringify({}),
      },
    );
    assert.equal(cancelRes.status, 200, JSON.stringify(cancelRes.json));
    assert.equal(cancelRes.json.session.status, "CANCELED");

    const canceledIntent = await prisma.paymentIntent.findUnique({
      where: { id: cancelStartRes.json.session.corePaymentIntentId },
      select: { status: true },
    });
    assert.equal(canceledIntent?.status, "CANCELED");

    console.log("[dojo-card-terminal-smoke] passed");
  } finally {
    await cleanup(state).catch((error) => {
      console.error("[dojo-card-terminal-smoke] cleanup failed", error);
    });
    await prisma.$disconnect();
    await serverController.stop();
  }
};

run().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect().catch(() => undefined);
  await serverController.stop().catch(() => undefined);
  process.exit(1);
});
