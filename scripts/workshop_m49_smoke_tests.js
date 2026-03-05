#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
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

const safeDbUrl = DATABASE_URL.replace(/(postgres(?:ql)?:\/\/[^:/@]+:)[^@]+@/i, "$1***@");
console.log(`[m49-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m49-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const apiJson = async ({ path, method = "GET", body, cookie }) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const payload = await parseJson(response);
  if (!response.ok) {
    throw new Error(`${method} ${path} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return { payload, status: response.status };
};

const login = async (email, password) => {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  const payload = await parseJson(response);
  assert.equal(response.status, 200, JSON.stringify(payload));
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie, "missing set-cookie");
  return setCookie.split(";")[0];
};

let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;

const run = async () => {
  const token = uniqueRef();
  const staffEmail = `m49.staff.${token}@example.com`;
  const staffPassword = `M49Staff!${token}`;

  const created = {
    userId: null,
    customerId: null,
    workshopJobId: null,
  };

  let startedServer = false;
  let serverProcess = null;

  try {
    const alreadyHealthy = await serverIsHealthy();
    if (alreadyHealthy && process.env.ALLOW_EXISTING_SERVER !== "1") {
      throw new Error(
        "Refusing to run against an already-running server. Stop it first or set ALLOW_EXISTING_SERVER=1.",
      );
    }

    if (!alreadyHealthy) {
      serverProcess = spawn("npm", ["run", "dev"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          NODE_ENV: "test",
          DATABASE_URL,
        },
      });
      startedServer = true;
      await waitForServer();
    }

    const staff = await prisma.user.create({
      data: {
        username: `m49-staff-${token}`,
        name: "M49 Staff",
        email: staffEmail,
        passwordHash: await bcrypt.hash(staffPassword, 10),
        role: "STAFF",
        isActive: true,
      },
    });
    created.userId = staff.id;

    const cookie = await login(staffEmail, staffPassword);

    const customer = await apiJson({
      path: "/api/customers",
      method: "POST",
      body: {
        name: `M49 Customer ${token}`,
        email: `m49.customer.${token}@example.com`,
      },
      cookie,
    });
    created.customerId = customer.payload.id;

    const createdJob = await apiJson({
      path: "/api/workshop/jobs",
      method: "POST",
      body: {
        customerId: created.customerId,
        title: `M49 Service ${token}`,
        notes: "M49 smoke create",
        status: "NEW",
      },
      cookie,
    });
    created.workshopJobId = createdJob.payload.id;
    assert.equal(createdJob.payload.statusV1, "NEW");

    const updatedJob = await apiJson({
      path: `/api/workshop/jobs/${encodeURIComponent(created.workshopJobId)}`,
      method: "PATCH",
      body: {
        status: "IN_PROGRESS",
        notes: "Bike on stand",
      },
      cookie,
    });
    assert.equal(updatedJob.payload.statusV1, "IN_PROGRESS");

    const awaitingParts = await apiJson({
      path: `/api/workshop/jobs/${encodeURIComponent(created.workshopJobId)}`,
      method: "PATCH",
      body: {
        status: "AWAITING_PARTS",
      },
      cookie,
    });
    assert.equal(awaitingParts.payload.statusV1, "AWAITING_PARTS");

    const listedJobs = await apiJson({
      path: "/api/workshop/jobs?status=AWAITING_PARTS&search=M49%20Service",
      cookie,
    });
    assert.ok(Array.isArray(listedJobs.payload.jobs), JSON.stringify(listedJobs.payload));
    assert.ok(
      listedJobs.payload.jobs.some((job) => job.id === created.workshopJobId),
      "Expected created workshop job in filtered list",
    );

    const jobDetail = await apiJson({
      path: `/api/workshop/jobs/${encodeURIComponent(created.workshopJobId)}`,
      cookie,
    });
    assert.equal(jobDetail.payload.job.id, created.workshopJobId);
    assert.equal(jobDetail.payload.job.statusV1, "AWAITING_PARTS");

    const workshopPage = await fetch(`${BASE_URL}/workshop`, {
      headers: {
        Cookie: cookie,
        Accept: "text/html",
      },
    });
    assert.equal(workshopPage.status, 200);
    const workshopHtml = await workshopPage.text();
    assert.ok(workshopHtml.includes("Jobs"));
    assert.ok(workshopHtml.includes("jobs-board"));

    const workshopJobCardPage = await fetch(
      `${BASE_URL}/workshop/${encodeURIComponent(created.workshopJobId)}`,
      {
        headers: {
          Cookie: cookie,
          Accept: "text/html",
        },
      },
    );
    assert.equal(workshopJobCardPage.status, 200);
    const workshopJobCardHtml = await workshopJobCardPage.text();
    assert.ok(workshopJobCardHtml.includes("Workshop Job Card"));
    assert.ok(workshopJobCardHtml.includes("workshop-job-card-heading"));

    console.log("M49 workshop jobs smoke tests passed.");
  } finally {
    if (created.workshopJobId) {
      await prisma.workshopJobLine.deleteMany({ where: { jobId: created.workshopJobId } });
      await prisma.workshopJobPart.deleteMany({ where: { workshopJobId: created.workshopJobId } });
      await prisma.workshopJobNote.deleteMany({ where: { workshopJobId: created.workshopJobId } });
      await prisma.payment.deleteMany({ where: { workshopJobId: created.workshopJobId } });
      await prisma.workshopJob.deleteMany({ where: { id: created.workshopJobId } });
    }
    if (created.customerId) {
      await prisma.creditAccount.deleteMany({ where: { customerId: created.customerId } });
      await prisma.customer.deleteMany({ where: { id: created.customerId } });
    }
    if (created.userId) {
      await prisma.user.deleteMany({ where: { id: created.userId } });
    }

    await prisma.$disconnect();

    if (startedServer && serverProcess) {
      serverProcess.kill("SIGTERM");
      await sleep(400);
      if (!serverProcess.killed) {
        serverProcess.kill("SIGKILL");
      }
    }
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
