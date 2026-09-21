import { defineConfig, devices } from "@playwright/test";

const localExecutable = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "live-factgrid.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    ...(localExecutable ? { launchOptions: { executablePath: localExecutable } } : {}),
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    // Never reuse the fixture-backed acceptance server from another run.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
