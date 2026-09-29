import { defineConfig, devices } from "@playwright/test";
import { E2E_PORT, SHOWCASE_E2E_PORT } from "./tests/e2e/ports";

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
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    trace: "on-first-retry",
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      command: "npm run start:e2e",
      url: `http://127.0.0.1:${E2E_PORT}/dashboard`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npm run dev:showcase -- --hostname 127.0.0.1 --port ${SHOWCASE_E2E_PORT}`,
      url: `http://127.0.0.1:${SHOWCASE_E2E_PORT}/`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
