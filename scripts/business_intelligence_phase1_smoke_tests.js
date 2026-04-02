#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { ensureMainLocationId } = require("./default_location_helper");
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
  throw new Error("Refusing to run against non-test database URL.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});
const serverController = createSmokeServerController({
  label: "business-intelligence-smoke",
  baseUrl: BASE_URL,
  databaseUrl: DATABASE_URL,
});

const RUN_REF = `bi_${Date.now()}`;
const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": `bi-manager-${RUN_REF}`,
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

const formatDateKey = (value) => value.toISOString().slice(0, 10);

const shiftDays = (value, days) => {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const cleanup = async (state) => {
  if (state.refundIds.length) {
    await prisma.refund.deleteMany({ where: { id: { in: state.refundIds } } });
  }

  if (state.saleIds.length) {
    await prisma.sale.deleteMany({ where: { id: { in: state.saleIds } } });
  }

  if (state.estimateIds.length) {
    await prisma.workshopEstimate.deleteMany({ where: { id: { in: state.estimateIds } } });
  }

  if (state.workshopPartIds.length) {
    await prisma.workshopJobPart.deleteMany({ where: { id: { in: state.workshopPartIds } } });
  }

  if (state.workshopJobIds.length) {
    await prisma.workshopJob.deleteMany({ where: { id: { in: state.workshopJobIds } } });
  }

  if (state.bookingIds.length) {
    await prisma.hireBooking.deleteMany({ where: { id: { in: state.bookingIds } } });
  }

  if (state.assetIds.length) {
    await prisma.hireAsset.deleteMany({ where: { id: { in: state.assetIds } } });
  }

  if (state.customerIds.length) {
    await prisma.customer.deleteMany({ where: { id: { in: state.customerIds } } });
  }

  if (state.variantIds.length) {
    await prisma.inventoryMovement.deleteMany({ where: { variantId: { in: state.variantIds } } });
    await prisma.barcode.deleteMany({ where: { variantId: { in: state.variantIds } } });
    await prisma.variant.deleteMany({ where: { id: { in: state.variantIds } } });
  }

  if (state.productIds.length) {
    await prisma.product.deleteMany({ where: { id: { in: state.productIds } } });
  }
};

const main = async () => {
  const state = {
    refundIds: [],
    saleIds: [],
    estimateIds: [],
    workshopPartIds: [],
    workshopJobIds: [],
    bookingIds: [],
    assetIds: [],
    customerIds: [],
    variantIds: [],
    productIds: [],
  };

  try {
    await serverController.startIfNeeded();
    const locationId = await ensureMainLocationId(prisma);
    const stockLocationId = await ensureDefaultStockLocationId();
    const today = new Date();
    const rangeTo = formatDateKey(today);
    const rangeFrom = formatDateKey(shiftDays(today, -6));
    const retailDateA = shiftDays(today, -2);
    const retailDateB = shiftDays(today, -1);
    const refundDate = shiftDays(today, -1);
    const workshopCompleteDate = shiftDays(today, -1);
    const pendingRequestedAt = shiftDays(today, -2);
    const approvedRequestedAt = shiftDays(today, -4);
    const approvedAt = shiftDays(today, -3);
    const overdueStart = shiftDays(today, -3);
    const overdueDue = shiftDays(today, -1);
    const returnedStart = shiftDays(today, -5);
    const returnedDue = shiftDays(today, -4);
    const reportPath = `/api/reports/business-intelligence?from=${encodeURIComponent(rangeFrom)}&to=${encodeURIComponent(rangeTo)}&take=20`;
    const baselineReport = await fetchJson(reportPath);
    assert.equal(baselineReport.status, 200, JSON.stringify(baselineReport.json));

    const [retailProduct, deadStockProduct, workshopPartProduct, hireProduct] = await Promise.all([
      prisma.product.create({
        data: {
          name: `BI Fast Product ${RUN_REF}`,
          category: `BI Retail ${RUN_REF}`,
          variants: {
            create: {
              sku: `BI-FAST-${RUN_REF}`,
              retailPricePence: 1200,
              costPricePence: 600,
            },
          },
        },
        include: { variants: true },
      }),
      prisma.product.create({
        data: {
          name: `BI Dead Product ${RUN_REF}`,
          category: `BI Dead ${RUN_REF}`,
          variants: {
            create: {
              sku: `BI-DEAD-${RUN_REF}`,
              retailPricePence: 3000,
              costPricePence: 2000,
            },
          },
        },
        include: { variants: true },
      }),
      prisma.product.create({
        data: {
          name: `BI Workshop Part ${RUN_REF}`,
          category: `BI Workshop Parts ${RUN_REF}`,
          variants: {
            create: {
              sku: `BI-PART-${RUN_REF}`,
              retailPricePence: 4000,
              costPricePence: 2000,
            },
          },
        },
        include: { variants: true },
      }),
      prisma.product.create({
        data: {
          name: `BI Hire Bike ${RUN_REF}`,
          category: `BI Hire ${RUN_REF}`,
          variants: {
            create: {
              sku: `BI-HIRE-${RUN_REF}`,
              retailPricePence: 4500,
            },
          },
        },
        include: { variants: true },
      }),
    ]);

    state.productIds.push(retailProduct.id, deadStockProduct.id, workshopPartProduct.id, hireProduct.id);
    state.variantIds.push(
      retailProduct.variants[0].id,
      deadStockProduct.variants[0].id,
      workshopPartProduct.variants[0].id,
      hireProduct.variants[0].id,
    );

    await prisma.inventoryMovement.createMany({
      data: [
        {
          variantId: retailProduct.variants[0].id,
          type: "PURCHASE",
          quantity: 20,
          unitCost: 600,
          referenceType: "BI",
          referenceId: RUN_REF,
        },
        {
          variantId: deadStockProduct.variants[0].id,
          type: "PURCHASE",
          quantity: 8,
          unitCost: 2000,
          referenceType: "BI",
          referenceId: RUN_REF,
        },
        {
          variantId: workshopPartProduct.variants[0].id,
          type: "PURCHASE",
          quantity: 5,
          unitCost: 2000,
          referenceType: "BI",
          referenceId: RUN_REF,
        },
      ],
    });

    const [repeatCustomer, workshopCustomer] = await Promise.all([
      prisma.customer.create({
        data: {
          firstName: "Repeat",
          lastName: `Customer ${RUN_REF}`,
          email: `repeat-${RUN_REF}@corepos.test`,
        },
      }),
      prisma.customer.create({
        data: {
          firstName: "Workshop",
          lastName: `Customer ${RUN_REF}`,
          email: `workshop-${RUN_REF}@corepos.test`,
        },
      }),
    ]);
    state.customerIds.push(repeatCustomer.id, workshopCustomer.id);

    const retailSaleA = await prisma.sale.create({
      data: {
        customerId: repeatCustomer.id,
        locationId,
        subtotalPence: 6000,
        taxPence: 0,
        totalPence: 6000,
        completedAt: retailDateA,
        items: {
          create: [
            {
              variantId: retailProduct.variants[0].id,
              quantity: 5,
              unitPricePence: 1200,
              lineTotalPence: 6000,
            },
          ],
        },
      },
      include: { items: true },
    });
    const retailSaleB = await prisma.sale.create({
      data: {
        customerId: repeatCustomer.id,
        locationId,
        subtotalPence: 12000,
        taxPence: 0,
        totalPence: 12000,
        completedAt: retailDateB,
        items: {
          create: [
            {
              variantId: retailProduct.variants[0].id,
              quantity: 10,
              unitPricePence: 1200,
              lineTotalPence: 12000,
            },
          ],
        },
      },
      include: { items: true },
    });
    state.saleIds.push(retailSaleA.id, retailSaleB.id);

    const refundedLine = retailSaleA.items[0];
    const refund = await prisma.refund.create({
      data: {
        saleId: retailSaleA.id,
        status: "COMPLETED",
        subtotalPence: 1200,
        taxPence: 0,
        totalPence: 1200,
        completedAt: refundDate,
        lines: {
          create: {
            saleLineId: refundedLine.id,
            quantity: 1,
            unitPricePence: 1200,
            lineTotalPence: 1200,
          },
        },
      },
    });
    state.refundIds.push(refund.id);

    const completedWorkshopJob = await prisma.workshopJob.create({
      data: {
        customerId: workshopCustomer.id,
        customerName: `${workshopCustomer.firstName} ${workshopCustomer.lastName}`.trim(),
        locationId,
        bikeDescription: "Completed BI workshop bike",
        status: "COMPLETED",
        completedAt: workshopCompleteDate,
      },
    });
    const pendingWorkshopJob = await prisma.workshopJob.create({
      data: {
        customerId: workshopCustomer.id,
        customerName: `${workshopCustomer.firstName} ${workshopCustomer.lastName}`.trim(),
        locationId,
        bikeDescription: "Pending approval bike",
        status: "WAITING_FOR_APPROVAL",
      },
    });
    const approvedWorkshopJob = await prisma.workshopJob.create({
      data: {
        customerId: workshopCustomer.id,
        customerName: `${workshopCustomer.firstName} ${workshopCustomer.lastName}`.trim(),
        locationId,
        bikeDescription: "Approved in-progress bike",
        status: "IN_PROGRESS",
      },
    });
    state.workshopJobIds.push(completedWorkshopJob.id, pendingWorkshopJob.id, approvedWorkshopJob.id);

    const workshopSale = await prisma.sale.create({
      data: {
        customerId: workshopCustomer.id,
        workshopJobId: completedWorkshopJob.id,
        locationId,
        subtotalPence: 9000,
        taxPence: 0,
        totalPence: 9000,
        completedAt: workshopCompleteDate,
      },
    });
    state.saleIds.push(workshopSale.id);

    const workshopPart = await prisma.workshopJobPart.create({
      data: {
        workshopJobId: completedWorkshopJob.id,
        variantId: workshopPartProduct.variants[0].id,
        stockLocationId,
        quantity: 1,
        unitPriceAtTime: 4000,
        costPriceAtTime: 2000,
        status: "USED",
      },
    });
    state.workshopPartIds.push(workshopPart.id);

    const pendingEstimate = await prisma.workshopEstimate.create({
      data: {
        workshopJobId: pendingWorkshopJob.id,
        version: 1,
        status: "PENDING_APPROVAL",
        labourTotalPence: 7000,
        partsTotalPence: 0,
        subtotalPence: 7000,
        lineCount: 1,
        requestedAt: pendingRequestedAt,
      },
    });
    const approvedEstimate = await prisma.workshopEstimate.create({
      data: {
        workshopJobId: approvedWorkshopJob.id,
        version: 1,
        status: "APPROVED",
        labourTotalPence: 5000,
        partsTotalPence: 0,
        subtotalPence: 5000,
        lineCount: 1,
        requestedAt: approvedRequestedAt,
        approvedAt,
        decisionSource: "CUSTOMER",
      },
    });
    state.estimateIds.push(pendingEstimate.id, approvedEstimate.id);

    const activeHireAsset = await prisma.hireAsset.create({
      data: {
        variantId: hireProduct.variants[0].id,
        assetTag: `BI-HIRE-ACTIVE-${RUN_REF}`,
        displayName: "BI hire demo bike",
        isOnlineBookable: true,
      },
    });
    const maintenanceHireAsset = await prisma.hireAsset.create({
      data: {
        variantId: hireProduct.variants[0].id,
        assetTag: `BI-HIRE-MAINT-${RUN_REF}`,
        displayName: "BI hire maintenance bike",
        status: "MAINTENANCE",
        isOnlineBookable: false,
      },
    });
    state.assetIds.push(activeHireAsset.id, maintenanceHireAsset.id);

    const overdueHireBooking = await prisma.hireBooking.create({
      data: {
        hireAssetId: activeHireAsset.id,
        customerId: workshopCustomer.id,
        status: "CHECKED_OUT",
        depositStatus: "HELD",
        startsAt: overdueStart,
        dueBackAt: overdueDue,
        checkedOutAt: overdueStart,
        hirePricePence: 4500,
        depositPence: 10000,
        depositHeldPence: 10000,
        notes: "Overdue BI rental",
      },
    });
    const returnedHireBooking = await prisma.hireBooking.create({
      data: {
        hireAssetId: activeHireAsset.id,
        customerId: repeatCustomer.id,
        status: "RETURNED",
        depositStatus: "RETURNED",
        startsAt: returnedStart,
        dueBackAt: returnedDue,
        checkedOutAt: returnedStart,
        returnedAt: returnedDue,
        hirePricePence: 4000,
        depositPence: 8000,
        depositHeldPence: 0,
        notes: "Returned BI rental",
      },
    });
    state.bookingIds.push(overdueHireBooking.id, returnedHireBooking.id);

    const { status, json } = await fetchJson(reportPath);

    assert.equal(status, 200, JSON.stringify(json));

    assert.equal(
      json.headline.actualNetSalesPence - baselineReport.json.headline.actualNetSalesPence,
      25800,
    );
    assert.equal(
      json.headline.retailNetSalesPence - baselineReport.json.headline.retailNetSalesPence,
      16800,
    );
    assert.equal(
      json.headline.workshopNetSalesPence - baselineReport.json.headline.workshopNetSalesPence,
      9000,
    );
    assert.equal(
      json.headline.hireBookedValuePence - baselineReport.json.headline.hireBookedValuePence,
      8500,
    );

    assert.equal(
      json.finance.salesSummary.grossSalesPence - baselineReport.json.finance.salesSummary.grossSalesPence,
      27000,
    );
    assert.equal(
      json.finance.salesSummary.refundsPence - baselineReport.json.finance.salesSummary.refundsPence,
      1200,
    );
    assert.equal(
      json.finance.salesSummary.revenuePence - baselineReport.json.finance.salesSummary.revenuePence,
      25800,
    );
    assert.equal(
      json.finance.tradingMix.retailNetSalesPence - baselineReport.json.finance.tradingMix.retailNetSalesPence,
      16800,
    );
    assert.equal(
      json.finance.tradingMix.workshopNetSalesPence - baselineReport.json.finance.tradingMix.workshopNetSalesPence,
      9000,
    );
    assert.ok(Array.isArray(json.limitations));
    assert.ok(json.limitations.length >= 3);

    assert.equal(
      json.workshop.summary.completedJobs - baselineReport.json.workshop.summary.completedJobs,
      1,
    );
    assert.equal(
      json.workshop.summary.quoteApprovalRequestedCount - baselineReport.json.workshop.summary.quoteApprovalRequestedCount,
      2,
    );
    assert.equal(
      json.workshop.summary.quoteApprovedCount - baselineReport.json.workshop.summary.quoteApprovedCount,
      1,
    );
    assert.equal(
      json.workshop.summary.quotePendingCount - baselineReport.json.workshop.summary.quotePendingCount,
      1,
    );
    assert.equal(
      json.workshop.summary.waitingForApprovalCount - baselineReport.json.workshop.summary.waitingForApprovalCount,
      1,
    );

    assert.equal(json.hire.summary.bookingCount - baselineReport.json.hire.summary.bookingCount, 2);
    assert.equal(json.hire.summary.bookedValuePence - baselineReport.json.hire.summary.bookedValuePence, 8500);
    assert.equal(json.hire.summary.activeNowCount - baselineReport.json.hire.summary.activeNowCount, 1);
    assert.equal(json.hire.summary.overdueNowCount - baselineReport.json.hire.summary.overdueNowCount, 1);
    assert.equal(
      json.hire.summary.maintenanceAssetCount - baselineReport.json.hire.summary.maintenanceAssetCount,
      1,
    );
    assert.equal(
      json.hire.summary.onlineBookableAssetCount - baselineReport.json.hire.summary.onlineBookableAssetCount,
      1,
    );
    assert.equal(
      json.hire.summary.depositHeldPence - baselineReport.json.hire.summary.depositHeldPence,
      10000,
    );

    assert.ok(json.inventory.deadStockCandidates.some((row) => row.productName === `BI Dead Product ${RUN_REF}`));
    assert.ok(json.inventory.fastMovingProducts.some((row) => row.productName === `BI Fast Product ${RUN_REF}`));

    assert.ok(
      json.customers.summary.repeatCustomerCount >= baselineReport.json.customers.summary.repeatCustomerCount + 1,
    );
    assert.ok(
      json.customers.summary.workshopActiveCustomerCount
        >= baselineReport.json.customers.summary.workshopActiveCustomerCount + 1,
    );

    assert.ok(
      json.finance.dailyMix.some((row) => row.hireBookedValuePence > 0),
      "expected at least one daily row to include hire booked value",
    );

    console.log("[business-intelligence-smoke] cross-domain BI report passed");
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
