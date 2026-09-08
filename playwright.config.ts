import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // The suite intentionally shares one fictional SQLite database and Next dev
  // server. Serial workers keep compilation and mutation ordering deterministic.
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "npm run start:e2e",
    url: "http://127.0.0.1:3100/dashboard",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
