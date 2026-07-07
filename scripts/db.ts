// Standalone Drizzle client for CLI scripts (seed-demo, seed-e2e).
//
// The app's db module ($lib/server/db) reads $env/dynamic/private — a
// SvelteKit virtual module that only exists inside the Vite build —
// so importing it from tsx crashes with ERR_MODULE_NOT_FOUND. Scripts
// build their own HTTP-driver client from process.env instead.
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../src/lib/server/db/schema";

// Loads ./.env for local runs (never overwrites variables already set
// in the shell, so `DATABASE_URL=... npm run seed:demo` still wins).
// CI passes env directly and has no .env file — hence the swallow.
export function loadDotEnv(): void {
  try {
    process.loadEnvFile();
  } catch {
    // no .env file — fine, env must come from the shell
  }
}

export function createScriptDb(connectionString: string) {
  return drizzle(neon(connectionString), { schema });
}
