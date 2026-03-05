#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const HEALTH_URL = `${BASE_URL}/health`;
const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

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
console.log(`[m34-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m34-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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

const serverIsHealthy = async () => {
  try {
    const response = await fetch(HEALTH_URL);
    return response.ok;
  } catch {
    return false;
  }
};

const waitForServer = async () => {
  for (let i = 0; i < 60; i += 1) {
    if (await serverIsHealthy()) {
      return;
    }
    await sleep(500);
  }
  throw new Error("Server did not become healthy on /health");
};

const cleanup = async (state) => {
  const saleIds = Array.from(state.saleIds);
  const basketIds = Array.from(state.basketIds);
  const workshopJobIds = Array.from(state.workshopJobIds);
  const variantIds = Array.from(state.variantIds);
  const productIds = Array.from(state.productIds);
  const customerIds = Array.from(state.customerIds);
  const userIds = Array.from(state.userIds);

  if (saleIds.length > 0) {
    await prisma.paymentIntent.deleteMany({
      where: {
        saleId: {
          in: saleIds,
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

    await prisma.saleItem.deleteMany({
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

  if (workshopJobIds.length > 0) {
    await prisma.workshopJobLine.deleteMany({
      where: {
        jobId: {
          in: workshopJobIds,
        },
      },
    });
    await prisma.workshopJobPart.deleteMany({
      where: {
        workshopJobId: {
          in: workshopJobIds,
        },
      },
    });
    await prisma.workshopJobNote.deleteMany({
      where: {
        workshopJobId: {
          in: workshopJobIds,
        },
      },
    });
    await prisma.payment.deleteMany({
      where: {
        workshopJobId: {
          in: workshopJobIds,
        },
      },
    });
    await prisma.workshopJob.deleteMany({
      where: {
        id: {
          in: workshopJobIds,
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

  if (customerIds.length > 0) {
    await prisma.creditAccount.deleteMany({
      where: {
        customerId: {
          in: customerIds,
        },
      },
    });
    await prisma.customer.deleteMany({
      where: {
        id: {
          in: customerIds,
        },
      },
    });
  }

  if (userIds.length > 0) {
    await prisma.user.deleteMany({
      where: {
        id: {
          in: userIds,
        },
      },
    });
  }
};

const run = async () => {
  const state = {
    saleIds: new Set(),
    basketIds: new Set(),
    workshopJobIds: new Set(),
    variantIds: new Set(),
    productIds: new Set(),
    customerIds: new Set(),
    userIds: new Set(),
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
      serverProcess.stdout.on("data", () => {});
      serverProcess.stderr.on("data", () => {});
      startedServer = true;
      await waitForServer();
    }

    const managerUser = await prisma.user.create({
      data: {
        username: `m34-manager-${uniqueRef()}`,
        passwordHash: "m34-smoke",
        role: "ADMIN",
      },
    });
    state.userIds.add(managerUser.id);

    const staffUser = await prisma.user.create({
      data: {
        username: `m34-staff-${uniqueRef()}`,
        passwordHash: "m34-smoke",
        role: "STAFF",
      },
    });
    state.userIds.add(staffUser.id);

    const managerHeaders = {
      "X-Staff-Role": "MANAGER",
      "X-Staff-Id": managerUser.id,
    };
    const staffHeaders = {
      "X-Staff-Role": "STAFF",
      "X-Staff-Id": staffUser.id,
    };

    const createCustomerRes = await fetchJson("/api/customers", {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        name: `M34 Customer ${uniqueRef()}`,
        email: `m34_${uniqueRef()}@example.com`,
        phone: `07${String(Date.now()).slice(-9)}`,
        notes: "M34 smoke test customer",
      }),
    });
    assert.equal(createCustomerRes.status, 201, JSON.stringify(createCustomerRes.json));
    const customer = createCustomerRes.json;
    state.customerIds.add(customer.id);

    const searchCustomerRes = await fetchJson(
      `/api/customers/search?q=${encodeURIComponent("M34 Customer")}&take=20`,
      {
        headers: staffHeaders,
      },
    );
    assert.equal(searchCustomerRes.status, 200, JSON.stringify(searchCustomerRes.json));
    assert.ok(
      searchCustomerRes.json.customers.some((entry) => entry.id === customer.id),
      "Expected created customer in search results",
    );

    const productRes = await fetchJson("/api/products", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        name: `M34 Product ${uniqueRef()}`,
      }),
    });
    assert.equal(productRes.status, 201, JSON.stringify(productRes.json));
    state.productIds.add(productRes.json.id);

    const variantRes = await fetchJson("/api/variants", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        productId: productRes.json.id,
        sku: `M34-SKU-${uniqueRef()}`,
        retailPricePence: 2499,
      }),
    });
    assert.equal(variantRes.status, 201, JSON.stringify(variantRes.json));
    state.variantIds.add(variantRes.json.id);

    const stockRes = await fetchJson("/api/inventory/movements", {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        variantId: variantRes.json.id,
        type: "PURCHASE",
        quantity: 8,
        referenceType: "M34_TEST",
        referenceId: `seed_${uniqueRef()}`,
      }),
    });
    assert.equal(stockRes.status, 201, JSON.stringify(stockRes.json));

    const basketRes = await fetchJson("/api/baskets", {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(basketRes.status, 201, JSON.stringify(basketRes.json));
    const basketId = basketRes.json.id;
    state.basketIds.add(basketId);

    const addLineRes = await fetchJson(`/api/baskets/${basketId}/lines`, {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        variantId: variantRes.json.id,
        quantity: 1,
      }),
    });
    assert.equal(addLineRes.status, 201, JSON.stringify(addLineRes.json));

    const checkoutRes = await fetchJson(`/api/baskets/${basketId}/checkout`, {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(checkoutRes.status, 201, JSON.stringify(checkoutRes.json));
    const saleId = checkoutRes.json.sale.id;
    state.saleIds.add(saleId);

    const attachSaleCustomerRes = await fetchJson(`/api/sales/${saleId}/customer`, {
      method: "PATCH",
      headers: staffHeaders,
      body: JSON.stringify({
        customerId: customer.id,
      }),
    });
    assert.equal(attachSaleCustomerRes.status, 200, JSON.stringify(attachSaleCustomerRes.json));
    assert.equal(attachSaleCustomerRes.json.sale.customer.id, customer.id);

    const createIntentRes = await fetchJson("/api/payments/intents", {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        saleId,
        provider: "CASH",
        amountPence: checkoutRes.json.sale.totalPence,
      }),
    });
    assert.equal(createIntentRes.status, 201, JSON.stringify(createIntentRes.json));

    const receiptRes = await fetchJson(`/api/sales/${saleId}/receipt`, {
      headers: staffHeaders,
    });
    assert.equal(receiptRes.status, 200, JSON.stringify(receiptRes.json));
    assert.equal(receiptRes.json.saleId, saleId);
    assert.ok(receiptRes.json.customer, "Expected customer on receipt");
    assert.equal(receiptRes.json.customer.id, customer.id);

    const createWorkshopRes = await fetchJson("/api/workshop/jobs", {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        customerName: "Workshop Walk-in",
        bikeDescription: "M34 Bike",
        notes: "M34 workshop attach",
      }),
    });
    assert.equal(createWorkshopRes.status, 201, JSON.stringify(createWorkshopRes.json));
    const workshopJobId = createWorkshopRes.json.id;
    state.workshopJobIds.add(workshopJobId);

    const attachWorkshopCustomerRes = await fetchJson(
      `/api/workshop/jobs/${workshopJobId}/customer`,
      {
        method: "PATCH",
        headers: staffHeaders,
        body: JSON.stringify({
          customerId: customer.id,
        }),
      },
    );
    assert.equal(
      attachWorkshopCustomerRes.status,
      200,
      JSON.stringify(attachWorkshopCustomerRes.json),
    );
    assert.equal(attachWorkshopCustomerRes.json.customerId, customer.id);

    const getWorkshopRes = await fetchJson(`/api/workshop/jobs/${workshopJobId}`, {
      headers: staffHeaders,
    });
    assert.equal(getWorkshopRes.status, 200, JSON.stringify(getWorkshopRes.json));
    assert.equal(getWorkshopRes.json.job.customerId, customer.id);
    assert.ok(getWorkshopRes.json.job.customerName);

    console.log("M34 smoke tests passed.");
  } finally {
    try {
      await cleanup(state);
    } catch (error) {
      console.error("[m34-smoke] cleanup error:", error);
    }

    await prisma.$disconnect();

    if (startedServer && serverProcess) {
      serverProcess.kill("SIGTERM");
      await sleep(600);
      if (!serverProcess.killed) {
        serverProcess.kill("SIGKILL");
      }
    }
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
