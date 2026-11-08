import { defineConfig, devices } from "@playwright/test";

const origin = "http://127.0.0.1:4185";
const chromiumPath = process.env.MANZAI_CHROMIUM;
const chromiumLaunch = chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {};
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.mjs",
  timeout: 25_000,
  expect: { timeout: 7000 },
  workers: 2,
  reporter: "list",
  use: { baseURL: origin, trace: "retain-on-failure" },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"], ...chromiumLaunch, viewport: { width: 1280, height: 900 } } },
    { name: "chromium-touch", use: { ...devices["iPhone 14"], ...chromiumLaunch, browserName: "chromium" } },
    { name: "webkit-iphone", use: { ...devices["iPhone 14"], browserName: "webkit" } },
  ],
  webServer: {
    command: "npm run build && npm exec vite -- preview --host 127.0.0.1 --port 4185 --strictPort",
    env: { MANZAI_E2E: "1" },
    url: origin,
    timeout: 45_000,
  },
});
