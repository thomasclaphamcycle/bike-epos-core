#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { createSmokeServerController } = require("./smoke_server_helper");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3100";
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
console.log(`[m19-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m19-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});
const serverController = createSmokeServerController({
  label: "m19-smoke",
  baseUrl: BASE_URL,
  databaseUrl: DATABASE_URL,
  captureStartupLog: true,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;
const RUN_REF = uniqueRef();
const STAFF_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": `m19-smoke-manager-${RUN_REF}`,
};

const londonDateKey = (date = new Date()) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
};

const fetchJson = async (path, options = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
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

const cleanup = async (state) => {
  const purchaseOrderItemIds = Array.from(state.purchaseOrderItemIds);
  const purchaseOrderIds = Array.from(state.purchaseOrderIds);
  const supplierIds = Array.from(state.supplierIds);
  const saleIds = Array.from(state.saleIds);
  const basketIds = Array.from(state.basketIds);
  const variantIds = Array.from(state.variantIds);
  const productIds = Array.from(state.productIds);
  const locationIds = Array.from(state.locationIds);

  if (purchaseOrderItemIds.length > 0) {
    await prisma.stockLedgerEntry.deleteMany({
      where: {
        referenceType: "PURCHASE_ORDER_ITEM",
        referenceId: {
          in: purchaseOrderItemIds,
        },
      },
    });
  }

  if (saleIds.length > 0) {
    await prisma.paymentRefund.deleteMany({
      where: {
        payment: {
          saleId: {
            in: saleIds,
          },
        },
      },
    });

    await prisma.payment.deleteMany({
      where: {
        saleId: {
          in: saleIds,
        },
      },
    });

    await prisma.saleReturnItem.deleteMany({
      where: {
        saleItem: {
          saleId: {
            in: saleIds,
          },
        },
      },
    });

    await prisma.saleReturn.deleteMany({
      where: {
        saleId: {
          in: saleIds,
        },
      },
    });

    await prisma.sale.deleteMany({
      where: {
        id: {
          in: saleIds,
        },
      },
    });
  }

  if (basketIds.length > 0) {
    await prisma.basketItem.deleteMany({
      where: {
        basketId: {
          in: basketIds,
        },
      },
    });

    await prisma.basket.deleteMany({
      where: {
        id: {
          in: basketIds,
        },
      },
    });
  }

  if (purchaseOrderIds.length > 0) {
    await prisma.purchaseOrderItem.deleteMany({
      where: {
        purchaseOrderId: {
          in: purchaseOrderIds,
        },
      },
    });

    await prisma.purchaseOrder.deleteMany({
      where: {
        id: {
          in: purchaseOrderIds,
        },
      },
    });
  }

  if (supplierIds.length > 0) {
    await prisma.supplier.deleteMany({
      where: {
        id: {
          in: supplierIds,
        },
      },
    });
  }

  if (variantIds.length > 0) {
    await prisma.stockLedgerEntry.deleteMany({
      where: {
        variantId: {
          in: variantIds,
        },
      },
    });
    await prisma.inventoryMovement.deleteMany({
      where: {
        variantId: {
          in: variantIds,
        },
      },
    });
    await prisma.barcode.deleteMany({
      where: {
        variantId: {
          in: variantIds,
        },
      },
    });
    await prisma.variant.deleteMany({
      where: {
        id: {
          in: variantIds,
        },
      },
    });
  }

  if (productIds.length > 0) {
    await prisma.product.deleteMany({
      where: {
        id: {
          in: productIds,
        },
      },
    });
  }

  if (locationIds.length > 0) {
    await prisma.stockLocation.deleteMany({
      where: {
        id: {
          in: locationIds,
        },
      },
    });
  }
};

const run = async () => {
  const state = {
    supplierIds: new Set(),
    purchaseOrderIds: new Set(),
    purchaseOrderItemIds: new Set(),
    basketIds: new Set(),
    saleIds: new Set(),
    productIds: new Set(),
    variantIds: new Set(),
    locationIds: new Set(),
  };

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
    await serverController.startIfNeeded();

    const results = [];
    let variantId = "";
    let locationId = "";
    let saleTotalPence = 0;

    await runTest(
      "inventory reports reflect purchase receive with unit cost",
      async () => {
        const location = await prisma.stockLocation.create({
          data: {
            name: `M19 Location ${uniqueRef()}`,
            isDefault: false,
          },
        });
        locationId = location.id;
        state.locationIds.add(location.id);

        const supplierRes = await fetchJson("/api/suppliers", {
          method: "POST",
          body: JSON.stringify({
            name: `M19 Supplier ${uniqueRef()}`,
            email: `m19.${uniqueRef()}@supplier.test`,
          }),
        });
        assert.equal(supplierRes.status, 201);
        state.supplierIds.add(supplierRes.json.id);

        const productRes = await fetchJson("/api/products", {
          method: "POST",
          body: JSON.stringify({
            name: `M19 Product ${uniqueRef()}`,
          }),
        });
        assert.equal(productRes.status, 201);
        state.productIds.add(productRes.json.id);

        const createdVariantRes = await fetchJson("/api/variants", {
          method: "POST",
          body: JSON.stringify({
            productId: productRes.json.id,
            sku: `M19-SKU-${uniqueRef()}`,
            barcode: `93919${Date.now().toString().slice(-7)}${sequence}`,
            option: "700x28c",
            retailPricePence: 1999,
            costPricePence: 1700,
          }),
        });
        assert.equal(createdVariantRes.status, 201);
        variantId = createdVariantRes.json.id;
        state.variantIds.add(variantId);

        const poRes = await fetchJson("/api/purchase-orders", {
          method: "POST",
          body: JSON.stringify({
            supplierId: supplierRes.json.id,
            notes: "M19 report test PO",
          }),
        });
        assert.equal(poRes.status, 201);
        state.purchaseOrderIds.add(poRes.json.id);

        const addItemsRes = await fetchJson(`/api/purchase-orders/${poRes.json.id}/items`, {
          method: "POST",
          body: JSON.stringify({
            lines: [
              {
                variantId,
                quantityOrdered: 5,
                unitCostPence: 1800,
              },
            ],
          }),
        });
        assert.equal(addItemsRes.status, 200);
        assert.equal(addItemsRes.json.items.length, 1);
        const purchaseOrderItemId = addItemsRes.json.items[0].id;
        state.purchaseOrderItemIds.add(purchaseOrderItemId);

        const receiveRes = await fetchJson(`/api/purchase-orders/${poRes.json.id}/receive`, {
          method: "POST",
          body: JSON.stringify({
            locationId,
            lines: [
              {
                purchaseOrderItemId,
                quantity: 5,
              },
            ],
          }),
        });
        assert.equal(receiveRes.status, 200);
        assert.equal(receiveRes.json.status, "RECEIVED");

        const onHandRes = await fetchJson(`/api/reports/inventory/on-hand?locationId=${locationId}`);
        assert.equal(onHandRes.status, 200);
        assert.ok(Array.isArray(onHandRes.json));
        const onHandRow = onHandRes.json.find((row) => row.variantId === variantId);
        assert.ok(onHandRow, "expected variant to be present in on-hand report");
        assert.equal(onHandRow.onHand, 5);

        const aggregate = await prisma.stockLedgerEntry.aggregate({
          where: {
            variantId,
            locationId,
          },
          _sum: {
            quantityDelta: true,
          },
        });
        assert.equal(onHandRow.onHand, aggregate._sum.quantityDelta ?? 0);

        const valueRes = await fetchJson(`/api/reports/inventory/value?locationId=${locationId}`);
        assert.equal(valueRes.status, 200);
        assert.equal(valueRes.json.locationId, locationId);
        assert.equal(valueRes.json.method, "PURCHASE_COST_AVG_V1");
        assert.equal(valueRes.json.totalValuePence > 0, true);
        const valueRow = valueRes.json.breakdown.find((row) => row.variantId === variantId);
        assert.ok(valueRow, "expected variant to be present in value report");
        assert.equal(valueRow.avgUnitCostPence, 1800);
        assert.equal(valueRow.valuePence, 9000);
      },
      results,
    );

    await runTest(
      "sales daily report returns expected shape and includes checkout day",
      async () => {
        assert.ok(variantId, "variantId missing from previous test");

        const basketRes = await fetchJson("/api/baskets", { method: "POST" });
        assert.equal(basketRes.status, 201);
        const basketId = basketRes.json.id;
        state.basketIds.add(basketId);

        const addItemRes = await fetchJson(`/api/baskets/${basketId}/items`, {
          method: "POST",
          body: JSON.stringify({
            variantId,
            quantity: 2,
          }),
        });
        assert.equal(addItemRes.status, 201);

        const checkoutRes = await fetchJson(`/api/baskets/${basketId}/checkout`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        assert.equal(checkoutRes.status, 201);
        const sale = checkoutRes.json.sale;
        assert.ok(sale?.id);
        state.saleIds.add(sale.id);
        saleTotalPence = sale.totalPence;

        const today = londonDateKey();
        const salesReportRes = await fetchJson(
          `/api/reports/sales/daily?from=${today}&to=${today}`,
        );
        assert.equal(salesReportRes.status, 200);
        assert.ok(Array.isArray(salesReportRes.json));
        assert.equal(salesReportRes.json.length, 1);

        const row = salesReportRes.json[0];
        assert.equal(row.date, today);
        assert.equal(typeof row.saleCount, "number");
        assert.equal(typeof row.grossPence, "number");
        assert.equal(typeof row.refundsPence, "number");
        assert.equal(typeof row.netPence, "number");
        assert.equal(row.saleCount >= 1, true);
        assert.equal(row.grossPence >= saleTotalPence, true);
      },
      results,
    );

    await runTest(
      "workshop daily report endpoint responds with expected structure",
      async () => {
        const today = londonDateKey();
        const reportRes = await fetchJson(`/api/reports/workshop/daily?from=${today}&to=${today}`);
        assert.equal(reportRes.status, 200);
        assert.ok(Array.isArray(reportRes.json));
        assert.equal(reportRes.json.length, 1);
        const row = reportRes.json[0];
        assert.equal(row.date, today);
        assert.equal(typeof row.jobCount, "number");
        assert.equal(typeof row.revenuePence, "number");
      },
      results,
    );

    const failed = results.filter((result) => !result.ok);
    if (failed.length > 0) {
      console.error(`\n${failed.length} test(s) failed.`);
      process.exitCode = 1;
      return;
    }

    console.log(`\nAll ${results.length} M19 smoke test(s) passed.`);
  } finally {
    await cleanup(state).catch((error) => {
      console.error("Cleanup failed:", error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
    await serverController.stop();
    await prisma.$disconnect();
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
