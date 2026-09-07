import { env as privateEnv } from "$env/dynamic/private";
// PUBLIC_BASE_URL starts with the "PUBLIC_" prefix that SvelteKit
// reserves for client-exposable env vars. Per SvelteKit's own docs,
// `$env/dynamic/private` *excludes* every variable matching that
// prefix, so reading PUBLIC_BASE_URL from there always returns
// undefined — even when Vercel has the value set. Read public vars
// from the public module instead.
import { env as publicEnv } from "$env/dynamic/public";
import { dev, building } from "$app/environment";

/**
 * Variables whose absence must stop the boot rather than surface later as a
 * 500 in the middle of someone's login.
 *
 * `ENCRYPTION_KEY` is here because its absence has the worst possible shape:
 * it fails AFTER the password has been accepted. It is the HMAC key for the
 * pre-auth claim that carries a user between the password step and the 2FA
 * step, and the AES key for `users.totp_secret`. Without it a 2FA-enabled
 * account cannot log in at all — but the app boots clean and every other
 * page works, so the first symptom is a user who cannot get in and a stack
 * trace nobody is watching for. That is the exact shape of the CRON_SECRET
 * outage that ran undetected for four months (see CLAUDE.md).
 *
 * `CRON_SECRET` is deliberately NOT here, despite having caused exactly that
 * outage. Without it only the reminder sweep fails; every page still works.
 * Refusing to boot the whole app over a background job would turn a degraded
 * feature into a total outage, and that failure already has its own detector
 * — the cron dead-man switch added in #128.
 */
const required = ["DATABASE_URL", "ENCRYPTION_KEY"] as const;

// `building` is true while SvelteKit prerenders pages at build time —
// the app boots there with no runtime secrets available (CI and local
// builds have none), so validation must wait for a real server boot.
const missing = building ? [] : required.filter((key) => !privateEnv[key]);
if (missing.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missing.join(", ")}. ` +
      `Check .env.example for the full list.`,
  );
}

// PUBLIC_BASE_URL is the canonical origin used to build links inside
// outbound emails (password reset, email verification). It MUST be set
// in any non-dev build — otherwise links would be derived from the
// inbound request and an attacker could poison them via Host/Origin
// header injection.
if (!dev && !building) {
  const baseUrl = publicEnv.PUBLIC_BASE_URL;
  if (!baseUrl) {
    throw new Error(
      "PUBLIC_BASE_URL must be set in production. It is the canonical origin " +
        "used to build links in outbound email and must not be derived from " +
        "request headers. See .env.example.",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`PUBLIC_BASE_URL is not a valid URL: ${baseUrl}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`PUBLIC_BASE_URL must use https in production, got ${parsed.protocol}`);
  }
}
