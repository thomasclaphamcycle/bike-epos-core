#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const fs = require("node:fs");
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
const IMPORTED_MONDAY = "2026-03-09";
const IMPORTED_TUESDAY = "2026-03-10";
const IMPORTED_WEDNESDAY = "2026-03-11";
const IMPORTED_FRIDAY = "2026-03-13";
const IMPORTED_SUNDAY = "2026-03-15";

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

const run = async () => {
  let startedServer = false;
  let serverProcess = null;
  const tempFilePath = path.join(os.tmpdir(), `corepos-rota-import-${Date.now()}.csv`);

  try {
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
          in: [STORE_OPENING_HOURS_KEY],
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        username: {
          in: ["rota-alex", "rota-jordan"],
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
          username: "rota-alex",
          email: "rota-alex@corepos.local",
          name: "Alex Turner",
          passwordHash: "hash",
          role: "STAFF",
          isActive: true,
        },
        {
          username: "rota-jordan",
          email: "rota-jordan@corepos.local",
          name: "Jordan Patel",
          passwordHash: "hash",
          role: "MANAGER",
          isActive: true,
        },
      ],
    });

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

    const applyRun = runImporter(tempFilePath, { apply: true });
    assert.equal(applyRun.status, 0, applyRun.stderr || applyRun.stdout);
    assert.match(applyRun.stdout, /createdAssignments=7/);

    const rotaPeriod = await prisma.rotaPeriod.findFirst();
    assert.ok(rotaPeriod, "Expected a rota period to be created");
    assert.equal(rotaPeriod.startsOn, IMPORTED_MONDAY);
    assert.equal(rotaPeriod.endsOn, "2026-04-19");

    const importedAssignments = await prisma.rotaAssignment.findMany({
      orderBy: [{ date: "asc" }, { staffId: "asc" }],
    });
    assert.equal(importedAssignments.length, 7);

    const tuesdayRes = await fetchJson(`/api/dashboard/staff-today?date=${IMPORTED_TUESDAY}`, { headers: ADMIN_HEADERS });
    assert.equal(tuesdayRes.status, 200, JSON.stringify(tuesdayRes.json));
    assert.equal(tuesdayRes.json.staffToday.summary.isClosed, false);
    assert.equal(tuesdayRes.json.staffToday.summary.scheduledStaffCount, 2);
    assert.deepEqual(
      tuesdayRes.json.staffToday.staff.map((entry) => entry.name).sort(),
      ["Alex Turner", "Jordan Patel"],
    );

    const trainingDayRes = await fetchJson(`/api/dashboard/staff-today?date=${IMPORTED_WEDNESDAY}`, { headers: ADMIN_HEADERS });
    assert.equal(trainingDayRes.status, 200, JSON.stringify(trainingDayRes.json));
    assert.equal(trainingDayRes.json.staffToday.summary.scheduledStaffCount, 1);
    assert.equal(trainingDayRes.json.staffToday.staff[0].note, "Training day");

    const sundayRes = await fetchJson(`/api/dashboard/staff-today?date=${IMPORTED_SUNDAY}`, { headers: ADMIN_HEADERS });
    assert.equal(sundayRes.status, 200, JSON.stringify(sundayRes.json));
    assert.equal(sundayRes.json.staffToday.summary.isClosed, true);
    assert.match(sundayRes.json.staffToday.summary.closedReason, /closed/i);

    await prisma.rotaClosedDay.create({
      data: {
        date: IMPORTED_FRIDAY,
        type: "BANK_HOLIDAY",
        note: "Bank holiday closure",
      },
    });

    const closedDayRes = await fetchJson(`/api/dashboard/staff-today?date=${IMPORTED_FRIDAY}`, { headers: ADMIN_HEADERS });
    assert.equal(closedDayRes.status, 200, JSON.stringify(closedDayRes.json));
    assert.equal(closedDayRes.json.staffToday.summary.isClosed, true);
    assert.equal(closedDayRes.json.staffToday.summary.closedReason, "Bank holiday closure");
    assert.equal(closedDayRes.json.staffToday.staff.length, 0);

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
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
