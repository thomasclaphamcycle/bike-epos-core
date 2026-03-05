const { defineConfig } = require("@playwright/test");

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3000";

const buildStaffHeaders = () => {
  const headers = {
    "X-Staff-Role": process.env.E2E_STAFF_ROLE || "STAFF",
    "X-Staff-Id": process.env.E2E_STAFF_ID || "e2e-staff",
  };

  if (process.env.INTERNAL_AUTH_SHARED_SECRET) {
    headers["X-Internal-Auth"] = process.env.INTERNAL_AUTH_SHARED_SECRET;
  }

  return headers;
};

module.exports = defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: baseUrl,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    extraHTTPHeaders: buildStaffHeaders(),
  },
  webServer: {
    command: "node scripts/run_with_test_env.js npx ts-node --transpile-only src/server.ts",
    url: `${baseUrl}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
