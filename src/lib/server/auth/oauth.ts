import { Google, GitHub } from "arctic";
import { env } from "$env/dynamic/private";
import { publicBaseUrl } from "$lib/server/public-base-url";
import type { WebProvider } from "$lib/utils/destructive-confirm";

/**
 * The redirect URI each provider sends the authorization code back to. It
 * must be ABSOLUTE: arctic copies it verbatim into the authorize URL and the
 * token exchange, Google refuses a URI with no scheme, and GitHub matches the
 * registered callback's host. A bare path, as this used to be, meant OAuth
 * sign-in could never complete wherever it was configured. Built from the
 * configured origin, never the request (see `publicBaseUrl`); with no safe
 * origin the provider is simply not offered. The Google and GitHub consoles
 * must register exactly `${PUBLIC_BASE_URL}/auth/callback/<provider>`.
 */
function callbackUrl(provider: "google" | "github"): string | null {
  const base = publicBaseUrl();
  return base ? `${base}/auth/callback/${provider}` : null;
}

export function getGoogle() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  const redirectUri = callbackUrl("google");
  if (!redirectUri) return null;
  return new Google(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri);
}

export function getGitHub() {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return null;
  const redirectUri = callbackUrl("github");
  if (!redirectUri) return null;
  return new GitHub(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET, redirectUri);
}

export function hasOAuthProviders() {
  return !!(env.GOOGLE_CLIENT_ID || env.GITHUB_CLIENT_ID);
}

/** The providers a browser can sign in with right now, in the order the login page lists them. */
export function configuredWebProviders(): WebProvider[] {
  const providers: WebProvider[] = [];
  if (getGoogle()) providers.push("google");
  if (getGitHub()) providers.push("github");
  return providers;
}
