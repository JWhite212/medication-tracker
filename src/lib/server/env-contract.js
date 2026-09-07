/**
 * The boot contract: which environment variables must be present, and what
 * PUBLIC_BASE_URL has to look like.
 *
 * This is the ONLY statement of that contract. `env.ts` enforces it at server
 * boot against SvelteKit's `$env` modules; `scripts/vercel-build.mjs` enforces
 * the same thing at build time against `process.env`. Neither restates the
 * list — a second copy is how a variable ends up required in one place and
 * forgotten in the other, which is the exact failure this file exists to stop.
 *
 * It is `.js` and not `.ts` ON PURPOSE. `vercel-build.mjs` runs under plain
 * node during the Vercel build, before any bundler or transpiler is involved,
 * so it can only import JavaScript. `allowJs`/`checkJs` are on in
 * tsconfig.json, so this file is still type-checked by `npm run check` — the
 * JSDoc annotations below are load-bearing, not decoration.
 */

/**
 * Variables whose absence must stop the boot rather than surface later as a
 * 500 in the middle of someone's login.
 *
 * `ENCRYPTION_KEY` is here because its absence has the worst possible shape:
 * it fails AFTER the password has been accepted. It is the HMAC key for the
 * pre-auth claim that carries a user between the password step and the 2FA
 * step, and the AES key for `users.totp_secret`. Without it a 2FA-enabled
 * account cannot log in at all — but the app boots clean and every other page
 * works, so the first symptom is a user who cannot get in and a stack trace
 * nobody is watching for. That is the exact shape of the CRON_SECRET outage
 * that ran undetected for four months (see CLAUDE.md).
 *
 * `CRON_SECRET` is deliberately NOT here, despite having caused exactly that
 * outage. Without it only the reminder sweep fails; every page still works.
 * Refusing to boot the whole app over a background job would turn a degraded
 * feature into a total outage, and that failure already has its own detector
 * — the cron dead-man switch added in #128.
 *
 * @type {readonly string[]}
 */
export const REQUIRED_PRIVATE_ENV = ["DATABASE_URL", "ENCRYPTION_KEY"];

/**
 * The Vercel environments in which the app boots with `dev === false`, and so
 * the ones where the full contract applies.
 *
 * `development` is `vercel dev` on a laptop, where `dev` is true and
 * PUBLIC_BASE_URL is legitimately absent — checking there would fail a build
 * that would have run fine. The mapping is derived from when `env.ts` is
 * strict, not chosen for convenience; keep the two in step.
 *
 * @type {readonly string[]}
 */
export const STRICT_VERCEL_ENVS = ["production", "preview"];

/**
 * Required variables that are absent or empty.
 *
 * An empty string counts as missing: Vercel stores a cleared variable as `""`
 * rather than dropping the key, and an empty DATABASE_URL is no more usable
 * than an absent one.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
export function missingRequiredEnv(env) {
  return REQUIRED_PRIVATE_ENV.filter((key) => !env[key]);
}

/**
 * What is wrong with PUBLIC_BASE_URL, or null if nothing is.
 *
 * It is the canonical origin used to build links inside outbound email
 * (password reset, email verification). It MUST be set in any non-dev build —
 * otherwise links would be derived from the inbound request and an attacker
 * could poison them via Host/Origin header injection.
 *
 * @param {string | undefined} value
 * @returns {string | null}
 */
export function publicBaseUrlProblem(value) {
  if (!value) {
    return (
      "PUBLIC_BASE_URL must be set in production. It is the canonical origin " +
      "used to build links in outbound email and must not be derived from " +
      "request headers. See .env.example."
    );
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return `PUBLIC_BASE_URL is not a valid URL: ${value}`;
  }

  if (parsed.protocol !== "https:") {
    return `PUBLIC_BASE_URL must use https in production, got ${parsed.protocol}`;
  }

  return null;
}

/**
 * Every reason this environment would fail to boot, or an empty array.
 *
 * Used by the Vercel build wrapper. Vercel exposes all project environment
 * variables to the build, so the same values the server will read at runtime
 * are readable here — which turns "the deploy succeeds and every request
 * 500s" into a build that never ships.
 *
 * Returns ALL problems rather than the first, because fixing one variable,
 * redeploying, and waiting only to be told about the next one is a bad way to
 * spend an outage.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
export function buildEnvProblems(env) {
  if (!STRICT_VERCEL_ENVS.includes(env.VERCEL_ENV ?? "")) return [];

  const problems = [];

  const missing = missingRequiredEnv(env);
  if (missing.length > 0) {
    problems.push(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const baseUrl = publicBaseUrlProblem(env.PUBLIC_BASE_URL);
  if (baseUrl) problems.push(baseUrl);

  return problems;
}
