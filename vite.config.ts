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
      include: ["src/**/*.{ts,svelte}"],
      exclude: [
        "src/**/*.test.ts",
        "src/service-worker.ts",
        "src/app.html",
        "src/app.d.ts",
        "src/lib/server/db/schema.ts",
        "src/routes/**/+layout.ts",
        "src/routes/**/+layout.svelte",
        "src/routes/**/+error.svelte",
      ],
      // Thresholds intentionally absent — Phase 2 collects a baseline.
      // Phase 3 adds regression-only thresholds once the test suite
      // expands to cover doses, analytics, and auth flows.
    },
  },
});
