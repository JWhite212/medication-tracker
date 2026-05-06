import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "jsdom",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      // Scope to library code that's unit-testable. Route files
      // (SvelteKit pages and server endpoints) are exercised via E2E
      // tests, not units, so including them here just inflates the
      // denominator with files we never intended to unit test.
      include: ["src/lib/**/*.{ts,svelte}"],
      exclude: [
        "src/lib/**/*.test.ts",
        "src/lib/server/db/schema.ts",
        "src/lib/server/db/index.ts",
      ],
      // Regression-only thresholds. After the auth-reauth + analytics
      // + TOTP test additions actuals sit at ~31/37/25.9/39 across
      // the four metrics in CI. Floor bumped on functions from 25 to
      // 25.5 to lock in the new service-layer coverage with a small
      // margin for CI variance. CI fails if any metric drops below
      // these.
      thresholds: {
        statements: 30,
        branches: 25,
        functions: 25.5,
        lines: 30,
      },
    },
  },
});
