#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { createSmokeServerController } = require("./smoke_server_helper");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3100";
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
const serverController = createSmokeServerController({
  label: "settings-smoke",
  baseUrl: BASE_URL,
  databaseUrl: DATABASE_URL,
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
  "store.openingHours",
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
  "workshop.maxBookingsPerDay",
  "workshop.manageTokenTtlDays",
  "workshop.requestTimingMessage",
  "notifications.workshopAutoSendEnabled",
  "notifications.workshopEmailEnabled",
  "notifications.workshopSmsEnabled",
  "notifications.workshopWhatsappEnabled",
  "operations.lowStockThreshold",
  "operations.dashboardWeatherEnabled",
];

const fetchJson = async (path, options = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, options);
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, json };
};

const run = async () => {
  try {
    await serverController.startIfNeeded();

    await prisma.appConfig.deleteMany({
      where: {
        key: {
          in: SETTINGS_KEYS,
        },
      },
    });
    await prisma.receiptSettings.deleteMany({
      where: { id: 1 },
    });
    await prisma.bookingSettings.deleteMany({
      where: { id: 1 },
    });

    const defaultRes = await fetchJson("/api/settings", { headers: MANAGER_HEADERS });
    assert.equal(defaultRes.status, 200, JSON.stringify(defaultRes.json));
    assert.equal(defaultRes.json.settings.store.name, "Bike EPOS");
    assert.equal(defaultRes.json.settings.store.businessName, "Bike EPOS");
    assert.equal(defaultRes.json.settings.store.addressLine1, "");
    assert.equal(defaultRes.json.settings.store.city, "");
    assert.equal(defaultRes.json.settings.store.postcode, "");
    assert.equal(defaultRes.json.settings.store.country, "United Kingdom");
    assert.equal(defaultRes.json.settings.store.openingHours.MONDAY.opensAt, "10:00");
    assert.equal(defaultRes.json.settings.store.openingHours.SATURDAY.closesAt, "16:30");
    assert.equal(defaultRes.json.settings.store.openingHours.SUNDAY.isClosed, true);
    assert.equal(defaultRes.json.settings.store.defaultCurrency, "GBP");
    assert.equal(defaultRes.json.settings.store.timeZone, "Europe/London");
    assert.equal(defaultRes.json.settings.store.footerText, "Thank you for your custom.");
    assert.equal(defaultRes.json.settings.store.latitude, null);
    assert.equal(defaultRes.json.settings.store.longitude, null);
    assert.equal(defaultRes.json.settings.pos.defaultTaxRatePercent, 20);
    assert.equal(defaultRes.json.settings.workshop.defaultJobDurationMinutes, 60);
    assert.equal(defaultRes.json.settings.workshop.defaultDepositPence, 1000);
    assert.equal(defaultRes.json.settings.workshop.maxBookingsPerDay, 8);
    assert.equal(defaultRes.json.settings.workshop.manageTokenTtlDays, 30);
    assert.equal(
      defaultRes.json.settings.workshop.requestTimingMessage,
      "Choose a preferred workshop date and drop-off preference. The shop will confirm the final timing if a precise slot is needed.",
    );
    assert.equal(defaultRes.json.settings.notifications.workshopAutoSendEnabled, true);
    assert.equal(defaultRes.json.settings.notifications.workshopEmailEnabled, true);
    assert.equal(defaultRes.json.settings.notifications.workshopSmsEnabled, true);
    assert.equal(defaultRes.json.settings.notifications.workshopWhatsappEnabled, true);
    assert.equal(defaultRes.json.settings.operations.lowStockThreshold, 3);
    assert.equal(defaultRes.json.settings.operations.dashboardWeatherEnabled, true);

    const publicConfigRes = await fetchJson("/api/config", { headers: STAFF_HEADERS });
    assert.equal(publicConfigRes.status, 200, JSON.stringify(publicConfigRes.json));
    assert.equal(publicConfigRes.json.config.store.name, "Bike EPOS");
    assert.equal(publicConfigRes.json.config.store.defaultCurrency, "GBP");
    assert.equal(publicConfigRes.json.config.workshop.defaultDepositPence, 1000);
    assert.equal(publicConfigRes.json.config.workshop.maxBookingsPerDay, 8);
    assert.equal(publicConfigRes.json.config.operations.dashboardWeatherEnabled, true);
    assert.equal("vatNumber" in publicConfigRes.json.config.store, false);
    assert.equal("companyNumber" in publicConfigRes.json.config.store, false);
    assert.equal("latitude" in publicConfigRes.json.config.store, false);
    assert.equal("longitude" in publicConfigRes.json.config.store, false);
    assert.equal("manageTokenTtlDays" in publicConfigRes.json.config.workshop, false);
    assert.equal("notifications" in publicConfigRes.json.config, false);

    await prisma.receiptSettings.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        shopName: "Legacy Workshop Name",
        shopAddress: "99 Legacy Lane",
        vatNumber: "GBLEGACY123",
        footerText: "Legacy footer",
      },
      update: {
        shopName: "Legacy Workshop Name",
        shopAddress: "99 Legacy Lane",
        vatNumber: "GBLEGACY123",
        footerText: "Legacy footer",
      },
    });
    await prisma.bookingSettings.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        minBookableDate: new Date("2026-01-01T00:00:00.000Z"),
        maxBookingsPerDay: 11,
        defaultDepositPence: 1750,
      },
      update: {
        maxBookingsPerDay: 11,
        defaultDepositPence: 1750,
      },
    });

    const legacyFallbackRes = await fetchJson("/api/settings", { headers: MANAGER_HEADERS });
    assert.equal(legacyFallbackRes.status, 200, JSON.stringify(legacyFallbackRes.json));
    assert.equal(legacyFallbackRes.json.settings.store.name, "Legacy Workshop Name");
    assert.equal(legacyFallbackRes.json.settings.store.businessName, "Legacy Workshop Name");
    assert.equal(legacyFallbackRes.json.settings.store.vatNumber, "GBLEGACY123");
    assert.equal(legacyFallbackRes.json.settings.store.footerText, "Legacy footer");
    assert.equal(legacyFallbackRes.json.settings.workshop.defaultDepositPence, 1750);
    assert.equal(legacyFallbackRes.json.settings.workshop.maxBookingsPerDay, 11);

    const legacyPublicConfigRes = await fetchJson("/api/config", { headers: STAFF_HEADERS });
    assert.equal(legacyPublicConfigRes.status, 200, JSON.stringify(legacyPublicConfigRes.json));
    assert.equal(legacyPublicConfigRes.json.config.store.name, "Legacy Workshop Name");
    assert.equal(legacyPublicConfigRes.json.config.workshop.defaultDepositPence, 1750);
    assert.equal(legacyPublicConfigRes.json.config.workshop.maxBookingsPerDay, 11);

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
          openingHours: {
            MONDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
            TUESDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
            WEDNESDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
            THURSDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
            FRIDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
            SATURDAY: { isClosed: false, opensAt: "09:00", closesAt: "16:30" },
            SUNDAY: { isClosed: true, opensAt: "", closesAt: "" },
          },
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
          defaultDepositPence: 1500,
          maxBookingsPerDay: 9,
          manageTokenTtlDays: 45,
          requestTimingMessage: "Pick a preferred workshop date and we will confirm the final slot after review.",
        },
        notifications: {
          workshopAutoSendEnabled: false,
          workshopEmailEnabled: true,
          workshopSmsEnabled: false,
          workshopWhatsappEnabled: true,
        },
        operations: {
          lowStockThreshold: 6,
          dashboardWeatherEnabled: false,
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
    assert.equal(patchRes.json.settings.store.openingHours.MONDAY.opensAt, "10:00");
    assert.equal(patchRes.json.settings.store.openingHours.SATURDAY.opensAt, "09:00");
    assert.equal(patchRes.json.settings.store.openingHours.SUNDAY.isClosed, true);
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
    assert.equal(patchRes.json.settings.workshop.defaultDepositPence, 1500);
    assert.equal(patchRes.json.settings.workshop.maxBookingsPerDay, 9);
    assert.equal(patchRes.json.settings.workshop.manageTokenTtlDays, 45);
    assert.equal(
      patchRes.json.settings.workshop.requestTimingMessage,
      "Pick a preferred workshop date and we will confirm the final slot after review.",
    );
    assert.equal(patchRes.json.settings.notifications.workshopAutoSendEnabled, false);
    assert.equal(patchRes.json.settings.notifications.workshopEmailEnabled, true);
    assert.equal(patchRes.json.settings.notifications.workshopSmsEnabled, false);
    assert.equal(patchRes.json.settings.notifications.workshopWhatsappEnabled, true);
    assert.equal(patchRes.json.settings.operations.lowStockThreshold, 6);
    assert.equal(patchRes.json.settings.operations.dashboardWeatherEnabled, false);

    const bookingSettings = await prisma.bookingSettings.findUnique({
      where: { id: 1 },
    });
    assert.ok(bookingSettings, "Expected workshop booking settings compatibility record to exist");
    assert.equal(bookingSettings.defaultDepositPence, 1500);
    assert.equal(bookingSettings.maxBookingsPerDay, 9);

    const persistedRes = await fetchJson("/api/settings", { headers: MANAGER_HEADERS });
    assert.equal(persistedRes.status, 200, JSON.stringify(persistedRes.json));
    assert.equal(persistedRes.json.settings.store.name, "CorePOS Cycles");
    assert.equal(persistedRes.json.settings.notifications.workshopAutoSendEnabled, false);

    const persistedPublicConfigRes = await fetchJson("/api/config", { headers: STAFF_HEADERS });
    assert.equal(persistedPublicConfigRes.status, 200, JSON.stringify(persistedPublicConfigRes.json));
    assert.equal(persistedPublicConfigRes.json.config.store.name, "CorePOS Cycles");
    assert.equal(persistedPublicConfigRes.json.config.workshop.defaultDepositPence, 1500);
    assert.equal(persistedPublicConfigRes.json.config.workshop.maxBookingsPerDay, 9);
    assert.equal(
      persistedPublicConfigRes.json.config.workshop.requestTimingMessage,
      "Pick a preferred workshop date and we will confirm the final slot after review.",
    );
    assert.equal(persistedPublicConfigRes.json.config.operations.dashboardWeatherEnabled, false);

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
        openingHours: {
          MONDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
          TUESDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
          WEDNESDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
          THURSDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
          FRIDAY: { isClosed: false, opensAt: "10:00", closesAt: "18:30" },
          SATURDAY: { isClosed: false, opensAt: "09:00", closesAt: "16:30" },
          SUNDAY: { isClosed: true, opensAt: "", closesAt: "" },
        },
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
    assert.equal(storeInfoPatchRes.json.store.openingHours.MONDAY.opensAt, "10:00");
    assert.equal(storeInfoPatchRes.json.store.openingHours.SUNDAY.isClosed, true);

    const receiptSettings = await prisma.receiptSettings.findUnique({
      where: { id: 1 },
    });
    assert.ok(receiptSettings, "Expected receipt settings compatibility record to exist");
    assert.equal(receiptSettings.shopName, "CorePOS Workshop & Retail");
    assert.equal(receiptSettings.vatNumber, "GB987654321");
    assert.equal(receiptSettings.footerText, "See you in the workshop soon.");

    const publicStoreInfoRes = await fetchJson("/api/config", { headers: STAFF_HEADERS });
    assert.equal(publicStoreInfoRes.status, 200, JSON.stringify(publicStoreInfoRes.json));
    assert.equal(publicStoreInfoRes.json.config.store.name, "CorePOS Workshop & Retail");
    assert.equal(publicStoreInfoRes.json.config.store.footerText, "See you in the workshop soon.");
    assert.equal(publicStoreInfoRes.json.config.workshop.defaultDepositPence, 1500);
    assert.equal("vatNumber" in publicStoreInfoRes.json.config.store, false);

    const staffRes = await fetchJson("/api/settings", { headers: STAFF_HEADERS });
    assert.equal(staffRes.status, 403, JSON.stringify(staffRes.json));
    assert.equal(staffRes.json.error.code, "INSUFFICIENT_ROLE");

    const managerStoreInfoRes = await fetchJson("/api/settings/store-info", { headers: MANAGER_HEADERS });
    assert.equal(managerStoreInfoRes.status, 403, JSON.stringify(managerStoreInfoRes.json));
    assert.equal(managerStoreInfoRes.json.error.code, "INSUFFICIENT_ROLE");

    const versionRes = await fetchJson("/api/system/version");
    assert.equal(versionRes.status, 200, JSON.stringify(versionRes.json));
    assert.match(versionRes.json.app.version, /^\d+\.\d+\.\d+$/);
    assert.equal(versionRes.json.app.label, `v${versionRes.json.app.version}`);

    console.log("[settings-smoke] persisted settings API passed");
  } finally {
    await prisma.appConfig.deleteMany({
      where: {
        key: {
          in: SETTINGS_KEYS,
        },
      },
    });
    await prisma.receiptSettings.deleteMany({
      where: { id: 1 },
    });
    await prisma.bookingSettings.deleteMany({
      where: { id: 1 },
    });
    await prisma.$disconnect();
    await serverController.stop();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
