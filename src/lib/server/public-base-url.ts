// SvelteKit's $env/dynamic/private excludes any variable that starts with
// the PUBLIC_ prefix, so PUBLIC_BASE_URL must come from the public module.
// The value is genuinely public anyway (the site's own URL).
import { env as publicEnv } from "$env/dynamic/public";
import { dev } from "$app/environment";

/**
 * The site's canonical origin, for every absolute URL the server hands to a
 * third party: email links and the OAuth redirect URI.
 *
 * Always PUBLIC_BASE_URL, never the inbound request. Host and Origin headers
 * are attacker-controlled; an email link built from them is a token-leak
 * account takeover, and an OAuth redirect URI built from them would send the
 * authorization code wherever the attacker chose.
 *
 * env.ts already enforces PUBLIC_BASE_URL in production. In dev it falls back
 * to localhost so the dev server works without extra config. Returns null
 * when there is no safe answer; each caller decides what that means.
 */
export function publicBaseUrl(): string | null {
  const raw = (publicEnv.PUBLIC_BASE_URL ?? "") as string;
  if (raw.length > 0) return raw.replace(/\/$/, "");
  if (dev) return "http://localhost:5173";
  return null;
}
