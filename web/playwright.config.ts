import { defineConfig, devices } from "playwright/test";

const chromePath = process.env.PLAYWRIGHT_CHROME_PATH;

export default defineConfig({
  testDir: "./tests",
  // Each workbench page owns a WebGL scene. Running every scene-heavy test at
  // once starves software-rendered CI browsers and makes ordinary button clicks
  // time out; files may still run in parallel, but tests within a file are kept
  // in order.
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "line",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
    launchOptions: chromePath ? { executablePath: chromePath } : undefined,
  },
  webServer: {
    command: "npm run dev:web -- --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
