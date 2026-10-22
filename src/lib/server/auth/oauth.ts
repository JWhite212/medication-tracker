import { Google, GitHub } from "arctic";
import { env } from "$env/dynamic/private";
import type { WebProvider } from "$lib/utils/destructive-confirm";

export function getGoogle() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  return new Google(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, "/auth/callback/google");
}

export function getGitHub() {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return null;
  return new GitHub(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET, "/auth/callback/github");
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
