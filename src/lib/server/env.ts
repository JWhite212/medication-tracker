import { env } from "$env/dynamic/private";
import { dev } from "$app/environment";

const required = ["DATABASE_URL"] as const;

const missing = required.filter((key) => !env[key]);
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
  if (!env.PUBLIC_BASE_URL) {
    throw new Error(
      "PUBLIC_BASE_URL must be set in production. It is the canonical origin " +
        "used to build links in outbound email and must not be derived from " +
        "request headers. See .env.example.",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(env.PUBLIC_BASE_URL);
  } catch {
    throw new Error(`PUBLIC_BASE_URL is not a valid URL: ${env.PUBLIC_BASE_URL}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`PUBLIC_BASE_URL must use https in production, got ${parsed.protocol}`);
  }
}
