import { redirect, error } from "@sveltejs/kit";
import { google, github } from "$lib/server/auth/oauth";
import { lucia } from "$lib/server/auth/lucia";
import { db } from "$lib/server/db";
import { users, oauthAccounts } from "$lib/server/db/schema";
import { eq, and } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import type { RequestHandler } from "./$types";

interface OAuthUserInfo {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

async function getGoogleUser(
  code: string,
  codeVerifier: string,
): Promise<OAuthUserInfo> {
  const tokens = await google.validateAuthorizationCode(code, codeVerifier);
  const response = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
      headers: { Authorization: `Bearer ${tokens.accessToken()}` },
    },
  );
  const data = await response.json();
  return {
    id: data.sub,
    email: data.email,
    name: data.name,
    avatarUrl: data.picture ?? null,
  };
}

async function getGitHubUser(code: string): Promise<OAuthUserInfo> {
  const tokens = await github.validateAuthorizationCode(code);
  const response = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${tokens.accessToken()}` },
  });
  const data = await response.json();
  const emailResponse = await fetch("https://api.github.com/user/emails", {
    headers: { Authorization: `Bearer ${tokens.accessToken()}` },
  });
  const emails = await emailResponse.json();
  const primaryEmail =
    emails.find((e: { primary: boolean }) => e.primary)?.email ?? data.email;
  return {
    id: String(data.id),
    email: primaryEmail,
    name: data.name ?? data.login,
    avatarUrl: data.avatar_url ?? null,
  };
}

export const GET: RequestHandler = async ({ params, url, cookies }) => {
  const provider = params.provider;
  const code = url.searchParams.get("code");

  if (!code) {
    if (provider === "google") {
      const codeVerifier = crypto.randomUUID();
      const scopes = ["openid", "email", "profile"];
      const authUrl = google.createAuthorizationURL(
        crypto.randomUUID(),
        codeVerifier,
        scopes,
      );
      cookies.set("google_code_verifier", codeVerifier, {
        path: "/",
        httpOnly: true,
        secure: true,
        maxAge: 600,
        sameSite: "lax",
      });
      redirect(302, authUrl.toString());
    }
    if (provider === "github") {
      const authUrl = github.createAuthorizationURL(crypto.randomUUID(), [
        "user:email",
      ]);
      redirect(302, authUrl.toString());
    }
    error(400, "Unsupported provider");
  }

  let oauthUser: OAuthUserInfo;
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

  const [existingOAuth] = await db
    .select()
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.provider, provider),
        eq(oauthAccounts.providerUserId, oauthUser.id),
      ),
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
    .select()
    .from(users)
    .where(eq(users.email, oauthUser.email))
    .limit(1);
  let userId: string;

  if (existingUser) {
    userId = existingUser.id;
    await db
      .update(users)
      .set({ avatarUrl: oauthUser.avatarUrl, emailVerified: true })
      .where(eq(users.id, userId));
  } else {
    userId = createId();
    await db
      .insert(users)
      .values({
        id: userId,
        email: oauthUser.email,
        name: oauthUser.name,
        avatarUrl: oauthUser.avatarUrl,
        emailVerified: true,
      });
  }

  await db
    .insert(oauthAccounts)
    .values({ provider, providerUserId: oauthUser.id, userId });

  const session = await lucia.createSession(userId, {});
  const sessionCookie = lucia.createSessionCookie(session.id);
  cookies.set(sessionCookie.name, sessionCookie.value, {
    path: ".",
    ...sessionCookie.attributes,
  });
  redirect(302, "/dashboard");
};
