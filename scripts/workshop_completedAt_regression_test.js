#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { ensureMainLocationId } = require("./default_location_helper");
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
console.log(`[m19_1-regression] BASE_URL=${BASE_URL}`);
console.log(`[m19_1-regression] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});
const serverController = createSmokeServerController({
  label: "m19_1-regression",
  baseUrl: BASE_URL,
  databaseUrl: DATABASE_URL,
  captureStartupLog: true,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;
const ensureMainLocationId = async () => {
  const existing = await prisma.location.findFirst({
    where: {
      code: {
        equals: "MAIN",
        mode: "insensitive",
      },
    },
    select: {
      id: true,
    },
  });
  if (existing) {
    return existing.id;
  }

  const created = await prisma.location.create({
    data: {
      name: "Main",
      code: "MAIN",
      isActive: true,
    },
    select: {
      id: true,
    },
  });
  return created.id;
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
  const workshopJobIds = Array.from(state.workshopJobIds);
  const customerIds = Array.from(state.customerIds);

  if (workshopJobIds.length > 0) {
    await prisma.auditEvent.deleteMany({
      where: {
        entityType: "WORKSHOP_JOB",
        entityId: {
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

    await prisma.sale.deleteMany({
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

  if (customerIds.length > 0) {
    await prisma.customer.deleteMany({
      where: {
        id: {
          in: customerIds,
        },
      },
    });
  }
};

const run = async () => {
  const state = {
    workshopJobIds: new Set(),
    customerIds: new Set(),
  };

  try {
    await serverController.startIfNeeded();

    const ref = uniqueRef();
    const locationId = await ensureMainLocationId();
    const customer = await prisma.customer.create({
      data: {
        firstName: "M19",
        lastName: "Regression",
        email: `m19_1.${ref}@example.com`,
        phone: `0799${String(ref).replace(/\D/g, "").slice(-7).padStart(7, "0")}`,
      },
    });
    state.customerIds.add(customer.id);
    const locationId = await ensureMainLocationId(prisma);

    const job = await prisma.workshopJob.create({
      data: {
        locationId,
        customerId: customer.id,
        locationId,
        status: "BOOKED",
        source: "IN_STORE",
        notes: `M19.1 job ${ref}`,
      },
    });
    state.workshopJobIds.add(job.id);

    // Use the app's status transition service path via API.
    const statuses = ["IN_PROGRESS", "READY", "COMPLETED"];
    for (const status of statuses) {
      const response = await fetchJson(`/api/workshop/jobs/${job.id}/status`, {
        method: "POST",
        headers: {
          "X-Staff-Role": "STAFF",
        },
        body: JSON.stringify({ status }),
      });
      assert.equal(
        response.status,
        201,
        `expected 201 for status transition ${status}, got ${response.status}: ${JSON.stringify(response.json)}`,
      );
    }

    const completedJob = await prisma.workshopJob.findUnique({
      where: { id: job.id },
      select: {
        id: true,
        status: true,
        completedAt: true,
        updatedAt: true,
      },
    });

    assert.ok(completedJob, "Workshop job should exist after transition");
    assert.equal(completedJob.status, "COMPLETED");
    assert.ok(completedJob.completedAt, "completedAt should be set on first completion");
    const firstCompletedAtIso = completedJob.completedAt.toISOString();
    const firstUpdatedAtMs = completedJob.updatedAt.getTime();

    await sleep(25);

    await prisma.workshopJob.update({
      where: { id: job.id },
      data: {
        notes: `M19.1 post-complete update ${uniqueRef()}`,
      },
    });

    const afterUpdate = await prisma.workshopJob.findUnique({
      where: { id: job.id },
      select: {
        id: true,
        status: true,
        completedAt: true,
        updatedAt: true,
      },
    });

    assert.ok(afterUpdate, "Workshop job should exist after update");
    assert.equal(afterUpdate.status, "COMPLETED");
    assert.ok(afterUpdate.completedAt, "completedAt should remain set");
    assert.equal(
      afterUpdate.completedAt.toISOString(),
      firstCompletedAtIso,
      "completedAt changed after subsequent update; expected first-completion only behavior",
    );
    assert.ok(
      afterUpdate.updatedAt.getTime() > firstUpdatedAtMs,
      "updatedAt should move forward after subsequent update",
    );

    console.log("PASS completedAt is first-completion only");
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
