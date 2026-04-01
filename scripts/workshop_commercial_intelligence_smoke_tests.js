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
  label: "workshop-commercial-intelligence-smoke",
  baseUrl: BASE_URL,
  databaseUrl: DATABASE_URL,
});

const RUN_REF = `commercial_${Date.now()}`;
const MANAGER_HEADERS = {
  "Content-Type": "application/json",
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": `commercial-manager-${RUN_REF}`,
};
const COMMERCIAL_SETTING_KEYS = [
  "workshop.commercialSuggestionsEnabled",
  "workshop.commercialLongGapDays",
  "workshop.commercialRecentServiceCooldownDays",
];

const daysAgo = (days) => {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() - days);
  return value;
};

const fetchJson = async (path, options = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, options);
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, json };
};

const fetchJsonOrThrow = async (path, options = {}) => {
  const result = await fetchJson(path, options);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(
      `${options.method || "GET"} ${path} failed (${result.status}): ${JSON.stringify(result.json)}`,
    );
  }
  return result.json;
};

const cleanup = async (state) => {
  await prisma.appConfig.deleteMany({
    where: {
      key: {
        in: COMMERCIAL_SETTING_KEYS,
      },
    },
  });

  if (state.workshopJobIds.length > 0) {
    await prisma.workshopJob.deleteMany({
      where: {
        id: {
          in: state.workshopJobIds,
        },
      },
    });
  }

  if (state.scheduleIds.length > 0) {
    await prisma.bikeServiceSchedule.deleteMany({
      where: {
        id: {
          in: state.scheduleIds,
        },
      },
    });
  }

  if (state.bikeIds.length > 0) {
    await prisma.customerBike.deleteMany({
      where: {
        id: {
          in: state.bikeIds,
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

  if (state.templateIds.length > 0) {
    await prisma.workshopServiceTemplate.deleteMany({
      where: {
        id: {
          in: state.templateIds,
        },
      },
    });
  }
};

const main = async () => {
  const state = {
    customerIds: [],
    bikeIds: [],
    scheduleIds: [],
    workshopJobIds: [],
    templateIds: [],
  };

  try {
    await serverController.startIfNeeded();
    const locationId = await ensureMainLocationId(prisma);

    const settingsResult = await fetchJson("/api/settings", {
      method: "PATCH",
      headers: MANAGER_HEADERS,
      body: JSON.stringify({
        workshop: {
          commercialSuggestionsEnabled: true,
          commercialLongGapDays: 120,
          commercialRecentServiceCooldownDays: 30,
        },
      }),
    });
    assert.equal(settingsResult.status, 200, JSON.stringify(settingsResult.json));

    const customer = await prisma.customer.create({
      data: {
        firstName: "Commercial",
        lastName: RUN_REF,
        email: `commercial-${RUN_REF}@local`,
        phone: `07123${String(Date.now()).slice(-6)}`,
      },
    });
    state.customerIds.push(customer.id);

    const bike = await prisma.customerBike.create({
      data: {
        customerId: customer.id,
        label: "Daily e-bike",
        make: "Specialized",
        model: `Turbo Vado ${RUN_REF.slice(-4)}`,
        bikeType: "E_BIKE",
        motorBrand: "Bosch",
        motorModel: "Performance Line",
        colour: "Green",
      },
    });
    state.bikeIds.push(bike.id);

    const schedule = await prisma.bikeServiceSchedule.create({
      data: {
        bikeId: bike.id,
        type: "BRAKES",
        title: "Brake service",
        description: "Check brake pads, braking surface, and setup.",
        intervalMonths: 6,
        lastServiceAt: daysAgo(220),
        nextDueAt: daysAgo(40),
        isActive: true,
      },
    });
    state.scheduleIds.push(schedule.id);

    const completedJob = await prisma.workshopJob.create({
      data: {
        customerId: customer.id,
        customerName: `${customer.firstName} ${customer.lastName}`.trim(),
        bikeId: bike.id,
        bikeDescription: `${bike.make} ${bike.model}`,
        status: "COMPLETED",
        completedAt: daysAgo(220),
        locationId,
        source: "IN_STORE",
        depositStatus: "NOT_REQUIRED",
        depositRequiredPence: 0,
      },
    });
    state.workshopJobIds.push(completedJob.id);

    const template = await prisma.workshopServiceTemplate.create({
      data: {
        name: "Brake service package",
        category: "Brakes",
        description: "Pads, cables, caliper setup, and brake health check.",
        sortOrder: 1,
        defaultDurationMinutes: 60,
        pricingMode: "STANDARD_SERVICE",
        isActive: true,
      },
    });
    state.templateIds.push(template.id);

    const liveJob = await fetchJsonOrThrow("/api/workshop/jobs", {
      method: "POST",
      headers: MANAGER_HEADERS,
      body: JSON.stringify({
        customerId: customer.id,
        bikeId: bike.id,
        status: "BOOKED",
        notes: "Customer mentions handling concerns and wants a workshop assessment.",
      }),
    });
    state.workshopJobIds.push(liveJob.id);

    await fetchJsonOrThrow(`/api/workshop/jobs/${encodeURIComponent(liveJob.id)}/lines`, {
      method: "POST",
      headers: MANAGER_HEADERS,
      body: JSON.stringify({
        type: "LABOUR",
        description: "Wheel true and general workshop assessment",
        qty: 1,
        unitPricePence: 5200,
      }),
    });

    const unlinkedJob = await fetchJsonOrThrow("/api/workshop/jobs", {
      method: "POST",
      headers: MANAGER_HEADERS,
      body: JSON.stringify({
        customerId: customer.id,
        bikeDescription: "Free-text commuter bike with no linked record yet",
        status: "BOOKED",
        notes: "Walk-in job before the reusable bike profile has been captured.",
      }),
    });
    state.workshopJobIds.push(unlinkedJob.id);

    const bikesResponse = await fetchJsonOrThrow(
      `/api/customers/${encodeURIComponent(customer.id)}/bikes`,
      { headers: MANAGER_HEADERS },
    );
    const listedBike = bikesResponse.bikes.find((entry) => entry.id === bike.id);
    assert.ok(listedBike, JSON.stringify(bikesResponse));
    assert.equal(listedBike.commercialInsights.enabled, true);
    assert.equal(listedBike.commercialInsights.summary.highestPriority, "HIGH");
    assert.equal(listedBike.commercialInsights.recommendations[0].code, "OVERDUE_SERVICE");
    assert.equal(listedBike.commercialInsights.recommendations[0].matchedTemplate.name, template.name);

    const bikeHistoryResponse = await fetchJsonOrThrow(
      `/api/customers/bikes/${encodeURIComponent(bike.id)}`,
      { headers: MANAGER_HEADERS },
    );
    assert.equal(bikeHistoryResponse.commercialInsights.enabled, true);
    assert.ok(
      bikeHistoryResponse.commercialInsights.recommendations.some(
        (recommendation) => recommendation.code === "OVERDUE_SERVICE",
      ),
      JSON.stringify(bikeHistoryResponse.commercialInsights),
    );
    assert.ok(
      bikeHistoryResponse.commercialInsights.recommendations.some(
        (recommendation) => recommendation.code === "E_BIKE_HEALTH",
      ),
      JSON.stringify(bikeHistoryResponse.commercialInsights),
    );

    const workshopJobResponse = await fetchJsonOrThrow(
      `/api/workshop/jobs/${encodeURIComponent(liveJob.id)}`,
      { headers: MANAGER_HEADERS },
    );
    assert.equal(workshopJobResponse.commercialInsights.enabled, true);
    assert.ok(
      workshopJobResponse.commercialInsights.recommendations.some(
        (recommendation) => recommendation.code === "OVERDUE_SERVICE",
      ),
      JSON.stringify(workshopJobResponse.commercialInsights),
    );
    assert.ok(
      workshopJobResponse.commercialInsights.recommendations.some(
        (recommendation) => recommendation.matchedTemplate?.name === template.name,
      ),
      JSON.stringify(workshopJobResponse.commercialInsights),
    );

    const unlinkedJobResponse = await fetchJsonOrThrow(
      `/api/workshop/jobs/${encodeURIComponent(unlinkedJob.id)}`,
      { headers: MANAGER_HEADERS },
    );
    assert.equal(unlinkedJobResponse.commercialInsights.enabled, true);
    assert.ok(
      unlinkedJobResponse.commercialInsights.recommendations.some(
        (recommendation) => recommendation.code === "LINK_BIKE_RECORD",
      ),
      JSON.stringify(unlinkedJobResponse.commercialInsights),
    );

    const disableResult = await fetchJson("/api/settings", {
      method: "PATCH",
      headers: MANAGER_HEADERS,
      body: JSON.stringify({
        workshop: {
          commercialSuggestionsEnabled: false,
        },
      }),
    });
    assert.equal(disableResult.status, 200, JSON.stringify(disableResult.json));

    const bikesWhenDisabled = await fetchJsonOrThrow(
      `/api/customers/${encodeURIComponent(customer.id)}/bikes`,
      { headers: MANAGER_HEADERS },
    );
    const disabledBike = bikesWhenDisabled.bikes.find((entry) => entry.id === bike.id);
    assert.ok(disabledBike, JSON.stringify(bikesWhenDisabled));
    assert.equal(disabledBike.commercialInsights.enabled, false);
    assert.equal(disabledBike.commercialInsights.recommendations.length, 0);

    console.log("[workshop-commercial-intelligence-smoke] commercial recommendations passed");
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
