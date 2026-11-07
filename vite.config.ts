import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  // Under vitest, resolve `svelte` through its "browser" export condition so a
  // jsdom suite that mount()s a component gets the client runtime rather than
  // the server one, where mount() throws and tick() flushes nothing. Svelte's
  // own testing guide recommends exactly this. Scoped to VITEST so the dev
  // server and production build resolve as they always have.
  resolve: process.env.VITEST ? { conditions: ["browser"] } : undefined,
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
      exclude: ["src/lib/server/db/schema.ts", "src/lib/server/db/index.ts"],
      // Regression floors, a few points under the measured actuals
      // (2026-11-06: 94.8 / 84.6 / 91.3 / 95.3 statements / branches /
      // functions / lines). The old 30/25/25.5/30 sat 60 points below
      // reality, so coverage could have collapsed without failing CI.
      // CI fails if any metric drops below these.
      thresholds: {
        statements: 90,
        branches: 80,
        functions: 87,
        lines: 90,
      },
    },
  },
});
