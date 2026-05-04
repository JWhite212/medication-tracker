import { redirect, error } from "@sveltejs/kit";
import { timingSafeEqual } from "crypto";
import { dev } from "$app/environment";
import { getGoogle, getGitHub } from "$lib/server/auth/oauth";
import { lucia } from "$lib/server/auth/lucia";
import { db } from "$lib/server/db";
import { users, oauthAccounts } from "$lib/server/db/schema";
import { eq, and } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import type { RequestHandler } from "./$types";

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

interface OAuthUserInfo {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

// Sentinel thrown when the IdP says the email is not verified. Caught
// in the GET handler and translated into a user-facing redirect.
class UnverifiedOAuthEmailError extends Error {
  constructor() {
    super("oauth_email_unverified");
    this.name = "UnverifiedOAuthEmailError";
  }
}

async function getGoogleUser(code: string, codeVerifier: string): Promise<OAuthUserInfo> {
  const google = getGoogle();
  if (!google) error(503, "OAuth not configured");
  const tokens = await google.validateAuthorizationCode(code, codeVerifier);
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokens.accessToken()}` },
  });
  const data = await response.json();
  // Trusting `email` without `email_verified` is the classic Sign-in-
  // with-Google account-takeover bug. Google Workspace tenants can
  // issue tokens for unverified custom-domain emails — reject them.
  if (data.email_verified !== true) {
    throw new UnverifiedOAuthEmailError();
  }
  return {
    id: data.sub,
    email: data.email,
    name: data.name,
    avatarUrl: data.picture ?? null,
  };
}

async function getGitHubUser(code: string): Promise<OAuthUserInfo> {
  const github = getGitHub();
  if (!github) error(503, "OAuth not configured");
  const tokens = await github.validateAuthorizationCode(code);
  const response = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${tokens.accessToken()}` },
  });
  const data = await response.json();
  const emailResponse = await fetch("https://api.github.com/user/emails", {
    headers: { Authorization: `Bearer ${tokens.accessToken()}` },
  });
  const emails = (await emailResponse.json()) as Array<{
    email: string;
    primary: boolean;
    verified: boolean;
  }>;
  // Require primary AND verified. GitHub blocks setting an unverified
  // email as primary today, but defending against future regressions
  // costs nothing.
  const primary = emails.find((e) => e.primary && e.verified);
  if (!primary) throw new UnverifiedOAuthEmailError();
  return {
    id: String(data.id),
    email: primary.email,
    name: data.name ?? data.login,
    avatarUrl: data.avatar_url ?? null,
  };
}

export const GET: RequestHandler = async ({ params, url, cookies }) => {
  const provider = params.provider;
  const code = url.searchParams.get("code");

  if (!code) {
    const state = crypto.randomUUID();
    const cookieOpts = {
      path: "/",
      httpOnly: true,
      secure: !dev,
      maxAge: 600,
      sameSite: "lax" as const,
    };

    if (provider === "google") {
      const google = getGoogle();
      if (!google) error(503, "OAuth not configured");
      const codeVerifier = crypto.randomUUID();
      const scopes = ["openid", "email", "profile"];
      const authUrl = google.createAuthorizationURL(state, codeVerifier, scopes);
      cookies.set("google_code_verifier", codeVerifier, cookieOpts);
      cookies.set("oauth_state", state, cookieOpts);
      redirect(302, authUrl.toString());
    }
    if (provider === "github") {
      const github = getGitHub();
      if (!github) error(503, "OAuth not configured");
      const authUrl = github.createAuthorizationURL(state, ["user:email"]);
      cookies.set("oauth_state", state, cookieOpts);
      redirect(302, authUrl.toString());
    }
    error(400, "Unsupported provider");
  }

  // Verify OAuth state to prevent CSRF
  const storedState = cookies.get("oauth_state");
  const returnedState = url.searchParams.get("state");
  if (!storedState || !returnedState || !safeEqual(storedState, returnedState)) {
    error(400, "Invalid OAuth state");
  }
  cookies.delete("oauth_state", { path: "/" });

  let oauthUser: OAuthUserInfo;
  try {
    if (provider === "google") {
      const codeVerifier = cookies.get("google_code_verifier");
      if (!codeVerifier) error(400, "Missing code verifier");
      oauthUser = await getGoogleUser(code, codeVerifier);
      cookies.delete("google_code_verifier", { path: "/" });
    } else if (provider === "github") {
      oauthUser = await getGitHubUser(code);
    } else {
      error(400, "Unsupported provider");
    }
  } catch (err) {
    if (err instanceof UnverifiedOAuthEmailError) {
      redirect(302, "/auth/login?error=oauth_email_unverified");
    }
    throw err;
  }

  const [existingOAuth] = await db
    .select()
    .from(oauthAccounts)
    .where(
      and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.providerUserId, oauthUser.id)),
    )
    .limit(1);

  if (existingOAuth) {
    const session = await lucia.createSession(existingOAuth.userId, {});
    const sessionCookie = lucia.createSessionCookie(session.id);
    cookies.set(sessionCookie.name, sessionCookie.value, {
      path: ".",
      ...sessionCookie.attributes,
    });
    redirect(302, "/dashboard");
  }

  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, oauthUser.email))
    .limit(1);

  if (existingUser) {
    // Refuse to auto-link an unfamiliar OAuth identity to a pre-existing
    // account just because the email matches. Even with email_verified
    // checks at the IdP, multiple verified-by-different-providers paths
    // can collide on the same address (Booking.com / Trello-class
    // takeover patterns). The user must log in via the original method
    // and explicitly link the new provider from settings.
    redirect(
      302,
      "/auth/login?error=oauth_email_conflict&email=" + encodeURIComponent(oauthUser.email),
    );
  }

  const userId = createId();
  await db.insert(users).values({
    id: userId,
    email: oauthUser.email,
    name: oauthUser.name,
    avatarUrl: oauthUser.avatarUrl,
    emailVerified: true,
  });

  await db.insert(oauthAccounts).values({ provider, providerUserId: oauthUser.id, userId });

  const session = await lucia.createSession(userId, {});
  const sessionCookie = lucia.createSessionCookie(session.id);
  cookies.set(sessionCookie.name, sessionCookie.value, {
    path: ".",
    ...sessionCookie.attributes,
  });
  redirect(302, "/dashboard");
};
