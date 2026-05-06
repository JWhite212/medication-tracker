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
      // Regression-only thresholds. Bumped after the P1-P9 work
      // landed — actuals are now ~30/36/25/37 across the four
      // metrics, so the floor sits at the brief's target of
      // 30/25/25/30. CI fails if any metric drops below these;
      // meaningful coverage growth bumps the floor again when more
      // service-layer tests land.
      thresholds: {
        statements: 30,
        branches: 25,
        functions: 25,
        lines: 30,
      },
    },
  },
});
