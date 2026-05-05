import { defineConfig } from "@playwright/test";
import { SEEDED_STORAGE_STATE } from "./tests/e2e/global-setup";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  // CI gets a single retry to absorb the occasional Neon cold start;
  // local runs should fail fast.
  retries: process.env.CI ? 1 : 0,
  reporter: [["html", { open: "never" }], ["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: "http://localhost:5173",
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "anon",
      // Tests that drive auth flows themselves (login, register).
      testMatch: /(auth|smoke|accessibility)\.test\.ts$/,
    },
    {
      name: "authed",
      // Tests that operate against the seeded user's session.
      testMatch: /(medication-lifecycle|dose-logging|analytics|exports)\.test\.ts$/,
      use: { storageState: SEEDED_STORAGE_STATE },
    },
  ],
  webServer: {
    command: "npm run dev",
    port: 5173,
    reuseExistingServer: !process.env.CI,
    // Vite dev startup can be slow on cold caches.
    timeout: 120_000,
  },
});
