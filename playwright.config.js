const { defineConfig } = require("@playwright/test");

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3000";

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
  },
  webServer: [
    {
      command: "node scripts/run_with_test_env.js npx ts-node --transpile-only src/server.ts",
      url: `${baseUrl}/health`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: `VITE_API_PROXY_TARGET=${baseUrl} npm --prefix frontend run dev -- --host localhost --port 4173`,
      url: "http://localhost:4173/login",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
