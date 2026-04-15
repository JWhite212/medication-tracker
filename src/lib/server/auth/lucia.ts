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
