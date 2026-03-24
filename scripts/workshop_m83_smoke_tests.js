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

const addMonthsUtc = (date, months) => {
  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth();
  const day = date.getUTCDate();
  const targetMonthIndex = monthIndex + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedTargetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetYear, normalizedTargetMonth + 1, 0),
  ).getUTCDate();

  return new Date(
    Date.UTC(
      targetYear,
      normalizedTargetMonth,
      Math.min(day, lastDayOfTargetMonth),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
};

const toIsoDate = (value) => value.toISOString().slice(0, 10);

let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;
const CURRENT_YEAR = new Date().getUTCFullYear();
const MAX_VALID_BIKE_YEAR = CURRENT_YEAR + 1;
const TOO_LOW_BIKE_YEAR = 1899;
const TOO_HIGH_BIKE_YEAR = MAX_VALID_BIKE_YEAR + 1;
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sX9jKkAAAAASUVORK5CYII=";

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

const nextWorkshopWeekday = (minimumOffsetDays = 0) => {
  let candidate = addDays(todayUtc(), minimumOffsetDays);
  while (true) {
    const dayOfWeek = getWorkshopDayOfWeek(candidate);
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      return candidate;
    }
    candidate = addDays(candidate, 1);
  }
};

const toWorkshopDateKey = (value) => {
  const parts = getWorkshopTimeParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const getWorkshopTimeParts = (value) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: WORKSHOP_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

const toScheduledSlot = (date, hours, minutes = 0) => {
  const baseParts = getWorkshopTimeParts(date);
  const targetLocalTimestamp = Date.UTC(
    Number(baseParts.year),
    Number(baseParts.month) - 1,
    Number(baseParts.day),
    hours,
    minutes,
    0,
    0,
  );

  let slot = new Date(targetLocalTimestamp);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actualParts = getWorkshopTimeParts(slot);
    const actualLocalTimestamp = Date.UTC(
      Number(actualParts.year),
      Number(actualParts.month) - 1,
      Number(actualParts.day),
      Number(actualParts.hour),
      Number(actualParts.minute),
      Number(actualParts.second),
      0,
    );
    const adjustmentMs = targetLocalTimestamp - actualLocalTimestamp;
    if (adjustmentMs === 0) {
      return slot;
    }

    slot = new Date(slot.getTime() + adjustmentMs);
  }

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

const createLinkedPartVariant = async (state, overrides = {}) => {
  const ref = uniqueRef();
  const product = await prisma.product.create({
    data: {
      name: overrides.name || `M83 Template Part ${ref}`,
      brand: "M83",
      variants: {
        create: {
          sku: overrides.sku || `M83-TEMPLATE-${ref}`,
          name: overrides.variantName || "Standard",
          retailPrice: overrides.retailPrice || "9.50",
          retailPricePence: overrides.retailPricePence || 950,
        },
      },
    },
    include: {
      variants: {
        take: 1,
      },
    },
  });

  state.productIds.add(product.id);
  return {
    productId: product.id,
    variantId: product.variants[0].id,
    sku: product.variants[0].sku,
    name: product.name,
    pricePence: product.variants[0].retailPricePence,
  };
};

const createWorkshopServiceTemplate = async (state, body, headers = MANAGER_HEADERS) => {
  const response = await fetchJson("/api/workshop/service-templates", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  assert.equal(response.status, 201, JSON.stringify(response.json));
  state.templateIds.add(response.json.template.id);
  return response.json.template;
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

const createBikeServiceSchedule = async (bikeId, overrides = {}) => {
  const response = await fetchJson(`/api/customers/bikes/${bikeId}/service-schedules`, {
    method: "POST",
    headers: STAFF_HEADERS,
    body: JSON.stringify(overrides),
  });

  assert.equal(response.status, 201, JSON.stringify(response.json));
  return response.json.schedule;
};

const updateBikeServiceSchedule = async (bikeId, scheduleId, overrides = {}) => {
  const response = await fetchJson(
    `/api/customers/bikes/${bikeId}/service-schedules/${scheduleId}`,
    {
      method: "PATCH",
      headers: STAFF_HEADERS,
      body: JSON.stringify(overrides),
    },
  );

  assert.equal(response.status, 200, JSON.stringify(response.json));
  return response.json.schedule;
};

const markBikeServiceScheduleServiced = async (
  bikeId,
  scheduleId,
  overrides = {},
) =>
  fetchJson(
    `/api/customers/bikes/${bikeId}/service-schedules/${scheduleId}/mark-serviced`,
    {
      method: "POST",
      headers: STAFF_HEADERS,
      body: JSON.stringify(overrides),
    },
  );

const extractQuoteToken = (publicPath) => {
  const match = publicPath.match(/\/(?:quote|public\/workshop)\/([^/?#]+)/);
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

const getOrCreateRotaPeriodForDate = async (state, dateKey) => {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  const day = date.getUTCDay();
  const offsetToMonday = (day + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offsetToMonday);
  const startsOn = date.toISOString().slice(0, 10);
  const endsOnDate = new Date(date);
  endsOnDate.setUTCDate(endsOnDate.getUTCDate() + 41);
  const endsOn = endsOnDate.toISOString().slice(0, 10);

  const existing = await prisma.rotaPeriod.findUnique({
    where: {
      startsOn_endsOn: {
        startsOn,
        endsOn,
      },
    },
  });

  if (existing) {
    return existing;
  }

  const created = await prisma.rotaPeriod.create({
    data: {
      label: `M83 ${startsOn}`,
      startsOn,
      endsOn,
      status: "ACTIVE",
    },
  });
  state.rotaPeriodIds.add(created.id);
  return created;
};

const createWorkshopRotaAssignment = async (state, input) => {
  const period = await getOrCreateRotaPeriodForDate(state, input.date);
  const record = await prisma.rotaAssignment.upsert({
    where: {
      staffId_date: {
        staffId: input.staffId,
        date: input.date,
      },
    },
    create: {
      rotaPeriodId: period.id,
      staffId: input.staffId,
      date: input.date,
      shiftType: input.shiftType,
      source: input.source ?? "MANUAL",
      note: input.note ?? null,
    },
    update: {
      rotaPeriodId: period.id,
      shiftType: input.shiftType,
      source: input.source ?? "MANUAL",
      note: input.note ?? null,
    },
  });
  state.rotaAssignmentIds.add(record.id);
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
  const rotaAssignmentIds = Array.from(state.rotaAssignmentIds);
  const rotaPeriodIds = Array.from(state.rotaPeriodIds);
  const timeOffIds = Array.from(state.timeOffIds);
  const templateIds = Array.from(state.templateIds);
  const productIds = Array.from(state.productIds);

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

  if (rotaAssignmentIds.length > 0) {
    await prisma.rotaAssignment.deleteMany({
      where: { id: { in: rotaAssignmentIds } },
    });
  }

  if (rotaPeriodIds.length > 0) {
    await prisma.rotaPeriod.deleteMany({
      where: { id: { in: rotaPeriodIds } },
    });
  }

  if (workingHoursIds.length > 0) {
    await prisma.workshopWorkingHours.deleteMany({
      where: { id: { in: workingHoursIds } },
    });
  }

  if (templateIds.length > 0) {
    await prisma.workshopServiceTemplate.deleteMany({
      where: { id: { in: templateIds } },
    });
  }

  if (customerIds.length > 0) {
    await prisma.customer.deleteMany({
      where: { id: { in: customerIds } },
    });
  }

  if (productIds.length > 0) {
    await prisma.variant.deleteMany({
      where: { productId: { in: productIds } },
    });
    await prisma.product.deleteMany({
      where: { id: { in: productIds } },
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
    rotaAssignmentIds: new Set(),
    rotaPeriodIds: new Set(),
    timeOffIds: new Set(),
    templateIds: new Set(),
    productIds: new Set(),
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

    await runTest("bike service schedules support due tracking, refresh, and bike-level lifecycle listing", async () => {
      const customer = await createCustomer(state, {
        name: `Bike Schedule Customer ${uniqueRef()}`,
      });
      const bike = await createBike(state, customer.id, {
        label: "Reminder bike",
        make: "Trek",
        model: "Checkpoint",
      });

      const today = todayUtc();
      const generalService = await createBikeServiceSchedule(bike.id, {
        type: "GENERAL_SERVICE",
        title: "General service",
        intervalMonths: 6,
        lastServiceAt: toIsoDate(addDays(today, -40)),
      });
      const expectedGeneralDueAt = toIsoDate(addMonthsUtc(addDays(today, -40), 6));

      assert.equal(generalService.type, "GENERAL_SERVICE");
      assert.equal(generalService.nextDueAt.slice(0, 10), expectedGeneralDueAt);
      assert.equal(generalService.dueStatus, "UPCOMING");

      const brakeCheck = await createBikeServiceSchedule(bike.id, {
        type: "BRAKES",
        title: "Brake check",
        intervalMonths: 3,
        nextDueAt: toIsoDate(addDays(today, -2)),
      });

      assert.equal(brakeCheck.dueStatus, "OVERDUE");

      const drivetrain = await createBikeServiceSchedule(bike.id, {
        type: "DRIVETRAIN",
        title: "Chain and drivetrain refresh",
        intervalMileage: 1500,
        nextDueMileage: 3000,
      });

      assert.equal(drivetrain.dueStatus, "UPCOMING");
      assert.equal(drivetrain.nextDueMileage, 3000);

      const scheduleList = await fetchJson(
        `/api/customers/bikes/${bike.id}/service-schedules?includeInactive=true`,
        {
          headers: STAFF_HEADERS,
        },
      );
      assert.equal(scheduleList.status, 200, JSON.stringify(scheduleList.json));
      assert.equal(scheduleList.json.summary.activeCount, 3);
      assert.equal(scheduleList.json.summary.overdueCount, 1);
      assert.equal(scheduleList.json.schedules.length, 3);

      const mileageRefreshBlocked = await markBikeServiceScheduleServiced(bike.id, drivetrain.id, {
        servicedAt: toIsoDate(today),
      });
      assert.equal(mileageRefreshBlocked.status, 400, JSON.stringify(mileageRefreshBlocked.json));
      assert.equal(
        mileageRefreshBlocked.json.error.code,
        "INVALID_BIKE_SERVICE_SCHEDULE_MILEAGE",
      );

      const refreshedBrakeCheck = await markBikeServiceScheduleServiced(
        bike.id,
        brakeCheck.id,
        {
          servicedAt: toIsoDate(today),
        },
      );
      assert.equal(refreshedBrakeCheck.status, 200, JSON.stringify(refreshedBrakeCheck.json));
      assert.equal(refreshedBrakeCheck.json.schedule.lastServiceAt.slice(0, 10), toIsoDate(today));
      assert.equal(
        refreshedBrakeCheck.json.schedule.nextDueAt.slice(0, 10),
        toIsoDate(addMonthsUtc(today, 3)),
      );
      assert.equal(refreshedBrakeCheck.json.schedule.dueStatus, "UPCOMING");

      const refreshedDrivetrain = await markBikeServiceScheduleServiced(
        bike.id,
        drivetrain.id,
        {
          servicedAt: toIsoDate(today),
          servicedMileage: 3000,
        },
      );
      assert.equal(refreshedDrivetrain.status, 200, JSON.stringify(refreshedDrivetrain.json));
      assert.equal(refreshedDrivetrain.json.schedule.lastServiceMileage, 3000);
      assert.equal(refreshedDrivetrain.json.schedule.nextDueMileage, 4500);
      assert.equal(refreshedDrivetrain.json.schedule.dueStatus, "UPCOMING");

      const inactiveGeneralService = await updateBikeServiceSchedule(bike.id, generalService.id, {
        isActive: false,
      });
      assert.equal(inactiveGeneralService.isActive, false);
      assert.equal(inactiveGeneralService.dueStatus, "INACTIVE");

      const listedBikes = await fetchJson(`/api/customers/${customer.id}/bikes`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(listedBikes.status, 200, JSON.stringify(listedBikes.json));
      const listedBike = listedBikes.json.bikes.find((candidate) => candidate.id === bike.id);
      assert.ok(listedBike, JSON.stringify(listedBikes.json));
      assert.equal(listedBike.serviceScheduleSummary.activeCount, 2);
      assert.equal(listedBike.serviceScheduleSummary.inactiveCount, 1);
      assert.equal(listedBike.serviceScheduleSummary.overdueCount, 0);
      assert.equal(listedBike.serviceSchedules.length, 3);

      const bikeHistory = await fetchJson(`/api/customers/bikes/${bike.id}`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(bikeHistory.status, 200, JSON.stringify(bikeHistory.json));
      assert.equal(bikeHistory.json.serviceSchedules.length, 3);
      assert.equal(bikeHistory.json.serviceScheduleSummary.activeCount, 2);
      assert.equal(
        bikeHistory.json.serviceSchedules.find((schedule) => schedule.id === drivetrain.id).nextDueMileage,
        4500,
      );
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

    await runTest("workshop service templates can be created, listed, and updated safely", async () => {
      const linkedPart = await createLinkedPartVariant(state, {
        retailPrice: "12.99",
        retailPricePence: 1299,
      });

      const template = await createWorkshopServiceTemplate(state, {
        name: `Standard Service ${uniqueRef()}`,
        description: "Common workshop service quote",
        category: "Service",
        defaultDurationMinutes: 60,
        lines: [
          {
            type: "LABOUR",
            description: "Standard service labour",
            qty: 1,
            unitPricePence: 4500,
          },
          {
            type: "PART",
            productId: linkedPart.productId,
            variantId: linkedPart.variantId,
            description: "Fresh cable set",
            qty: 1,
            unitPricePence: linkedPart.pricePence,
            isOptional: true,
          },
        ],
      });

      assert.equal(template.defaultDurationMinutes, 60);
      assert.equal(template.pricingMode, "STANDARD_SERVICE");
      assert.equal(template.targetTotalPricePence, null);
      assert.equal(template.lines.length, 2);
      assert.equal(template.lines[1].isOptional, true);

      const list = await fetchJson("/api/workshop/service-templates", {
        headers: STAFF_HEADERS,
      });
      assert.equal(list.status, 200, JSON.stringify(list.json));
      const listedTemplate = list.json.templates.find((entry) => entry.id === template.id);
      assert.ok(listedTemplate, JSON.stringify(list.json.templates));

      const updated = await fetchJson(`/api/workshop/service-templates/${template.id}`, {
        method: "PATCH",
        headers: MANAGER_HEADERS,
        body: JSON.stringify({
          description: "Updated workshop service quote",
          isActive: false,
          lines: [
            {
              type: "LABOUR",
              description: "Standard service labour",
              qty: 1,
              unitPricePence: 4700,
            },
            {
              type: "PART",
              productId: linkedPart.productId,
              variantId: linkedPart.variantId,
              description: "Fresh cable set",
              qty: 2,
              unitPricePence: linkedPart.pricePence,
              isOptional: true,
            },
          ],
        }),
      });
      assert.equal(updated.status, 200, JSON.stringify(updated.json));
      assert.equal(updated.json.template.isActive, false);
      assert.equal(updated.json.template.pricingMode, "STANDARD_SERVICE");
      assert.equal(updated.json.template.lines[1].qty, 2);

      const inactiveForStaff = await fetchJson(`/api/workshop/service-templates/${template.id}`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(inactiveForStaff.status, 404, JSON.stringify(inactiveForStaff.json));

      const inactiveForManager = await fetchJson(
        `/api/workshop/service-templates/${template.id}?includeInactive=true`,
        {
          headers: MANAGER_HEADERS,
        },
      );
      assert.equal(inactiveForManager.status, 200, JSON.stringify(inactiveForManager.json));
      assert.equal(inactiveForManager.json.template.description, "Updated workshop service quote");
    }, results);

    await runTest("labour template lines tolerate null and empty inventory-link fields from clients", async () => {
      const response = await fetchJson("/api/workshop/service-templates", {
        method: "POST",
        headers: MANAGER_HEADERS,
        body: JSON.stringify({
          name: `Null Link Labour ${uniqueRef()}`,
          pricingMode: "STANDARD_SERVICE",
          lines: [
            {
              type: "LABOUR",
              productId: null,
              variantId: null,
              description: "Wheel true labour",
              qty: 1,
              unitPricePence: 3000,
              isOptional: false,
              sortOrder: 0,
            },
          ],
        }),
      });

      assert.equal(response.status, 201, JSON.stringify(response.json));
      state.templateIds.add(response.json.template.id);
      assert.equal(response.json.template.lines.length, 1);
      assert.equal(response.json.template.lines[0].type, "LABOUR");
      assert.equal(response.json.template.lines[0].productId, null);
      assert.equal(response.json.template.lines[0].variantId, null);

      const emptyStringResponse = await fetchJson("/api/workshop/service-templates", {
        method: "POST",
        headers: MANAGER_HEADERS,
        body: JSON.stringify({
          name: `Empty Link Labour ${uniqueRef()}`,
          pricingMode: "STANDARD_SERVICE",
          lines: [
            {
              type: "LABOUR",
              productId: "",
              variantId: "   ",
              description: "Brake check labour",
              qty: 1,
              unitPricePence: 2200,
              isOptional: false,
              sortOrder: 0,
            },
          ],
        }),
      });

      assert.equal(emptyStringResponse.status, 201, JSON.stringify(emptyStringResponse.json));
      state.templateIds.add(emptyStringResponse.json.template.id);
      assert.equal(emptyStringResponse.json.template.lines.length, 1);
      assert.equal(emptyStringResponse.json.template.lines[0].type, "LABOUR");
      assert.equal(emptyStringResponse.json.template.lines[0].productId, null);
      assert.equal(emptyStringResponse.json.template.lines[0].variantId, null);
    }, results);

    await runTest("legacy labour template links are sanitized on read and re-save safely", async () => {
      const linkedPart = await createLinkedPartVariant(state, {
        retailPrice: "9.99",
        retailPricePence: 999,
      });

      const template = await createWorkshopServiceTemplate(state, {
        name: `Legacy Labour Template ${uniqueRef()}`,
        category: "Service",
        pricingMode: "STANDARD_SERVICE",
        lines: [
          {
            type: "LABOUR",
            description: "Legacy labour",
            qty: 1,
            unitPricePence: 2500,
          },
        ],
      });

      const labourLineId = template.lines.find((line) => line.type === "LABOUR")?.id;
      assert.ok(labourLineId);

      await prisma.workshopServiceTemplateLine.update({
        where: { id: labourLineId },
        data: {
          productId: linkedPart.productId,
          variantId: linkedPart.variantId,
        },
      });

      const fetched = await fetchJson(`/api/workshop/service-templates/${template.id}?includeInactive=true`, {
        headers: MANAGER_HEADERS,
      });
      assert.equal(fetched.status, 200, JSON.stringify(fetched.json));
      assert.equal(fetched.json.template.lines[0].type, "LABOUR");
      assert.equal(fetched.json.template.lines[0].productId, null);
      assert.equal(fetched.json.template.lines[0].variantId, null);
      assert.equal(fetched.json.template.lines[0].hasInventoryLink, false);

      const resaved = await fetchJson(`/api/workshop/service-templates/${template.id}`, {
        method: "PATCH",
        headers: MANAGER_HEADERS,
        body: JSON.stringify({
          name: `${template.name} Updated`,
          lines: fetched.json.template.lines.map((line, index) => ({
            type: line.type,
            productId: line.productId,
            variantId: line.variantId,
            description: line.description,
            qty: line.qty,
            unitPricePence: line.unitPricePence,
            isOptional: line.isOptional,
            sortOrder: index,
          })),
        }),
      });
      assert.equal(resaved.status, 200, JSON.stringify(resaved.json));
      assert.equal(resaved.json.template.lines[0].productId, null);
      assert.equal(resaved.json.template.lines[0].variantId, null);
    }, results);

    await runTest("applying a workshop service template creates normal job lines and keeps estimate compatibility", async () => {
      const linkedPartA = await createLinkedPartVariant(state, {
        retailPrice: "4.99",
        retailPricePence: 499,
      });
      const linkedPartB = await createLinkedPartVariant(state, {
        retailPrice: "6.50",
        retailPricePence: 650,
      });

      const template = await createWorkshopServiceTemplate(state, {
        name: `Puncture Repair ${uniqueRef()}`,
        description: "Quick puncture-repair quote",
        category: "Repair",
        defaultDurationMinutes: 45,
        lines: [
          {
            type: "LABOUR",
            description: "Puncture repair labour",
            qty: 1,
            unitPricePence: 1800,
          },
          {
            type: "PART",
            productId: linkedPartA.productId,
            variantId: linkedPartA.variantId,
            description: "Tube replacement",
            qty: 1,
            unitPricePence: linkedPartA.pricePence,
            isOptional: true,
          },
          {
            type: "PART",
            productId: linkedPartB.productId,
            variantId: linkedPartB.variantId,
            description: "Rim tape refresh",
            qty: 1,
            unitPricePence: linkedPartB.pricePence,
            isOptional: true,
          },
        ],
      });

      const { job } = await createJob(state, {
        bikeDescription: "Workshop template job",
      });

      const applyTemplate = await fetchJson(`/api/workshop/jobs/${job.id}/templates/apply`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          templateId: template.id,
          selectedOptionalLineIds: [template.lines[1].id],
        }),
      });
      assert.equal(applyTemplate.status, 201, JSON.stringify(applyTemplate.json));
      assert.equal(applyTemplate.json.appliedLineCount, 2);
      assert.equal(applyTemplate.json.durationEffect.durationUpdated, true);
      assert.equal(applyTemplate.json.durationEffect.appliedDurationMinutes, 45);
      assert.equal(applyTemplate.json.durationEffect.reason, "unscheduled_duration_set");

      const detail = await fetchJson(`/api/workshop/jobs/${job.id}`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(detail.status, 200, JSON.stringify(detail.json));
      assert.equal(detail.json.lines.length, 2);
      assert.equal(detail.json.job.durationMinutes, 45);
      assert.deepEqual(
        detail.json.lines.map((line) => line.description),
        ["Puncture repair labour", "Tube replacement"],
      );
      assert.equal(detail.json.lines[1].variantId, linkedPartA.variantId);

      const saveEstimate = await fetchJson(`/api/workshop/jobs/${job.id}/estimate`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({}),
      });
      assert.equal(saveEstimate.status, 201, JSON.stringify(saveEstimate.json));

      const estimatedDetail = await fetchJson(`/api/workshop/jobs/${job.id}`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(estimatedDetail.status, 200, JSON.stringify(estimatedDetail.json));
      assert.equal(estimatedDetail.json.currentEstimate.subtotalPence, 2299);
      assert.equal(estimatedDetail.json.currentEstimate.lineCount, 2);

      const scheduledJobDate = addDays(todayUtc(), 17);
      const scheduledJobStart = toScheduledSlot(scheduledJobDate, 12, 0);
      const scheduledJobEnd = toScheduledSlot(scheduledJobDate, 13, 30);
      const { job: scheduledJob } = await createJob(state, {
        bikeDescription: "Scheduled workshop template job",
        scheduledStartAt: scheduledJobStart.toISOString(),
        scheduledEndAt: scheduledJobEnd.toISOString(),
        durationMinutes: 90,
      });

      const applyToScheduled = await fetchJson(`/api/workshop/jobs/${scheduledJob.id}/templates/apply`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          templateId: template.id,
        }),
      });
      assert.equal(applyToScheduled.status, 201, JSON.stringify(applyToScheduled.json));
      assert.equal(applyToScheduled.json.durationEffect.durationUpdated, false);
      assert.equal(applyToScheduled.json.durationEffect.appliedDurationMinutes, 90);
      assert.equal(applyToScheduled.json.durationEffect.reason, "job_duration_already_set");

      const scheduledDetail = await fetchJson(`/api/workshop/jobs/${scheduledJob.id}`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(scheduledDetail.status, 200, JSON.stringify(scheduledDetail.json));
      assert.equal(scheduledDetail.json.job.durationMinutes, 90);
      assert.equal(
        new Date(scheduledDetail.json.job.scheduledEndAt).toISOString(),
        scheduledJobEnd.toISOString(),
      );
    }, results);

    await runTest("fixed-price service templates rebalance labour as parts change on the job", async () => {
      const punctureTube = await createLinkedPartVariant(state, {
        retailPrice: "7.00",
        retailPricePence: 700,
      });
      const puncturePatch = await createLinkedPartVariant(state, {
        retailPrice: "2.00",
        retailPricePence: 200,
      });

      const fixedTemplate = await createWorkshopServiceTemplate(state, {
        name: `Fixed Price Repair ${uniqueRef()}`,
        description: "Fixed-price workshop repair",
        category: "Repair",
        defaultDurationMinutes: 30,
        pricingMode: "FIXED_PRICE_SERVICE",
        targetTotalPricePence: 2500,
        lines: [
          {
            type: "LABOUR",
            description: "Fixed-price repair labour",
            qty: 1,
            unitPricePence: 2500,
          },
          {
            type: "PART",
            productId: punctureTube.productId,
            variantId: punctureTube.variantId,
            description: "Tube",
            qty: 1,
            unitPricePence: punctureTube.pricePence,
            isOptional: true,
          },
        ],
      });

      assert.equal(fixedTemplate.pricingMode, "FIXED_PRICE_SERVICE");
      assert.equal(fixedTemplate.targetTotalPricePence, 2500);

      const { job } = await createJob(state, {
        bikeDescription: "Fixed-price service job",
      });

      const applyTemplate = await fetchJson(`/api/workshop/jobs/${job.id}/templates/apply`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          templateId: fixedTemplate.id,
          selectedOptionalLineIds: [],
        }),
      });
      assert.equal(applyTemplate.status, 201, JSON.stringify(applyTemplate.json));
      assert.equal(applyTemplate.json.pricingEffect.fixedPriceActivated, true);
      assert.equal(applyTemplate.json.pricingEffect.targetTotalPricePence, 2500);

      let detail = await fetchJson(`/api/workshop/jobs/${job.id}`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(detail.status, 200, JSON.stringify(detail.json));
      assert.equal(detail.json.job.servicePricingMode, "FIXED_PRICE_SERVICE");
      assert.equal(detail.json.job.serviceTargetTotalPence, 2500);
      assert.equal(detail.json.lines.length, 1);
      assert.equal(detail.json.lines[0].type, "LABOUR");
      assert.equal(detail.json.lines[0].unitPricePence, 2500);

      const addPart = await fetchJson(`/api/workshop/jobs/${job.id}/lines`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          type: "PART",
          productId: punctureTube.productId,
          variantId: punctureTube.variantId,
          description: "Tube replacement",
          qty: 1,
          unitPricePence: punctureTube.pricePence,
        }),
      });
      assert.equal(addPart.status, 201, JSON.stringify(addPart.json));

      detail = await fetchJson(`/api/workshop/jobs/${job.id}`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(detail.status, 200, JSON.stringify(detail.json));
      const labourLineAfterTube = detail.json.lines.find((line) => line.type === "LABOUR");
      const tubeLine = detail.json.lines.find((line) => line.type === "PART" && line.variantId === punctureTube.variantId);
      assert.ok(labourLineAfterTube);
      assert.ok(tubeLine);
      assert.equal(labourLineAfterTube.unitPricePence, 1800);
      assert.equal(
        detail.json.lines.reduce((sum, line) => sum + line.lineTotalPence, 0),
        2500,
      );

      const updatePart = await fetchJson(`/api/workshop/jobs/${job.id}/lines/${tubeLine.id}`, {
        method: "PATCH",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          unitPricePence: 900,
        }),
      });
      assert.equal(updatePart.status, 200, JSON.stringify(updatePart.json));

      detail = await fetchJson(`/api/workshop/jobs/${job.id}`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(detail.status, 200, JSON.stringify(detail.json));
      const labourLineAfterUpdate = detail.json.lines.find((line) => line.type === "LABOUR");
      assert.ok(labourLineAfterUpdate);
      assert.equal(labourLineAfterUpdate.unitPricePence, 1600);
      assert.equal(
        detail.json.lines.reduce((sum, line) => sum + line.lineTotalPence, 0),
        2500,
      );

      const addExcessPart = await fetchJson(`/api/workshop/jobs/${job.id}/lines`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          type: "PART",
          productId: puncturePatch.productId,
          variantId: puncturePatch.variantId,
          description: "Extra puncture consumables",
          qty: 10,
          unitPricePence: 200,
        }),
      });
      assert.equal(addExcessPart.status, 409, JSON.stringify(addExcessPart.json));
      assert.equal(addExcessPart.json.error.code, "WORKSHOP_FIXED_PRICE_TARGET_EXCEEDED");

      const deleteBalancingLine = await fetchJson(
        `/api/workshop/jobs/${job.id}/lines/${labourLineAfterUpdate.id}`,
        {
          method: "DELETE",
          headers: STAFF_HEADERS,
        },
      );
      assert.equal(deleteBalancingLine.status, 409, JSON.stringify(deleteBalancingLine.json));
      assert.equal(deleteBalancingLine.json.error.code, "WORKSHOP_FIXED_PRICE_CONFIGURATION_INVALID");
    }, results);

    await runTest("timed workshop jobs derive schedule fields, reject store-closed slots, and validate end-time consistency", async () => {
      const scheduledDate = nextWorkshopWeekday(16);
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
      const scheduledDate = nextWorkshopWeekday(18);
      const dateKey = toWorkshopDateKey(scheduledDate);

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
      assert.equal(assignFirst.status, 409, JSON.stringify(assignFirst.json));
      assert.equal(assignFirst.json.error.code, "WORKSHOP_SCHEDULE_NO_WORKING_HOURS");

      await createWorkshopRotaAssignment(state, {
        staffId: managerUser.id,
        date: dateKey,
        shiftType: "FULL_DAY",
      });

      const assignFirstAfterRota = await fetchJson(`/api/workshop/jobs/${firstJob.id}/assign`, {
        method: "POST",
        headers: MANAGER_HEADERS,
        body: JSON.stringify({ staffId: managerUser.id }),
      });
      assert.equal(assignFirstAfterRota.status, 201, JSON.stringify(assignFirstAfterRota.json));

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
      const scheduledDate = nextWorkshopWeekday(23);
      const dateKey = scheduledDate.toISOString().slice(0, 10);
      await createWorkshopRotaAssignment(state, {
        staffId: managerUser.id,
        date: dateKey,
        shiftType: "FULL_DAY",
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

      const { job: unscheduledJob } = await createJob(state, {
        customerName: `Needs Slot ${uniqueRef()}`,
        bikeDescription: "Unscheduled intake job",
        scheduledStartAt: null,
        scheduledEndAt: null,
        durationMinutes: null,
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
      assert.ok(Array.isArray(calendar.json.unscheduledJobs), JSON.stringify(calendar.json));

      const scheduledJob = calendar.json.scheduledJobs.find((entry) => entry.id === job.id);
      assert.ok(scheduledJob, JSON.stringify(calendar.json));
      assert.equal(scheduledJob.assignedStaffId, managerUser.id);
      assert.equal(scheduledJob.jobPath, `/workshop/${job.id}`);

      const unscheduledCalendarJob = calendar.json.unscheduledJobs.find((entry) => entry.id === unscheduledJob.id);
      assert.ok(unscheduledCalendarJob, JSON.stringify(calendar.json.unscheduledJobs));
      assert.equal(unscheduledCalendarJob.scheduledStartAt, null);
      assert.equal(unscheduledCalendarJob.bikeDescription, "Unscheduled intake job");

      const staffRow = calendar.json.staff.find((entry) => entry.id === managerUser.id);
      assert.ok(staffRow, JSON.stringify(calendar.json));
      assert.equal(staffRow.workingHours.length, 1);
      assert.equal(staffRow.workingHours[0].date, dateKey);
      assert.equal(staffRow.workingHours[0].source, "ROTA");
      assert.equal(staffRow.workingHours[0].shiftType, "FULL_DAY");
      assert.equal(staffRow.workingHours[0].startTime, calendar.json.days[0].opensAt);
      assert.equal(staffRow.workingHours[0].endTime, calendar.json.days[0].closesAt);
      assert.equal(staffRow.availability[0].source, "ROTA");
      assert.equal(staffRow.availability[0].label, "Rota full-day shift");

      const capacity = staffRow.dailyCapacity.find((entry) => entry.date === dateKey);
      assert.ok(capacity, JSON.stringify(staffRow));
      assert.equal(capacity.totalMinutes, 510);
      assert.equal(capacity.bookedMinutes, 60);
      assert.equal(capacity.timeOffMinutes, 180);
      assert.equal(capacity.availableMinutes, 270);

      assert.ok(
        calendar.json.workshopTimeOff.some((entry) => entry.reason === "Workshop briefing"),
        JSON.stringify(calendar.json.workshopTimeOff),
      );
      assert.ok(
        staffRow.scheduledJobs.some((entry) => entry.id === job.id),
        JSON.stringify(staffRow.scheduledJobs),
      );
    }, results);

    await runTest("legacy workshop working hours stay as an explicit fallback when rota is missing", async () => {
      const scheduledDate = nextWorkshopWeekday(22);
      const dateKey = toWorkshopDateKey(scheduledDate);
      const dayOfWeek = getWorkshopDayOfWeek(scheduledDate);
      assert.notEqual(dayOfWeek, undefined);

      await createWorkshopWorkingHours(state, {
        staffId: managerUser.id,
        dayOfWeek,
        startTime: "09:00",
        endTime: "17:00",
      });

      const { job } = await createJob(state, {
        customerName: `Fallback Hours ${uniqueRef()}`,
        bikeDescription: "Fallback availability job",
        scheduledStartAt: null,
        scheduledEndAt: null,
        durationMinutes: null,
      });

      const scheduled = await patchWorkshopJobSchedule(job.id, {
        staffId: managerUser.id,
        scheduledStartAt: toScheduledSlot(scheduledDate, 10, 0).toISOString(),
        durationMinutes: 60,
      });
      assert.equal(scheduled.status, 201, JSON.stringify(scheduled.json));

      const calendar = await fetchJson(
        `/api/workshop/calendar?from=${dateKey}&to=${dateKey}`,
        { headers: STAFF_HEADERS },
      );
      assert.equal(calendar.status, 200, JSON.stringify(calendar.json));

      const staffRow = calendar.json.staff.find((entry) => entry.id === managerUser.id);
      assert.ok(staffRow, JSON.stringify(calendar.json.staff));
      assert.equal(staffRow.availability[0].source, "WORKSHOP_FALLBACK");
      assert.equal(staffRow.availability[0].label, "Legacy workshop hours fallback");
      assert.equal(staffRow.workingHours[0].source, "WORKSHOP_FALLBACK");
      assert.equal(staffRow.workingHours[0].startTime, "09:00");
      assert.equal(staffRow.workingHours[0].endTime, "17:00");
    }, results);

    await runTest("schedule patch endpoint supports assign, partial reschedule, clear, and overlap-safe validation", async () => {
      const scheduledDate = nextWorkshopWeekday(24);
      await createWorkshopRotaAssignment(state, {
        staffId: managerUser.id,
        date: toWorkshopDateKey(scheduledDate),
        shiftType: "FULL_DAY",
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

    await runTest("customer workshop portal allows safe approval and stale links cannot approve superseded estimates", async () => {
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

      const customerVisibleNote = await fetchJson(`/api/workshop/jobs/${job.id}/notes`, {
        method: "POST",
        headers: MANAGER_HEADERS,
        body: JSON.stringify({
          visibility: "CUSTOMER",
          note: "We will confirm as soon as the quoted work is ready to continue.",
        }),
      });
      assert.equal(customerVisibleNote.status, 201, JSON.stringify(customerVisibleNote.json));

      const internalNote = await fetchJson(`/api/workshop/jobs/${job.id}/notes`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          visibility: "INTERNAL",
          note: "Internal margin note only for staff.",
        }),
      });
      assert.equal(internalNote.status, 201, JSON.stringify(internalNote.json));

      const link = await fetchJson(`/api/workshop/jobs/${job.id}/customer-quote-link`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({}),
      });
      assert.equal(link.status, 200, JSON.stringify(link.json));
      assert.equal(link.json.idempotent, true);
      assert.equal(link.json.customerQuote.status, "ACTIVE");
      const quoteToken = extractQuoteToken(link.json.customerQuote.publicPath);

      const publicPortal = await fetchJson(`/api/public/workshop/${quoteToken}`);
      assert.equal(publicPortal.status, 200, JSON.stringify(publicPortal.json));
      assert.equal(publicPortal.json.portal.accessStatus, "ACTIVE");
      assert.equal(publicPortal.json.quote.accessStatus, "ACTIVE");
      assert.equal(publicPortal.json.customerProgress.stage, "AWAITING_APPROVAL");
      assert.equal(publicPortal.json.customerProgress.needsCustomerAction, true);
      assert.equal(publicPortal.json.estimate.status, "PENDING_APPROVAL");
      assert.equal(publicPortal.json.estimate.lines.length, 1);
      assert.equal(publicPortal.json.workSummary.lineCount, 1);
      assert.equal(publicPortal.json.job.customerName.startsWith("M83 Customer"), true);
      assert.ok(publicPortal.json.job.updatedAt, JSON.stringify(publicPortal.json.job));
      assert.equal("id" in publicPortal.json.job, false);
      assert.equal(publicPortal.json.customerNotes.length, 1);
      assert.equal(publicPortal.json.customerNotes[0].note, "We will confirm as soon as the quoted work is ready to continue.");
      assert.equal("authorName" in publicPortal.json.customerNotes[0], false);
      assert.equal(
        publicPortal.json.customerNotes.some((note) => note.note === "Internal margin note only for staff."),
        false,
      );
      assert.ok(
        publicPortal.json.timeline.some((event) => event.type === "JOB_CREATED"),
        JSON.stringify(publicPortal.json.timeline),
      );
      assert.ok(
        publicPortal.json.timeline.some(
          (event) =>
            event.type === "QUOTE_READY" &&
            event.detail === "Quote total £65.00",
        ),
        JSON.stringify(publicPortal.json.timeline),
      );

      const legacyQuote = await fetchJson(`/api/public/workshop-quotes/${quoteToken}`);
      assert.equal(legacyQuote.status, 200, JSON.stringify(legacyQuote.json));
      assert.equal(legacyQuote.json.portal.accessStatus, "ACTIVE");

      const approved = await fetchJson(`/api/public/workshop/${quoteToken}/decision`, {
        method: "POST",
        body: JSON.stringify({ status: "APPROVED" }),
      });
      assert.equal(approved.status, 201, JSON.stringify(approved.json));
      assert.equal(approved.json.estimate.status, "APPROVED");
      assert.equal(approved.json.estimate.decisionSource, "CUSTOMER");

      const approvedReplay = await fetchJson(`/api/public/workshop/${quoteToken}/decision`, {
        method: "POST",
        body: JSON.stringify({ status: "APPROVED" }),
      });
      assert.equal(approvedReplay.status, 200, JSON.stringify(approvedReplay.json));
      assert.equal(approvedReplay.json.portal.idempotent, true);

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

      const stalePortal = await fetchJson(`/api/public/workshop/${quoteToken}`);
      assert.equal(stalePortal.status, 200, JSON.stringify(stalePortal.json));
      assert.equal(stalePortal.json.portal.accessStatus, "SUPERSEDED");
      assert.equal(stalePortal.json.portal.canApprove, false);
      assert.equal(stalePortal.json.estimate.status, "APPROVED");

      const staleApprove = await fetchJson(`/api/public/workshop/${quoteToken}/decision`, {
        method: "POST",
        body: JSON.stringify({ status: "APPROVED" }),
      });
      assert.equal(staleApprove.status, 409, JSON.stringify(staleApprove.json));
      assert.equal(staleApprove.json.error.code, "WORKSHOP_QUOTE_SUPERSEDED");
    }, results);

    await runTest("customer workshop portal progress shows approval, in-progress, and collection stages clearly", async () => {
      const { job } = await createJob(state);

      const addLine = await fetchJson(`/api/workshop/jobs/${job.id}/lines`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          type: "LABOUR",
          description: "Portal progress labour",
          qty: 1,
          unitPricePence: 5900,
        }),
      });
      assert.equal(addLine.status, 201, JSON.stringify(addLine.json));

      const waitingApproval = await fetchJson(`/api/workshop/jobs/${job.id}/approval`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "WAITING_FOR_APPROVAL" }),
      });
      assert.equal(waitingApproval.status, 201, JSON.stringify(waitingApproval.json));

      const link = await fetchJson(`/api/workshop/jobs/${job.id}/customer-quote-link`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({}),
      });
      assert.equal(link.status, 200, JSON.stringify(link.json));
      const quoteToken = extractQuoteToken(link.json.customerQuote.publicPath);

      const awaitingApproval = await fetchJson(`/api/public/workshop/${quoteToken}`);
      assert.equal(awaitingApproval.status, 200, JSON.stringify(awaitingApproval.json));
      assert.equal(awaitingApproval.json.customerProgress.stage, "AWAITING_APPROVAL");
      assert.equal(awaitingApproval.json.customerProgress.needsCustomerAction, true);

      const approve = await fetchJson(`/api/public/workshop/${quoteToken}/decision`, {
        method: "POST",
        body: JSON.stringify({ status: "APPROVED" }),
      });
      assert.equal(approve.status, 201, JSON.stringify(approve.json));

      const toInProgress = await fetchJson(`/api/workshop/jobs/${job.id}/status`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      });
      assert.equal(toInProgress.status, 201, JSON.stringify(toInProgress.json));

      const inProgressPortal = await fetchJson(`/api/public/workshop/${quoteToken}`);
      assert.equal(inProgressPortal.status, 200, JSON.stringify(inProgressPortal.json));
      assert.equal(inProgressPortal.json.customerProgress.stage, "IN_PROGRESS");
      assert.equal(inProgressPortal.json.customerProgress.needsCustomerAction, false);

      const toWaitingForParts = await fetchJson(`/api/workshop/jobs/${job.id}/status`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "WAITING_FOR_PARTS" }),
      });
      assert.equal(toWaitingForParts.status, 201, JSON.stringify(toWaitingForParts.json));

      const waitingForPartsPortal = await fetchJson(`/api/public/workshop/${quoteToken}`);
      assert.equal(waitingForPartsPortal.status, 200, JSON.stringify(waitingForPartsPortal.json));
      assert.equal(waitingForPartsPortal.json.customerProgress.stage, "WAITING");
      assert.match(
        waitingForPartsPortal.json.customerProgress.label,
        /waiting on parts/i,
      );

      const toOnHold = await fetchJson(`/api/workshop/jobs/${job.id}/status`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "ON_HOLD" }),
      });
      assert.equal(toOnHold.status, 201, JSON.stringify(toOnHold.json));

      const onHoldPortal = await fetchJson(`/api/public/workshop/${quoteToken}`);
      assert.equal(onHoldPortal.status, 200, JSON.stringify(onHoldPortal.json));
      assert.equal(onHoldPortal.json.customerProgress.stage, "WAITING");
      assert.match(onHoldPortal.json.customerProgress.label, /waiting on an update/i);

      const resumeBenchWork = await fetchJson(`/api/workshop/jobs/${job.id}/status`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      });
      assert.equal(resumeBenchWork.status, 201, JSON.stringify(resumeBenchWork.json));

      const toReady = await fetchJson(`/api/workshop/jobs/${job.id}/status`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "READY" }),
      });
      assert.equal(toReady.status, 201, JSON.stringify(toReady.json));

      const readyPortal = await fetchJson(`/api/public/workshop/${quoteToken}`);
      assert.equal(readyPortal.status, 200, JSON.stringify(readyPortal.json));
      assert.equal(readyPortal.json.customerProgress.stage, "READY_FOR_COLLECTION");
      assert.ok(
        readyPortal.json.customerProgress.headline.includes("ready to collect"),
        readyPortal.json.customerProgress.headline,
      );
    }, results);

    await runTest("customer workshop portal rejects invalid secure tokens safely", async () => {
      const missingPortal = await fetchJson(`/api/public/workshop/not-a-real-token`);
      assert.equal(missingPortal.status, 404, JSON.stringify(missingPortal.json));
      assert.equal(missingPortal.json.error.code, "WORKSHOP_QUOTE_NOT_FOUND");
    }, results);

    await runTest("workshop attachments respect internal vs customer visibility and portal access", async () => {
      const customer = await createCustomer(state, {
        name: `Attachment Customer ${uniqueRef()}`,
      });
      const { job } = await createJob(state, {
        customerId: customer.id,
        bikeDescription: "Attachment commuter",
      });

      const addLine = await fetchJson(`/api/workshop/jobs/${job.id}/lines`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          type: "LABOUR",
          description: "Attachment labour",
          qty: 1,
          unitPricePence: 4200,
        }),
      });
      assert.equal(addLine.status, 201, JSON.stringify(addLine.json));

      const waitingApproval = await fetchJson(`/api/workshop/jobs/${job.id}/approval`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "WAITING_FOR_APPROVAL" }),
      });
      assert.equal(waitingApproval.status, 201, JSON.stringify(waitingApproval.json));

      const link = await fetchJson(`/api/workshop/jobs/${job.id}/customer-quote-link`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({}),
      });
      assert.equal(link.status, 200, JSON.stringify(link.json));
      const quoteToken = extractQuoteToken(link.json.customerQuote.publicPath);

      const internalAttachment = await fetchJson(`/api/workshop/jobs/${job.id}/attachments`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          filename: "internal-damage-photo.png",
          fileDataUrl: TINY_PNG_DATA_URL,
          visibility: "INTERNAL",
        }),
      });
      assert.equal(internalAttachment.status, 201, JSON.stringify(internalAttachment.json));
      assert.equal(internalAttachment.json.attachment.visibility, "INTERNAL");

      const customerAttachment = await fetchJson(`/api/workshop/jobs/${job.id}/attachments`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          filename: "customer-repair-photo.png",
          fileDataUrl: TINY_PNG_DATA_URL,
          visibility: "CUSTOMER",
        }),
      });
      assert.equal(customerAttachment.status, 201, JSON.stringify(customerAttachment.json));
      assert.equal(customerAttachment.json.attachment.visibility, "CUSTOMER");

      const staffAttachments = await fetchJson(`/api/workshop/jobs/${job.id}/attachments`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(staffAttachments.status, 200, JSON.stringify(staffAttachments.json));
      assert.equal(staffAttachments.json.attachments.length, 2);
      assert.equal(
        staffAttachments.json.attachments.some((attachment) => attachment.visibility === "INTERNAL"),
        true,
      );
      assert.equal(
        staffAttachments.json.attachments.some((attachment) => attachment.visibility === "CUSTOMER"),
        true,
      );

      const publicAttachments = await fetchJson(`/api/public/workshop/${quoteToken}/attachments`);
      assert.equal(publicAttachments.status, 200, JSON.stringify(publicAttachments.json));
      assert.equal(publicAttachments.json.attachments.length, 1);
      assert.equal(publicAttachments.json.attachments[0].filename, "customer-repair-photo.png");

      const publicAttachmentFile = await fetchFromApp(
        publicAttachments.json.attachments[0].filePath,
      );
      assert.equal(publicAttachmentFile.status, 200);
      assert.equal(publicAttachmentFile.headers.get("content-type"), "image/png");

      const internalAttachmentFile = await fetchJson(
        `/api/public/workshop/${quoteToken}/attachments/${internalAttachment.json.attachment.id}/file`,
      );
      assert.equal(internalAttachmentFile.status, 404, JSON.stringify(internalAttachmentFile.json));
      assert.equal(
        internalAttachmentFile.json.error.code,
        "WORKSHOP_ATTACHMENT_NOT_FOUND",
      );

      const deleteAttachment = await fetchJson(
        `/api/workshop/jobs/${job.id}/attachments/${customerAttachment.json.attachment.id}`,
        {
          method: "DELETE",
          headers: STAFF_HEADERS,
        },
      );
      assert.equal(deleteAttachment.status, 200, JSON.stringify(deleteAttachment.json));

      const refreshedPublicAttachments = await fetchJson(
        `/api/public/workshop/${quoteToken}/attachments`,
      );
      assert.equal(refreshedPublicAttachments.status, 200, JSON.stringify(refreshedPublicAttachments.json));
      assert.equal(refreshedPublicAttachments.json.attachments.length, 0);
    }, results);

    await runTest("workshop conversation threads are scoped to the job portal and support customer replies", async () => {
      const customer = await createCustomer(state, {
        name: `Conversation Customer ${uniqueRef()}`,
      });
      const { job } = await createJob(state, {
        customerId: customer.id,
        bikeDescription: "Conversation commuter",
      });

      const addLine = await fetchJson(`/api/workshop/jobs/${job.id}/lines`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          type: "LABOUR",
          description: "Conversation labour",
          qty: 1,
          unitPricePence: 3900,
        }),
      });
      assert.equal(addLine.status, 201, JSON.stringify(addLine.json));

      const waitingApproval = await fetchJson(`/api/workshop/jobs/${job.id}/approval`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({ status: "WAITING_FOR_APPROVAL" }),
      });
      assert.equal(waitingApproval.status, 201, JSON.stringify(waitingApproval.json));

      const link = await fetchJson(`/api/workshop/jobs/${job.id}/customer-quote-link`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({}),
      });
      assert.equal(link.status, 200, JSON.stringify(link.json));
      const quoteToken = extractQuoteToken(link.json.customerQuote.publicPath);

      const internalNote = await fetchJson(`/api/workshop/jobs/${job.id}/notes`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          visibility: "INTERNAL",
          note: "Internal diagnostics note that must not appear in the conversation thread.",
        }),
      });
      assert.equal(internalNote.status, 201, JSON.stringify(internalNote.json));

      const sendMessage = await fetchJson(`/api/workshop/jobs/${job.id}/conversation/messages`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          body: "We have your bike on the bench now. Please reply here if you want us to confirm anything before we continue.",
        }),
      });
      assert.equal(sendMessage.status, 201, JSON.stringify(sendMessage.json));
      assert.equal(sendMessage.json.messages.length, 1);
      assert.equal(sendMessage.json.messages[0].direction, "OUTBOUND");
      assert.equal(sendMessage.json.messages[0].channel, "PORTAL");

      const staffConversation = await fetchJson(`/api/workshop/jobs/${job.id}/conversation`, {
        headers: STAFF_HEADERS,
      });
      assert.equal(staffConversation.status, 200, JSON.stringify(staffConversation.json));
      assert.equal(staffConversation.json.conversation.workshopJobId, job.id);
      assert.equal(staffConversation.json.conversation.messageCount, 1);
      assert.equal(staffConversation.json.messages[0].authorStaff.id, STAFF_USER_ID);

      const publicConversation = await fetchJson(`/api/public/workshop/${quoteToken}/conversation`);
      assert.equal(publicConversation.status, 200, JSON.stringify(publicConversation.json));
      assert.equal(publicConversation.json.conversation.canReply, true);
      assert.equal(publicConversation.json.messages.length, 1);
      assert.equal(publicConversation.json.messages[0].direction, "OUTBOUND");
      assert.equal(
        "authorStaff" in publicConversation.json.messages[0],
        false,
        JSON.stringify(publicConversation.json.messages[0]),
      );
      assert.equal(
        publicConversation.json.messages.some((message) =>
          message.body.includes("Internal diagnostics note"),
        ),
        false,
      );

      const reply = await fetchJson(`/api/public/workshop/${quoteToken}/conversation/messages`, {
        method: "POST",
        body: JSON.stringify({
          body: "Please continue with the quoted work and give me a ring if anything else changes.",
        }),
      });
      assert.equal(reply.status, 201, JSON.stringify(reply.json));
      assert.equal(reply.json.conversation.messageCount, 2);
      assert.equal(reply.json.messages[1].direction, "INBOUND");
      assert.equal(reply.json.messages[1].senderLabel, "You");

      const refreshedStaffConversation = await fetchJson(
        `/api/workshop/jobs/${job.id}/conversation`,
        {
          headers: STAFF_HEADERS,
        },
      );
      assert.equal(refreshedStaffConversation.status, 200, JSON.stringify(refreshedStaffConversation.json));
      assert.equal(refreshedStaffConversation.json.messages.length, 2);
      assert.equal(refreshedStaffConversation.json.messages[1].direction, "INBOUND");
      assert.equal(refreshedStaffConversation.json.messages[1].authorStaff, null);

      const portalMessageNotification = await waitForNotification(
        {
          workshopJobId: job.id,
          eventType: "PORTAL_MESSAGE",
          channel: "WHATSAPP",
        },
        "SENT",
      );
      assert.ok(portalMessageNotification, "Expected portal message notification row");
      assert.equal(portalMessageNotification.deliveryStatus, "SENT");

      const notificationHistory = await fetchJson(
        `/api/workshop/jobs/${job.id}/notifications`,
        {
          headers: STAFF_HEADERS,
        },
      );
      assert.equal(notificationHistory.status, 200, JSON.stringify(notificationHistory.json));
      assert.equal(
        notificationHistory.json.notifications.some(
          (notification) =>
            notification.eventType === "PORTAL_MESSAGE" &&
            notification.channel === "WHATSAPP" &&
            notification.deliveryStatus === "SENT",
        ),
        true,
        JSON.stringify(notificationHistory.json),
      );
    }, results);

    await runTest("portal-message alerts skip truthfully when no active customer portal link exists", async () => {
      const customer = await createCustomer(state, {
        name: `Conversation No Link ${uniqueRef()}`,
      });
      const { job } = await createJob(state, {
        customerId: customer.id,
        bikeDescription: "No-link conversation bike",
      });

      const sendMessage = await fetchJson(`/api/workshop/jobs/${job.id}/conversation/messages`, {
        method: "POST",
        headers: STAFF_HEADERS,
        body: JSON.stringify({
          body: "We have an update for you, but the portal has not been shared yet.",
        }),
      });
      assert.equal(sendMessage.status, 201, JSON.stringify(sendMessage.json));

      const skippedNotification = await waitForNotification(
        {
          workshopJobId: job.id,
          eventType: "PORTAL_MESSAGE",
          channel: "WHATSAPP",
        },
        "SKIPPED",
      );
      assert.ok(skippedNotification, "Expected skipped portal message notification row");
      assert.equal(skippedNotification.reasonCode, "PORTAL_ACCESS_UNAVAILABLE");
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
