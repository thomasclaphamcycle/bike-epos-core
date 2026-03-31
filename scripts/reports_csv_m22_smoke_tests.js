#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
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

const safeDbUrl = DATABASE_URL.replace(
  /(postgres(?:ql)?:\/\/[^:/@]+:)[^@]+@/i,
  "$1***@",
);
console.log(`[m22-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m22-smoke] DATABASE_URL=${safeDbUrl}`);

const serverController = createSmokeServerController({
  label: "m22-smoke",
  baseUrl: BASE_URL,
  databaseUrl: DATABASE_URL,
});

const run = async () => {
  try {
    await serverController.startIfNeeded();

    const today = new Date().toISOString().slice(0, 10);
    const response = await fetch(
      `${serverController.getBaseUrl()}/api/reports/sales/daily.csv?from=${today}&to=${today}`,
      {
        headers: {
          "X-Staff-Role": "MANAGER",
          "X-Staff-Id": "m22-smoke",
        },
      },
    );

    assert.equal(response.status, 200);
    const contentType = response.headers.get("content-type") ?? "";
    assert.equal(contentType.includes("text/csv"), true, `unexpected content-type: ${contentType}`);
    const contentDisposition = response.headers.get("content-disposition") ?? "";
    assert.equal(
      contentDisposition.includes("attachment"),
      true,
      `unexpected content-disposition: ${contentDisposition}`,
    );
    assert.equal(
      contentDisposition.includes("sales_daily.csv"),
      true,
      `unexpected content-disposition filename: ${contentDisposition}`,
    );

    const csv = await response.text();
    const firstLine = csv.split(/\r?\n/)[0];
    assert.equal(firstLine, "date,saleCount,grossPence,refundsPence,netPence");

    console.log("PASS csv endpoint returns text/csv with expected header");
  } finally {
    await serverController.stop();
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
