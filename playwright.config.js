const { defineConfig } = require("@playwright/test");
const { applyTestEnvDefaults } = require("./scripts/test_env_defaults");

const baseUrl = applyTestEnvDefaults(process.env).TEST_BASE_URL;
const backendWebServer = {
  command: "node scripts/start_test_server.js",
  url: `${baseUrl}/health`,
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
};
const frontendWebServer = {
  command: `VITE_API_PROXY_TARGET=${baseUrl} npm --prefix frontend run dev -- --host localhost --port 4173`,
  url: "http://localhost:4173/login",
  reuseExistingServer: false,
  timeout: 120_000,
};

module.exports = defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
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
  },
  projects: [
    {
      name: "parallel-core",
      testIgnore: [
        "**/admin/admin.spec.js",
        "**/critical/critical-smoke.spec.js",
        "**/pos/pos-checkout.spec.js",
      ],
    },
    {
      name: "register-serial",
      testMatch: [
        "**/admin/admin.spec.js",
        "**/critical/critical-smoke.spec.js",
        "**/pos/pos-checkout.spec.js",
      ],
      fullyParallel: false,
      workers: 1,
      dependencies: ["parallel-core"],
    },
  ],
  webServer: [backendWebServer, frontendWebServer],
});
