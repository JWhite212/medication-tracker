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
      // Regression-only thresholds. Numbers were measured at the end
      // of Phase 3 and intentionally sit a few points below current to
      // tolerate legitimate refactor noise. CI fails if any metric
      // drops below these — meaningful coverage growth bumps the floor
      // when the next phase lands.
      thresholds: {
        statements: 13,
        branches: 14,
        functions: 9,
        lines: 17,
      },
    },
  },
});
