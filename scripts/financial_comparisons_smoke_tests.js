#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { createSmokeServerController } = require("./smoke_server_helper");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
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

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;
const RUN_REF = uniqueRef();
const CURRENT_YEAR = 2200 + Number(String(Date.now()).slice(-2));
const HISTORICAL_YEAR = CURRENT_YEAR - 1;
const AS_OF_DATE = `${CURRENT_YEAR}-03-16`;
const HISTORICAL_MONTH_PREFIX = `${HISTORICAL_YEAR}-03`;
const NO_DATA_AS_OF_DATE = `${CURRENT_YEAR + 2}-03-16`;
const SALE_COMPLETED_AT = new Date(`${AS_OF_DATE}T11:00:00.000Z`);
const REFUND_COMPLETED_AT = new Date(`${AS_OF_DATE}T13:00:00.000Z`);
const STAFF_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": `financial-comparisons-smoke-${RUN_REF}`,
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
  label: "financial-comparisons-smoke",
  baseUrls: appBaseUrlCandidates,
  databaseUrl: DATABASE_URL,
  captureStartupLog: true,
  startupReadyPattern: /Server running on http:\/\/localhost:\d+/i,
});

const fetchJson = async (path, options = {}) => {
  const response = await fetch(`${serverController.getBaseUrl()}${path}`, {
    ...options,
    headers: {
      ...STAFF_HEADERS,
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

const createHistoricalCsv = () => {
  const lines = ["date,gross_revenue,net_revenue,cost_of_goods,transaction_count"];
  for (let day = 1; day <= 16; day += 1) {
    const date = `${HISTORICAL_MONTH_PREFIX}-${String(day).padStart(2, "0")}`;
    lines.push(`${date},100,70,40,2`);
  }
  lines.push(`${HISTORICAL_MONTH_PREFIX}-20,abc,70,40,2`);
  return lines.join("\n");
};

const cleanup = async (state) => {
  await prisma.historicalFinancialSummary.deleteMany({
    where: {
      date: {
        gte: new Date(`${HISTORICAL_MONTH_PREFIX}-01T00:00:00.000Z`),
        lte: new Date(`${HISTORICAL_MONTH_PREFIX}-31T00:00:00.000Z`),
      },
    },
  });

  if (state.refundId) {
    await prisma.$executeRaw`DELETE FROM "Refund" WHERE id = ${state.refundId}::uuid`;
  }

  if (state.saleId) {
    await prisma.$executeRaw`DELETE FROM "SaleItem" WHERE "saleId" = ${state.saleId}::uuid`;
    await prisma.$executeRaw`DELETE FROM "Sale" WHERE id = ${state.saleId}::uuid`;
  }

  if (state.variantId) {
    await prisma.$executeRaw`DELETE FROM "SaleItem" WHERE "variantId" = ${state.variantId}`;
    await prisma.barcode.deleteMany({ where: { variantId: state.variantId } });
    await prisma.variant.deleteMany({
      where: {
        id: state.variantId,
      },
    });
  }

  if (state.productId) {
    await prisma.product.deleteMany({
      where: {
        id: state.productId,
      },
    });
  }
};

const main = async () => {
  const state = {
    productId: null,
    variantId: null,
    saleId: null,
    refundId: null,
  };

  try {
    await serverController.startIfNeeded();

    const location =
      (await prisma.location.findFirst({
        where: {
          code: {
            equals: "MAIN",
            mode: "insensitive",
          },
        },
      })) ??
      (await prisma.location.create({
        data: {
          name: "Main",
          code: "MAIN",
          isActive: true,
        },
      }));

    const product = await prisma.product.create({
      data: {
        name: `Financial Comparison Product ${RUN_REF}`,
      },
    });
    state.productId = product.id;

    const variant = await prisma.variant.create({
      data: {
        productId: product.id,
        sku: `FIN-COMP-${RUN_REF}`,
        retailPricePence: 150000,
        costPricePence: 8000,
      },
    });
    state.variantId = variant.id;

    const saleId = randomUUID();
    const refundId = randomUUID();

    await prisma.$executeRaw`
      INSERT INTO "Sale" (
        id,
        "locationId",
        "subtotalPence",
        "taxPence",
        "totalPence",
        "changeDuePence",
        "createdAt",
        "completedAt"
      )
      VALUES (
        ${saleId}::uuid,
        ${location.id},
        150000,
        0,
        150000,
        0,
        ${SALE_COMPLETED_AT},
        ${SALE_COMPLETED_AT}
      )
    `;

    await prisma.$executeRaw`
      INSERT INTO "SaleItem" (
        id,
        "saleId",
        "variantId",
        quantity,
        "unitPricePence",
        "lineTotalPence"
      )
      VALUES (
        ${randomUUID()}::uuid,
        ${saleId}::uuid,
        ${variant.id},
        10,
        15000,
        150000
      )
    `;

    await prisma.$executeRaw`
      INSERT INTO "Refund" (
        id,
        "saleId",
        status,
        currency,
        "subtotalPence",
        "taxPence",
        "totalPence",
        "completedAt",
        "createdAt",
        "updatedAt"
      )
      VALUES (
        ${refundId}::uuid,
        ${saleId}::uuid,
        'COMPLETED'::"RefundRecordStatus",
        'GBP',
        10000,
        0,
        10000,
        ${REFUND_COMPLETED_AT},
        ${REFUND_COMPLETED_AT},
        ${REFUND_COMPLETED_AT}
      )
    `;

    state.saleId = saleId;
    state.refundId = refundId;

    const importResponse = await fetchJson("/api/reports/financial/historical-summary/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ csv: createHistoricalCsv() }),
    });
    assert.equal(importResponse.status, 201, `unexpected import status: ${importResponse.status}`);
    assert.equal(importResponse.json.importedCount, 16, "expected 16 imported historical summary rows");
    assert.equal(importResponse.json.skippedCount, 1, "expected one invalid row to be skipped");

    const duplicateImport = await fetchJson("/api/reports/financial/historical-summary/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ csv: createHistoricalCsv() }),
    });
    assert.equal(duplicateImport.status, 201);
    assert.equal(duplicateImport.json.importedCount, 0, "expected duplicate import to skip existing rows");
    assert.equal(duplicateImport.json.skippedCount, 17, "expected all rows to be skipped on duplicate import");

    const salesSummary = await fetchJson(`/api/reports/financial/monthly-sales-summary?asOf=${AS_OF_DATE}`);
    assert.equal(salesSummary.status, 200, `unexpected sales summary status: ${salesSummary.status}`);
    assert.equal(salesSummary.json.summary.revenuePence, 140000);
    assert.equal(salesSummary.json.summary.transactionCount, 1);
    assert.equal(salesSummary.json.comparison.revenue.status, "available");
    assert.equal(salesSummary.json.comparison.revenue.historicalPence, 112000);
    assert.equal(Number(salesSummary.json.comparison.revenue.percentageChange.toFixed(1)), 25.0);

    const marginSummary = await fetchJson(`/api/reports/financial/monthly-margin-summary?asOf=${AS_OF_DATE}`);
    assert.equal(marginSummary.status, 200, `unexpected margin summary status: ${marginSummary.status}`);
    assert.equal(marginSummary.json.summary.grossMarginPence, 60000);
    assert.equal(marginSummary.json.comparison.grossMargin.status, "available");
    assert.equal(marginSummary.json.comparison.grossMargin.historicalPence, 48000);
    assert.equal(Number(marginSummary.json.comparison.grossMargin.percentageChange.toFixed(1)), 25.0);

    const fallbackSummary = await fetchJson(`/api/reports/financial/monthly-sales-summary?asOf=${NO_DATA_AS_OF_DATE}`);
    assert.equal(fallbackSummary.status, 200, `unexpected fallback sales summary status: ${fallbackSummary.status}`);
    assert.equal(fallbackSummary.json.comparison.revenue.status, "no_data");

    console.log("[financial-comparisons-smoke] historical import and financial comparisons passed");
  } finally {
    try {
      await cleanup(state);
    } finally {
      await prisma.$disconnect();
      await serverController.stop();
    }
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
