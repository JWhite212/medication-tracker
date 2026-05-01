#!/usr/bin/env node
// One-shot HTTP migrator. Use this to apply pending Drizzle migrations
// against a live Neon database when `drizzle-kit migrate` hangs (it tries
// to use the WebSocket driver and stalls without a `ws` constructor).
//
// Usage:
//   DATABASE_URL='postgres://...neon-pooled-url...?sslmode=require' \
//     node scripts/migrate-once.mjs
//
// Idempotent — Drizzle records every applied migration in
// `drizzle.__drizzle_migrations`, so re-runs are no-ops.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

console.log("[migrate] connecting via Neon HTTP driver…");
const { neon } = await import("@neondatabase/serverless");
const { drizzle } = await import("drizzle-orm/neon-http");
const { migrate } = await import("drizzle-orm/neon-http/migrator");

const client = neon(url);
const db = drizzle(client);

console.log("[migrate] applying pending migrations from drizzle/…");
await migrate(db, { migrationsFolder: resolve(repoRoot, "drizzle") });
console.log("[migrate] done.");
