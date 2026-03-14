#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const HEALTH_URL = `${BASE_URL}/health`;
const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const ADMIN_HEADERS = {
  "X-Staff-Role": "ADMIN",
  "X-Staff-Id": "rota-smoke-admin",
};
const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": "rota-smoke-manager",
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const STORE_OPENING_HOURS_KEY = "store.openingHours";
const BANK_HOLIDAY_STATUS_KEY = "rota.bankHolidaySync";
const ALEX_STAFF_ID = "rota-alex-id";
const JORDAN_STAFF_ID = "rota-jordan-id";
const CASEY_STAFF_ID = "rota-casey-id";
const IMPORTED_MONDAY = "2026-03-09";
const IMPORTED_TUESDAY = "2026-03-10";
const IMPORTED_WEDNESDAY = "2026-03-11";
const IMPORTED_FRIDAY = "2026-03-13";
const IMPORTED_SUNDAY = "2026-03-15";
const FUTURE_MONDAY = "2026-03-23";
const FUTURE_TUESDAY = "2026-03-24";
const LONG_RANGE_BANK_HOLIDAY = "2099-03-24";

const ALEX_HEADERS = {
  "X-Staff-Role": "STAFF",
  "X-Staff-Id": ALEX_STAFF_ID,
};

const JORDAN_HEADERS = {
  "X-Staff-Role": "STAFF",
  "X-Staff-Id": JORDAN_STAFF_ID,
};

const fetchJson = async (pathName, options = {}) => {
  const response = await fetch(`${BASE_URL}${pathName}`, options);
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
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

const waitForExit = (child, timeoutMs) =>
  new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    }, timeoutMs);

    child.once("exit", () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve();
    });
  });

const runImporter = (filePath, { apply = false } = {}) => {
  const args = ["ts-node", "--transpile-only", "scripts/import_rota_spreadsheet.ts", "--file", filePath];
  if (apply) {
    args.push("--apply");
  }

  return spawnSync("npx", args, {
    env: {
      ...process.env,
      DATABASE_URL,
      TEST_DATABASE_URL: DATABASE_URL,
    },
    encoding: "utf8",
    shell: process.platform === "win32",
  });
};

const startBankHolidayFeedServer = async () =>
  new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url !== "/bank-holidays.json") {
        res.writeHead(404);
        res.end("not found");
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        "england-and-wales": {
          division: "england-and-wales",
          events: [
            {
              title: "Special bank holiday",
              date: IMPORTED_FRIDAY,
              notes: "",
              bunting: true,
            },
            {
              title: "Long-range bank holiday",
              date: LONG_RANGE_BANK_HOLIDAY,
              notes: "",
              bunting: true,
            },
          ],
        },
      }));
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}/bank-holidays.json`,
      });
    });
  });

const run = async () => {
  let startedServer = false;
  let serverProcess = null;
  let bankHolidayFeedServer = null;
  const tempFilePath = path.join(os.tmpdir(), `corepos-rota-import-${Date.now()}.csv`);

  try {
    bankHolidayFeedServer = await startBankHolidayFeedServer();
    process.env.BANK_HOLIDAY_FEED_URL = bankHolidayFeedServer.url;

    const existing = await serverIsHealthy();
    if (existing && process.env.ALLOW_EXISTING_SERVER !== "1") {
      throw new Error(
        "Refusing to run against an already-running server. Stop it first or set ALLOW_EXISTING_SERVER=1.",
      );
    }

    if (!existing) {
      serverProcess = spawn("npx", ["ts-node", "--transpile-only", "src/server.ts"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          NODE_ENV: "test",
          DATABASE_URL,
          PORT: new URL(BASE_URL).port || "3100",
        },
      });
      startedServer = true;
      await waitForServer();
    }

    await prisma.rotaAssignment.deleteMany();
    await prisma.rotaPeriod.deleteMany();
    await prisma.rotaClosedDay.deleteMany();
    await prisma.appConfig.deleteMany({
      where: {
        key: {
          in: [STORE_OPENING_HOURS_KEY, BANK_HOLIDAY_STATUS_KEY],
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        username: {
          in: ["rota-alex", "rota-jordan", "rota-casey"],
        },
      },
    });

    await prisma.appConfig.create({
      data: {
        key: STORE_OPENING_HOURS_KEY,
        value: {
          MONDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
          TUESDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
          WEDNESDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
          THURSDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
          FRIDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
          SATURDAY: { isClosed: false, opensAt: "09:00", closesAt: "16:30" },
          SUNDAY: { isClosed: true, opensAt: "", closesAt: "" },
        },
      },
    });

    await prisma.user.createMany({
      data: [
        {
          id: ALEX_STAFF_ID,
          username: "rota-alex",
          email: "rota-alex@corepos.local",
          name: "Alex Turner",
          passwordHash: "hash",
          role: "STAFF",
          isActive: true,
        },
        {
          id: JORDAN_STAFF_ID,
          username: "rota-jordan",
          email: "rota-jordan@corepos.local",
          name: "Jordan Patel",
          passwordHash: "hash",
          role: "MANAGER",
          isActive: true,
        },
        {
          id: CASEY_STAFF_ID,
          username: "rota-casey",
          email: "rota-casey@corepos.local",
          name: "Casey Hudson",
          passwordHash: "hash",
          role: "STAFF",
          isActive: true,
        },
      ],
    });

    const bankHolidayStatusBeforeSyncRes = await fetchJson("/api/rota/bank-holidays/status", {
      headers: MANAGER_HEADERS,
    });
    assert.equal(bankHolidayStatusBeforeSyncRes.status, 200, JSON.stringify(bankHolidayStatusBeforeSyncRes.json));
    assert.equal(bankHolidayStatusBeforeSyncRes.json.lastSyncedAt, null);
    assert.equal(bankHolidayStatusBeforeSyncRes.json.storedCount, 0);

    const bankHolidaySyncRes = await fetchJson("/api/rota/bank-holidays/sync", {
      method: "POST",
      headers: ADMIN_HEADERS,
    });
    assert.equal(bankHolidaySyncRes.status, 200, JSON.stringify(bankHolidaySyncRes.json));
    assert.equal(bankHolidaySyncRes.json.lastResult.createdCount, 2);
    assert.equal(bankHolidaySyncRes.json.lastResult.updatedCount, 0);
    assert.equal(bankHolidaySyncRes.json.lastResult.skippedManualCount, 0);
    assert.equal(bankHolidaySyncRes.json.storedCount, 1);
    assert.equal(bankHolidaySyncRes.json.upcoming[0].name, "Long-range bank holiday");

    fs.writeFileSync(
      tempFilePath,
      [
        "Week commencing,09/03/2026,,,,,,",
        "Name,Mon 09/03,Tue 10/03,Wed 11/03,Thu 12/03,Fri 13/03,Sat 14/03,Sun 15/03",
        "Alex Turner,10-6:30,10-6:30,Training day,x,,9-4:30,",
        "Jordan Patel,,10-6:30,,10-6:30,10-6:30,x,",
      ].join("\n"),
      "utf8",
    );

    const dryRun = runImporter(tempFilePath);
    assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
    assert.match(dryRun.stdout, /mode=dry-run/);
    assert.equal(await prisma.rotaAssignment.count(), 0);

    const spreadsheetText = fs.readFileSync(tempFilePath, "utf8");

    const previewRes = await fetchJson("/api/rota/import/preview", {
      method: "POST",
      headers: {
        ...ADMIN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        spreadsheetText,
        fileName: path.basename(tempFilePath),
      }),
    });
    assert.equal(previewRes.status, 200, JSON.stringify(previewRes.json));
    assert.equal(previewRes.json.summary.parsedAssignments, 6);
    assert.equal(previewRes.json.summary.weekBlocks, 1);
    assert.ok(previewRes.json.warnings.some((warning) => warning.includes("Special bank holiday")));
    assert.ok(typeof previewRes.json.previewKey === "string" && previewRes.json.previewKey.length > 20);

    const managerImportRes = await fetchJson("/api/rota/import/preview", {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        spreadsheetText,
        fileName: path.basename(tempFilePath),
      }),
    });
    assert.equal(managerImportRes.status, 403);

    const confirmRes = await fetchJson("/api/rota/import/confirm", {
      method: "POST",
      headers: {
        ...ADMIN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        spreadsheetText,
        fileName: path.basename(tempFilePath),
        previewKey: previewRes.json.previewKey,
      }),
    });
    assert.equal(confirmRes.status, 201, JSON.stringify(confirmRes.json));
    assert.equal(confirmRes.json.createdAssignments, 6);
    assert.equal(confirmRes.json.updatedAssignments, 0);

    const rotaPeriod = await prisma.rotaPeriod.findFirst();
    assert.ok(rotaPeriod, "Expected a rota period to be created");
    assert.equal(rotaPeriod.startsOn, IMPORTED_MONDAY);
    assert.equal(rotaPeriod.endsOn, "2026-04-19");

    const importedAssignments = await prisma.rotaAssignment.findMany({
      orderBy: [{ date: "asc" }, { staffId: "asc" }],
    });
    assert.equal(importedAssignments.length, 6);

    const rotaOverviewRes = await fetchJson("/api/rota", { headers: MANAGER_HEADERS });
    assert.equal(rotaOverviewRes.status, 200, JSON.stringify(rotaOverviewRes.json));
    assert.equal(rotaOverviewRes.json.selectedPeriodId, rotaPeriod.id);
    assert.equal(rotaOverviewRes.json.period.summary.assignedStaffCount, 2);
    assert.equal(rotaOverviewRes.json.period.summary.importedAssignments, 6);
    assert.equal(rotaOverviewRes.json.period.staffRows.length, 2);
    assert.equal(rotaOverviewRes.json.period.days.length, 36);
    assert.equal(rotaOverviewRes.json.period.days[0].weekday, "MONDAY");
    const fridayColumn = rotaOverviewRes.json.period.days.find((day) => day.date === IMPORTED_FRIDAY);
    assert.equal(fridayColumn.isClosed, true);
    assert.equal(fridayColumn.closedReason, "Special bank holiday");

    const filteredAllStaffRes = await fetchJson("/api/rota?staffScope=all&role=STAFF&search=Casey", { headers: MANAGER_HEADERS });
    assert.equal(filteredAllStaffRes.status, 200, JSON.stringify(filteredAllStaffRes.json));
    assert.equal(filteredAllStaffRes.json.period.staffRows.length, 1);
    assert.equal(filteredAllStaffRes.json.period.staffRows[0].name, "Casey Hudson");
    assert.ok(filteredAllStaffRes.json.period.staffRows[0].cells.every((cell) => cell.shiftType === null));

    const caseyManualAssignRes = await fetchJson("/api/rota/assignments", {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        rotaPeriodId: rotaPeriod.id,
        staffId: CASEY_STAFF_ID,
        date: FUTURE_MONDAY,
        shiftType: "FULL_DAY",
      }),
    });
    assert.equal(caseyManualAssignRes.status, 201, JSON.stringify(caseyManualAssignRes.json));
    assert.equal(caseyManualAssignRes.json.assignment.source, "MANUAL");

    const futureMondayRes = await fetchJson(`/api/dashboard/staff-today?date=${FUTURE_MONDAY}`, { headers: ADMIN_HEADERS });
    assert.equal(futureMondayRes.status, 200, JSON.stringify(futureMondayRes.json));
    assert.equal(futureMondayRes.json.staffToday.summary.scheduledStaffCount, 1);
    assert.equal(futureMondayRes.json.staffToday.summary.holidayStaffCount, 0);
    assert.deepEqual(
      futureMondayRes.json.staffToday.staff.map((entry) => entry.name),
      ["Casey Hudson"],
    );

    const alexHolidaySubmitRes = await fetchJson("/api/rota/holiday-requests", {
      method: "POST",
      headers: {
        ...ALEX_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: IMPORTED_MONDAY,
        endDate: IMPORTED_SUNDAY,
        requestNotes: "Family trip",
      }),
    });
    assert.equal(alexHolidaySubmitRes.status, 201, JSON.stringify(alexHolidaySubmitRes.json));
    assert.equal(alexHolidaySubmitRes.json.request.status, "PENDING");

    const alexOwnRequestsRes = await fetchJson("/api/rota/holiday-requests?scope=mine", { headers: ALEX_HEADERS });
    assert.equal(alexOwnRequestsRes.status, 200, JSON.stringify(alexOwnRequestsRes.json));
    assert.equal(alexOwnRequestsRes.json.scope, "mine");
    assert.equal(alexOwnRequestsRes.json.statusFilter, "ALL");
    assert.equal(alexOwnRequestsRes.json.requests.length, 1);

    const managerHolidayRequestsRes = await fetchJson("/api/rota/holiday-requests?scope=all&status=PENDING", { headers: MANAGER_HEADERS });
    assert.equal(managerHolidayRequestsRes.status, 200, JSON.stringify(managerHolidayRequestsRes.json));
    assert.equal(managerHolidayRequestsRes.json.scope, "all");
    assert.equal(managerHolidayRequestsRes.json.statusFilter, "PENDING");
    assert.equal(managerHolidayRequestsRes.json.requests.length, 1);

    const approveHolidayRes = await fetchJson(`/api/rota/holiday-requests/${alexHolidaySubmitRes.json.request.id}/approve`, {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        decisionNotes: "Approved and covered on the workshop bench.",
      }),
    });
    assert.equal(approveHolidayRes.status, 200, JSON.stringify(approveHolidayRes.json));
    assert.equal(approveHolidayRes.json.request.status, "APPROVED");
    assert.equal(approveHolidayRes.json.request.decisionNotes, "Approved and covered on the workshop bench.");
    assert.deepEqual(
      approveHolidayRes.json.appliedDates,
      ["2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12", "2026-03-14"],
    );

    const alexApprovedRequestsRes = await fetchJson("/api/rota/holiday-requests?scope=mine&status=APPROVED", { headers: ALEX_HEADERS });
    assert.equal(alexApprovedRequestsRes.status, 200, JSON.stringify(alexApprovedRequestsRes.json));
    assert.equal(alexApprovedRequestsRes.json.requests.length, 1);
    assert.equal(alexApprovedRequestsRes.json.requests[0].decisionNotes, "Approved and covered on the workshop bench.");
    assert.equal(alexApprovedRequestsRes.json.requests[0].reviewedByUserId, MANAGER_HEADERS["X-Staff-Id"]);

    const jordanHolidaySubmitRes = await fetchJson("/api/rota/holiday-requests", {
      method: "POST",
      headers: {
        ...JORDAN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: "2026-03-12",
        endDate: "2026-03-14",
        requestNotes: "Short break",
      }),
    });
    assert.equal(jordanHolidaySubmitRes.status, 201, JSON.stringify(jordanHolidaySubmitRes.json));

    const rejectHolidayRes = await fetchJson(`/api/rota/holiday-requests/${jordanHolidaySubmitRes.json.request.id}/reject`, {
      method: "POST",
      headers: {
        ...ADMIN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        decisionNotes: "Too many people away that weekend.",
      }),
    });
    assert.equal(rejectHolidayRes.status, 200, JSON.stringify(rejectHolidayRes.json));
    assert.equal(rejectHolidayRes.json.request.status, "REJECTED");
    assert.equal(rejectHolidayRes.json.request.decisionNotes, "Too many people away that weekend.");

    const managerRejectedRequestsRes = await fetchJson("/api/rota/holiday-requests?scope=all&status=REJECTED", { headers: MANAGER_HEADERS });
    assert.equal(managerRejectedRequestsRes.status, 200, JSON.stringify(managerRejectedRequestsRes.json));
    assert.equal(managerRejectedRequestsRes.json.requests.length, 1);
    assert.equal(managerRejectedRequestsRes.json.requests[0].staffName, "Jordan Patel");
    assert.equal(managerRejectedRequestsRes.json.requests[0].decisionNotes, "Too many people away that weekend.");

    const cancelHolidaySubmitRes = await fetchJson("/api/rota/holiday-requests", {
      method: "POST",
      headers: {
        ...JORDAN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: FUTURE_MONDAY,
        endDate: FUTURE_TUESDAY,
        requestNotes: "Cancel me",
      }),
    });
    assert.equal(cancelHolidaySubmitRes.status, 201, JSON.stringify(cancelHolidaySubmitRes.json));

    const cancelHolidayRes = await fetchJson(`/api/rota/holiday-requests/${cancelHolidaySubmitRes.json.request.id}/cancel`, {
      method: "POST",
      headers: JORDAN_HEADERS,
    });
    assert.equal(cancelHolidayRes.status, 200, JSON.stringify(cancelHolidayRes.json));
    assert.equal(cancelHolidayRes.json.request.status, "CANCELLED");

    const approvedHolidayAssignments = await prisma.rotaAssignment.findMany({
      where: {
        staffId: ALEX_STAFF_ID,
        shiftType: "HOLIDAY",
      },
      orderBy: {
        date: "asc",
      },
    });
    assert.deepEqual(
      approvedHolidayAssignments.map((assignment) => assignment.date),
      ["2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12", "2026-03-14"],
    );
    assert.ok(approvedHolidayAssignments.every((assignment) => assignment.source === "HOLIDAY_APPROVED"));
    assert.ok(approvedHolidayAssignments.every((assignment) => assignment.note === "Family trip"));
    assert.equal(await prisma.rotaAssignment.count(), 8);

    const tuesdayRes = await fetchJson(`/api/dashboard/staff-today?date=${IMPORTED_TUESDAY}`, { headers: ADMIN_HEADERS });
    assert.equal(tuesdayRes.status, 200, JSON.stringify(tuesdayRes.json));
    assert.equal(tuesdayRes.json.staffToday.summary.isClosed, false);
    assert.equal(tuesdayRes.json.staffToday.summary.scheduledStaffCount, 1);
    assert.equal(tuesdayRes.json.staffToday.summary.holidayStaffCount, 1);
    assert.deepEqual(
      tuesdayRes.json.staffToday.staff.map((entry) => entry.name).sort(),
      ["Jordan Patel"],
    );
    assert.deepEqual(
      tuesdayRes.json.staffToday.holidayStaff.map((entry) => entry.name),
      ["Alex Turner"],
    );

    const workshopTuesdayRes = await fetchJson(`/api/workshop/dashboard?limit=20&staffDate=${IMPORTED_TUESDAY}`, {
      headers: ALEX_HEADERS,
    });
    assert.equal(workshopTuesdayRes.status, 200, JSON.stringify(workshopTuesdayRes.json));
    assert.equal(workshopTuesdayRes.json.staffingToday.context.usesOperationalRoleTags, false);
    assert.equal(workshopTuesdayRes.json.staffingToday.context.fallbackToBroadStaffing, true);
    assert.equal(workshopTuesdayRes.json.staffingToday.summary.coverageStatus, "thin");
    assert.equal(workshopTuesdayRes.json.staffingToday.summary.scheduledStaffCount, 1);
    assert.equal(workshopTuesdayRes.json.staffingToday.summary.holidayStaffCount, 1);
    assert.deepEqual(
      workshopTuesdayRes.json.staffingToday.scheduledStaff.map((entry) => entry.name),
      ["Jordan Patel"],
    );
    assert.deepEqual(
      workshopTuesdayRes.json.staffingToday.holidayStaff.map((entry) => entry.name),
      ["Alex Turner"],
    );

    const tagJordanWorkshopRes = await fetchJson(`/api/staff-directory/${JORDAN_STAFF_ID}/operational-role`, {
      method: "PATCH",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        operationalRole: "WORKSHOP",
      }),
    });
    assert.equal(tagJordanWorkshopRes.status, 200, JSON.stringify(tagJordanWorkshopRes.json));
    assert.equal(tagJordanWorkshopRes.json.user.operationalRole, "WORKSHOP");

    const tagAlexSalesRes = await fetchJson(`/api/staff-directory/${ALEX_STAFF_ID}/operational-role`, {
      method: "PATCH",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        operationalRole: "SALES",
      }),
    });
    assert.equal(tagAlexSalesRes.status, 200, JSON.stringify(tagAlexSalesRes.json));
    assert.equal(tagAlexSalesRes.json.user.operationalRole, "SALES");

    const taggedWorkshopTuesdayRes = await fetchJson(`/api/workshop/dashboard?limit=20&staffDate=${IMPORTED_TUESDAY}`, {
      headers: MANAGER_HEADERS,
    });
    assert.equal(taggedWorkshopTuesdayRes.status, 200, JSON.stringify(taggedWorkshopTuesdayRes.json));
    assert.equal(taggedWorkshopTuesdayRes.json.staffingToday.context.usesOperationalRoleTags, true);
    assert.equal(taggedWorkshopTuesdayRes.json.staffingToday.context.fallbackToBroadStaffing, false);
    assert.equal(taggedWorkshopTuesdayRes.json.staffingToday.summary.scheduledStaffCount, 1);
    assert.equal(taggedWorkshopTuesdayRes.json.staffingToday.summary.totalScheduledStaffCount, 1);
    assert.equal(taggedWorkshopTuesdayRes.json.staffingToday.summary.holidayStaffCount, 0);
    assert.equal(taggedWorkshopTuesdayRes.json.staffingToday.summary.totalHolidayStaffCount, 1);
    assert.deepEqual(
      taggedWorkshopTuesdayRes.json.staffingToday.scheduledStaff.map((entry) => entry.name),
      ["Jordan Patel"],
    );
    assert.deepEqual(taggedWorkshopTuesdayRes.json.staffingToday.holidayStaff, []);

    const mondayRes = await fetchJson(`/api/dashboard/staff-today?date=${IMPORTED_MONDAY}`, { headers: ADMIN_HEADERS });
    assert.equal(mondayRes.status, 200, JSON.stringify(mondayRes.json));
    assert.equal(mondayRes.json.staffToday.summary.scheduledStaffCount, 0);
    assert.equal(mondayRes.json.staffToday.summary.holidayStaffCount, 1);

    const workshopMondayRes = await fetchJson(`/api/workshop/dashboard?limit=20&staffDate=${IMPORTED_MONDAY}`, {
      headers: ALEX_HEADERS,
    });
    assert.equal(workshopMondayRes.status, 200, JSON.stringify(workshopMondayRes.json));
    assert.equal(workshopMondayRes.json.staffingToday.summary.coverageStatus, "none");
    assert.equal(workshopMondayRes.json.staffingToday.summary.scheduledStaffCount, 0);
    assert.equal(workshopMondayRes.json.staffingToday.summary.holidayStaffCount, 1);

    const trainingDayRes = await fetchJson(`/api/dashboard/staff-today?date=${IMPORTED_WEDNESDAY}`, { headers: ADMIN_HEADERS });
    assert.equal(trainingDayRes.status, 200, JSON.stringify(trainingDayRes.json));
    assert.equal(trainingDayRes.json.staffToday.summary.scheduledStaffCount, 0);
    assert.equal(trainingDayRes.json.staffToday.summary.holidayStaffCount, 1);

    const sundayRes = await fetchJson(`/api/dashboard/staff-today?date=${IMPORTED_SUNDAY}`, { headers: ADMIN_HEADERS });
    assert.equal(sundayRes.status, 200, JSON.stringify(sundayRes.json));
    assert.equal(sundayRes.json.staffToday.summary.isClosed, true);
    assert.match(sundayRes.json.staffToday.summary.closedReason, /closed/i);

    const updatedRotaOverviewRes = await fetchJson("/api/rota", { headers: MANAGER_HEADERS });
    assert.equal(updatedRotaOverviewRes.status, 200, JSON.stringify(updatedRotaOverviewRes.json));
    const alexRow = updatedRotaOverviewRes.json.period.staffRows.find((row) => row.name === "Alex Turner");
    assert.ok(alexRow, "Expected Alex Turner to be present in rota overview");
    const tuesdayCell = alexRow.cells.find((cell) => cell.date === IMPORTED_TUESDAY);
    assert.equal(tuesdayCell.shiftType, "HOLIDAY");
    assert.equal(tuesdayCell.source, "HOLIDAY_APPROVED");
    assert.equal(tuesdayCell.note, "Family trip");

    const manualAssignRes = await fetchJson("/api/rota/assignments", {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        rotaPeriodId: rotaPeriod.id,
        staffId: JORDAN_STAFF_ID,
        date: IMPORTED_MONDAY,
        shiftType: "HALF_DAY_AM",
      }),
    });
    assert.equal(manualAssignRes.status, 201, JSON.stringify(manualAssignRes.json));
    assert.equal(manualAssignRes.json.assignment.source, "MANUAL");
    assert.equal(manualAssignRes.json.assignment.shiftType, "HALF_DAY_AM");

    const mondayAfterManualEditRes = await fetchJson(`/api/dashboard/staff-today?date=${IMPORTED_MONDAY}`, { headers: ADMIN_HEADERS });
    assert.equal(mondayAfterManualEditRes.status, 200, JSON.stringify(mondayAfterManualEditRes.json));
    assert.equal(mondayAfterManualEditRes.json.staffToday.summary.scheduledStaffCount, 1);
    assert.equal(mondayAfterManualEditRes.json.staffToday.summary.holidayStaffCount, 1);
    assert.deepEqual(
      mondayAfterManualEditRes.json.staffToday.staff.map((entry) => entry.name),
      ["Jordan Patel"],
    );

    const overwriteHolidayApprovedRes = await fetchJson("/api/rota/assignments", {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        rotaPeriodId: rotaPeriod.id,
        staffId: ALEX_STAFF_ID,
        date: IMPORTED_TUESDAY,
        shiftType: "FULL_DAY",
      }),
    });
    assert.equal(overwriteHolidayApprovedRes.status, 201, JSON.stringify(overwriteHolidayApprovedRes.json));
    assert.equal(overwriteHolidayApprovedRes.json.assignment.source, "MANUAL");
    assert.equal(overwriteHolidayApprovedRes.json.replacedHolidayApproved, true);

    const overviewAfterOverwriteRes = await fetchJson("/api/rota", { headers: MANAGER_HEADERS });
    assert.equal(overviewAfterOverwriteRes.status, 200, JSON.stringify(overviewAfterOverwriteRes.json));
    const alexRowAfterOverwrite = overviewAfterOverwriteRes.json.period.staffRows.find((row) => row.name === "Alex Turner");
    const tuesdayCellAfterOverwrite = alexRowAfterOverwrite.cells.find((cell) => cell.date === IMPORTED_TUESDAY);
    assert.equal(tuesdayCellAfterOverwrite.shiftType, "FULL_DAY");
    assert.equal(tuesdayCellAfterOverwrite.source, "MANUAL");

    const tuesdayAfterOverwriteRes = await fetchJson(`/api/dashboard/staff-today?date=${IMPORTED_TUESDAY}`, { headers: ADMIN_HEADERS });
    assert.equal(tuesdayAfterOverwriteRes.status, 200, JSON.stringify(tuesdayAfterOverwriteRes.json));
    assert.equal(tuesdayAfterOverwriteRes.json.staffToday.summary.scheduledStaffCount, 2);
    assert.equal(tuesdayAfterOverwriteRes.json.staffToday.summary.holidayStaffCount, 0);
    assert.deepEqual(
      tuesdayAfterOverwriteRes.json.staffToday.staff.map((entry) => entry.name).sort(),
      ["Alex Turner", "Jordan Patel"],
    );

    const closedDayEditRes = await fetchJson("/api/rota/assignments", {
      method: "POST",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        rotaPeriodId: rotaPeriod.id,
        staffId: JORDAN_STAFF_ID,
        date: IMPORTED_FRIDAY,
        shiftType: "FULL_DAY",
      }),
    });
    assert.equal(closedDayEditRes.status, 409, JSON.stringify(closedDayEditRes.json));

    const clearManualAssignRes = await fetchJson(`/api/rota/assignments/${manualAssignRes.json.assignment.id}`, {
      method: "DELETE",
      headers: MANAGER_HEADERS,
    });
    assert.equal(clearManualAssignRes.status, 200, JSON.stringify(clearManualAssignRes.json));
    assert.equal(clearManualAssignRes.json.clearedAssignmentId, manualAssignRes.json.assignment.id);

    const mondayAfterClearRes = await fetchJson(`/api/dashboard/staff-today?date=${IMPORTED_MONDAY}`, { headers: ADMIN_HEADERS });
    assert.equal(mondayAfterClearRes.status, 200, JSON.stringify(mondayAfterClearRes.json));
    assert.equal(mondayAfterClearRes.json.staffToday.summary.scheduledStaffCount, 0);
    assert.equal(mondayAfterClearRes.json.staffToday.summary.holidayStaffCount, 1);

    const closedDayRes = await fetchJson(`/api/dashboard/staff-today?date=${IMPORTED_FRIDAY}`, { headers: ADMIN_HEADERS });
    assert.equal(closedDayRes.status, 200, JSON.stringify(closedDayRes.json));
    assert.equal(closedDayRes.json.staffToday.summary.isClosed, true);
    assert.equal(closedDayRes.json.staffToday.summary.closedReason, "Special bank holiday");
    assert.equal(closedDayRes.json.staffToday.staff.length, 0);

    const workshopClosedDayRes = await fetchJson(`/api/workshop/dashboard?limit=20&staffDate=${IMPORTED_FRIDAY}`, {
      headers: MANAGER_HEADERS,
    });
    assert.equal(workshopClosedDayRes.status, 200, JSON.stringify(workshopClosedDayRes.json));
    assert.equal(workshopClosedDayRes.json.staffingToday.summary.isClosed, true);
    assert.equal(workshopClosedDayRes.json.staffingToday.summary.coverageStatus, "closed");
    assert.equal(workshopClosedDayRes.json.staffingToday.summary.closedReason, "Special bank holiday");
    assert.equal(workshopClosedDayRes.json.staffingToday.scheduledStaff.length, 0);

    console.log("[rota-foundation-smoke] rota import and dashboard staff summary passed");
  } finally {
    fs.rmSync(tempFilePath, { force: true });
    await prisma.$disconnect();

    if (startedServer && serverProcess) {
      serverProcess.kill("SIGTERM");
      await waitForExit(serverProcess, 1500);
      if (serverProcess.exitCode === null) {
        serverProcess.kill("SIGKILL");
        await waitForExit(serverProcess, 500);
      }
    }

    if (bankHolidayFeedServer) {
      await new Promise((resolve) => bankHolidayFeedServer.server.close(resolve));
    }
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
