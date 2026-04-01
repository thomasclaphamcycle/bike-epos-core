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

const safeDbUrl = DATABASE_URL.replace(/(postgres(?:ql)?:\/\/[^:/@]+:)[^@]+@/i, "$1***@");
console.log(`[customer-account-smoke] BASE_URL=${BASE_URL}`);
console.log(`[customer-account-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});
const serverController = createSmokeServerController({
  label: "customer-account-smoke",
  baseUrl: BASE_URL,
  databaseUrl: DATABASE_URL,
});

let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;

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

const apiJson = async ({ path, method = "GET", body, headers }) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const payload = await parseJson(response);
  return {
    status: response.status,
    headers: response.headers,
    payload,
  };
};

const apiJsonOrThrow = async (request) => {
  const result = await apiJson(request);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(
      `${request.method || "GET"} ${request.path} failed (${result.status}): ${JSON.stringify(result.payload)}`,
    );
  }
  return result;
};

const cleanup = async (created) => {
  if (created.workshopJobIds.size > 0) {
    await prisma.workshopJob.deleteMany({
      where: {
        id: {
          in: Array.from(created.workshopJobIds),
        },
      },
    });
  }

  if (created.bikeIds.size > 0) {
    await prisma.customerBike.deleteMany({
      where: {
        id: {
          in: Array.from(created.bikeIds),
        },
      },
    });
  }

  if (created.customerIds.size > 0) {
    await prisma.customer.deleteMany({
      where: {
        id: {
          in: Array.from(created.customerIds),
        },
      },
    });
  }

  if (created.locationIds.size > 0) {
    await prisma.location.deleteMany({
      where: {
        id: {
          in: Array.from(created.locationIds),
        },
      },
    });
  }
};

const run = async () => {
  const created = {
    customerIds: new Set(),
    bikeIds: new Set(),
    workshopJobIds: new Set(),
    locationIds: new Set(),
  };

  try {
    await serverController.startIfNeeded();

    const token = uniqueRef();
    const email = `customer-account-${token}@example.com`;
    const location = await prisma.location.create({
      data: {
        name: `Customer Account Test ${token}`,
        code: `CA${token.slice(-6)}`,
      },
    });
    created.locationIds.add(location.id);

    const customer = await prisma.customer.create({
      data: {
        firstName: "Account",
        lastName: "Customer",
        email,
        phone: `07123${token.slice(-6)}`,
      },
    });
    created.customerIds.add(customer.id);

    const bike = await prisma.customerBike.create({
      data: {
        customerId: customer.id,
        label: "Winter commuter",
        make: "Genesis",
        model: `Croix de Fer ${token.slice(-4)}`,
        colour: "Blue",
      },
    });
    created.bikeIds.add(bike.id);

    const manageToken = `manage_${token}`;
    const quoteToken = `quote_${token}`;
    const scheduledDate = new Date();
    scheduledDate.setUTCDate(scheduledDate.getUTCDate() + 2);
    scheduledDate.setUTCHours(0, 0, 0, 0);

    const workshopJob = await prisma.workshopJob.create({
      data: {
        customerId: customer.id,
        bikeId: bike.id,
        locationId: location.id,
        status: "WAITING_FOR_APPROVAL",
        source: "ONLINE",
        scheduledDate,
        bikeDescription: `${bike.make} ${bike.model}`,
        manageToken,
        manageTokenExpiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        depositRequiredPence: 2500,
        depositStatus: "PAID",
        lines: {
          create: [
            {
              type: "LABOUR",
              description: "Brake service and gear tune",
              qty: 1,
              unitPricePence: 7800,
            },
          ],
        },
        estimates: {
          create: [
            {
              version: 1,
              status: "PENDING_APPROVAL",
              labourTotalPence: 7800,
              partsTotalPence: 0,
              subtotalPence: 7800,
              lineCount: 1,
              requestedAt: new Date(),
              customerQuoteToken: quoteToken,
              customerQuoteTokenExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
              lines: {
                create: [
                  {
                    sortOrder: 0,
                    type: "LABOUR",
                    description: "Brake service and gear tune",
                    qty: 1,
                    unitPricePence: 7800,
                    lineTotalPence: 7800,
                  },
                ],
              },
            },
          ],
        },
        conversation: {
          create: {
            customerId: customer.id,
            messages: {
              create: [
                {
                  direction: "OUTBOUND",
                  channel: "PORTAL",
                  customerVisible: true,
                  body: "We have inspected the bike and prepared a quote for the next stage of work.",
                  sentAt: new Date(),
                  deliveryStatus: "SENT",
                },
              ],
            },
          },
        },
      },
    });
    created.workshopJobIds.add(workshopJob.id);

    const requestLink = await apiJsonOrThrow({
      path: "/api/customer-auth/request-link",
      method: "POST",
      body: {
        email,
        returnTo: `/quote/${quoteToken}`,
      },
    });

    assert.equal(requestLink.payload.ok, true);
    assert.match(requestLink.payload.message, /secure sign-in link/i);
    assert.ok(requestLink.payload.devMagicLinkUrl, "Expected non-production magic link preview");

    const magicLink = new URL(requestLink.payload.devMagicLinkUrl);
    const accessToken = magicLink.pathname.split("/").pop();
    assert.ok(accessToken, "Expected access token in preview link");

    const consume = await apiJsonOrThrow({
      path: "/api/customer-auth/consume",
      method: "POST",
      body: {
        token: accessToken,
      },
    });

    const setCookie = consume.headers.get("set-cookie");
    assert.ok(setCookie, "Expected customer auth cookie to be set");
    const cookieHeader = setCookie.split(";")[0];

    const session = await apiJsonOrThrow({
      path: "/api/customer-auth/session",
      headers: {
        Cookie: cookieHeader,
      },
    });

    assert.equal(session.payload.authenticated, true);
    assert.equal(session.payload.customer.displayName, "Account Customer");
    assert.equal(session.payload.stats.activeJobCount, 1);
    assert.equal(session.payload.bikes[0].id, bike.id);

    const dashboard = await apiJsonOrThrow({
      path: "/api/customer-account/dashboard",
      headers: {
        Cookie: cookieHeader,
      },
    });

    assert.equal(dashboard.payload.activeJobs.length, 1);
    assert.equal(dashboard.payload.spotlight.counts.awaitingApproval, 1);
    assert.equal(dashboard.payload.spotlight.nextAction.kind, "APPROVAL_NEEDED");
    assert.equal(dashboard.payload.activeJobs[0].links.quotePath, `/quote/${quoteToken}`);
    assert.equal(dashboard.payload.activeJobs[0].bikeId, bike.id);

    const publicForm = await apiJsonOrThrow({
      path: "/api/workshop-bookings/public-form",
    });
    const minBookableDate = publicForm.payload.booking.minBookableDate.slice(0, 10);

    const booking = await apiJsonOrThrow({
      path: "/api/workshop-bookings",
      method: "POST",
      headers: {
        Cookie: cookieHeader,
      },
      body: {
        firstName: "Account",
        lastName: "Customer",
        email,
        phone: customer.phone,
        scheduledDate: minBookableDate,
        bikeId: bike.id,
        serviceRequest: "Please check the rear brake and drivetrain.",
        notes: "Customer account booking reuse smoke test.",
      },
    });

    assert.ok(booking.payload.manageToken, "Expected manage token from booking response");

    const createdBooking = await prisma.workshopJob.findUnique({
      where: {
        manageToken: booking.payload.manageToken,
      },
      select: {
        id: true,
        customerId: true,
        bikeId: true,
        bikeDescription: true,
      },
    });

    assert.ok(createdBooking, "Expected saved-bike booking to be created");
    assert.equal(createdBooking.customerId, customer.id);
    assert.equal(createdBooking.bikeId, bike.id);
    assert.match(createdBooking.bikeDescription || "", /Genesis|Croix de Fer/);
    created.workshopJobIds.add(createdBooking.id);

    console.log("[customer-account-smoke] Customer identity/account flow verified.");
  } finally {
    await cleanup(created);
    await prisma.$disconnect();
    await serverController.stop();
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
