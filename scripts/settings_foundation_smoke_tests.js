#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const HEALTH_URL = `${BASE_URL}/health`;
const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": "settings-smoke-manager",
};
const ADMIN_HEADERS = {
  "X-Staff-Role": "ADMIN",
  "X-Staff-Id": "settings-smoke-admin",
};
const STAFF_HEADERS = {
  "X-Staff-Role": "STAFF",
  "X-Staff-Id": "settings-smoke-staff",
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

const SETTINGS_KEYS = [
  "store.name",
  "store.businessName",
  "store.email",
  "store.phone",
  "store.website",
  "store.addressLine1",
  "store.addressLine2",
  "store.city",
  "store.region",
  "store.postcode",
  "store.country",
  "store.vatNumber",
  "store.companyNumber",
  "store.defaultCurrency",
  "store.timeZone",
  "store.logoUrl",
  "store.footerText",
  "store.latitude",
  "store.longitude",
  "pos.defaultTaxRatePercent",
  "pos.barcodeSearchAutoFocus",
  "workshop.defaultJobDurationMinutes",
  "workshop.defaultDepositPence",
  "operations.lowStockThreshold",
];

const fetchJson = async (path, options = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, options);
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

const run = async () => {
  let startedServer = false;
  let serverProcess = null;

  try {
    const existing = await serverIsHealthy();
    if (existing && process.env.ALLOW_EXISTING_SERVER !== "1") {
      throw new Error(
        "Refusing to run against an already-running server. Stop it first or set ALLOW_EXISTING_SERVER=1.",
      );
    }

    if (!existing) {
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

    await prisma.appConfig.deleteMany({
      where: {
        key: {
          in: SETTINGS_KEYS,
        },
      },
    });

    const defaultRes = await fetchJson("/api/settings", { headers: MANAGER_HEADERS });
    assert.equal(defaultRes.status, 200, JSON.stringify(defaultRes.json));
    assert.equal(defaultRes.json.settings.store.name, "Bike EPOS");
    assert.equal(defaultRes.json.settings.store.businessName, "Bike EPOS");
    assert.equal(defaultRes.json.settings.store.addressLine1, "");
    assert.equal(defaultRes.json.settings.store.city, "");
    assert.equal(defaultRes.json.settings.store.postcode, "");
    assert.equal(defaultRes.json.settings.store.country, "United Kingdom");
    assert.equal(defaultRes.json.settings.store.defaultCurrency, "GBP");
    assert.equal(defaultRes.json.settings.store.timeZone, "Europe/London");
    assert.equal(defaultRes.json.settings.store.footerText, "Thank you for your custom.");
    assert.equal(defaultRes.json.settings.store.latitude, null);
    assert.equal(defaultRes.json.settings.store.longitude, null);
    assert.equal(defaultRes.json.settings.pos.defaultTaxRatePercent, 20);
    assert.equal(defaultRes.json.settings.workshop.defaultDepositPence, 1000);
    assert.equal(defaultRes.json.settings.operations.lowStockThreshold, 3);

    const patchRes = await fetchJson("/api/settings", {
      method: "PATCH",
      headers: {
        ...MANAGER_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        store: {
          name: "CorePOS Cycles",
          businessName: "CorePOS Cycles Ltd",
          email: "support@corepos.local",
          phone: "01234 567890",
          website: "https://www.corepos.local",
          addressLine1: "123 Service Lane",
          addressLine2: "Unit 4",
          city: "Clapham",
          region: "Greater London",
          postcode: "SW4 0HY",
          country: "United Kingdom",
          vatNumber: "GB123456789",
          companyNumber: "01234567",
          defaultCurrency: "GBP",
          timeZone: "Europe/London",
          logoUrl: "https://cdn.corepos.local/logo.png",
          footerText: "Thanks for riding with CorePOS.",
          latitude: 51.4526,
          longitude: -0.1477,
        },
        pos: {
          defaultTaxRatePercent: 17.5,
          barcodeSearchAutoFocus: false,
        },
        workshop: {
          defaultJobDurationMinutes: 75,
        },
        operations: {
          lowStockThreshold: 6,
        },
      }),
    });
    assert.equal(patchRes.status, 200, JSON.stringify(patchRes.json));
    assert.equal(patchRes.json.settings.store.name, "CorePOS Cycles");
    assert.equal(patchRes.json.settings.store.businessName, "CorePOS Cycles Ltd");
    assert.equal(patchRes.json.settings.store.email, "support@corepos.local");
    assert.equal(patchRes.json.settings.store.phone, "01234 567890");
    assert.equal(patchRes.json.settings.store.website, "https://www.corepos.local");
    assert.equal(patchRes.json.settings.store.addressLine1, "123 Service Lane");
    assert.equal(patchRes.json.settings.store.addressLine2, "Unit 4");
    assert.equal(patchRes.json.settings.store.city, "Clapham");
    assert.equal(patchRes.json.settings.store.region, "Greater London");
    assert.equal(patchRes.json.settings.store.postcode, "SW4 0HY");
    assert.equal(patchRes.json.settings.store.country, "United Kingdom");
    assert.equal(patchRes.json.settings.store.vatNumber, "GB123456789");
    assert.equal(patchRes.json.settings.store.companyNumber, "01234567");
    assert.equal(patchRes.json.settings.store.defaultCurrency, "GBP");
    assert.equal(patchRes.json.settings.store.timeZone, "Europe/London");
    assert.equal(patchRes.json.settings.store.logoUrl, "https://cdn.corepos.local/logo.png");
    assert.equal(patchRes.json.settings.store.footerText, "Thanks for riding with CorePOS.");
    assert.equal(patchRes.json.settings.store.latitude, 51.4526);
    assert.equal(patchRes.json.settings.store.longitude, -0.1477);
    assert.equal(patchRes.json.settings.pos.defaultTaxRatePercent, 17.5);
    assert.equal(patchRes.json.settings.pos.barcodeSearchAutoFocus, false);
    assert.equal(patchRes.json.settings.workshop.defaultJobDurationMinutes, 75);
    assert.equal(patchRes.json.settings.workshop.defaultDepositPence, 1000);
    assert.equal(patchRes.json.settings.operations.lowStockThreshold, 6);

    const persistedRes = await fetchJson("/api/settings", { headers: MANAGER_HEADERS });
    assert.equal(persistedRes.status, 200, JSON.stringify(persistedRes.json));
    assert.equal(persistedRes.json.settings.store.name, "CorePOS Cycles");

    const storeInfoRes = await fetchJson("/api/settings/store-info", { headers: ADMIN_HEADERS });
    assert.equal(storeInfoRes.status, 200, JSON.stringify(storeInfoRes.json));
    assert.equal(storeInfoRes.json.store.businessName, "CorePOS Cycles Ltd");
    assert.equal(storeInfoRes.json.store.footerText, "Thanks for riding with CorePOS.");

    const storeInfoPatchRes = await fetchJson("/api/settings/store-info", {
      method: "PATCH",
      headers: {
        ...ADMIN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "CorePOS Workshop & Retail",
        businessName: "CorePOS Workshop & Retail Ltd",
        email: "store-info@corepos.local",
        phone: "020 7946 0958",
        website: "https://shop.corepos.local",
        addressLine1: "200 High Street",
        addressLine2: "",
        city: "London",
        region: "Greater London",
        postcode: "SW4 0HY",
        country: "United Kingdom",
        vatNumber: "GB987654321",
        companyNumber: "76543210",
        defaultCurrency: "GBP",
        timeZone: "Europe/London",
        logoUrl: "",
        footerText: "See you in the workshop soon.",
        latitude: 51.4526,
        longitude: -0.1477,
      }),
    });
    assert.equal(storeInfoPatchRes.status, 200, JSON.stringify(storeInfoPatchRes.json));
    assert.equal(storeInfoPatchRes.json.store.name, "CorePOS Workshop & Retail");
    assert.equal(storeInfoPatchRes.json.store.email, "store-info@corepos.local");
    assert.equal(storeInfoPatchRes.json.store.footerText, "See you in the workshop soon.");

    const receiptSettings = await prisma.receiptSettings.findUnique({
      where: { id: 1 },
    });
    assert.ok(receiptSettings, "Expected receipt settings compatibility record to exist");
    assert.equal(receiptSettings.shopName, "CorePOS Workshop & Retail");
    assert.equal(receiptSettings.vatNumber, "GB987654321");
    assert.equal(receiptSettings.footerText, "See you in the workshop soon.");

    const staffRes = await fetchJson("/api/settings", { headers: STAFF_HEADERS });
    assert.equal(staffRes.status, 403, JSON.stringify(staffRes.json));
    assert.equal(staffRes.json.error.code, "INSUFFICIENT_ROLE");

    const managerStoreInfoRes = await fetchJson("/api/settings/store-info", { headers: MANAGER_HEADERS });
    assert.equal(managerStoreInfoRes.status, 403, JSON.stringify(managerStoreInfoRes.json));
    assert.equal(managerStoreInfoRes.json.error.code, "INSUFFICIENT_ROLE");

    console.log("[settings-smoke] persisted settings API passed");
  } finally {
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
