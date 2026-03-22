#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { createSmokeServerController } = require("./smoke_server_helper");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const MAX_STARTUP_LOG_CHARS = 4000;
const APP_REQUEST_RETRIES = 8;

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
console.log(`[m83-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m83-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const portFromBaseUrl = () => {
  const url = new URL(BASE_URL);
  return url.port || (url.protocol === "https:" ? "443" : "80");
};

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
    // Keep the primary URL only if parsing fails unexpectedly.
  }

  return urls;
})();
let activeAppBaseUrl = appBaseUrlCandidates[0];
const serverStartedPattern = /Server running on http:\/\/localhost:\d+/i;
const serverController = createSmokeServerController({
  label: "m83-smoke",
  baseUrls: appBaseUrlCandidates,
  databaseUrl: DATABASE_URL,
  captureStartupLog: true,
  startupLogCharLimit: MAX_STARTUP_LOG_CHARS,
  startupReadyPattern: serverStartedPattern,
  envOverrides: {
    PORT: portFromBaseUrl(),
  },
});

const fetchFromApp = async (path, options = {}) => {
  let lastError = null;

  for (let attempt = 0; attempt < APP_REQUEST_RETRIES; attempt += 1) {
    try {
      activeAppBaseUrl = serverController.getBaseUrl();
      return await fetch(`${activeAppBaseUrl}${path}`, options);
    } catch (error) {
      lastError = error;

      const healthyBaseUrl = await serverController.probeHealthyBaseUrl();
      if (healthyBaseUrl) {
        activeAppBaseUrl = healthyBaseUrl;
      }
    }

    if (attempt < APP_REQUEST_RETRIES - 1) {
      await sleep(250);
    }
  }

  if (lastError instanceof Error) {
    lastError.message = `${lastError.message} while requesting ${activeAppBaseUrl}${path}`;
    throw lastError;
  }

  throw new Error(`Failed to fetch ${activeAppBaseUrl}${path}`);
};

const fetchJson = async (path, options = {}) => {
  const response = await fetchFromApp(path, {
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

const todayUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

const addDays = (date, days) => {
  const out = new Date(date);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
};

let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;
const CURRENT_YEAR = new Date().getUTCFullYear();
const MAX_VALID_BIKE_YEAR = CURRENT_YEAR + 1;
const TOO_LOW_BIKE_YEAR = 1899;
const TOO_HIGH_BIKE_YEAR = MAX_VALID_BIKE_YEAR + 1;

const RUN_REF = uniqueRef();
const STAFF_USER_ID = `m83-staff-${RUN_REF}`;
const MANAGER_USER_ID = `m83-manager-${RUN_REF}`;
const WORKSHOP_TIME_ZONE = "Europe/London";
const WORKSHOP_DAY_OF_WEEK_BY_NAME = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const STAFF_HEADERS = {
  "X-Staff-Role": "STAFF",
  "X-Staff-Id": STAFF_USER_ID,
};
const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": MANAGER_USER_ID,
};

const getWorkshopDayOfWeek = (value) => {
  const weekday = new Intl.DateTimeFormat("en-GB", {
    timeZone: WORKSHOP_TIME_ZONE,
    weekday: "long",
  }).format(value).toLowerCase();

  return WORKSHOP_DAY_OF_WEEK_BY_NAME[weekday];
};

const toScheduledSlot = (date, hours, minutes = 0) => {
  const slot = new Date(date);
  slot.setUTCHours(hours, minutes, 0, 0);
  return slot;
};

const createJob = async (state, overrides = {}) => {
  const ref = uniqueRef();
  const response = await fetchJson("/api/workshop/jobs", {
    method: "POST",
    headers: STAFF_HEADERS,
    body: JSON.stringify({
      customerId: overrides.customerId,
      customerName:
        Object.prototype.hasOwnProperty.call(overrides, "customerName")
          ? overrides.customerName
          : `M83 Customer ${ref}`,
      bikeId: overrides.bikeId,
      bikeDescription:
        Object.prototype.hasOwnProperty.call(overrides, "bikeDescription")
          ? overrides.bikeDescription
          : "Road bike service",
      scheduledStartAt:
        Object.prototype.hasOwnProperty.call(overrides, "scheduledStartAt")
          ? overrides.scheduledStartAt
          : undefined,
      scheduledEndAt:
        Object.prototype.hasOwnProperty.call(overrides, "scheduledEndAt")
          ? overrides.scheduledEndAt
          : undefined,
      durationMinutes:
        Object.prototype.hasOwnProperty.call(overrides, "durationMinutes")
          ? overrides.durationMinutes
          : undefined,
      notes: overrides.notes || `m83 job ${ref}`,
      status: overrides.status || "BOOKED",
    }),
  });

  assert.equal(response.status, 201, JSON.stringify(response.json));
  state.workshopJobIds.add(response.json.id);

  if (
    !Object.prototype.hasOwnProperty.call(overrides, "scheduledStartAt") &&
    !Object.prototype.hasOwnProperty.call(overrides, "scheduledEndAt") &&
    !Object.prototype.hasOwnProperty.call(overrides, "durationMinutes")
  ) {
    await prisma.workshopJob.update({
      where: { id: response.json.id },
      data: {
        scheduledDate: addDays(todayUtc(), 14),
      },
    });
  }

  return { job: response.json };
};

const createCustomer = async (state, overrides = {}) => {
  const ref = uniqueRef();
  const body = {
    name: overrides.name || `M83 Customer ${ref}`,
    notes: overrides.notes || "M83 customer for workshop estimate coverage",
  };

  if (Object.prototype.hasOwnProperty.call(overrides, "phone")) {
    if (typeof overrides.phone === "string") {
      body.phone = overrides.phone;
    }
  } else {
    body.phone = `07000${String(Math.floor(Math.random() * 90000) + 10000)}`;
  }

  if (Object.prototype.hasOwnProperty.call(overrides, "email")) {
    if (typeof overrides.email === "string") {
      body.email = overrides.email;
    }
  } else {
    body.email = `m83-${ref}@example.com`;
  }

  const response = await fetchJson("/api/customers", {
    method: "POST",
    headers: STAFF_HEADERS,
    body: JSON.stringify(body),
  });

  assert.equal(response.status, 201, JSON.stringify(response.json));
  state.customerIds.add(response.json.id);
  return response.json;
};

const updateCustomerCommunicationPreferences = async (
  customerId,
  communicationPreferences,
) => {
  const response = await fetchJson(
    `/api/customers/${encodeURIComponent(customerId)}/communication-preferences`,
    {
      method: "PATCH",
      headers: STAFF_HEADERS,
      body: JSON.stringify(communicationPreferences),
    },
  );

  assert.equal(response.status, 200, JSON.stringify(response.json));
  return response.json;
};

const createBike = async (state, customerId, overrides = {}) => {
  const ref = uniqueRef();
  const response = await fetchJson(`/api/customers/${customerId}/bikes`, {
    method: "POST",
    headers: STAFF_HEADERS,
    body: JSON.stringify({
      label: overrides.label || `M83 Bike ${ref}`,
      make: overrides.make || "Trek",
      model: overrides.model || "Domane",
      year: Object.prototype.hasOwnProperty.call(overrides, "year") ? overrides.year : undefined,
      bikeType: overrides.bikeType || undefined,
      colour: overrides.colour || "Blue",
      wheelSize: overrides.wheelSize || undefined,
      frameSize: overrides.frameSize || undefined,
      groupset: overrides.groupset || undefined,
      motorBrand: overrides.motorBrand || undefined,
      motorModel: overrides.motorModel || undefined,
      batterySerial: overrides.batterySerial || undefined,
      frameNumber: overrides.frameNumber || `FRAME-${ref}`,
      serialNumber: overrides.serialNumber || undefined,
      registrationNumber: overrides.registrationNumber || undefined,
      notes: overrides.notes || "Workshop-linked bike record",
    }),
  });

  assert.equal(response.status, 201, JSON.stringify(response.json));
  return response.json.bike;
};

const updateBike = async (bikeId, overrides = {}) => {
  const response = await fetchJson(`/api/customers/bikes/${bikeId}`, {
    method: "PATCH",
    headers: STAFF_HEADERS,
    body: JSON.stringify(overrides),
  });

  assert.equal(response.status, 200, JSON.stringify(response.json));
  return response.json.bike;
};

const extractQuoteToken = (publicPath) => {
  const match = publicPath.match(/\/quote\/([^/?#]+)/);
  assert.ok(match, `Expected quote token in public path: ${publicPath}`);
  return decodeURIComponent(match[1]);
};

const waitForNotification = async (where, expectedStatus) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const notification = await prisma.workshopNotification.findFirst({
      where,
      orderBy: { createdAt: "desc" },
    });

    if (notification && (!expectedStatus || notification.deliveryStatus === expectedStatus)) {
      return notification;
    }

    await sleep(100);
  }

  return prisma.workshopNotification.findFirst({
    where,
    orderBy: { createdAt: "desc" },
  });
};

const createWorkshopWorkingHours = async (state, input) => {
  const record = await prisma.workshopWorkingHours.create({
    data: input,
  });
  state.workingHoursIds.add(record.id);
  return record;
};

const createWorkshopTimeOff = async (state, input) => {
  const record = await prisma.workshopTimeOff.create({
    data: input,
  });
  state.timeOffIds.add(record.id);
  return record;
};

const patchWorkshopJobSchedule = async (jobId, body, headers = MANAGER_HEADERS) => {
  return fetchJson(`/api/workshop/jobs/${jobId}/schedule`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
};

const cleanup = async (state) => {
  const workshopJobIds = Array.from(state.workshopJobIds);
  const customerIds = Array.from(state.customerIds);
  const userIds = Array.from(state.userIds);
  const workingHoursIds = Array.from(state.workingHoursIds);
  const timeOffIds = Array.from(state.timeOffIds);

  await prisma.auditEvent.deleteMany({
    where: {
      OR: [
        { actorId: { in: [STAFF_USER_ID, MANAGER_USER_ID] } },
        workshopJobIds.length > 0 ? { entityId: { in: workshopJobIds } } : undefined,
      ].filter(Boolean),
    },
  });

  if (workshopJobIds.length > 0) {
    await prisma.workshopNotification.deleteMany({
      where: { workshopJobId: { in: workshopJobIds } },
    });
    await prisma.workshopEstimateLine.deleteMany({
      where: {
        estimate: {
          workshopJobId: {
            in: workshopJobIds,
          },
        },
      },
    });
    await prisma.workshopEstimate.deleteMany({
      where: { workshopJobId: { in: workshopJobIds } },
    });
    await prisma.workshopJobNote.deleteMany({
      where: { workshopJobId: { in: workshopJobIds } },
    });
    await prisma.workshopJobLine.deleteMany({
      where: { jobId: { in: workshopJobIds } },
    });
    await prisma.workshopJob.deleteMany({
      where: { id: { in: workshopJobIds } },
    });
  }

  if (timeOffIds.length > 0) {
    await prisma.workshopTimeOff.deleteMany({
      where: { id: { in: timeOffIds } },
    });
  }

  if (workingHoursIds.length > 0) {
    await prisma.workshopWorkingHours.deleteMany({
      where: { id: { in: workingHoursIds } },
    });
  }

  if (customerIds.length > 0) {
    await prisma.customer.deleteMany({
      where: { id: { in: customerIds } },
    });
  }

  if (userIds.length > 0) {
    await prisma.user.deleteMany({
      where: { id: { in: userIds } },
    });
  }
};

const run = async () => {
  const state = {
    workshopJobIds: new Set(),
    customerIds: new Set(),
    userIds: new Set(),
    workingHoursIds: new Set(),
    timeOffIds: new Set(),
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
    activeAppBaseUrl = serverController.getBaseUrl();

    const staffUser = await prisma.user.create({
      data: {
        id: STAFF_USER_ID,
        username: `staff_${RUN_REF}`,
        name: "M83 Staff",
        passwordHash: "test",
        role: "STAFF",
        operationalRole: "WORKSHOP",
      },
    });
    state.userIds.add(staffUser.id);

    const managerUser = await prisma.user.create({
      data: {
        id: MANAGER_USER_ID,
        username: `manager_${RUN_REF}`,
        name: "M83 Manager",
        passwordHash: "test",
        role: "MANAGER",
        operationalRole: "WORKSHOP",
      },
    });
    state.userIds.add(managerUser.id);

    const results = [];

    await runTest("approval status persists, is idempotent, and appears in dashboard filters", async () => {
      const { job } = await createJob(state);

      const addLine = await fetchJson(`/api/workshop/jobs/${job.id}/lines`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          type: "LABOUR",
          description: "Brake service estimate",
          qty: 1,
          unitPricePence: 4500,
        }),
      });
      assert.equal(addLine.status, 201, JSON.stringify(addLine.json));

      const waitingApproval = await fetchJson(`/api/workshop/jobs/${job.id}/approval`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "WAITING_FOR_APPROVAL" }),
      });
      assert.equal(waitingApproval.status, 201, JSON.stringify(waitingApproval.json));
      assert.equal(waitingApproval.json.job.status, "WAITING_FOR_APPROVAL");

      const replay = await fetchJson(`/api/workshop/jobs/${job.id}/approval`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "WAITING_FOR_APPROVAL" }),
      });
      assert.equal(replay.status, 200, JSON.stringify(replay.json));
      assert.equal(replay.json.idempotent, true);

      const detail = await fetchJson(`/api/workshop/jobs/${job.id}`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(detail.status, 200, JSON.stringify(detail.json));
      assert.equal(detail.json.job.rawStatus, "WAITING_FOR_APPROVAL");
      assert.equal(detail.json.lines.length, 1);
      assert.equal(detail.json.currentEstimate.status, "PENDING_APPROVAL");
      assert.equal(detail.json.currentEstimate.version, 1);
      assert.equal(detail.json.estimateHistory.length, 1);
      assert.equal(detail.json.currentEstimate.subtotalPence, 4500);

      const dashboard = await fetchJson(
        `/api/workshop/dashboard?status=WAITING_FOR_APPROVAL&limit=20`,
        { headers: STAFF_HEADERS },
      );
      assert.equal(dashboard.status, 200, JSON.stringify(dashboard.json));
      assert.ok(
        dashboard.json.jobs.some((dashboardJob) => dashboardJob.id === job.id),
        JSON.stringify(dashboard.json),
      );

      const audit = await fetchJson(
        `/api/audit?entityType=WORKSHOP_JOB&entityId=${job.id}&action=JOB_APPROVAL_STATUS_CHANGED&limit=20`,
        { headers: MANAGER_HEADERS },
      );
      assert.equal(audit.status, 200, JSON.stringify(audit.json));
      assert.ok(audit.json.events.length >= 1, JSON.stringify(audit.json));
    }, results);

    await runTest("approval can move to APPROVED, stale estimates are invalidated by line changes, and history is preserved", async () => {
      const { job } = await createJob(state);

      const addLine = await fetchJson(`/api/workshop/jobs/${job.id}/lines`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          type: "LABOUR",
          description: "Full service labour",
          qty: 1,
          unitPricePence: 6000,
        }),
      });
      assert.equal(addLine.status, 201, JSON.stringify(addLine.json));

      const approved = await fetchJson(`/api/workshop/jobs/${job.id}/approval`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "APPROVED" }),
      });
      assert.equal(approved.status, 201, JSON.stringify(approved.json));
      assert.equal(approved.json.job.status, "APPROVED");

      const updateLine = await fetchJson(
        `/api/workshop/jobs/${job.id}/lines/${addLine.json.line.id}`,
        {
          method: "PATCH",
          headers: STAFF_HEADERS,
          body: JSON.stringify({
            description: "Full service labour plus wheel true",
            qty: 1,
            unitPricePence: 7200,
          }),
        },
      );
      assert.equal(updateLine.status, 200, JSON.stringify(updateLine.json));

      const invalidatedDetail = await fetchJson(`/api/workshop/jobs/${job.id}`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(invalidatedDetail.status, 200, JSON.stringify(invalidatedDetail.json));
      assert.equal(invalidatedDetail.json.currentEstimate, null);
      assert.equal(invalidatedDetail.json.job.rawStatus, "BIKE_ARRIVED");
      assert.equal(invalidatedDetail.json.estimateHistory.length, 1);
      assert.ok(invalidatedDetail.json.estimateHistory[0].supersededAt, JSON.stringify(invalidatedDetail.json));

      const reRequest = await fetchJson(`/api/workshop/jobs/${job.id}/approval`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "WAITING_FOR_APPROVAL" }),
      });
      assert.equal(reRequest.status, 201, JSON.stringify(reRequest.json));

      const refreshedDetail = await fetchJson(`/api/workshop/jobs/${job.id}`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(refreshedDetail.status, 200, JSON.stringify(refreshedDetail.json));
      assert.equal(refreshedDetail.json.currentEstimate.status, "PENDING_APPROVAL");
      assert.equal(refreshedDetail.json.currentEstimate.version, 2);
      assert.equal(refreshedDetail.json.estimateHistory.length, 2);

      await prisma.workshopJob.update({
        where: { id: job.id },
        data: { status: "BIKE_READY" },
      });

      const invalid = await fetchJson(`/api/workshop/jobs/${job.id}/approval`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "WAITING_FOR_APPROVAL" }),
      });
      assert.equal(invalid.status, 409, JSON.stringify(invalid.json));
      assert.equal(invalid.json.error.code, "INVALID_APPROVAL_STATE_TRANSITION");
    }, results);

    await runTest("customer bike records can be linked directly to workshop jobs", async () => {
      const customer = await createCustomer(state, {
        name: `Bike Record Customer ${uniqueRef()}`,
      });
      const bike = await createBike(state, customer.id, {
        label: "Blue commuter",
        make: "Genesis",
        model: "Croix de Fer",
      });

      const { job } = await createJob(state, {
        customerId: customer.id,
        bikeId: bike.id,
        customerName: undefined,
        bikeDescription: undefined,
      });

      const detail = await fetchJson(`/api/workshop/jobs/${job.id}`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(detail.status, 200, JSON.stringify(detail.json));
      assert.equal(detail.json.job.customerId, customer.id);
      assert.equal(detail.json.job.bike.id, bike.id);
      assert.match(detail.json.job.bikeDescription, /Blue commuter/);
      assert.match(detail.json.job.bikeDescription, /Genesis Croix de Fer/);
    }, results);

    await runTest("customer bike structured profile fields round-trip through create and update flows", async () => {
      const customer = await createCustomer(state, {
        name: `Bike Profile Customer ${uniqueRef()}`,
      });
      const bike = await createBike(state, customer.id, {
        label: "Structured bike",
        make: "Specialized",
        model: "Turbo Vado",
        year: MAX_VALID_BIKE_YEAR,
        bikeType: "ROAD",
        wheelSize: "700c",
        frameSize: "L",
        groupset: "Shimano Deore",
        motorBrand: "Brose",
        motorModel: "Drive S Mag",
        batterySerial: "BAT-12345",
      });

      assert.equal(bike.year, MAX_VALID_BIKE_YEAR);
      assert.equal(bike.bikeType, "ROAD");
      assert.equal(bike.wheelSize, "700c");
      assert.equal(bike.frameSize, "L");
      assert.equal(bike.groupset, "Shimano Deore");
      assert.equal(bike.motorBrand, "Brose");
      assert.equal(bike.motorModel, "Drive S Mag");
      assert.equal(bike.batterySerial, "BAT-12345");
      assert.match(bike.displayName, /Structured bike/);
      assert.doesNotMatch(bike.displayName, /E-BIKE/);

      const updatedBike = await updateBike(bike.id, {
        year: CURRENT_YEAR,
        bikeType: "E-BIKE",
        wheelSize: "650b",
        frameSize: "M",
        groupset: "Shimano GRX",
        motorBrand: null,
        motorModel: null,
        batterySerial: null,
      });

      assert.equal(updatedBike.year, CURRENT_YEAR);
      assert.equal(updatedBike.bikeType, "E_BIKE");
      assert.equal(updatedBike.wheelSize, "650b");
      assert.equal(updatedBike.frameSize, "M");
      assert.equal(updatedBike.groupset, "Shimano GRX");
      assert.equal(updatedBike.motorBrand, null);
      assert.equal(updatedBike.motorModel, null);
      assert.equal(updatedBike.batterySerial, null);

      const history = await fetchJson(`/api/customers/bikes/${bike.id}`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(history.status, 200, JSON.stringify(history.json));
      assert.equal(history.json.bike.year, CURRENT_YEAR);
      assert.equal(history.json.bike.bikeType, "E_BIKE");
      assert.equal(history.json.bike.groupset, "Shimano GRX");
      assert.equal(history.json.bike.motorBrand, null);
    }, results);

    await runTest("customer bike year bounds and bike type vocabulary reject invalid input on create and update", async () => {
      const customer = await createCustomer(state, {
        name: `Bike Validation Customer ${uniqueRef()}`,
      });

      const invalidYearLow = await fetchJson(`/api/customers/${customer.id}/bikes`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          label: "Too old bike",
          year: TOO_LOW_BIKE_YEAR,
        }),
      });
      assert.equal(invalidYearLow.status, 400, JSON.stringify(invalidYearLow.json));
      assert.equal(invalidYearLow.json.error.code, "INVALID_CUSTOMER_BIKE_YEAR");

      const invalidYearHigh = await fetchJson(`/api/customers/${customer.id}/bikes`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          label: "Future bike",
          year: TOO_HIGH_BIKE_YEAR,
        }),
      });
      assert.equal(invalidYearHigh.status, 400, JSON.stringify(invalidYearHigh.json));
      assert.equal(invalidYearHigh.json.error.code, "INVALID_CUSTOMER_BIKE_YEAR");

      const invalidBikeType = await fetchJson(`/api/customers/${customer.id}/bikes`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          label: "Mystery bike",
          bikeType: "SPACESHIP",
        }),
      });
      assert.equal(invalidBikeType.status, 400, JSON.stringify(invalidBikeType.json));
      assert.equal(invalidBikeType.json.error.code, "INVALID_CUSTOMER_BIKE_TYPE");

      const bike = await createBike(state, customer.id, {
        label: "Validation parity bike",
        year: CURRENT_YEAR,
        bikeType: "GRAVEL",
      });

      const updateInvalidYear = await fetchJson(`/api/customers/bikes/${bike.id}`, {
        method: "PATCH",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          year: TOO_HIGH_BIKE_YEAR,
        }),
      });
      assert.equal(updateInvalidYear.status, 400, JSON.stringify(updateInvalidYear.json));
      assert.equal(updateInvalidYear.json.error.code, "INVALID_CUSTOMER_BIKE_YEAR");

      const updateInvalidBikeType = await fetchJson(`/api/customers/bikes/${bike.id}`, {
        method: "PATCH",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          bikeType: "UNKNOWN_FAST_BIKE",
        }),
      });
      assert.equal(updateInvalidBikeType.status, 400, JSON.stringify(updateInvalidBikeType.json));
      assert.equal(updateInvalidBikeType.json.error.code, "INVALID_CUSTOMER_BIKE_TYPE");
    }, results);

    await runTest("bike history only includes truly linked jobs and exposes workshop history details", async () => {
      const customer = await createCustomer(state, {
        name: `Bike History Customer ${uniqueRef()}`,
      });
      const bike = await createBike(state, customer.id, {
        label: "History bike",
        make: "Specialized",
        model: "Sirrus",
      });

      const { job: linkedJob } = await createJob(state, {
        customerId: customer.id,
        bikeId: bike.id,
        customerName: undefined,
        bikeDescription: undefined,
      });

      const addLine = await fetchJson(`/api/workshop/jobs/${linkedJob.id}/lines`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          type: "LABOUR",
          description: "Bike history labour",
          qty: 1,
          unitPricePence: 4800,
        }),
      });
      assert.equal(addLine.status, 201, JSON.stringify(addLine.json));

      const requestApproval = await fetchJson(`/api/workshop/jobs/${linkedJob.id}/approval`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "WAITING_FOR_APPROVAL" }),
      });
      assert.equal(requestApproval.status, 201, JSON.stringify(requestApproval.json));

      const addNote = await fetchJson(`/api/workshop/jobs/${linkedJob.id}/notes`, {
        method: "POST",
        headers: MANAGER_HEADERS,
        body: JSON.stringify({
          visibility: "INTERNAL",
          note: "Bike history inspection note",
        }),
      });
      assert.equal(addNote.status, 201, JSON.stringify(addNote.json));

      await prisma.workshopJob.update({
        where: { id: linkedJob.id },
        data: {
          assignedStaffId: managerUser.id,
          assignedStaffName: managerUser.name,
        },
      });

      const { job: legacyJob } = await createJob(state, {
        customerId: customer.id,
        customerName: undefined,
        bikeDescription: "History bike | Specialized Sirrus",
      });
      assert.ok(legacyJob.id);

      const bikeList = await fetchJson(`/api/customers/${customer.id}/bikes`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(bikeList.status, 200, JSON.stringify(bikeList.json));
      const listedBike = bikeList.json.bikes.find((row) => row.id === bike.id);
      assert.ok(listedBike, JSON.stringify(bikeList.json));
      assert.equal(listedBike.serviceSummary.linkedJobCount, 1);

      const history = await fetchJson(`/api/customers/bikes/${bike.id}`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(history.status, 200, JSON.stringify(history.json));
      assert.equal(history.json.bike.id, bike.id);
      assert.equal(history.json.customer.id, customer.id);
      assert.equal(history.json.serviceSummary.linkedJobCount, 1);
      assert.equal(history.json.history.length, 1);
      assert.equal(history.json.history[0].id, linkedJob.id);
      assert.equal(history.json.history[0].jobPath, `/workshop/${linkedJob.id}`);
      assert.equal(history.json.history[0].assignedTechnician.name, managerUser.name);
      assert.equal(history.json.history[0].liveTotals.subtotalPence, 4800);
      assert.equal(history.json.history[0].moneySummary.labourTotalPence, 4800);
      assert.equal(history.json.history[0].moneySummary.partsTotalPence, 0);
      assert.equal(history.json.history[0].moneySummary.primaryTotalPence, 4800);
      assert.equal(history.json.history[0].moneySummary.primaryTotalSource, "ESTIMATE");
      assert.equal(history.json.history[0].estimate.status, "PENDING_APPROVAL");
      assert.match(history.json.history[0].serviceSummaryText, /Bike history inspection note|quote|line/i);
      assert.match(history.json.history[0].notes.latestNote.note, /Bike history inspection note/);
      assert.ok(
        history.json.limitations[0].includes("Legacy free-text workshop jobs without a bike link"),
        JSON.stringify(history.json),
      );
      assert.equal(history.json.workshopStartContext.defaults.customerId, customer.id);
      assert.equal(history.json.workshopStartContext.defaults.bikeId, bike.id);
      assert.match(history.json.workshopStartContext.defaults.bikeDescription, /History bike/);
      assert.equal(history.json.workshopStartContext.startPath, `/workshop/check-in?bikeId=${bike.id}`);
    }, results);

    await runTest("bike workshop-start context returns safe defaults and mismatched customer-bike creation is rejected", async () => {
      const customer = await createCustomer(state, {
        name: `Bike Start Customer ${uniqueRef()}`,
      });
      const otherCustomer = await createCustomer(state, {
        name: `Bike Start Other Customer ${uniqueRef()}`,
      });
      const bike = await createBike(state, customer.id, {
        label: "Workshop start bike",
        make: "Cannondale",
        model: "Synapse",
      });

      const startContext = await fetchJson(`/api/customers/bikes/${bike.id}/workshop-start`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(startContext.status, 200, JSON.stringify(startContext.json));
      assert.equal(startContext.json.customer.id, customer.id);
      assert.equal(startContext.json.bike.id, bike.id);
      assert.equal(startContext.json.defaults.customerId, customer.id);
      assert.equal(startContext.json.defaults.customerName, customer.name);
      assert.equal(startContext.json.defaults.bikeId, bike.id);
      assert.equal(startContext.json.defaults.status, "BOOKED");
      assert.match(startContext.json.defaults.bikeDescription, /Workshop start bike/);
      assert.equal(startContext.json.startPath, `/workshop/check-in?bikeId=${bike.id}`);

      const mismatch = await fetchJson("/api/workshop/jobs", {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          customerId: otherCustomer.id,
          bikeId: bike.id,
          status: "BOOKED",
        }),
      });
      assert.equal(mismatch.status, 409, JSON.stringify(mismatch.json));
      assert.equal(mismatch.json.error.code, "WORKSHOP_BIKE_CUSTOMER_MISMATCH");
    }, results);

    await runTest("timed workshop jobs derive schedule fields, reject store-closed slots, and validate end-time consistency", async () => {
      const scheduledDate = addDays(todayUtc(), 16);
      const validStart = toScheduledSlot(scheduledDate, 11, 0);

      const scheduledJob = await fetchJson("/api/workshop/jobs", {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          customerName: `Scheduled Customer ${uniqueRef()}`,
          bikeDescription: "Timed workshop job",
          scheduledStartAt: validStart.toISOString(),
          durationMinutes: 90,
          status: "BOOKED",
        }),
      });
      assert.equal(scheduledJob.status, 201, JSON.stringify(scheduledJob.json));
      state.workshopJobIds.add(scheduledJob.json.id);
      assert.equal(
        new Date(scheduledJob.json.scheduledStartAt).toISOString(),
        validStart.toISOString(),
      );
      assert.equal(scheduledJob.json.durationMinutes, 90);
      assert.equal(
        new Date(scheduledJob.json.scheduledEndAt).toISOString(),
        new Date(validStart.getTime() + (90 * 60_000)).toISOString(),
      );
      assert.equal(
        new Date(scheduledJob.json.scheduledDate).toISOString(),
        new Date(validStart.toISOString().slice(0, 10) + "T00:00:00.000Z").toISOString(),
      );

      const invalidStoreHours = await fetchJson("/api/workshop/jobs", {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          customerName: `Too Early ${uniqueRef()}`,
          bikeDescription: "Before opening",
          scheduledStartAt: toScheduledSlot(scheduledDate, 2, 0).toISOString(),
          durationMinutes: 60,
          status: "BOOKED",
        }),
      });
      assert.equal(invalidStoreHours.status, 409, JSON.stringify(invalidStoreHours.json));
      assert.equal(
        invalidStoreHours.json.error.code,
        "WORKSHOP_SCHEDULE_OUTSIDE_STORE_HOURS",
      );

      const invalidEndTime = await fetchJson(`/api/workshop/jobs/${scheduledJob.json.id}`, {
        method: "PATCH",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          scheduledStartAt: validStart.toISOString(),
          durationMinutes: 90,
          scheduledEndAt: new Date(validStart.getTime() + (30 * 60_000)).toISOString(),
        }),
      });
      assert.equal(invalidEndTime.status, 400, JSON.stringify(invalidEndTime.json));
      assert.equal(invalidEndTime.json.error.code, "INVALID_WORKSHOP_SCHEDULE");
    }, results);

    await runTest("staff assignment to timed workshop jobs respects working hours, time off, and overlap rules", async () => {
      const scheduledDate = addDays(todayUtc(), 17);
      const dayOfWeek = getWorkshopDayOfWeek(scheduledDate);
      assert.notEqual(dayOfWeek, undefined);

      await createWorkshopWorkingHours(state, {
        staffId: managerUser.id,
        dayOfWeek,
        startTime: "00:00",
        endTime: "23:59",
      });

      const firstStart = toScheduledSlot(scheduledDate, 11, 0);
      const { job: firstJob } = await createJob(state, {
        customerName: `Scheduled Assign ${uniqueRef()}`,
        bikeDescription: "First timed assignment",
        scheduledStartAt: firstStart.toISOString(),
        durationMinutes: 60,
      });

      const assignFirst = await fetchJson(`/api/workshop/jobs/${firstJob.id}/assign`, {
        method: "POST",
        headers: MANAGER_HEADERS,
        body: JSON.stringify({ staffId: managerUser.id }),
      });
      assert.equal(assignFirst.status, 201, JSON.stringify(assignFirst.json));

      const overlappingStart = toScheduledSlot(scheduledDate, 11, 30);
      const { job: overlappingJob } = await createJob(state, {
        customerName: `Scheduled Overlap ${uniqueRef()}`,
        bikeDescription: "Overlap timed assignment",
        scheduledStartAt: overlappingStart.toISOString(),
        durationMinutes: 45,
      });

      const overlapAssign = await fetchJson(`/api/workshop/jobs/${overlappingJob.id}/assign`, {
        method: "POST",
        headers: MANAGER_HEADERS,
        body: JSON.stringify({ staffId: managerUser.id }),
      });
      assert.equal(overlapAssign.status, 409, JSON.stringify(overlapAssign.json));
      assert.equal(overlapAssign.json.error.code, "WORKSHOP_SCHEDULE_OVERLAP");

      const timeOffStart = toScheduledSlot(scheduledDate, 15, 0);
      await createWorkshopTimeOff(state, {
        staffId: managerUser.id,
        startAt: timeOffStart,
        endAt: new Date(timeOffStart.getTime() + (60 * 60_000)),
        reason: "Annual leave",
      });

      const blockedStart = toScheduledSlot(scheduledDate, 15, 15);
      const { job: blockedJob } = await createJob(state, {
        customerName: `Scheduled Time Off ${uniqueRef()}`,
        bikeDescription: "Time-off blocked assignment",
        scheduledStartAt: blockedStart.toISOString(),
        durationMinutes: 30,
      });

      const blockedAssign = await fetchJson(`/api/workshop/jobs/${blockedJob.id}/assign`, {
        method: "POST",
        headers: MANAGER_HEADERS,
        body: JSON.stringify({ staffId: managerUser.id }),
      });
      assert.equal(blockedAssign.status, 409, JSON.stringify(blockedAssign.json));
      assert.equal(blockedAssign.json.error.code, "WORKSHOP_SCHEDULE_TIME_OFF");
    }, results);

    await runTest("calendar api returns staff rows, scheduled jobs, and capacity clipped to working hours", async () => {
      const scheduledDate = addDays(todayUtc(), 18);
      const dateKey = scheduledDate.toISOString().slice(0, 10);
      const dayOfWeek = getWorkshopDayOfWeek(scheduledDate);
      assert.notEqual(dayOfWeek, undefined);

      await createWorkshopWorkingHours(state, {
        staffId: managerUser.id,
        dayOfWeek,
        startTime: "09:00",
        endTime: "17:00",
      });

      await createWorkshopTimeOff(state, {
        staffId: managerUser.id,
        startAt: toScheduledSlot(scheduledDate, 6, 0),
        endAt: toScheduledSlot(scheduledDate, 10, 0),
        reason: "Morning appointment",
      });

      await createWorkshopTimeOff(state, {
        staffId: managerUser.id,
        startAt: toScheduledSlot(scheduledDate, 12, 0),
        endAt: toScheduledSlot(scheduledDate, 13, 0),
        reason: "Lunch block",
      });

      await createWorkshopTimeOff(state, {
        staffId: managerUser.id,
        startAt: toScheduledSlot(scheduledDate, 17, 0),
        endAt: toScheduledSlot(scheduledDate, 18, 0),
        reason: "After hours hold",
      });

      await createWorkshopTimeOff(state, {
        staffId: null,
        startAt: toScheduledSlot(scheduledDate, 16, 0),
        endAt: toScheduledSlot(scheduledDate, 18, 0),
        reason: "Workshop briefing",
      });

      const { job } = await createJob(state, {
        customerName: `Calendar Job ${uniqueRef()}`,
        bikeDescription: "Calendar visibility job",
        scheduledStartAt: toScheduledSlot(scheduledDate, 10, 30).toISOString(),
        durationMinutes: 60,
      });

      const scheduled = await patchWorkshopJobSchedule(job.id, {
        staffId: managerUser.id,
      });
      assert.equal(scheduled.status, 201, JSON.stringify(scheduled.json));

      const calendar = await fetchJson(
        `/api/workshop/calendar?from=${dateKey}&to=${dateKey}`,
        { headers: STAFF_HEADERS },
      );
      assert.equal(calendar.status, 200, JSON.stringify(calendar.json));
      assert.equal(calendar.json.range.from, dateKey);
      assert.equal(calendar.json.range.to, dateKey);
      assert.ok(Array.isArray(calendar.json.staff), JSON.stringify(calendar.json));
      assert.ok(Array.isArray(calendar.json.scheduledJobs), JSON.stringify(calendar.json));

      const scheduledJob = calendar.json.scheduledJobs.find((entry) => entry.id === job.id);
      assert.ok(scheduledJob, JSON.stringify(calendar.json));
      assert.equal(scheduledJob.assignedStaffId, managerUser.id);
      assert.equal(scheduledJob.jobPath, `/workshop/${job.id}`);

      const staffRow = calendar.json.staff.find((entry) => entry.id === managerUser.id);
      assert.ok(staffRow, JSON.stringify(calendar.json));
      assert.equal(staffRow.workingHours.length, 1);
      assert.equal(staffRow.workingHours[0].date, dateKey);
      assert.equal(staffRow.workingHours[0].startTime, "09:00");
      assert.equal(staffRow.workingHours[0].endTime, "17:00");

      const capacity = staffRow.dailyCapacity.find((entry) => entry.date === dateKey);
      assert.ok(capacity, JSON.stringify(staffRow));
      assert.equal(capacity.totalMinutes, 480);
      assert.equal(capacity.bookedMinutes, 60);
      assert.equal(capacity.timeOffMinutes, 180);
      assert.equal(capacity.availableMinutes, 240);

      assert.ok(
        calendar.json.workshopTimeOff.some((entry) => entry.reason === "Workshop briefing"),
        JSON.stringify(calendar.json.workshopTimeOff),
      );
      assert.ok(
        staffRow.scheduledJobs.some((entry) => entry.id === job.id),
        JSON.stringify(staffRow.scheduledJobs),
      );
    }, results);

    await runTest("schedule patch endpoint supports assign, partial reschedule, clear, and overlap-safe validation", async () => {
      const scheduledDate = addDays(todayUtc(), 19);
      const dayOfWeek = getWorkshopDayOfWeek(scheduledDate);
      assert.notEqual(dayOfWeek, undefined);

      await createWorkshopWorkingHours(state, {
        staffId: managerUser.id,
        dayOfWeek,
        startTime: "09:00",
        endTime: "17:00",
      });

      const { job: jobToSchedule } = await createJob(state, {
        customerName: `Patch Schedule ${uniqueRef()}`,
        bikeDescription: "Schedule patch target",
        scheduledStartAt: null,
        scheduledEndAt: null,
        durationMinutes: null,
      });

      const firstPatch = await patchWorkshopJobSchedule(jobToSchedule.id, {
        staffId: managerUser.id,
        scheduledStartAt: toScheduledSlot(scheduledDate, 11, 0).toISOString(),
        durationMinutes: 45,
      });
      assert.equal(firstPatch.status, 201, JSON.stringify(firstPatch.json));
      assert.equal(firstPatch.json.job.assignedStaffId, managerUser.id);
      assert.equal(firstPatch.json.job.durationMinutes, 45);
      assert.equal(
        new Date(firstPatch.json.job.scheduledEndAt).toISOString(),
        toScheduledSlot(scheduledDate, 11, 45).toISOString(),
      );

      const durationOnlyPatch = await patchWorkshopJobSchedule(jobToSchedule.id, {
        durationMinutes: 90,
      });
      assert.equal(durationOnlyPatch.status, 201, JSON.stringify(durationOnlyPatch.json));
      assert.equal(durationOnlyPatch.json.job.durationMinutes, 90);
      assert.equal(
        new Date(durationOnlyPatch.json.job.scheduledStartAt).toISOString(),
        toScheduledSlot(scheduledDate, 11, 0).toISOString(),
      );
      assert.equal(
        new Date(durationOnlyPatch.json.job.scheduledEndAt).toISOString(),
        toScheduledSlot(scheduledDate, 12, 30).toISOString(),
      );

      const startOnlyPatch = await patchWorkshopJobSchedule(jobToSchedule.id, {
        scheduledStartAt: toScheduledSlot(scheduledDate, 12, 0).toISOString(),
      });
      assert.equal(startOnlyPatch.status, 201, JSON.stringify(startOnlyPatch.json));
      assert.equal(
        new Date(startOnlyPatch.json.job.scheduledStartAt).toISOString(),
        toScheduledSlot(scheduledDate, 12, 0).toISOString(),
      );
      assert.equal(
        new Date(startOnlyPatch.json.job.scheduledEndAt).toISOString(),
        toScheduledSlot(scheduledDate, 13, 30).toISOString(),
      );

      const replayPatch = await patchWorkshopJobSchedule(jobToSchedule.id, {
        scheduledStartAt: toScheduledSlot(scheduledDate, 12, 0).toISOString(),
      });
      assert.equal(replayPatch.status, 200, JSON.stringify(replayPatch.json));
      assert.equal(replayPatch.json.idempotent, true);

      const clearedPatch = await patchWorkshopJobSchedule(jobToSchedule.id, {
        clearSchedule: true,
      });
      assert.equal(clearedPatch.status, 201, JSON.stringify(clearedPatch.json));
      assert.equal(clearedPatch.json.job.scheduledDate, null);
      assert.equal(clearedPatch.json.job.scheduledStartAt, null);
      assert.equal(clearedPatch.json.job.scheduledEndAt, null);
      assert.equal(clearedPatch.json.job.durationMinutes, null);
      assert.equal(clearedPatch.json.job.assignedStaffId, managerUser.id);

      const clearReplay = await patchWorkshopJobSchedule(jobToSchedule.id, {
        clearSchedule: true,
      });
      assert.equal(clearReplay.status, 200, JSON.stringify(clearReplay.json));
      assert.equal(clearReplay.json.idempotent, true);

      const invalidPartial = await patchWorkshopJobSchedule(jobToSchedule.id, {
        scheduledStartAt: toScheduledSlot(scheduledDate, 14, 0).toISOString(),
      });
      assert.equal(invalidPartial.status, 400, JSON.stringify(invalidPartial.json));
      assert.equal(invalidPartial.json.error.code, "INVALID_WORKSHOP_SCHEDULE");

      const { job: firstAssignedJob } = await createJob(state, {
        customerName: `Scheduled Existing ${uniqueRef()}`,
        bikeDescription: "Existing scheduled job",
        scheduledStartAt: toScheduledSlot(scheduledDate, 15, 0).toISOString(),
        durationMinutes: 60,
      });

      const assignExisting = await patchWorkshopJobSchedule(firstAssignedJob.id, {
        staffId: managerUser.id,
      });
      assert.equal(assignExisting.status, 201, JSON.stringify(assignExisting.json));

      const { job: overlappingJob } = await createJob(state, {
        customerName: `Scheduled Candidate ${uniqueRef()}`,
        bikeDescription: "Overlap candidate",
        scheduledStartAt: null,
        scheduledEndAt: null,
        durationMinutes: null,
      });

      const overlapAttempt = await patchWorkshopJobSchedule(overlappingJob.id, {
        staffId: managerUser.id,
        scheduledStartAt: toScheduledSlot(scheduledDate, 15, 30).toISOString(),
        durationMinutes: 30,
      });
      assert.equal(overlapAttempt.status, 409, JSON.stringify(overlapAttempt.json));
      assert.equal(overlapAttempt.json.error.code, "WORKSHOP_SCHEDULE_OVERLAP");
    }, results);

    await runTest("customer quote links allow safe approval and stale links cannot approve superseded estimates", async () => {
      const { job } = await createJob(state);

      const addLine = await fetchJson(`/api/workshop/jobs/${job.id}/lines`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          type: "LABOUR",
          description: "Customer quote labour",
          qty: 1,
          unitPricePence: 6500,
        }),
      });
      assert.equal(addLine.status, 201, JSON.stringify(addLine.json));

      const waitingApproval = await fetchJson(`/api/workshop/jobs/${job.id}/approval`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "WAITING_FOR_APPROVAL" }),
      });
      assert.equal(waitingApproval.status, 201, JSON.stringify(waitingApproval.json));

      const pendingDetail = await fetchJson(`/api/workshop/jobs/${job.id}`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(pendingDetail.status, 200, JSON.stringify(pendingDetail.json));
      assert.equal(pendingDetail.json.currentEstimate.customerQuote.status, "ACTIVE");

      const link = await fetchJson(`/api/workshop/jobs/${job.id}/customer-quote-link`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({}),
      });
      assert.equal(link.status, 200, JSON.stringify(link.json));
      assert.equal(link.json.idempotent, true);
      assert.equal(link.json.customerQuote.status, "ACTIVE");
      const quoteToken = extractQuoteToken(link.json.customerQuote.publicPath);

      const publicQuote = await fetchJson(`/api/public/workshop-quotes/${quoteToken}`);
      assert.equal(publicQuote.status, 200, JSON.stringify(publicQuote.json));
      assert.equal(publicQuote.json.quote.accessStatus, "ACTIVE");
      assert.equal(publicQuote.json.estimate.status, "PENDING_APPROVAL");
      assert.equal(publicQuote.json.estimate.lines.length, 1);

      const approved = await fetchJson(`/api/public/workshop-quotes/${quoteToken}`, {
        method: "POST",
        body: JSON.stringify({ status: "APPROVED" }),
      });
      assert.equal(approved.status, 201, JSON.stringify(approved.json));
      assert.equal(approved.json.estimate.status, "APPROVED");
      assert.equal(approved.json.estimate.decisionSource, "CUSTOMER");

      const approvedReplay = await fetchJson(`/api/public/workshop-quotes/${quoteToken}`, {
        method: "POST",
        body: JSON.stringify({ status: "APPROVED" }),
      });
      assert.equal(approvedReplay.status, 200, JSON.stringify(approvedReplay.json));
      assert.equal(approvedReplay.json.quote.idempotent, true);

      const approvedDetail = await fetchJson(`/api/workshop/jobs/${job.id}`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(approvedDetail.status, 200, JSON.stringify(approvedDetail.json));
      assert.equal(approvedDetail.json.currentEstimate.status, "APPROVED");
      assert.equal(approvedDetail.json.currentEstimate.decisionSource, "CUSTOMER");
      assert.equal(approvedDetail.json.currentEstimate.customerQuote.status, "ACTIVE");

      const updateLine = await fetchJson(
        `/api/workshop/jobs/${job.id}/lines/${addLine.json.line.id}`,
        {
          method: "PATCH",
          headers: STAFF_HEADERS,
          body: JSON.stringify({
            description: "Customer quote labour plus extra fitting",
            qty: 1,
            unitPricePence: 7800,
          }),
        },
      );
      assert.equal(updateLine.status, 200, JSON.stringify(updateLine.json));

      const staleQuote = await fetchJson(`/api/public/workshop-quotes/${quoteToken}`);
      assert.equal(staleQuote.status, 200, JSON.stringify(staleQuote.json));
      assert.equal(staleQuote.json.quote.accessStatus, "SUPERSEDED");
      assert.equal(staleQuote.json.quote.canApprove, false);

      const staleApprove = await fetchJson(`/api/public/workshop-quotes/${quoteToken}`, {
        method: "POST",
        body: JSON.stringify({ status: "APPROVED" }),
      });
      assert.equal(staleApprove.status, 409, JSON.stringify(staleApprove.json));
      assert.equal(staleApprove.json.error.code, "WORKSHOP_QUOTE_SUPERSEDED");
    }, results);

    await runTest("quote-ready notifications are logged, deduplicated, and skipped safely by channel", async () => {
      const customer = await createCustomer(state, {
        name: "Quote Email Customer",
        email: `quote-ready-${uniqueRef()}@example.com`,
      });
      const { job } = await createJob(state, {
        customerId: customer.id,
        bikeDescription: "Notification commuter",
      });

      const addLine = await fetchJson(`/api/workshop/jobs/${job.id}/lines`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          type: "LABOUR",
          description: "Notification labour",
          qty: 1,
          unitPricePence: 5400,
        }),
      });
      assert.equal(addLine.status, 201, JSON.stringify(addLine.json));

      const waitingApproval = await fetchJson(`/api/workshop/jobs/${job.id}/approval`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "WAITING_FOR_APPROVAL" }),
      });
      assert.equal(waitingApproval.status, 201, JSON.stringify(waitingApproval.json));

      const pendingDetail = await fetchJson(`/api/workshop/jobs/${job.id}`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(pendingDetail.status, 200, JSON.stringify(pendingDetail.json));
      assert.equal(pendingDetail.json.currentEstimate.customerQuote.status, "ACTIVE");

      const sentWhatsAppNotification = await waitForNotification(
        {
          workshopJobId: job.id,
          eventType: "QUOTE_READY",
          channel: "WHATSAPP",
        },
        "SENT",
      );
      assert.ok(sentWhatsAppNotification, "Expected quote-ready WhatsApp notification row");
      assert.equal(sentWhatsAppNotification.deliveryStatus, "SENT");
      assert.equal(sentWhatsAppNotification.recipientPhone, customer.phone);
      assert.ok(
        typeof sentWhatsAppNotification.bodyText === "string" &&
          sentWhatsAppNotification.bodyText.toLowerCase().includes("quote"),
        sentWhatsAppNotification.bodyText,
      );

      const skippedSmsNotification = await waitForNotification(
        {
          workshopJobId: job.id,
          eventType: "QUOTE_READY",
          channel: "SMS",
        },
        "SKIPPED",
      );
      assert.ok(skippedSmsNotification, "Expected skipped quote-ready SMS fallback row");
      assert.equal(skippedSmsNotification.deliveryStatus, "SKIPPED");
      assert.equal(skippedSmsNotification.reasonCode, "FALLBACK_NOT_REQUIRED");

      const skippedEmailNotification = await waitForNotification(
        {
          workshopJobId: job.id,
          eventType: "QUOTE_READY",
          channel: "EMAIL",
        },
        "SKIPPED",
      );
      assert.ok(skippedEmailNotification, "Expected skipped quote-ready email fallback row");
      assert.equal(skippedEmailNotification.deliveryStatus, "SKIPPED");
      assert.equal(skippedEmailNotification.reasonCode, "FALLBACK_NOT_REQUIRED");
      assert.equal(skippedEmailNotification.recipientEmail, customer.email);

      const notificationHistory = await fetchJson(
        `/api/workshop/jobs/${job.id}/notifications`,
        {
          headers: STAFF_HEADERS,
        },
      );
      assert.equal(notificationHistory.status, 200, JSON.stringify(notificationHistory.json));
      assert.equal(notificationHistory.json.workshopJobId, job.id);
      assert.ok(
        notificationHistory.json.notifications.some(
          (notification) =>
            notification.eventType === "QUOTE_READY" &&
            notification.channel === "WHATSAPP" &&
            notification.deliveryStatus === "SENT" &&
            notification.recipientPhone === customer.phone &&
            notification.strategy?.label === "Primary",
        ),
        JSON.stringify(notificationHistory.json),
      );
      assert.ok(
        notificationHistory.json.notifications.some(
          (notification) =>
            notification.eventType === "QUOTE_READY" &&
            notification.channel === "SMS" &&
            notification.deliveryStatus === "SKIPPED" &&
            notification.reasonCode === "FALLBACK_NOT_REQUIRED" &&
            notification.strategy?.label === "Fallback 2",
        ),
        JSON.stringify(notificationHistory.json),
      );
      assert.ok(
        notificationHistory.json.notifications.some(
          (notification) =>
            notification.eventType === "QUOTE_READY" &&
            notification.channel === "EMAIL" &&
            notification.deliveryStatus === "SKIPPED" &&
            notification.reasonCode === "FALLBACK_NOT_REQUIRED" &&
            notification.strategy?.label === "Fallback 3",
        ),
        JSON.stringify(notificationHistory.json),
      );

      const replayApproval = await fetchJson(`/api/workshop/jobs/${job.id}/approval`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "WAITING_FOR_APPROVAL" }),
      });
      assert.equal(replayApproval.status, 200, JSON.stringify(replayApproval.json));

      const notificationCount = await prisma.workshopNotification.count({
        where: {
          workshopJobId: job.id,
          eventType: "QUOTE_READY",
        },
      });
      assert.equal(notificationCount, 3);

      const resendQuote = await fetchJson(
        `/api/workshop/jobs/${job.id}/notifications/resend`,
        {
          method: "POST",
          headers: STAFF_HEADERS,
          body: JSON.stringify({
            eventType: "QUOTE_READY",
          }),
        },
      );
      assert.equal(resendQuote.status, 201, JSON.stringify(resendQuote.json));
      assert.equal(resendQuote.json.notification.eventType, "QUOTE_READY");
      assert.equal(resendQuote.json.notification.channel, "EMAIL");
      assert.equal(resendQuote.json.notification.deliveryStatus, "SENT");
      assert.equal(resendQuote.json.notification.strategy?.label, "Manual resend");
      assert.notEqual(resendQuote.json.notification.id, skippedEmailNotification.id);

      const resentNotificationCount = await prisma.workshopNotification.count({
        where: {
          workshopJobId: job.id,
          eventType: "QUOTE_READY",
        },
      });
      assert.equal(resentNotificationCount, 4);

      const noEmailCustomer = await createCustomer(state, {
        name: "No Email Quote Customer",
        email: undefined,
      });
      const noEmailJob = await createJob(state, {
        customerId: noEmailCustomer.id,
        bikeDescription: "No email city bike",
      });

      const noEmailLine = await fetchJson(`/api/workshop/jobs/${noEmailJob.job.id}/lines`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          type: "LABOUR",
          description: "No email quote labour",
          qty: 1,
          unitPricePence: 4100,
        }),
      });
      assert.equal(noEmailLine.status, 201, JSON.stringify(noEmailLine.json));

      const noEmailApproval = await fetchJson(`/api/workshop/jobs/${noEmailJob.job.id}/approval`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "WAITING_FOR_APPROVAL" }),
      });
      assert.equal(noEmailApproval.status, 201, JSON.stringify(noEmailApproval.json));

      const skippedEmailWithoutAddressNotification = await waitForNotification(
        {
          workshopJobId: noEmailJob.job.id,
          eventType: "QUOTE_READY",
          channel: "EMAIL",
        },
        "SKIPPED",
      );
      assert.ok(
        skippedEmailWithoutAddressNotification,
        "Expected skipped quote-ready email notification row",
      );
      assert.equal(skippedEmailWithoutAddressNotification.deliveryStatus, "SKIPPED");
      assert.equal(
        skippedEmailWithoutAddressNotification.reasonCode,
        "CUSTOMER_EMAIL_MISSING",
      );

      const skippedSmsWithoutEmail = await waitForNotification(
        {
          workshopJobId: noEmailJob.job.id,
          eventType: "QUOTE_READY",
          channel: "SMS",
        },
        "SKIPPED",
      );
      assert.ok(skippedSmsWithoutEmail, "Expected skipped quote-ready SMS fallback without email");
      assert.equal(skippedSmsWithoutEmail.deliveryStatus, "SKIPPED");
      assert.equal(skippedSmsWithoutEmail.reasonCode, "FALLBACK_NOT_REQUIRED");

      const sentWhatsAppWithoutEmail = await waitForNotification(
        {
          workshopJobId: noEmailJob.job.id,
          eventType: "QUOTE_READY",
          channel: "WHATSAPP",
        },
        "SENT",
      );
      assert.ok(sentWhatsAppWithoutEmail, "Expected quote-ready WhatsApp without email");
      assert.equal(sentWhatsAppWithoutEmail.deliveryStatus, "SENT");
      assert.equal(sentWhatsAppWithoutEmail.recipientPhone, noEmailCustomer.phone);

      const noPhoneCustomer = await createCustomer(state, {
        name: "No Phone Quote Customer",
        phone: undefined,
      });
      const noPhoneJob = await createJob(state, {
        customerId: noPhoneCustomer.id,
        bikeDescription: "No phone city bike",
      });

      const noPhoneLine = await fetchJson(`/api/workshop/jobs/${noPhoneJob.job.id}/lines`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          type: "LABOUR",
          description: "No phone quote labour",
          qty: 1,
          unitPricePence: 4300,
        }),
      });
      assert.equal(noPhoneLine.status, 201, JSON.stringify(noPhoneLine.json));

      const noPhoneApproval = await fetchJson(`/api/workshop/jobs/${noPhoneJob.job.id}/approval`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "WAITING_FOR_APPROVAL" }),
      });
      assert.equal(noPhoneApproval.status, 201, JSON.stringify(noPhoneApproval.json));

      const sentEmailWithoutPhone = await waitForNotification(
        {
          workshopJobId: noPhoneJob.job.id,
          eventType: "QUOTE_READY",
          channel: "EMAIL",
        },
        "SENT",
      );
      assert.ok(sentEmailWithoutPhone, "Expected quote-ready email without phone");
      assert.equal(sentEmailWithoutPhone.recipientEmail, noPhoneCustomer.email);

      const skippedSmsWithoutPhoneNotification = await waitForNotification(
        {
          workshopJobId: noPhoneJob.job.id,
          eventType: "QUOTE_READY",
          channel: "SMS",
        },
        "SKIPPED",
      );
      assert.ok(skippedSmsWithoutPhoneNotification, "Expected skipped quote-ready SMS row");
      assert.equal(skippedSmsWithoutPhoneNotification.deliveryStatus, "SKIPPED");
      assert.equal(
        skippedSmsWithoutPhoneNotification.reasonCode,
        "CUSTOMER_PHONE_MISSING",
      );

      const skippedWhatsAppNotification = await waitForNotification(
        {
          workshopJobId: noPhoneJob.job.id,
          eventType: "QUOTE_READY",
          channel: "WHATSAPP",
        },
        "SKIPPED",
      );
      assert.ok(skippedWhatsAppNotification, "Expected skipped quote-ready WhatsApp row");
      assert.equal(skippedWhatsAppNotification.deliveryStatus, "SKIPPED");
      assert.equal(skippedWhatsAppNotification.reasonCode, "CUSTOMER_PHONE_MISSING");

      const disabledWhatsAppCustomer = await createCustomer(state, {
        name: "Disabled WhatsApp Quote Customer",
        email: `disabled-whatsapp-${uniqueRef()}@example.com`,
      });
      const disabledWhatsAppPreferences = await updateCustomerCommunicationPreferences(
        disabledWhatsAppCustomer.id,
        {
          emailAllowed: true,
          smsAllowed: true,
          whatsappAllowed: false,
        },
      );
      assert.equal(disabledWhatsAppPreferences.whatsappAllowed, false);

      const disabledWhatsAppJob = await createJob(state, {
        customerId: disabledWhatsAppCustomer.id,
        bikeDescription: "WhatsApp disabled commuter",
      });

      const disabledWhatsAppLine = await fetchJson(
        `/api/workshop/jobs/${disabledWhatsAppJob.job.id}/lines`,
        {
          method: "POST",
          headers: STAFF_HEADERS,
          body: JSON.stringify({
            type: "LABOUR",
            description: "WhatsApp disabled quote labour",
            qty: 1,
            unitPricePence: 3900,
          }),
        },
      );
      assert.equal(disabledWhatsAppLine.status, 201, JSON.stringify(disabledWhatsAppLine.json));

      const disabledWhatsAppApproval = await fetchJson(
        `/api/workshop/jobs/${disabledWhatsAppJob.job.id}/approval`,
        {
          method: "POST",
          headers: STAFF_HEADERS,
          body: JSON.stringify({ status: "WAITING_FOR_APPROVAL" }),
        },
      );
      assert.equal(disabledWhatsAppApproval.status, 201, JSON.stringify(disabledWhatsAppApproval.json));

      const skippedWhatsAppByPreference = await waitForNotification(
        {
          workshopJobId: disabledWhatsAppJob.job.id,
          eventType: "QUOTE_READY",
          channel: "WHATSAPP",
        },
        "SKIPPED",
      );
      assert.ok(
        skippedWhatsAppByPreference,
        "Expected skipped quote-ready WhatsApp notification when disabled by customer preference",
      );
      assert.equal(skippedWhatsAppByPreference.reasonCode, "CUSTOMER_CHANNEL_DISABLED");
      assert.match(
        skippedWhatsAppByPreference.reasonMessage || "",
        /WhatsApp updates disabled/i,
      );

      const sentSmsWithDisabledWhatsApp = await waitForNotification(
        {
          workshopJobId: disabledWhatsAppJob.job.id,
          eventType: "QUOTE_READY",
          channel: "SMS",
        },
        "SENT",
      );
      assert.ok(sentSmsWithDisabledWhatsApp, "Expected quote-ready SMS fallback after WhatsApp preference skip");
      assert.equal(sentSmsWithDisabledWhatsApp.recipientPhone, disabledWhatsAppCustomer.phone);

      const skippedEmailAfterSmsFallback = await waitForNotification(
        {
          workshopJobId: disabledWhatsAppJob.job.id,
          eventType: "QUOTE_READY",
          channel: "EMAIL",
        },
        "SKIPPED",
      );
      assert.ok(skippedEmailAfterSmsFallback, "Expected quote-ready email fallback row after SMS delivery");
      assert.equal(skippedEmailAfterSmsFallback.reasonCode, "FALLBACK_NOT_REQUIRED");
    }, results);

    await runTest("customer quote links can be reused safely and customer rejection is idempotent", async () => {
      const { job } = await createJob(state);

      const addLine = await fetchJson(`/api/workshop/jobs/${job.id}/lines`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          type: "LABOUR",
          description: "Quote rejection labour",
          qty: 1,
          unitPricePence: 3200,
        }),
      });
      assert.equal(addLine.status, 201, JSON.stringify(addLine.json));

      const waitingApproval = await fetchJson(`/api/workshop/jobs/${job.id}/approval`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "WAITING_FOR_APPROVAL" }),
      });
      assert.equal(waitingApproval.status, 201, JSON.stringify(waitingApproval.json));

      const firstLink = await fetchJson(`/api/workshop/jobs/${job.id}/customer-quote-link`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({}),
      });
      assert.equal(firstLink.status, 200, JSON.stringify(firstLink.json));
      assert.equal(firstLink.json.idempotent, true);

      const replayLink = await fetchJson(`/api/workshop/jobs/${job.id}/customer-quote-link`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({}),
      });
      assert.equal(replayLink.status, 200, JSON.stringify(replayLink.json));
      assert.equal(replayLink.json.idempotent, true);
      assert.equal(replayLink.json.customerQuote.publicPath, firstLink.json.customerQuote.publicPath);

      const quoteToken = extractQuoteToken(firstLink.json.customerQuote.publicPath);
      const rejected = await fetchJson(`/api/public/workshop-quotes/${quoteToken}`, {
        method: "POST",
        body: JSON.stringify({ status: "REJECTED" }),
      });
      assert.equal(rejected.status, 201, JSON.stringify(rejected.json));
      assert.equal(rejected.json.estimate.status, "REJECTED");
      assert.equal(rejected.json.estimate.decisionSource, "CUSTOMER");

      const rejectedReplay = await fetchJson(`/api/public/workshop-quotes/${quoteToken}`, {
        method: "POST",
        body: JSON.stringify({ status: "REJECTED" }),
      });
      assert.equal(rejectedReplay.status, 200, JSON.stringify(rejectedReplay.json));
      assert.equal(rejectedReplay.json.quote.idempotent, true);

      const rejectedDetail = await fetchJson(`/api/workshop/jobs/${job.id}`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(rejectedDetail.status, 200, JSON.stringify(rejectedDetail.json));
      assert.equal(rejectedDetail.json.currentEstimate.status, "REJECTED");
      assert.equal(rejectedDetail.json.currentEstimate.decisionSource, "CUSTOMER");
      assert.equal(rejectedDetail.json.job.rawStatus, "ON_HOLD");
    }, results);

    await runTest("ready-for-collection notifications are sent once when the job reaches BIKE_READY", async () => {
      const customer = await createCustomer(state, {
        name: "Ready Collection Customer",
        email: `ready-collection-${uniqueRef()}@example.com`,
      });
      const { job } = await createJob(state, {
        customerId: customer.id,
        bikeDescription: "Ready collection hybrid",
      });

      const toInProgress = await fetchJson(`/api/workshop/jobs/${job.id}/status`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      });
      assert.equal(toInProgress.status, 201, JSON.stringify(toInProgress.json));

      const toReady = await fetchJson(`/api/workshop/jobs/${job.id}/status`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "READY" }),
      });
      assert.equal(toReady.status, 201, JSON.stringify(toReady.json));
      assert.equal(toReady.json.job.status, "BIKE_READY");

      const sentSmsNotification = await waitForNotification(
        {
          workshopJobId: job.id,
          eventType: "JOB_READY_FOR_COLLECTION",
          channel: "SMS",
        },
        "SENT",
      );
      assert.ok(sentSmsNotification, "Expected ready-for-collection SMS notification row");
      assert.equal(sentSmsNotification.deliveryStatus, "SENT");
      assert.equal(sentSmsNotification.recipientPhone, customer.phone);

      const skippedWhatsAppNotification = await waitForNotification(
        {
          workshopJobId: job.id,
          eventType: "JOB_READY_FOR_COLLECTION",
          channel: "WHATSAPP",
        },
        "SKIPPED",
      );
      assert.ok(
        skippedWhatsAppNotification,
        "Expected skipped ready-for-collection WhatsApp fallback row",
      );
      assert.equal(skippedWhatsAppNotification.deliveryStatus, "SKIPPED");
      assert.equal(skippedWhatsAppNotification.reasonCode, "FALLBACK_NOT_REQUIRED");

      const skippedEmailNotification = await waitForNotification(
        {
          workshopJobId: job.id,
          eventType: "JOB_READY_FOR_COLLECTION",
          channel: "EMAIL",
        },
        "SKIPPED",
      );
      assert.ok(skippedEmailNotification, "Expected skipped ready-for-collection email fallback row");
      assert.equal(skippedEmailNotification.deliveryStatus, "SKIPPED");
      assert.equal(skippedEmailNotification.reasonCode, "FALLBACK_NOT_REQUIRED");
      assert.equal(skippedEmailNotification.recipientEmail, customer.email);

      const notificationHistory = await fetchJson(
        `/api/workshop/jobs/${job.id}/notifications`,
        {
          headers: STAFF_HEADERS,
        },
      );
      assert.equal(notificationHistory.status, 200, JSON.stringify(notificationHistory.json));
      assert.ok(
        notificationHistory.json.notifications.some(
          (notification) =>
            notification.eventType === "JOB_READY_FOR_COLLECTION" &&
            notification.channel === "SMS" &&
            notification.deliveryStatus === "SENT" &&
            notification.recipientPhone === customer.phone &&
            notification.strategy?.label === "Primary",
        ),
        JSON.stringify(notificationHistory.json),
      );
      assert.ok(
        notificationHistory.json.notifications.some(
          (notification) =>
            notification.eventType === "JOB_READY_FOR_COLLECTION" &&
            notification.channel === "WHATSAPP" &&
            notification.deliveryStatus === "SKIPPED" &&
            notification.reasonCode === "FALLBACK_NOT_REQUIRED" &&
            notification.strategy?.label === "Fallback 2",
        ),
        JSON.stringify(notificationHistory.json),
      );
      assert.ok(
        notificationHistory.json.notifications.some(
          (notification) =>
            notification.eventType === "JOB_READY_FOR_COLLECTION" &&
            notification.channel === "EMAIL" &&
            notification.deliveryStatus === "SKIPPED" &&
            notification.reasonCode === "FALLBACK_NOT_REQUIRED" &&
            notification.strategy?.label === "Fallback 3",
        ),
        JSON.stringify(notificationHistory.json),
      );

      const readyReplay = await fetchJson(`/api/workshop/jobs/${job.id}/status`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "READY" }),
      });
      assert.equal(readyReplay.status, 200, JSON.stringify(readyReplay.json));

      const notificationCount = await prisma.workshopNotification.count({
        where: {
          workshopJobId: job.id,
          eventType: "JOB_READY_FOR_COLLECTION",
        },
      });
      assert.equal(notificationCount, 3);

      const resendReady = await fetchJson(
        `/api/workshop/jobs/${job.id}/notifications/resend`,
        {
          method: "POST",
          headers: STAFF_HEADERS,
          body: JSON.stringify({
            eventType: "JOB_READY_FOR_COLLECTION",
          }),
        },
      );
      assert.equal(resendReady.status, 201, JSON.stringify(resendReady.json));
      assert.equal(resendReady.json.notification.eventType, "JOB_READY_FOR_COLLECTION");
      assert.equal(resendReady.json.notification.channel, "EMAIL");
      assert.equal(resendReady.json.notification.deliveryStatus, "SENT");
      assert.equal(resendReady.json.notification.strategy?.label, "Manual resend");
      assert.notEqual(resendReady.json.notification.id, skippedEmailNotification.id);

      const resentNotificationCount = await prisma.workshopNotification.count({
        where: {
          workshopJobId: job.id,
          eventType: "JOB_READY_FOR_COLLECTION",
        },
      });
      assert.equal(resentNotificationCount, 4);

      const disabledSmsCustomer = await createCustomer(state, {
        name: "Disabled SMS Ready Customer",
        email: `disabled-sms-${uniqueRef()}@example.com`,
      });
      const disabledSmsPreferences = await updateCustomerCommunicationPreferences(
        disabledSmsCustomer.id,
        {
          emailAllowed: true,
          smsAllowed: false,
          whatsappAllowed: true,
        },
      );
      assert.equal(disabledSmsPreferences.smsAllowed, false);

      const disabledSmsJob = await createJob(state, {
        customerId: disabledSmsCustomer.id,
        bikeDescription: "SMS disabled hybrid",
      });

      const disabledSmsInProgress = await fetchJson(
        `/api/workshop/jobs/${disabledSmsJob.job.id}/status`,
        {
          method: "POST",
          headers: STAFF_HEADERS,
          body: JSON.stringify({ status: "IN_PROGRESS" }),
        },
      );
      assert.equal(disabledSmsInProgress.status, 201, JSON.stringify(disabledSmsInProgress.json));

      const disabledSmsReady = await fetchJson(`/api/workshop/jobs/${disabledSmsJob.job.id}/status`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "READY" }),
      });
      assert.equal(disabledSmsReady.status, 201, JSON.stringify(disabledSmsReady.json));

      const skippedSmsByPreference = await waitForNotification(
        {
          workshopJobId: disabledSmsJob.job.id,
          eventType: "JOB_READY_FOR_COLLECTION",
          channel: "SMS",
        },
        "SKIPPED",
      );
      assert.ok(
        skippedSmsByPreference,
        "Expected skipped ready-for-collection SMS notification when disabled by customer preference",
      );
      assert.equal(skippedSmsByPreference.reasonCode, "CUSTOMER_CHANNEL_DISABLED");
      assert.match(skippedSmsByPreference.reasonMessage || "", /SMS updates disabled/i);

      const sentWhatsAppAfterSmsSkip = await waitForNotification(
        {
          workshopJobId: disabledSmsJob.job.id,
          eventType: "JOB_READY_FOR_COLLECTION",
          channel: "WHATSAPP",
        },
        "SENT",
      );
      assert.ok(sentWhatsAppAfterSmsSkip, "Expected ready-for-collection WhatsApp fallback after SMS preference skip");
      assert.equal(sentWhatsAppAfterSmsSkip.recipientPhone, disabledSmsCustomer.phone);

      const skippedEmailAfterWhatsAppFallback = await waitForNotification(
        {
          workshopJobId: disabledSmsJob.job.id,
          eventType: "JOB_READY_FOR_COLLECTION",
          channel: "EMAIL",
        },
        "SKIPPED",
      );
      assert.ok(
        skippedEmailAfterWhatsAppFallback,
        "Expected ready-for-collection email fallback row after WhatsApp delivery",
      );
      assert.equal(skippedEmailAfterWhatsAppFallback.reasonCode, "FALLBACK_NOT_REQUIRED");
    }, results);

    await runTest("manager can add and retrieve customer-visible quote notes", async () => {
      const { job } = await createJob(state);

      const addNote = await fetchJson(`/api/workshop/jobs/${job.id}/notes`, {
        method: "POST",
        headers: MANAGER_HEADERS,
        body: JSON.stringify({
          visibility: "CUSTOMER",
          note: "Estimate approved for new chain and labour.",
        }),
      });
      assert.equal(addNote.status, 201, JSON.stringify(addNote.json));
      assert.equal(addNote.json.note.visibility, "CUSTOMER");

      const listNotes = await fetchJson(`/api/workshop/jobs/${job.id}/notes`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(listNotes.status, 200, JSON.stringify(listNotes.json));
      assert.ok(
        listNotes.json.notes.some(
          (note) =>
            note.visibility === "CUSTOMER" &&
            note.note === "Estimate approved for new chain and labour.",
        ),
        JSON.stringify(listNotes.json),
      );
    }, results);

    const failed = results.filter((result) => !result.ok);
    if (failed.length > 0) {
      throw new Error(`${failed.length} m83 smoke test(s) failed.`);
    }

    console.log("M83 workshop estimates and approvals smoke tests passed.");
  } finally {
    await cleanup(state).catch((error) => {
      console.error("Cleanup failed:", error instanceof Error ? error.message : String(error));
    });
    await prisma.$disconnect();
    await serverController.stop();
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
