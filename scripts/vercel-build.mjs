#!/usr/bin/env node
// Vercel build wrapper.
//
// Runs `drizzle-kit push` against the live DATABASE_URL before building, so
// we never ship a binary that references columns the database doesn't have.
// Drizzle emits explicit column lists, so a single missing column 500s every
// page that touches its table — see docs/RUNBOOK.md, which records the two
// outages that taught us this.
//
// Push (rather than `drizzle-kit migrate`) is deliberate — the prod journal
// can be empty even though tables exist (legacy `db:push` history). Push
// diffs the live schema directly and is idempotent regardless of journal
// state.
//
// ON BY DEFAULT IN PRODUCTION, and that is the point. This used to be
// opt-in via MIGRATE_ON_BUILD=true, and the variable was never set in the
// Vercel production env — so no migration ever ran there, prod drifted three
// migrations behind, and the first change that READ a missing column
// (user_preferences.theme) took down login and registration. An opt-in
// safety mechanism that nobody opts into is not a safety mechanism.
//
//   - Production (VERCEL_ENV=production): on. Set MIGRATE_ON_BUILD=false to
//     opt a single deploy out.
//   - Preview / Development: off, so per-PR builds never touch the prod
//     schema. Set MIGRATE_ON_BUILD=true to opt in.
//
// Vercel picks this up automatically because it's wired to the
// `vercel-build` npm script — Vercel runs `vercel-build` when defined,
// otherwise `build`.
import { spawnSync } from "node:child_process";
import process from "node:process";
import { buildEnvProblems } from "../src/lib/server/env-contract.js";

/**
 * drizzle-kit push EXITS 0 WHEN IT FAILS. Verified against a branch of the
 * production database on 2026-09-07: with a destructive diff pending it
 * prints "Found data-loss statements", throws
 * "Interactive prompts require a TTY terminal" because stdin is detached,
 * applies NOTHING — and still exits 0.
 *
 * So `if (status !== 0)` is not a check, and the previous version of this
 * file believed it was. We assert a success marker instead: a positive
 * signal drizzle-kit prints when it finished, rather than an enumeration of
 * the ways it can fail.
 *
 * There are TWO success shapes and both must be accepted — asserting only
 * the first failed a rehearsal against an already-synced database, which is
 * the common case on a redeploy:
 *   "[✓] Changes applied"     — there was a diff, and it was applied
 *   "[i] No changes detected" — the schema was already in sync
 */
const PUSH_SUCCESS_MARKERS = ["Changes applied", "No changes detected"];

function run(cmd, args) {
  return spawnSync(cmd, args, { stdio: ["ignore", "inherit", "inherit"] }).status ?? 1;
}

/** Same, but captures output so we can inspect it — and still streams it. */
function runCaptured(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  return { status: r.status ?? 1, output: stdout + stderr };
}

// FIRST, before the schema push — a deploy that cannot boot should not get as
// far as touching the production database.
//
// `src/lib/server/env.ts` throws on exactly these conditions at server boot,
// which on Vercel means every request dies inside the serverless function and
// the platform serves FUNCTION_INVOCATION_FAILED. Nothing about that failure
// is visible from the deploy — the build goes green, the deploy is promoted,
// and the first signal is a 500 on every route including /favicon.ico. That is
// how ENCRYPTION_KEY becoming boot-required took production down on
// 2026-09-07 (docs/RUNBOOK.md); the variable was documented as required in
// docs/DEPLOYMENT.md the whole time and nothing checked.
//
// Vercel exposes project environment variables to the build, so the values the
// server will read at runtime are readable here.
const envProblems = buildEnvProblems(process.env);
if (envProblems.length > 0) {
  console.error(
    `\n[vercel-build] This deploy cannot boot in the "${process.env.VERCEL_ENV}" ` +
      `environment:\n\n` +
      envProblems.map((p) => `  - ${p}`).join("\n") +
      `\n\nSet the missing values in Vercel → Project → Settings → Environment ` +
      `Variables, for the "${process.env.VERCEL_ENV}" environment, then redeploy. ` +
      `docs/DEPLOYMENT.md has the full table.\n\n` +
      `Failing the build instead: shipping this would return 500 on every ` +
      `route, not just the feature that needs the variable.`,
  );
  process.exit(1);
}

const isProduction = process.env.VERCEL_ENV === "production";
const override = process.env.MIGRATE_ON_BUILD;
const shouldMigrate = override === "true" || (isProduction && override !== "false");

if (shouldMigrate) {
  if (!process.env.DATABASE_URL) {
    console.error("[vercel-build] Schema sync is enabled but DATABASE_URL is missing.");
    process.exit(1);
  }

  console.log("[vercel-build] Applying pending schema changes via drizzle-kit push...");
  const { output } = runCaptured("npx", ["drizzle-kit", "push"]);

  // Deliberately ignoring the exit status — see PUSH_SUCCESS_MARKERS above.
  if (!PUSH_SUCCESS_MARKERS.some((marker) => output.includes(marker))) {
    console.error(
      "\n[vercel-build] drizzle-kit push did not report success. Aborting the " +
        "build rather than deploying code that references missing columns.\n" +
        "\n" +
        "If the output above mentions data-loss statements, push is waiting for " +
        "a confirmation it can never receive: stdin is detached on CI. Apply the " +
        "destructive change by hand against the production database first, then " +
        "redeploy. docs/RUNBOOK.md has the procedure.",
    );
    process.exit(1);
  }

  console.log("[vercel-build] Schema sync complete.");
} else {
  const why = isProduction ? "MIGRATE_ON_BUILD=false" : `VERCEL_ENV=${process.env.VERCEL_ENV}`;
  console.log(`[vercel-build] Skipping schema sync (${why}).`);
}

process.exit(run("npm", ["run", "build"]));
