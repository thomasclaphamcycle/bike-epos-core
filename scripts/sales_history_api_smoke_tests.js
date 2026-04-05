#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
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
  label: "sales-history-api-smoke",
  baseUrl: BASE_URL,
  databaseUrl: DATABASE_URL,
});

const STAFF_HEADERS = {
  "X-Staff-Role": "STAFF",
  "X-Staff-Id": "sales-history-smoke-staff",
};

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
  return { status: response.status, json, text };
};

const findOrCreateMainLocation = async () => {
  const existing = await prisma.location.findFirst({
    where: {
      code: {
        equals: "MAIN",
        mode: "insensitive",
      },
    },
  });

  if (existing) {
    return existing;
  }

  return prisma.location.create({
    data: {
      name: "Main",
      code: "MAIN",
      isActive: true,
    },
  });
};

const run = async () => {
  const token = randomUUID().slice(0, 8).toUpperCase();
  const state = {
    locationIds: [],
    customerIds: [],
    userIds: [],
    workshopJobIds: [],
    saleIds: [],
  };

  try {
    await serverController.startIfNeeded();

    const mainLocation = await findOrCreateMainLocation();
    const branchLocation = await prisma.location.create({
      data: {
        name: `Sales History Branch ${token}`,
        code: `H${token}`.slice(0, 9),
        isActive: true,
      },
    });
    state.locationIds.push(branchLocation.id);

    const eric = await prisma.user.create({
      data: {
        username: `sales-history-eric-${token.toLowerCase()}`,
        passwordHash: "sales-history-smoke",
        role: "STAFF",
        name: `Eric ${token}`,
      },
    });
    const nina = await prisma.user.create({
      data: {
        username: `sales-history-nina-${token.toLowerCase()}`,
        passwordHash: "sales-history-smoke",
        role: "STAFF",
        name: `Nina ${token}`,
      },
    });
    state.userIds.push(eric.id, nina.id);

    const alice = await prisma.customer.create({
      data: {
        firstName: "Alice",
        lastName: `Walker ${token}`,
        email: `alice-${token.toLowerCase()}@example.com`,
      },
    });
    state.customerIds.push(alice.id);

    const workshopJob = await prisma.workshopJob.create({
      data: {
        customerName: `Workshop Patron ${token}`,
        bikeDescription: "Demo commuter",
        status: "COMPLETED",
        locationId: branchLocation.id,
        createdAt: new Date("2026-04-04T08:00:00.000Z"),
        completedAt: new Date("2026-04-05T10:15:00.000Z"),
      },
    });
    state.workshopJobIds.push(workshopJob.id);

    const completeSale = await prisma.sale.create({
      data: {
        locationId: mainLocation.id,
        customerId: alice.id,
        createdByStaffId: eric.id,
        subtotalPence: 16100,
        taxPence: 0,
        totalPence: 16100,
        createdAt: new Date("2026-04-04T17:40:00.000Z"),
        completedAt: new Date("2026-04-04T17:56:26.000Z"),
        receiptNumber: `CL0200${token}`,
      },
    });
    const draftSale = await prisma.sale.create({
      data: {
        locationId: mainLocation.id,
        createdByStaffId: nina.id,
        subtotalPence: 899,
        taxPence: 0,
        totalPence: 899,
        createdAt: new Date("2026-04-05T09:45:00.000Z"),
      },
    });
    const workshopSale = await prisma.sale.create({
      data: {
        locationId: branchLocation.id,
        workshopJobId: workshopJob.id,
        createdByStaffId: eric.id,
        subtotalPence: 4500,
        taxPence: 0,
        totalPence: 4500,
        createdAt: new Date("2026-04-04T08:30:00.000Z"),
        completedAt: new Date("2026-04-05T10:15:00.000Z"),
        receiptNumber: `WSH-${token}`,
      },
    });
    state.saleIds.push(completeSale.id, draftSale.id, workshopSale.id);

    const pageOne = await fetchJson(`/api/sales/history?q=${encodeURIComponent(token)}&page=1&pageSize=2`, {
      headers: STAFF_HEADERS,
    });
    assert.equal(pageOne.status, 200, JSON.stringify(pageOne.json));
    assert.equal(pageOne.json.pagination.page, 1);
    assert.equal(pageOne.json.pagination.pageSize, 2);
    assert.equal(pageOne.json.pagination.total, 2);
    assert.equal(pageOne.json.pagination.totalPages, 1);
    assert.equal(pageOne.json.data.length, 2);
    assert.equal(pageOne.json.data[0].id, workshopSale.id);
    assert.equal(pageOne.json.data[0].source, "workshop");
    assert.equal(pageOne.json.data[0].reference, workshopJob.id.slice(0, 8).toUpperCase());
    assert.equal(pageOne.json.data[0].store.id, branchLocation.id);
    assert.equal(pageOne.json.data[0].store.name, branchLocation.name);
    assert.equal(pageOne.json.data[0].soldBy.name, `Eric ${token}`);
    assert.equal(pageOne.json.data[0].status, "complete");
    assert.equal(pageOne.json.data[0].currency, "GBP");
    assert.equal(pageOne.json.data[0].total, 45);
    assert.equal(pageOne.json.data[1].id, completeSale.id);
    assert.equal(pageOne.json.data[1].status, "complete");
    assert.equal(pageOne.json.data[1].customer.name, `Alice Walker ${token}`);
    assert.equal(pageOne.json.data[1].orderNo, `CL0200${token}`);

    const pageTwo = await fetchJson(`/api/sales/history?q=${encodeURIComponent(token)}&page=2&pageSize=2`, {
      headers: STAFF_HEADERS,
    });
    assert.equal(pageTwo.status, 200, JSON.stringify(pageTwo.json));
    assert.equal(pageTwo.json.data.length, 0);

    const byOrderNo = await fetchJson(`/api/sales/history?q=${encodeURIComponent(`CL0200${token}`)}`, {
      headers: STAFF_HEADERS,
    });
    assert.equal(byOrderNo.status, 200, JSON.stringify(byOrderNo.json));
    assert.equal(byOrderNo.json.pagination.total, 1);
    assert.equal(byOrderNo.json.data[0].id, completeSale.id);

    const byCustomer = await fetchJson(`/api/sales/history?q=${encodeURIComponent(token)}`, {
      headers: STAFF_HEADERS,
    });
    assert.equal(byCustomer.status, 200, JSON.stringify(byCustomer.json));
    assert.equal(byCustomer.json.pagination.total, 2);
    assert.equal(
      byCustomer.json.data.find((sale) => sale.id === completeSale.id)?.customer.name,
      `Alice Walker ${token}`,
    );

    const byStaff = await fetchJson(`/api/sales/history?q=${encodeURIComponent(`Eric ${token}`)}`, {
      headers: STAFF_HEADERS,
    });
    assert.equal(byStaff.status, 200, JSON.stringify(byStaff.json));
    assert.equal(byStaff.json.pagination.total, 2);

    const completeOnly = await fetchJson(`/api/sales/history?q=${encodeURIComponent(token)}&status=complete`, {
      headers: STAFF_HEADERS,
    });
    assert.equal(completeOnly.status, 200, JSON.stringify(completeOnly.json));
    assert.equal(completeOnly.json.pagination.total, 2);
    assert.ok(completeOnly.json.data.every((sale) => sale.status === "complete"));

    const draftOnly = await fetchJson(`/api/sales/history?q=${encodeURIComponent(token)}&status=draft`, {
      headers: STAFF_HEADERS,
    });
    assert.equal(draftOnly.status, 200, JSON.stringify(draftOnly.json));
    assert.equal(draftOnly.json.pagination.total, 1);
    assert.equal(draftOnly.json.data[0].id, draftSale.id);
    assert.equal(draftOnly.json.data[0].status, "draft");
    assert.match(draftOnly.json.data[0].orderNo, /^SALE-/);
    assert.equal(draftOnly.json.data[0].customer.name, "Walk-in");

    const branchOnly = await fetchJson(
      `/api/sales/history?q=${encodeURIComponent(token)}&storeId=${encodeURIComponent(branchLocation.id)}`,
      {
        headers: STAFF_HEADERS,
      },
    );
    assert.equal(branchOnly.status, 200, JSON.stringify(branchOnly.json));
    assert.equal(branchOnly.json.pagination.total, 1);
    assert.equal(branchOnly.json.data[0].id, workshopSale.id);

    const onFifth = await fetchJson(
      `/api/sales/history?q=${encodeURIComponent(token)}&dateFrom=2026-04-05T00:00:00.000Z&dateTo=2026-04-05T23:59:59.999Z`,
      { headers: STAFF_HEADERS },
    );
    assert.equal(onFifth.status, 200, JSON.stringify(onFifth.json));
    assert.equal(onFifth.json.pagination.total, 1);
    assert.deepEqual(onFifth.json.data.map((sale) => sale.id), [workshopSale.id]);

    const invalidStatus = await fetchJson("/api/sales/history?status=unknown", {
      headers: STAFF_HEADERS,
    });
    assert.equal(invalidStatus.status, 400, JSON.stringify(invalidStatus.json));
    assert.equal(invalidStatus.json.error.code, "INVALID_SALES_HISTORY_STATUS");

    console.log("sales history api smoke tests passed");
  } finally {
    if (state.saleIds.length > 0) {
      await prisma.sale.deleteMany({
        where: {
          id: {
            in: state.saleIds,
          },
        },
      });
    }

    if (state.workshopJobIds.length > 0) {
      await prisma.workshopJob.deleteMany({
        where: {
          id: {
            in: state.workshopJobIds,
          },
        },
      });
    }

    if (state.customerIds.length > 0) {
      await prisma.customer.deleteMany({
        where: {
          id: {
            in: state.customerIds,
          },
        },
      });
    }

    if (state.userIds.length > 0) {
      await prisma.user.deleteMany({
        where: {
          id: {
            in: state.userIds,
          },
        },
      });
    }

    if (state.locationIds.length > 0) {
      await prisma.location.deleteMany({
        where: {
          id: {
            in: state.locationIds,
          },
        },
      });
    }

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
