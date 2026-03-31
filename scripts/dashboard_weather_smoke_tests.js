#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { createSmokeServerController } = require("./smoke_server_helper");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3100";
const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const STAFF_HEADERS = {
  "X-Staff-Role": "STAFF",
  "X-Staff-Id": "weather-smoke-staff",
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

const WEATHER_KEYS = [
  "store.city",
  "store.postcode",
  "store.latitude",
  "store.longitude",
];

const assertDailyWeatherSnapshot = (snapshot, label) => {
  assert.ok(snapshot, `${label} weather snapshot should exist`);
  assert.equal(typeof snapshot.summary, "string");
  assert.ok(snapshot.summary.trim().length > 0);
  assert.equal(typeof snapshot.highC, "number");
  assert.ok(Number.isFinite(snapshot.highC));
  assert.equal(typeof snapshot.lowC, "number");
  assert.ok(Number.isFinite(snapshot.lowC));
  assert.equal(typeof snapshot.precipitationMm, "number");
  assert.ok(Number.isFinite(snapshot.precipitationMm));
};

const assertTradingTimelinePoint = (point, label) => {
  assert.ok(point, `${label} trading timeline point should exist`);
  assert.equal(typeof point.time, "string");
  assert.ok(point.time.length > 0);
  assert.equal(typeof point.label, "string");
  assert.ok(point.label.length > 0);
  assert.equal(typeof point.summary, "string");
  assert.ok(point.summary.length > 0);
  assert.ok(["sun", "part-sun", "cloud", "rain", "showers"].includes(point.kind));
  assert.equal(typeof point.temperatureC, "number");
  assert.equal(typeof point.precipitationMm, "number");
  assert.equal(typeof point.precipitationProbabilityPercent, "number");
};

const fetchJson = async (path, options = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, options);
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, json };
};

const startLocationLookupStubServer = () =>
  new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");

      if (url.pathname.startsWith("/postcodes/")) {
        const encodedPostcode = url.pathname.replace(/^\/postcodes\//, "");
        const postcode = decodeURIComponent(encodedPostcode).replace(/\s+/g, " ").trim().toUpperCase();
        if (postcode === "SW11 1JD") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            status: 200,
            result: {
              postcode: "SW11 1JD",
              latitude: 51.464095,
              longitude: -0.163837,
              admin_district: "Wandsworth",
              region: "London",
              country: "England",
            },
          }));
          return;
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: 404,
          error: "Invalid postcode",
        }));
        return;
      }

      if (url.pathname !== "/geocode") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
        return;
      }

      const query = (url.searchParams.get("name") || "").trim().toUpperCase();
      const body = query === "SW11 1JD"
        ? {
            results: [
              {
                latitude: 51.4643,
                longitude: -0.1703,
                name: "Battersea",
                admin1: "England",
                country: "United Kingdom",
              },
            ],
          }
        : { results: [] };

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    });

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not determine stub geocode server address."));
        return;
      }

      resolve({
        server,
        url: `http://127.0.0.1:${address.port}/geocode`,
      });
    });
  });

const run = async () => {
  let locationLookupStubServer = null;
  let serverController = null;

  try {
    const locationLookupStub = await startLocationLookupStubServer();
    locationLookupStubServer = locationLookupStub.server;
    serverController = createSmokeServerController({
      label: "dashboard-weather-smoke",
      baseUrl: BASE_URL,
      databaseUrl: DATABASE_URL,
      startup: {
        command: "node",
        args: ["scripts/start_test_server.js"],
      },
      envOverrides: {
        PORT: new URL(BASE_URL).port || "3100",
        COREPOS_WEATHER_STUB: "1",
        POSTCODES_IO_BASE_URL: `${locationLookupStub.url.replace(/\/geocode$/, "")}/postcodes`,
        OPEN_METEO_GEOCODE_URL: locationLookupStub.url,
      },
    });
    await serverController.startIfNeeded();

    await prisma.appConfig.deleteMany({
      where: {
        key: {
          in: WEATHER_KEYS,
        },
      },
    });

    const missingRes = await fetchJson("/api/dashboard/weather", { headers: STAFF_HEADERS });
    assert.equal(missingRes.status, 200, JSON.stringify(missingRes.json));
    assert.equal(missingRes.json.weather.status, "missing_location");
    assert.equal(missingRes.json.weather.message, "Weather unavailable. Set the store postcode in Settings.");

    await prisma.appConfig.upsert({
      where: { key: "store.postcode" },
      create: { key: "store.postcode", value: " sw11   1jd " },
      update: { value: " sw11   1jd " },
    });

    const readyRes = await fetchJson("/api/dashboard/weather", { headers: STAFF_HEADERS });
    assert.equal(readyRes.status, 200, JSON.stringify(readyRes.json));
    assert.equal(readyRes.json.weather.status, "ready");
    assert.equal(typeof readyRes.json.weather.locationLabel, "string");
    assert.ok(readyRes.json.weather.locationLabel.trim().length > 0);
    assert.match(readyRes.json.weather.locationLabel, /SW11 1JD/i);
    assertDailyWeatherSnapshot(readyRes.json.weather.today, "today");
    assertDailyWeatherSnapshot(readyRes.json.weather.tomorrow, "tomorrow");
    assert.ok(Array.isArray(readyRes.json.weather.tradingDayTimeline));
    assert.ok(readyRes.json.weather.tradingDayTimeline.length >= 2);
    readyRes.json.weather.tradingDayTimeline.forEach((point, index) => {
      assertTradingTimelinePoint(point, `trading timeline ${index}`);
    });

    await prisma.appConfig.upsert({
      where: { key: "store.postcode" },
      create: { key: "store.postcode", value: "INVALID POSTCODE" },
      update: { value: "INVALID POSTCODE" },
    });

    const unresolvedRes = await fetchJson("/api/dashboard/weather", { headers: STAFF_HEADERS });
    assert.equal(unresolvedRes.status, 200, JSON.stringify(unresolvedRes.json));
    assert.equal(unresolvedRes.json.weather.status, "unavailable");
    assert.equal(
      unresolvedRes.json.weather.message,
      "Weather location could not be resolved from the store postcode. Check Store Info.",
    );

    console.log("[dashboard-weather-smoke] dashboard weather endpoint passed");
  } finally {
    await prisma.$disconnect();
    if (serverController) {
      await serverController.stop();
    }

    if (locationLookupStubServer) {
      await new Promise((resolve) => locationLookupStubServer.close(resolve));
    }
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
