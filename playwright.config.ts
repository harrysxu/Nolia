import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  use: {
    baseURL: "http://localhost:4273",
    trace: "on-first-retry"
  },
  webServer: {
    command: "cross-env VITE_NOLIA_AI_WATCHDOG_MS=800 npm run dev:renderer -- --port 4273 --strictPort",
    url: "http://localhost:4273",
    reuseExistingServer: false,
    timeout: 120_000
  }
});
