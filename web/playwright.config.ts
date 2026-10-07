import { defineConfig, devices } from "playwright/test";

const chromePath = process.env.PLAYWRIGHT_CHROME_PATH;
const port = process.env.PLAYWRIGHT_PORT ?? "5173";
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests",
  // Each workbench page owns a WebGL scene. Running every scene-heavy test at
  // once starves software-rendered CI browsers and makes ordinary button clicks
  // time out; files may still run in parallel, but tests within a file are kept
  // in order.
  fullyParallel: false,
  // Hub challenges add another WebGL-heavy route. Keep one browser worker so
  // software-rendered CI does not starve ordinary React interactions.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "line",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "on-first-retry",
    launchOptions: chromePath ? { executablePath: chromePath } : undefined,
  },
  webServer: {
    command: `npm run dev:web -- --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
