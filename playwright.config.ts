import { defineConfig, devices } from "@playwright/test";

const localExecutable = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
const fixturePreload = "--import=./tests/e2e/factgrid-fetch-fixture.mjs";

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: "live-factgrid.spec.ts",
  // Keep the deterministic acceptance suite gentle on shared CI runners.
  fullyParallel: !process.env.CI,
  workers: process.env.CI ? 1 : undefined,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    ...(localExecutable ? { launchOptions: { executablePath: localExecutable } } : {}),
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run dev",
    env: {
      ...process.env,
      APP_ORIGIN: "",
      FACTGRID_ALLOWED_EDITORS: "",
      FACTGRID_ALLOWED_EDIT_TARGETS: "",
      FACTGRID_EDITING_ENABLED: "false",
      FACTGRID_OAUTH_CALLBACK_URL: "",
      FACTGRID_OAUTH_CLIENT_ID: "",
      FACTGRID_OAUTH_CLIENT_SECRET: "",
      FACTGRID_SESSION_DB_PATH: "",
      NODE_OPTIONS: [process.env.NODE_OPTIONS, fixturePreload].filter(Boolean).join(" "),
      SESSION_SECRET: "",
    },
    url: "http://localhost:3000",
    // Never reuse a developer server: it would bypass the fixture preload and
    // make the required suite depend on whichever process owns port 3000.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
