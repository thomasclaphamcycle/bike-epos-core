#!/usr/bin/env node
require("dotenv").config({ path: ".env.test" });

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createSmokeServerController } = require("./smoke_server_helper");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3100";
const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (process.env.NODE_ENV !== "test") {
  throw new Error("Refusing to run: NODE_ENV must be 'test'.");
}

if (DATABASE_URL && process.env.ALLOW_NON_TEST_DB !== "1") {
  const lowered = DATABASE_URL.toLowerCase();
  if (!lowered.includes("test")) {
    throw new Error(
      "Refusing to run against non-test DATABASE_URL. Set ALLOW_NON_TEST_DB=1 to override.",
    );
  }
}

const roleActorIds = {
  STAFF: randomUUID(),
  MANAGER: randomUUID(),
  ADMIN: randomUUID(),
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
    // Ignore malformed URL handling here; the primary URL will surface the failure.
  }

  return urls;
})();

const serverController = createSmokeServerController({
  label: "security-smoke",
  baseUrls: appBaseUrlCandidates,
  databaseUrl: DATABASE_URL,
  captureStartupLog: true,
  startupReadyPattern: /Server running on http:\/\/localhost:\d+/i,
});

const headersWithRole = (role) => ({
  "X-Staff-Role": role,
  "X-Staff-Id": roleActorIds[role] ?? randomUUID(),
});

const isAuthRejected = (status) => status === 401 || status === 403;
const REPORT_RANGE_QUERY = "?from=2026-01-01&to=2026-12-31";

const request = async ({ path, method = "GET", headers = {}, body }) => {
  const response = await fetch(`${serverController.getBaseUrl()}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return { status: response.status, text, json, headers: response.headers };
};

const expectStatus = (name, result, expectedStatuses) => {
  const statuses = Array.isArray(expectedStatuses) ? expectedStatuses : [expectedStatuses];
  assert.ok(
    statuses.includes(result.status),
    `${name} expected ${statuses.join(" or ")}, got ${result.status}. Body: ${result.text}`,
  );
};

const expectAuthRejected = (name, result) => {
  assert.ok(
    isAuthRejected(result.status),
    `${name} expected auth rejection (401/403), got ${result.status}. Body: ${result.text}`,
  );
};

const createFixtures = async () => {
  const staffHeaders = headersWithRole("STAFF");
  const suffix = Date.now();

  const customerResponse = await request({
    path: "/api/customers",
    method: "POST",
    headers: staffHeaders,
    body: {
      name: `Security Customer ${suffix}`,
      email: `security.${suffix}@example.com`,
      phone: `+44-000-${suffix.toString().slice(-4)}`,
    },
  });
  expectStatus("create customer fixture", customerResponse, 201);
  const customerId = customerResponse.json?.id;
  assert.ok(customerId, "Expected customer id from fixture create");

  const workshopResponse = await request({
    path: "/api/workshop/jobs",
    method: "POST",
    headers: staffHeaders,
    body: {
      customerName: `Security Customer ${suffix}`,
      bikeDescription: "Security fixture bike",
      notes: "security test fixture",
    },
  });
  expectStatus("create workshop fixture", workshopResponse, 201);
  const workshopJobId = workshopResponse.json?.id;
  assert.ok(workshopJobId, "Expected workshop job id from fixture create");

  const lineResponse = await request({
    path: `/api/workshop/jobs/${workshopJobId}/lines`,
    method: "POST",
    headers: staffHeaders,
    body: {
      type: "LABOUR",
      description: "Security fixture labour line",
      qty: 1,
      unitPricePence: 1500,
    },
  });
  expectStatus("create workshop line fixture", lineResponse, 201);
  const lineId = lineResponse.json?.line?.id;
  assert.ok(lineId, "Expected workshop line id from fixture create");

  return { customerId, workshopJobId, lineId };
};

const run = async () => {
  try {
    await serverController.startIfNeeded();

    const fixtures = await createFixtures();

    const unauthChecks = [
      { name: "unauth workshop parts", path: `/api/workshop-jobs/${fixtures.workshopJobId}/parts` },
      { name: "unauth sales report", path: `/api/reports/sales/daily${REPORT_RANGE_QUERY}` },
      { name: "unauth inventory on-hand report", path: "/api/reports/inventory/on-hand" },
      {
        name: "unauth workshop payments report",
        path: `/api/reports/workshop/payments${REPORT_RANGE_QUERY}`,
      },
      { name: "unauth credit balance", path: `/api/credits/balance?customerId=${fixtures.customerId}` },
      { name: "unauth workshop dashboard", path: "/api/workshop/dashboard" },
      { name: "unauth customer sales", path: `/api/customers/${fixtures.customerId}/sales` },
      { name: "unauth customer workshop jobs", path: `/api/customers/${fixtures.customerId}/workshop-jobs` },
      {
        name: "unauth workshop line patch",
        path: `/api/workshop/jobs/${fixtures.workshopJobId}/lines/${fixtures.lineId}`,
        method: "PATCH",
        body: { qty: 2 },
      },
      {
        name: "unauth workshop line delete",
        path: `/api/workshop/jobs/${fixtures.workshopJobId}/lines/${fixtures.lineId}`,
        method: "DELETE",
      },
      { name: "unauth export sales", path: "/api/admin/export/sales" },
      { name: "unauth export workshop", path: "/api/admin/export/workshop" },
      { name: "unauth export inventory", path: "/api/admin/export/inventory" },
      { name: "unauth metrics", path: "/metrics" },
    ];

    for (const check of unauthChecks) {
      const result = await request(check);
      expectAuthRejected(check.name, result);
    }

    const staffHeaders = headersWithRole("STAFF");
    const managerHeaders = headersWithRole("MANAGER");
    const adminHeaders = headersWithRole("ADMIN");

    expectStatus(
      "dev product route disabled outside development",
      await request({ path: "/dev/product", method: "POST" }),
      404,
    );
    expectStatus(
      "dev seed tube route disabled outside development",
      await request({ path: "/dev/seed-tube", method: "POST" }),
      404,
    );

    expectStatus(
      "staff workshop parts",
      await request({
        path: `/api/workshop-jobs/${fixtures.workshopJobId}/parts`,
        headers: staffHeaders,
      }),
      200,
    );
    expectStatus(
      "staff customer sales",
      await request({
        path: `/api/customers/${fixtures.customerId}/sales`,
        headers: staffHeaders,
      }),
      200,
    );
    expectStatus(
      "staff customer workshop jobs",
      await request({
        path: `/api/customers/${fixtures.customerId}/workshop-jobs`,
        headers: staffHeaders,
      }),
      200,
    );
    expectStatus(
      "staff workshop line patch",
      await request({
        path: `/api/workshop/jobs/${fixtures.workshopJobId}/lines/${fixtures.lineId}`,
        method: "PATCH",
        headers: staffHeaders,
        body: { qty: 2 },
      }),
      200,
    );
    expectStatus(
      "staff workshop dashboard",
      await request({ path: "/api/workshop/dashboard", headers: staffHeaders }),
      200,
    );
    expectStatus(
      "staff credit balance",
      await request({
        path: `/api/credits/balance?customerId=${fixtures.customerId}`,
        headers: staffHeaders,
      }),
      200,
    );

    expectStatus(
      "staff reports forbidden",
      await request({ path: `/api/reports/sales/daily${REPORT_RANGE_QUERY}`, headers: staffHeaders }),
      403,
    );
    expectStatus(
      "staff workshop reports forbidden",
      await request({
        path: `/api/reports/workshop/payments${REPORT_RANGE_QUERY}`,
        headers: staffHeaders,
      }),
      403,
    );
    expectStatus(
      "staff inventory on-hand report forbidden",
      await request({
        path: "/api/reports/inventory/on-hand",
        headers: staffHeaders,
      }),
      403,
    );
    expectStatus(
      "staff inventory value report forbidden",
      await request({
        path: `/api/reports/inventory/value?locationId=${fixtures.customerId}`,
        headers: staffHeaders,
      }),
      403,
    );
    expectStatus(
      "staff metrics forbidden",
      await request({ path: "/metrics", headers: staffHeaders }),
      403,
    );

    expectStatus(
      "reject malformed product pagination",
      await request({
        path: "/api/products?take=10foo",
        headers: staffHeaders,
      }),
      400,
    );
    expectStatus(
      "reject malformed purchase order pagination",
      await request({
        path: "/api/purchase-orders?skip=1.5",
        headers: staffHeaders,
      }),
      400,
    );
    expectStatus(
      "reject malformed report take filter",
      await request({
        path: "/api/reports/sales/products?from=2026-01-01&to=2026-12-31&take=10foo",
        headers: managerHeaders,
      }),
      400,
    );
    expectStatus(
      "reject malformed report integer filter",
      await request({
        path: "/api/reports/customers/reminders?dueSoonDays=7days",
        headers: managerHeaders,
      }),
      400,
    );

    expectStatus(
      "manager reports allowed",
      await request({
        path: `/api/reports/sales/daily${REPORT_RANGE_QUERY}`,
        headers: managerHeaders,
      }),
      200,
    );
    expectStatus(
      "manager inventory on-hand report allowed",
      await request({
        path: "/api/reports/inventory/on-hand",
        headers: managerHeaders,
      }),
      200,
    );
    expectStatus(
      "manager workshop reports allowed",
      await request({
        path: `/api/reports/workshop/payments${REPORT_RANGE_QUERY}`,
        headers: managerHeaders,
      }),
      200,
    );
    const managerInventoryValueReport = await request({
      path: `/api/reports/inventory/value?locationId=${fixtures.customerId}`,
      headers: managerHeaders,
    });
    assert.notEqual(
      managerInventoryValueReport.status,
      401,
      `manager inventory value report should reach the handler, got ${managerInventoryValueReport.status}`,
    );
    assert.notEqual(
      managerInventoryValueReport.status,
      403,
      `manager inventory value report should reach the handler, got ${managerInventoryValueReport.status}`,
    );
    const managerMetrics = await request({ path: "/metrics", headers: managerHeaders });
    expectStatus("manager metrics allowed", managerMetrics, 200);
    assert.equal(managerMetrics.json?.status, "ok");
    assert.match(managerMetrics.json?.app?.version ?? "", /^\d+\.\d+\.\d+$/);
    assert.equal(managerMetrics.json?.app?.label, `v${managerMetrics.json?.app?.version}`);
    assert.equal(managerMetrics.json?.runtime?.environment, "test");
    assert.equal(managerMetrics.json?.checks?.database?.status, "ok");
    assert.equal(managerMetrics.json?.checks?.migrations?.status, "ok");
    assert.equal(typeof managerMetrics.json?.diagnostics?.requestIdHeader, "string");
    assert.equal(typeof managerMetrics.json?.features?.shippingPrintAgentConfigured, "boolean");

    expectStatus(
      "manager export sales forbidden",
      await request({ path: "/api/admin/export/sales", headers: managerHeaders }),
      403,
    );
    expectStatus(
      "manager export workshop forbidden",
      await request({ path: "/api/admin/export/workshop", headers: managerHeaders }),
      403,
    );
    expectStatus(
      "manager export inventory forbidden",
      await request({ path: "/api/admin/export/inventory", headers: managerHeaders }),
      403,
    );

    const adminSalesExport = await request({ path: "/api/admin/export/sales", headers: adminHeaders });
    expectStatus("admin export sales allowed", adminSalesExport, 200);
    assert.match(
      adminSalesExport.text,
      /saleId,status,createdAt/i,
      "Expected sales export csv header",
    );

    const adminWorkshopExport = await request({
      path: "/api/admin/export/workshop",
      headers: adminHeaders,
    });
    expectStatus("admin export workshop allowed", adminWorkshopExport, 200);
    assert.match(
      adminWorkshopExport.text,
      /jobId,status,customerId/i,
      "Expected workshop export csv header",
    );

    const adminInventoryExport = await request({
      path: "/api/admin/export/inventory",
      headers: adminHeaders,
    });
    expectStatus("admin export inventory allowed", adminInventoryExport, 200);
    assert.match(
      adminInventoryExport.text,
      /source,id,timestamp,movementType/i,
      "Expected inventory export csv header",
    );

    expectStatus(
      "staff workshop line delete",
      await request({
        path: `/api/workshop/jobs/${fixtures.workshopJobId}/lines/${fixtures.lineId}`,
        method: "DELETE",
        headers: staffHeaders,
      }),
      200,
    );

    console.log("Security auth-guard regression tests passed.");
  } finally {
    await serverController.stop();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
