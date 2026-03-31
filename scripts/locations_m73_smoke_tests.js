#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
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
  throw new Error(
    "Refusing to run against non-test database URL. Set TEST_DATABASE_URL or ALLOW_NON_TEST_DB=1.",
  );
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;

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
  label: "m73-smoke",
  baseUrls: appBaseUrlCandidates,
  databaseUrl: DATABASE_URL,
  captureStartupLog: true,
  startupReadyPattern: /Server running on http:\/\/localhost:\d+/i,
});

const parseJson = async (response) => {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const fetchJson = async (path, options = {}) => {
  const response = await fetch(`${serverController.getBaseUrl()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  return {
    status: response.status,
    json: await parseJson(response),
  };
};

const run = async () => {
  const ref = uniqueRef();
  const created = {
    productIds: [],
    variantIds: [],
    workshopJobIds: [],
    locationIds: [],
    stockLocationIds: [],
    userIds: [],
  };

  const adminHeaders = {
    "X-Staff-Role": "ADMIN",
    "X-Staff-Id": `m73-admin-${ref}`,
  };
  const managerHeaders = {
    "X-Staff-Role": "MANAGER",
    "X-Staff-Id": `m73-manager-${ref}`,
  };
  const staffHeaders = {
    "X-Staff-Role": "STAFF",
    "X-Staff-Id": `m73-staff-${ref}`,
  };

  created.userIds.push(adminHeaders["X-Staff-Id"]);
  created.userIds.push(managerHeaders["X-Staff-Id"]);
  created.userIds.push(staffHeaders["X-Staff-Id"]);

  try {
    await serverController.startIfNeeded();

    const locationCode = `B${String(Date.now()).slice(-8)}`;
    const locationName = `Branch ${ref}`;

    const createLocation = await fetchJson("/api/locations", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        name: locationName,
        code: locationCode,
      }),
    });
    assert.equal(createLocation.status, 201, JSON.stringify(createLocation.json));
    assert.equal(createLocation.json.location.code, locationCode);
    assert.equal(createLocation.json.location.name, locationName);

    const locationId = createLocation.json.location.locationId || null;
    const stockLocationId = createLocation.json.location.stockLocationId || null;
    assert.ok(locationId, JSON.stringify(createLocation.json));

    created.locationIds.push(locationId);
    if (stockLocationId) {
      created.stockLocationIds.push(stockLocationId);
    }

    const listLocations = await fetchJson("/api/locations", {
      headers: staffHeaders,
    });
    assert.equal(listLocations.status, 200, JSON.stringify(listLocations.json));
    assert.ok(Array.isArray(listLocations.json.locations), JSON.stringify(listLocations.json));
    assert.ok(
      listLocations.json.locations.some((location) => location.code === locationCode),
      JSON.stringify(listLocations.json),
    );

    const product = await fetchJson("/api/products", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        name: `M73 Product ${ref}`,
        brand: "M73",
      }),
    });
    assert.equal(product.status, 201, JSON.stringify(product.json));
    created.productIds.push(product.json.id);

    const variant = await fetchJson(`/api/products/${product.json.id}/variants`, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        sku: `M73-${ref}`,
        name: `Variant ${ref}`,
        retailPricePence: 1299,
      }),
    });
    assert.equal(variant.status, 201, JSON.stringify(variant.json));
    created.variantIds.push(variant.json.id);

    const movement = await fetchJson("/api/inventory/movements", {
      method: "POST",
      headers: {
        ...managerHeaders,
        "X-Location-Code": locationCode,
      },
      body: JSON.stringify({
        variantId: variant.json.id,
        type: "PURCHASE",
        quantity: 5,
        note: "m73 branch stock",
      }),
    });
    assert.equal(movement.status, 201, JSON.stringify(movement.json));
    assert.equal(movement.json.locationId, locationId);

    const branchOnHand = await fetchJson(
      `/api/inventory/on-hand?variantId=${encodeURIComponent(variant.json.id)}`,
      {
        headers: {
          ...staffHeaders,
          "X-Location-Code": locationCode,
        },
      },
    );
    assert.equal(branchOnHand.status, 200, JSON.stringify(branchOnHand.json));
    assert.equal(branchOnHand.json.locationId, locationId);
    assert.equal(branchOnHand.json.onHand, 5, JSON.stringify(branchOnHand.json));

    const mainOnHand = await fetchJson(
      `/api/inventory/on-hand?variantId=${encodeURIComponent(variant.json.id)}`,
      {
        headers: staffHeaders,
      },
    );
    assert.equal(mainOnHand.status, 200, JSON.stringify(mainOnHand.json));
    assert.equal(mainOnHand.json.onHand, 0, JSON.stringify(mainOnHand.json));

    const job = await fetchJson("/api/workshop/jobs", {
      method: "POST",
      headers: {
        ...staffHeaders,
        "X-Location-Code": locationCode,
      },
      body: JSON.stringify({
        customerName: `M73 Customer ${ref}`,
        bikeDescription: "M73 Test Bike",
        notes: "m73 location scope",
      }),
    });
    assert.equal(job.status, 201, JSON.stringify(job.json));
    created.workshopJobIds.push(job.json.id);
    assert.equal(job.json.locationId, locationId);

    const branchJobs = await fetchJson("/api/workshop/jobs", {
      headers: {
        ...staffHeaders,
        "X-Location-Code": locationCode,
      },
    });
    assert.equal(branchJobs.status, 200, JSON.stringify(branchJobs.json));
    assert.ok(
      branchJobs.json.jobs.some((entry) => entry.id === job.json.id),
      JSON.stringify(branchJobs.json),
    );

    const mainJobs = await fetchJson("/api/workshop/jobs", {
      headers: staffHeaders,
    });
    assert.equal(mainJobs.status, 200, JSON.stringify(mainJobs.json));
    assert.ok(
      mainJobs.json.jobs.every((entry) => entry.id !== job.json.id),
      JSON.stringify(mainJobs.json),
    );

    console.log("M73 multi-location smoke tests passed.");
  } finally {
    if (created.workshopJobIds.length > 0) {
      await prisma.workshopJob.deleteMany({
        where: {
          id: {
            in: created.workshopJobIds,
          },
        },
      });
    }

    if (created.variantIds.length > 0) {
      await prisma.stockLedgerEntry.deleteMany({
        where: {
          variantId: {
            in: created.variantIds,
          },
        },
      });
      await prisma.inventoryMovement.deleteMany({
        where: {
          variantId: {
            in: created.variantIds,
          },
        },
      });
      await prisma.barcode.deleteMany({
        where: {
          variantId: {
            in: created.variantIds,
          },
        },
      });
      await prisma.variant.deleteMany({
        where: {
          id: {
            in: created.variantIds,
          },
        },
      });
    }

    if (created.productIds.length > 0) {
      await prisma.product.deleteMany({
        where: {
          id: {
            in: created.productIds,
          },
        },
      });
    }

    if (created.locationIds.length > 0) {
      await prisma.location.deleteMany({
        where: {
          id: {
            in: created.locationIds,
          },
        },
      });
    }

    if (created.stockLocationIds.length > 0) {
      await prisma.stockLocation.deleteMany({
        where: {
          id: {
            in: created.stockLocationIds,
          },
        },
      });
    }

    if (created.userIds.length > 0) {
      await prisma.user.deleteMany({
        where: {
          id: {
            in: created.userIds,
          },
        },
      });
    }

    await prisma.$disconnect();
    await serverController.stop();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
