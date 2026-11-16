import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  // The map, its worker and the fake services share the machine with the other tests.
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:4317/ways/",
    trace: "retain-on-failure",
    locale: "en-GB",
    timezoneId: "Europe/Paris",
  },
  webServer: {
    command: "bun scripts/serve.ts",
    url: "http://localhost:4317/ways/",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      // A phone: touch, a narrow screen, the bottom sheet instead of the side panel.
      name: "phone",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
