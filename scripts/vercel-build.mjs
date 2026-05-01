#!/usr/bin/env node
// Vercel build entrypoint.
//
// Runs Drizzle migrations against the live database before building, so a PR
// that ships both schema and code can deploy without a separate manual
// `npx drizzle-kit migrate` step. Migrations are applied only when:
//   - VERCEL_ENV === "production" (skip preview deploys to avoid coupling
//     preview branches to production schema), and
//   - DATABASE_URL is real (not the CI/build placeholder).
//
// Drizzle's migrator records every applied migration in
// `drizzle.__drizzle_migrations`, so re-running it on every deploy is a
// no-op once everything is up to date.

import { spawnSync } from "node:child_process";

const url = process.env.DATABASE_URL ?? "";
const env = process.env.VERCEL_ENV ?? "";
const isPlaceholder = /placeholder/i.test(url);
const isProductionDeploy = env === "production" && url && !isPlaceholder;

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  if (result.status !== 0) {
    console.error(`[vercel-build] step failed: ${command} ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
}

if (isProductionDeploy) {
  console.log("[vercel-build] applying Drizzle migrations against production database…");
  run("npx", ["drizzle-kit", "migrate"]);
  console.log("[vercel-build] migrations complete.");
} else {
  console.log(
    `[vercel-build] skipping migrations (VERCEL_ENV=${env || "unset"}, placeholder=${isPlaceholder}).`,
  );
}

console.log("[vercel-build] running vite build…");
run("npx", ["vite", "build"]);
