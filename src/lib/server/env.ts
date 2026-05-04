import { env as privateEnv } from "$env/dynamic/private";
// PUBLIC_BASE_URL starts with the "PUBLIC_" prefix that SvelteKit
// reserves for client-exposable env vars. Per SvelteKit's own docs,
// `$env/dynamic/private` *excludes* every variable matching that
// prefix, so reading PUBLIC_BASE_URL from there always returns
// undefined — even when Vercel has the value set. Read public vars
// from the public module instead.
import { env as publicEnv } from "$env/dynamic/public";
import { dev } from "$app/environment";

const required = ["DATABASE_URL"] as const;

const missing = required.filter((key) => !privateEnv[key]);
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
if (!dev) {
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
