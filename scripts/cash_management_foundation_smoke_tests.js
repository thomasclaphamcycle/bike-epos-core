#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3100";
const RUN_REF = `cash-foundation-${Date.now()}`;
const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": `${RUN_REF}-manager`,
};

const ONE_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Yw4n0kAAAAASUVORK5CYII=";

const fetchJson = async (path, init = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, init);
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, json };
};

const closeAnyOpenSession = async () => {
  const current = await fetchJson("/api/management/cash/register/current", {
    headers: MANAGER_HEADERS,
  });

  if (current.status !== 200) {
    throw new Error(`Unexpected current-session status ${current.status}`);
  }
  if (!current.json.session) {
    return;
  }

  const counted = current.json.totals?.expectedCashPence ?? 0;
  const close = await fetchJson("/api/management/cash/register/close", {
    method: "POST",
    headers: {
      ...MANAGER_HEADERS,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ countedAmountPence: counted, notes: "Pre-test cleanup" }),
  });

  assert.ok(close.status === 200 || close.status === 201);
};

const main = async () => {
  await closeAnyOpenSession();

  const opened = await fetchJson("/api/management/cash/register/open", {
    method: "POST",
    headers: {
      ...MANAGER_HEADERS,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ openingFloatPence: 10000 }),
  });
  assert.equal(opened.status, 201);
  assert.equal(opened.json.session.status, "OPEN");
  assert.equal(opened.json.totals.expectedCashPence, 10000);

  const current = await fetchJson("/api/management/cash/register/current", {
    headers: MANAGER_HEADERS,
  });
  assert.equal(current.status, 200);
  assert.equal(current.json.session.id, opened.json.session.id);

  const pettyExpense = await fetchJson("/api/management/cash/movements", {
    method: "POST",
    headers: {
      ...MANAGER_HEADERS,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "CASH_OUT",
      amountPence: 1250,
      reason: "PETTY_EXPENSE",
      notes: "Milk and biscuits",
    }),
  });
  assert.equal(pettyExpense.status, 201);
  assert.equal(pettyExpense.json.movement.reason, "PETTY_EXPENSE");
  assert.equal(pettyExpense.json.summary.totals.expectedCashPence, 8750);

  const noReason = await fetchJson("/api/management/cash/movements", {
    method: "POST",
    headers: {
      ...MANAGER_HEADERS,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "CASH_OUT",
      amountPence: 100,
    }),
  });
  assert.equal(noReason.status, 400);

  const token = await fetchJson(`/api/management/cash/movements/${encodeURIComponent(pettyExpense.json.movement.id)}/receipt-token`, {
    method: "POST",
    headers: MANAGER_HEADERS,
  });
  assert.equal(token.status, 201);
  assert.ok(typeof token.json.token === "string");

  const replacementToken = await fetchJson(`/api/management/cash/movements/${encodeURIComponent(pettyExpense.json.movement.id)}/receipt-token`, {
    method: "POST",
    headers: MANAGER_HEADERS,
  });
  assert.equal(replacementToken.status, 201);
  assert.ok(typeof replacementToken.json.token === "string");
  assert.notEqual(replacementToken.json.token, token.json.token);

  const invalidated = await fetchJson(`/api/public/receipt-upload/${encodeURIComponent(token.json.token)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      imageDataUrl: ONE_PIXEL_PNG,
    }),
  });
  assert.equal(invalidated.status, 410);

  const [uploaded, raced] = await Promise.all([
    fetchJson(`/api/public/receipt-upload/${encodeURIComponent(replacementToken.json.token)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        imageDataUrl: ONE_PIXEL_PNG,
      }),
    }),
    fetchJson(`/api/public/receipt-upload/${encodeURIComponent(replacementToken.json.token)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        imageDataUrl: ONE_PIXEL_PNG,
      }),
    }),
  ]);

  const uploadStatuses = [uploaded.status, raced.status].sort((left, right) => left - right);
  assert.deepEqual(uploadStatuses, [201, 409]);
  const successfulUpload = uploaded.status === 201 ? uploaded : raced;
  assert.ok(String(successfulUpload.json.receiptImageUrl).startsWith("/uploads/cash-receipts/"));

  const movements = await fetchJson("/api/management/cash/movements", {
    headers: MANAGER_HEADERS,
  });
  assert.equal(movements.status, 200);
  const uploadedMovement = movements.json.movements.find((row) => row.id === pettyExpense.json.movement.id);
  assert.ok(uploadedMovement);
  assert.ok(uploadedMovement.receiptImageUrl);

  const closed = await fetchJson("/api/management/cash/register/close", {
    method: "POST",
    headers: {
      ...MANAGER_HEADERS,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      countedAmountPence: 8700,
      notes: "Blind close smoke",
    }),
  });
  assert.equal(closed.status, 201);
  assert.equal(closed.json.session.status, "CLOSED");
  assert.equal(closed.json.totals.expectedCashPence, 8750);
  assert.equal(closed.json.totals.countedCashPence, 8700);
  assert.equal(closed.json.totals.variancePence, -50);

  const history = await fetchJson("/api/management/cash/register/history", {
    headers: MANAGER_HEADERS,
  });
  assert.equal(history.status, 200);
  assert.ok(Array.isArray(history.json.sessions));
  assert.ok(history.json.sessions.find((row) => row.id === opened.json.session.id));

  console.log("[cash-management-foundation] passed");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
