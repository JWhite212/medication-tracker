import { Lucia } from "lucia";
import { DrizzlePostgreSQLAdapter } from "@lucia-auth/adapter-drizzle";
import { db } from "$lib/server/db";
import { sessions, users } from "$lib/server/db/schema";
import { dev } from "$app/environment";
import type { SessionUser } from "$lib/types";

const adapter = new DrizzlePostgreSQLAdapter(db, sessions, users);

export const lucia = new Lucia(adapter, {
  sessionCookie: {
    attributes: {
      secure: !dev,
    },
  },
  // The adapter hands back every `sessions` column besides id, userId and
  // expiresAt as an attribute. The widening to `Date | null` is the point: a
  // session created before `authenticated_at` existed reads NULL even though
  // the registered creation type below says Date, and checkDestructiveGuard
  // treats null as not recent. (Drizzle already yields null, not undefined,
  // for a NULL column, so no `?? null` is needed.)
  getSessionAttributes: (attributes) => ({
    authenticatedAt: attributes.authenticatedAt as Date | null,
  }),
  getUserAttributes: (attributes): SessionUser => ({
    id: attributes.id,
    email: attributes.email,
    name: attributes.name,
    avatarUrl: attributes.avatarUrl,
    timezone: attributes.timezone,
    twoFactorEnabled: attributes.twoFactorEnabled,
    emailVerified: attributes.emailVerified,
  }),
});

declare module "lucia" {
  interface Register {
    Lucia: typeof lucia;
    // Required, so `createSession(userId, {})` does not compile: every
    // caller is a sign-in and must say when it happened.
    DatabaseSessionAttributes: {
      authenticatedAt: Date;
    };
    DatabaseUserAttributes: {
      id: string;
      email: string;
      name: string;
      avatarUrl: string | null;
      timezone: string;
      twoFactorEnabled: boolean;
      emailVerified: boolean;
    };
  }
}

export type { Session as SessionRecord } from "lucia";
