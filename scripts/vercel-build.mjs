#!/usr/bin/env node
// Vercel build entrypoint.
//
// Runs Drizzle migrations against the live database before building, so a PR
// that ships both schema and code can deploy without a separate manual
// migration step. Uses the programmatic `drizzle-orm/neon-http/migrator`
// (runtime deps only) rather than spawning `drizzle-kit`, which is more
// reliable in Vercel's build environment.
//
// Migrations are applied only when:
//   - VERCEL_ENV === "production" (skip preview deploys to avoid coupling
//     preview branches to production schema), and
//   - DATABASE_URL is real (not the CI/build placeholder).
//
// Drizzle's migrator records every applied migration in
// `drizzle.__drizzle_migrations`, so re-running it on every deploy is a
// no-op once everything is up to date.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const url = process.env.DATABASE_URL ?? "";
const env = process.env.VERCEL_ENV ?? "";
const isPlaceholder = /placeholder/i.test(url);
const isProductionDeploy = env === "production" && url && !isPlaceholder;

async function applyMigrations() {
  console.log("[vercel-build] applying Drizzle migrations against production database…");
  const { neon } = await import("@neondatabase/serverless");
  const { drizzle } = await import("drizzle-orm/neon-http");
  const { migrate } = await import("drizzle-orm/neon-http/migrator");

  const client = neon(url);
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: resolve(repoRoot, "drizzle") });
  console.log("[vercel-build] migrations complete.");
}

function runViteBuild() {
  console.log("[vercel-build] running vite build…");
  const result = spawnSync("npx", ["vite", "build"], {
    stdio: "inherit",
    env: process.env,
    cwd: repoRoot,
  });
  if (result.status !== 0) {
    console.error("[vercel-build] vite build failed.");
    process.exit(result.status ?? 1);
  }
}

if (isProductionDeploy) {
  try {
    await applyMigrations();
  } catch (err) {
    console.error("[vercel-build] migration failed:", err);
    process.exit(1);
  }
} else {
  console.log(
    `[vercel-build] skipping migrations (VERCEL_ENV=${env || "unset"}, placeholder=${isPlaceholder}).`,
  );
}

runViteBuild();
