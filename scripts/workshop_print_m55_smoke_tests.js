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
console.log(`[m55-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m55-smoke] DATABASE_URL=${safeDbUrl}`);

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

const fetchHtml = async (path, cookie) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Cookie: cookie,
      Accept: "text/html",
    },
  });
  const html = await response.text();
  return { status: response.status, html };
};

const run = async () => {
  const token = uniqueRef();
  const staffEmail = `m55.staff.${token}@example.com`;
  const staffPassword = `M55Staff!${token}`;

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
        username: `m55-staff-${token}`,
        name: "M55 Staff",
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
        name: `M55 Customer ${token}`,
        phone: "07000 111222",
      },
      cookie,
    });
    created.customerId = customer.payload.id;

    const job = await apiJson({
      path: "/api/workshop/jobs",
      method: "POST",
      body: {
        customerId: created.customerId,
        title: `M55 Print Job ${token}`,
        notes: "M55 print smoke",
      },
      cookie,
    });
    created.workshopJobId = job.payload.id;

    await apiJson({
      path: `/api/workshop/jobs/${encodeURIComponent(created.workshopJobId)}/lines`,
      method: "POST",
      body: {
        type: "LABOUR",
        description: "Full service labour",
        quantity: 1,
        unitPricePence: 4500,
      },
      cookie,
    });

    const shortRoute = await fetchHtml(`/w/${encodeURIComponent(created.workshopJobId)}`, cookie);
    assert.equal(shortRoute.status, 200);
    assert.match(shortRoute.html, /Workshop Job Estimate/i);
    assert.match(shortRoute.html, /Line Items/i);
    assert.match(shortRoute.html, /Customer/i);
    assert.match(shortRoute.html, /Full service labour/i);
    assert.match(shortRoute.html, new RegExp(created.workshopJobId));

    const explicitRoute = await fetchHtml(
      `/workshop/${encodeURIComponent(created.workshopJobId)}/print`,
      cookie,
    );
    assert.equal(explicitRoute.status, 200);
    assert.match(explicitRoute.html, /Workshop Job Estimate/i);

    console.log("M55 workshop print smoke tests passed.");
  } finally {
    if (created.workshopJobId) {
      await prisma.stockReservation.deleteMany({ where: { workshopJobId: created.workshopJobId } });
      await prisma.workshopJobLine.deleteMany({ where: { jobId: created.workshopJobId } });
      await prisma.workshopJobPart.deleteMany({ where: { workshopJobId: created.workshopJobId } });
      await prisma.workshopJobNote.deleteMany({ where: { workshopJobId: created.workshopJobId } });
      await prisma.payment.deleteMany({ where: { workshopJobId: created.workshopJobId } });
      await prisma.workshopCancellation.deleteMany({ where: { workshopJobId: created.workshopJobId } });
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
