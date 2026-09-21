import { defineConfig, devices } from "@playwright/test";

const localExecutable = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
const fixturePreload = "--import=./tests/e2e/factgrid-fetch-fixture.mjs";
const port = process.env.PLAYWRIGHT_PORT ?? "3000";
const baseURL = `http://localhost:${port}`;

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
    baseURL,
    ...(localExecutable ? { launchOptions: { executablePath: localExecutable } } : {}),
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npm run dev -- -p ${port}`,
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
    url: baseURL,
    // The required suite never reuses a developer server. An explicit local-only
    // override lets contributors target a server they started with the same fixtures.
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "true",
    timeout: 120_000,
  },
});
