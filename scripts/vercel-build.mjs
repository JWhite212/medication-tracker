#!/usr/bin/env node
// Vercel build wrapper.
//
// When MIGRATE_ON_BUILD=true, runs `drizzle-kit push` against the live
// DATABASE_URL before building. This keeps the prod schema in lock-step
// with the deploying code so we never ship a binary that references
// columns the database doesn't have yet.
//
// Push (rather than `drizzle-kit migrate`) is deliberate — the prod
// journal can be empty even though tables exist (legacy `db:push`
// history). Push diffs the live schema directly and is idempotent
// regardless of journal state. Destructive changes (renames, drops,
// type changes that need data conversion) cause it to abort in
// non-TTY mode, which is the safety property we want for unattended
// deploys.
//
// Flag is intentionally opt-in:
//   - Production: set MIGRATE_ON_BUILD=true so deploys auto-migrate.
//   - Preview / Development: leave unset so per-PR Neon branches and
//     local builds don't touch the prod schema.
//
// Vercel will pick this up automatically because it's wired to the
// `vercel-build` npm script — Vercel runs `vercel-build` when defined,
// otherwise `build`.
//
// Stdin is detached so drizzle-kit cannot hang on an interactive
// prompt — `prompts` returns its default in non-TTY mode, which for
// safe additive changes is "apply".
import { spawnSync } from "node:child_process";
import process from "node:process";

const DETACH_STDIN = ["ignore", "inherit", "inherit"];

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: DETACH_STDIN });
  return r.status ?? 1;
}

const shouldMigrate = process.env.MIGRATE_ON_BUILD === "true";

if (shouldMigrate) {
  if (!process.env.DATABASE_URL) {
    console.error("[vercel-build] MIGRATE_ON_BUILD=true but DATABASE_URL is missing.");
    process.exit(1);
  }
  console.log("[vercel-build] Applying pending schema changes via drizzle-kit push...");
  const code = run("npx", ["drizzle-kit", "push"]);
  if (code !== 0) {
    console.error(
      "[vercel-build] drizzle-kit push failed. Aborting build to prevent " +
        "deploying code that references missing columns.",
    );
    process.exit(code);
  }
  console.log("[vercel-build] Schema sync complete.");
} else {
  console.log("[vercel-build] MIGRATE_ON_BUILD not set — skipping schema sync.");
}

process.exit(run("npm", ["run", "build"]));
