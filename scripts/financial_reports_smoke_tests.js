#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { ensureMainLocationId } = require("./default_location_helper");
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
  throw new Error("Refusing to run against non-test database URL.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});
const serverController = createSmokeServerController({
  label: "financial-reports-smoke",
  baseUrl: BASE_URL,
  databaseUrl: DATABASE_URL,
});

const RUN_REF = `financial_${Date.now()}`;
const REPORT_DATE = "2026-02-14";
const REPORT_TIMESTAMP = new Date(`${REPORT_DATE}T12:00:00.000Z`);
const BIKE_CATEGORY = `Financial Bikes ${RUN_REF}`;
const ACCESSORY_CATEGORY = `Financial Accessories ${RUN_REF}`;
const PARTS_CATEGORY = `Financial Components ${RUN_REF}`;
const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": `financial-manager-${RUN_REF}`,
  "Content-Type": "application/json",
};

const ensureDefaultStockLocationId = async () => {
  const existing = await prisma.stockLocation.findFirst({
    where: { isDefault: true },
    orderBy: { createdAt: "asc" },
  });

  if (existing) {
    return existing.id;
  }

  const created = await prisma.stockLocation.create({
    data: {
      name: "Main Stock",
      isDefault: true,
    },
  });

  return created.id;
};

const fetchJson = async (path) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: MANAGER_HEADERS,
  });
  const json = await response.json();
  return { status: response.status, json };
};

const cleanup = async (state) => {
  if (state.refundIds.length) {
    await prisma.refund.deleteMany({
      where: {
        id: {
          in: state.refundIds,
        },
      },
    });
  }

  if (state.saleIds.length) {
    await prisma.sale.deleteMany({
      where: {
        id: {
          in: state.saleIds,
        },
      },
    });
  }

  if (state.workshopJobIds.length) {
    await prisma.workshopJob.deleteMany({
      where: {
        id: {
          in: state.workshopJobIds,
        },
      },
    });
  }

  if (state.customerIds.length) {
    await prisma.customer.deleteMany({
      where: {
        id: {
          in: state.customerIds,
        },
      },
    });
  }

  if (state.variantIds.length) {
    await prisma.variant.deleteMany({
      where: {
        id: {
          in: state.variantIds,
        },
      },
    });
  }

  if (state.productIds.length) {
    await prisma.product.deleteMany({
      where: {
        id: {
          in: state.productIds,
        },
      },
    });
  }
};

const main = async () => {
  const state = {
    customerIds: [],
    workshopJobIds: [],
    saleIds: [],
    refundIds: [],
    variantIds: [],
    productIds: [],
  };

  try {
    await serverController.startIfNeeded();

    const locationId = await ensureMainLocationId(prisma);
    const stockLocationId = await ensureDefaultStockLocationId();
    const [bikeProduct, helmetProduct, workshopPartProduct] = await Promise.all([
      prisma.product.create({
        data: {
          name: `Financial Bike ${RUN_REF}`,
          category: BIKE_CATEGORY,
          variants: {
            create: {
              sku: `FIN-BIKE-${RUN_REF}`,
              retailPricePence: 120000,
              costPricePence: 80000,
            },
          },
        },
        include: { variants: true },
      }),
      prisma.product.create({
        data: {
          name: `Financial Helmet ${RUN_REF}`,
          category: ACCESSORY_CATEGORY,
          variants: {
            create: {
              sku: `FIN-HELM-${RUN_REF}`,
              retailPricePence: 5000,
              costPricePence: 3000,
            },
          },
        },
        include: { variants: true },
      }),
      prisma.product.create({
        data: {
          name: `Financial Workshop Part ${RUN_REF}`,
          category: PARTS_CATEGORY,
          variants: {
            create: {
              sku: `FIN-PART-${RUN_REF}`,
              retailPricePence: 4000,
              costPricePence: 2000,
            },
          },
        },
        include: { variants: true },
      }),
    ]);

    state.productIds.push(bikeProduct.id, helmetProduct.id, workshopPartProduct.id);
    state.variantIds.push(
      bikeProduct.variants[0].id,
      helmetProduct.variants[0].id,
      workshopPartProduct.variants[0].id,
    );

    const [retailCustomer, workshopCustomer] = await Promise.all([
      prisma.customer.create({
        data: {
          firstName: "Financial",
          lastName: `Retail ${RUN_REF}`,
          email: `financial-retail-${RUN_REF}@local`,
        },
      }),
      prisma.customer.create({
        data: {
          firstName: "Financial",
          lastName: `Workshop ${RUN_REF}`,
          email: `financial-workshop-${RUN_REF}@local`,
        },
      }),
    ]);
    state.customerIds.push(retailCustomer.id, workshopCustomer.id);

    const retailSale = await prisma.sale.create({
      data: {
        customerId: retailCustomer.id,
        locationId,
        subtotalPence: 130000,
        taxPence: 0,
        totalPence: 130000,
        completedAt: REPORT_TIMESTAMP,
        items: {
          create: [
            {
              variantId: bikeProduct.variants[0].id,
              quantity: 1,
              unitPricePence: 120000,
              lineTotalPence: 120000,
            },
            {
              variantId: helmetProduct.variants[0].id,
              quantity: 2,
              unitPricePence: 5000,
              lineTotalPence: 10000,
            },
          ],
        },
      },
      include: {
        items: true,
      },
    });
    state.saleIds.push(retailSale.id);

    const workshopJob = await prisma.workshopJob.create({
      data: {
        customerId: workshopCustomer.id,
        locationId,
        customerName: `${workshopCustomer.firstName} ${workshopCustomer.lastName}`.trim(),
        bikeDescription: "Financial workshop bike",
        status: "COMPLETED",
        completedAt: REPORT_TIMESTAMP,
      },
    });
    state.workshopJobIds.push(workshopJob.id);

    const workshopSale = await prisma.sale.create({
      data: {
        customerId: workshopCustomer.id,
        workshopJobId: workshopJob.id,
        locationId,
        subtotalPence: 9000,
        taxPence: 0,
        totalPence: 9000,
        completedAt: REPORT_TIMESTAMP,
      },
    });
    state.saleIds.push(workshopSale.id);

    await prisma.workshopJobPart.create({
      data: {
        workshopJobId: workshopJob.id,
        variantId: workshopPartProduct.variants[0].id,
        stockLocationId,
        quantity: 1,
        unitPriceAtTime: 4000,
        costPriceAtTime: 2000,
        status: "USED",
      },
    });

    const helmetSaleLine = retailSale.items.find((item) => item.variantId === helmetProduct.variants[0].id);
    assert.ok(helmetSaleLine, "expected helmet sale line");

    const refund = await prisma.refund.create({
      data: {
        saleId: retailSale.id,
        status: "COMPLETED",
        subtotalPence: 5000,
        taxPence: 0,
        totalPence: 5000,
        completedAt: REPORT_TIMESTAMP,
        lines: {
          create: {
            saleLineId: helmetSaleLine.id,
            quantity: 1,
            unitPricePence: 5000,
            lineTotalPence: 5000,
          },
        },
      },
    });
    state.refundIds.push(refund.id);

    const periodQuery = `?from=${REPORT_DATE}&to=${REPORT_DATE}`;

    const monthlyMargin = await fetchJson(`/api/reports/financial/monthly-margin${periodQuery}`);
    assert.equal(monthlyMargin.status, 200, JSON.stringify(monthlyMargin.json));
    assert.equal(monthlyMargin.json.summary.grossSalesPence, 139000);
    assert.equal(monthlyMargin.json.summary.refundsPence, 5000);
    assert.equal(monthlyMargin.json.summary.revenuePence, 134000);
    assert.equal(monthlyMargin.json.summary.cogsPence, 85000);
    assert.equal(monthlyMargin.json.summary.grossMarginPence, 49000);
    assert.equal(monthlyMargin.json.summary.grossMarginPercent, 36.6);
    assert.equal(monthlyMargin.json.summary.transactions, 2);
    assert.equal(monthlyMargin.json.costBasis.revenueWithoutCostBasisPence, 5000);
    assert.equal(monthlyMargin.json.costBasis.knownCostCoveragePercent, 96.3);
    assert.equal(monthlyMargin.json.costBasis.workshopServiceRevenuePence, 5000);
    assert.ok(Array.isArray(monthlyMargin.json.costBasis.notes));
    assert.ok(monthlyMargin.json.costBasis.notes.length >= 2);

    const monthlySales = await fetchJson(`/api/reports/financial/monthly-sales${periodQuery}`);
    assert.equal(monthlySales.status, 200, JSON.stringify(monthlySales.json));
    assert.equal(monthlySales.json.summary.grossSalesPence, 139000);
    assert.equal(monthlySales.json.summary.refundsPence, 5000);
    assert.equal(monthlySales.json.summary.revenuePence, 134000);
    assert.equal(monthlySales.json.summary.transactions, 2);
    assert.equal(monthlySales.json.summary.refundCount, 1);
    assert.equal(monthlySales.json.summary.averageSaleValuePence, 69500);

    const salesByCategory = await fetchJson(`/api/reports/financial/sales-by-category${periodQuery}`);
    assert.equal(salesByCategory.status, 200, JSON.stringify(salesByCategory.json));
    assert.equal(salesByCategory.json.summary.categoryCount, 4);
    assert.equal(salesByCategory.json.summary.grossSalesPence, 139000);
    assert.equal(salesByCategory.json.summary.refundsPence, 5000);
    assert.equal(salesByCategory.json.summary.revenuePence, 134000);
    assert.equal(salesByCategory.json.summary.topCategoryName, BIKE_CATEGORY);
    assert.equal(salesByCategory.json.summary.topCategoryRevenuePence, 120000);

    const bikesRow = salesByCategory.json.categories.find((row) => row.categoryName === BIKE_CATEGORY);
    const accessoriesRow = salesByCategory.json.categories.find((row) => row.categoryName === ACCESSORY_CATEGORY);
    const partsRow = salesByCategory.json.categories.find((row) => row.categoryName === PARTS_CATEGORY);
    const workshopLabourRow = salesByCategory.json.categories.find((row) => row.categoryName === "Workshop Labour");

    assert.ok(bikesRow, "expected bikes category row");
    assert.ok(accessoriesRow, "expected accessories category row");
    assert.ok(partsRow, "expected parts category row");
    assert.ok(workshopLabourRow, "expected workshop labour category row");

    assert.equal(bikesRow.revenuePence, 120000);
    assert.equal(bikesRow.cogsPence, 80000);
    assert.equal(bikesRow.grossMarginPence, 40000);
    assert.equal(bikesRow.quantitySold, 1);

    assert.equal(accessoriesRow.grossSalesPence, 10000);
    assert.equal(accessoriesRow.refundsPence, 5000);
    assert.equal(accessoriesRow.revenuePence, 5000);
    assert.equal(accessoriesRow.cogsPence, 3000);
    assert.equal(accessoriesRow.grossMarginPence, 2000);
    assert.equal(accessoriesRow.quantitySold, 2);
    assert.equal(accessoriesRow.quantityRefunded, 1);
    assert.equal(accessoriesRow.netQuantity, 1);

    assert.equal(partsRow.revenuePence, 4000);
    assert.equal(partsRow.cogsPence, 2000);
    assert.equal(partsRow.grossMarginPence, 2000);

    assert.equal(workshopLabourRow.revenuePence, 5000);
    assert.equal(workshopLabourRow.cogsPence, 0);
    assert.equal(workshopLabourRow.revenueWithoutCostBasisPence, 5000);
    assert.equal(workshopLabourRow.knownCostCoveragePercent, 0);

    console.log("[financial-reports-smoke] financial reporting endpoints passed");
  } finally {
    await cleanup(state);
    await prisma.$disconnect();
    await serverController.stop();
  }
};

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
