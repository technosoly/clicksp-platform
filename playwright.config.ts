import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "off",
    // Optional: use a preinstalled Chromium instead of Playwright's download.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // Low-end Android profile: small viewport, touch.
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
  // Runs the production build. Build first with `pnpm build`.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // APP_URL: gateway callbacks come back to this server; "fake" is the test-only gateway.
        command: `PORT=${port} HOSTNAME=127.0.0.1 APP_URL=${baseURL} PAYMENT_PROVIDERS=fake pnpm start`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
