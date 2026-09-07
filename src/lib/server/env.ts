import { env as privateEnv } from "$env/dynamic/private";
// PUBLIC_BASE_URL starts with the "PUBLIC_" prefix that SvelteKit
// reserves for client-exposable env vars. Per SvelteKit's own docs,
// `$env/dynamic/private` *excludes* every variable matching that
// prefix, so reading PUBLIC_BASE_URL from there always returns
// undefined — even when Vercel has the value set. Read public vars
// from the public module instead.
import { env as publicEnv } from "$env/dynamic/public";
import { dev, building } from "$app/environment";
import { missingRequiredEnv, publicBaseUrlProblem } from "./env-contract.js";

// The contract itself — which variables, and why each one — lives in
// env-contract.js, because `scripts/vercel-build.mjs` enforces the same rules
// at build time and cannot import TypeScript. This module is only the boot-time
// half: it decides WHEN the rules apply and turns a violation into a throw.

// `building` is true while SvelteKit prerenders pages at build time —
// the app boots there with no runtime secrets available (CI and local
// builds have none), so validation must wait for a real server boot.
const missing = building ? [] : missingRequiredEnv(privateEnv);
if (missing.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missing.join(", ")}. ` +
      `Check .env.example for the full list.`,
  );
}

if (!dev && !building) {
  const problem = publicBaseUrlProblem(publicEnv.PUBLIC_BASE_URL);
  if (problem) throw new Error(problem);
}
