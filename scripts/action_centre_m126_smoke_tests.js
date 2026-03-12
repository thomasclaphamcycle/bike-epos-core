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
  throw new Error("Refusing to run against non-test database URL.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const RUN_REF = `m126_${Date.now()}`;
const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": `m126-manager-${RUN_REF}`,
  "Content-Type": "application/json",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchJson = async (path) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: MANAGER_HEADERS,
  });
  const json = await response.json();
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
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await serverIsHealthy()) {
      return;
    }
    await sleep(500);
  }
  throw new Error("Server did not become healthy on /health");
};

const daysAgo = (days) => {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() - days);
  return value;
};

const cleanup = async (state) => {
  if (state.purchaseOrderIds.length) {
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: state.purchaseOrderIds } } });
  }
  if (state.inventoryMovementVariantIds.length) {
    await prisma.inventoryMovement.deleteMany({
      where: { variantId: { in: state.inventoryMovementVariantIds } },
    });
  }
  if (state.variantIds.length) {
    await prisma.variant.deleteMany({ where: { id: { in: state.variantIds } } });
  }
  if (state.productIds.length) {
    await prisma.product.deleteMany({ where: { id: { in: state.productIds } } });
  }
  if (state.supplierIds.length) {
    await prisma.supplier.deleteMany({ where: { id: { in: state.supplierIds } } });
  }
  if (state.workshopJobIds.length) {
    await prisma.workshopJob.deleteMany({ where: { id: { in: state.workshopJobIds } } });
  }
  if (state.customerIds.length) {
    await prisma.customer.deleteMany({ where: { id: { in: state.customerIds } } });
  }
};

const sectionByKey = (sections, key) => sections.find((section) => section.key === key);

const main = async () => {
  const state = {
    supplierIds: [],
    productIds: [],
    variantIds: [],
    inventoryMovementVariantIds: [],
    purchaseOrderIds: [],
    workshopJobIds: [],
    customerIds: [],
  };
  let startedServer = false;
  let serverProcess = null;

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
      startedServer = true;
      await waitForServer();
    }

    const locationId = await ensureMainLocationId(prisma);
    const before = await fetchJson("/api/reports/operations/actions");
    assert.equal(before.status, 200);

    const [pricingProduct, deadStockProduct] = await Promise.all([
      prisma.product.create({
        data: {
          name: `M126 Pricing ${RUN_REF}`,
          variants: {
            create: {
              sku: `M126-PRICE-${RUN_REF}`,
              retailPricePence: 0,
              costPricePence: 1400,
            },
          },
        },
        include: { variants: true },
      }),
      prisma.product.create({
        data: {
          name: `M126 Dead ${RUN_REF}`,
          variants: {
            create: {
              sku: `M126-DEAD-${RUN_REF}`,
              retailPricePence: 1800,
              costPricePence: 900,
            },
          },
        },
        include: { variants: true },
      }),
    ]);
    state.productIds.push(pricingProduct.id, deadStockProduct.id);
    state.variantIds.push(pricingProduct.variants[0].id, deadStockProduct.variants[0].id);

    await prisma.inventoryMovement.create({
      data: {
        variantId: deadStockProduct.variants[0].id,
        type: "PURCHASE",
        quantity: 5,
        referenceType: "M126",
        referenceId: RUN_REF,
      },
    });
    state.inventoryMovementVariantIds.push(deadStockProduct.variants[0].id);

    const supplier = await prisma.supplier.create({
      data: { name: `M126 Supplier ${RUN_REF}` },
    });
    state.supplierIds.push(supplier.id);

    const purchaseOrder = await prisma.purchaseOrder.create({
      data: {
        poNumber: `PO26${RUN_REF.slice(-6)}26`,
        supplierId: supplier.id,
        status: "SENT",
        expectedAt: daysAgo(4),
        items: {
          create: [
            {
              variantId: deadStockProduct.variants[0].id,
              quantityOrdered: 3,
              quantityReceived: 0,
            },
          ],
        },
      },
    });
    state.purchaseOrderIds.push(purchaseOrder.id);

    const reminderCustomer = await prisma.customer.create({
      data: {
        name: `M126 Reminder ${RUN_REF}`,
        firstName: "Reminder",
        lastName: RUN_REF,
        email: `m126-reminder-${RUN_REF}@local`,
      },
    });
    const backlogCustomer = await prisma.customer.create({
      data: {
        name: `M126 Backlog ${RUN_REF}`,
        firstName: "Backlog",
        lastName: RUN_REF,
        email: `m126-backlog-${RUN_REF}@local`,
      },
    });
    state.customerIds.push(reminderCustomer.id, backlogCustomer.id);

    const workshopJobs = await Promise.all([
      prisma.workshopJob.create({
        data: {
          customerId: reminderCustomer.id,
          customerName: reminderCustomer.name,
          locationId,
          bikeDescription: "Reminder bike",
          status: "COMPLETED",
          createdAt: daysAgo(121),
          completedAt: daysAgo(120),
        },
      }),
      prisma.workshopJob.create({
        data: {
          customerId: backlogCustomer.id,
          customerName: backlogCustomer.name,
          locationId,
          bikeDescription: `M126 backlog anchor ${RUN_REF}`,
          status: "APPROVED",
          createdAt: daysAgo(20),
        },
      }),
      prisma.workshopJob.create({
        data: {
          customerId: backlogCustomer.id,
          customerName: backlogCustomer.name,
          locationId,
          bikeDescription: `M126 recently completed A ${RUN_REF}`,
          status: "COMPLETED",
          createdAt: daysAgo(4),
          completedAt: daysAgo(2),
        },
      }),
      prisma.workshopJob.create({
        data: {
          customerId: backlogCustomer.id,
          customerName: backlogCustomer.name,
          locationId,
          bikeDescription: `M126 recently completed B ${RUN_REF}`,
          status: "COMPLETED",
          createdAt: daysAgo(3),
          completedAt: daysAgo(1),
        },
      }),
      prisma.workshopJob.create({
        data: {
          customerId: backlogCustomer.id,
          customerName: backlogCustomer.name,
          locationId,
          bikeDescription: "Queue A",
          status: "BOOKING_MADE",
          createdAt: daysAgo(1),
        },
      }),
      prisma.workshopJob.create({
        data: {
          customerId: backlogCustomer.id,
          customerName: backlogCustomer.name,
          locationId,
          bikeDescription: "Queue B",
          status: "WAITING_FOR_APPROVAL",
          createdAt: daysAgo(2),
        },
      }),
      prisma.workshopJob.create({
        data: {
          customerId: backlogCustomer.id,
          customerName: backlogCustomer.name,
          locationId,
          bikeDescription: "Queue C",
          status: "WAITING_FOR_PARTS",
          createdAt: daysAgo(3),
        },
      }),
      prisma.workshopJob.create({
        data: {
          customerId: backlogCustomer.id,
          customerName: backlogCustomer.name,
          locationId,
          bikeDescription: "Queue D",
          status: "ON_HOLD",
          createdAt: daysAgo(4),
        },
      }),
      prisma.workshopJob.create({
        data: {
          customerId: backlogCustomer.id,
          customerName: backlogCustomer.name,
          locationId,
          bikeDescription: "Queue E",
          status: "BIKE_READY",
          createdAt: daysAgo(5),
        },
      }),
      prisma.workshopJob.create({
        data: {
          customerId: backlogCustomer.id,
          customerName: backlogCustomer.name,
          locationId,
          bikeDescription: "Queue F",
          status: "APPROVED",
          createdAt: daysAgo(6),
        },
      }),
    ]);
    state.workshopJobIds.push(...workshopJobs.map((job) => job.id));

    const after = await fetchJson("/api/reports/operations/actions");
    assert.equal(after.status, 200);

    const purchasingSection = sectionByKey(after.json.sections, "purchasing");
    const customerSection = sectionByKey(after.json.sections, "customerFollowUp");
    const workshopSection = sectionByKey(after.json.sections, "workshop");
    const pricingSection = sectionByKey(after.json.sections, "pricing");
    const inventorySection = sectionByKey(after.json.sections, "inventory");

    assert.ok(purchasingSection, "expected purchasing section");
    assert.ok(customerSection, "expected customer follow-up section");
    assert.ok(workshopSection, "expected workshop section");
    assert.ok(pricingSection, "expected pricing section");
    assert.ok(inventorySection, "expected inventory section");

    const overduePoRow = purchasingSection.items.find((row) => row.entityId === purchaseOrder.id);
    const overdueReminderRow = customerSection.items.find((row) => (
      row.entityId === reminderCustomer.id && row.type === "CUSTOMER_OVERDUE_REMINDER"
    ));
    const oldJobRow = workshopSection.items.find((row) => row.entityId === workshopJobs[1].id);
    const backlogRow = workshopSection.items.find((row) => row.type === "WORKSHOP_BACKLOG");
    const pricingRow = pricingSection.items.find((row) => row.entityId === pricingProduct.variants[0].id);
    const deadStockRow = inventorySection.items.find((row) => row.entityId === deadStockProduct.variants[0].id);

    assert.ok(overduePoRow, "expected overdue purchase order action");
    assert.equal(overduePoRow.severity, "WARNING");
    assert.equal(overduePoRow.link, `/purchasing/${purchaseOrder.id}`);

    assert.ok(overdueReminderRow, "expected overdue reminder action");
    assert.equal(overdueReminderRow.severity, "INFO");
    assert.equal(overdueReminderRow.link, `/customers/${reminderCustomer.id}`);

    assert.ok(oldJobRow, "expected workshop old-job action");
    assert.equal(oldJobRow.severity, "CRITICAL");

    assert.ok(backlogRow, "expected workshop backlog action");
    assert.match(backlogRow.reason, /open jobs/i);
    assert.equal(backlogRow.link, "/management/capacity");

    assert.ok(pricingRow, "expected pricing action");
    assert.equal(pricingRow.type, "MISSING_RETAIL_PRICE");
    assert.equal(pricingRow.severity, "CRITICAL");

    assert.ok(deadStockRow, "expected dead stock action");
    assert.equal(deadStockRow.type, "DEAD_STOCK");
    assert.equal(deadStockRow.severity, "INFO");

    assert.ok(after.json.summary.total >= before.json.summary.total + 5);
    assert.ok(after.json.summary.sectionsWithItems >= 4);

    console.log("[m126-smoke] action centre report passed");
  } finally {
    await cleanup(state);
    await prisma.$disconnect();
    if (startedServer && serverProcess) {
      serverProcess.kill("SIGTERM");
    }
  }
};

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
