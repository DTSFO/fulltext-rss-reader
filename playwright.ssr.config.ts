import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.SSR_E2E_PORT ?? "3200");
const baseURL = process.env.SSR_E2E_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests/e2e-ssr",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: process.env.CI ? 1 : 0,
  reporter: "line",
  timeout: 90_000,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `HOSTNAME=127.0.0.1 PORT=${port} node .next/standalone/server.js`,
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 1_000 },
    timeout: 120_000,
  },
  projects: [
    { name: "authenticated-ssr-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "authenticated-ssr-mobile", use: { ...devices["Pixel 5"] } },
  ],
});
