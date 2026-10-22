// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { sessions } from "../../../src/lib/server/db/schema";

// A session's sign-in time travels through Lucia's real Drizzle adapter: the
// insert spreads the attributes in, the validating select reads every column
// back out, and the sliding expiry writes `expires_at` alone. None of that
// is visible to fake-db, which never runs the adapter's queries, so the
// round trip is proved here against the real migrations.
vi.mock("$app/environment", () => ({ dev: true }));
vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { lucia } = await import("../../../src/lib/server/auth/lucia");

const T = new Date("2026-10-22T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

beforeAll(() => {
  // Fake ONLY Date. Faking timers wholesale stalls PGlite's WASM layer.
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  vi.setSystemTime(T);
  await pgDb.reset();
  await pgDb.seedUser({ id: "u1" });
});

describe("sessions.authenticated_at", () => {
  it("stores the sign-in time it was given and returns it on the session", async () => {
    const signedInAt = new Date(T.getTime() - 5_000);
    const created = await lucia.createSession("u1", { authenticatedAt: signedInAt });

    const { session } = await lucia.validateSession(created.id);

    expect(session?.authenticatedAt).toEqual(signedInAt);
  });

  it("keeps the sign-in time when the session's expiry slides", async () => {
    const created = await lucia.createSession("u1", { authenticatedAt: T });
    // Lucia extends a session once less than half its 30 days remain.
    vi.setSystemTime(new Date(T.getTime() + 16 * DAY));

    const { session } = await lucia.validateSession(created.id);

    expect(session?.fresh).toBe(true);
    expect(session?.authenticatedAt).toEqual(T);
    const [row] = await pgDb.db.select().from(sessions).where(eq(sessions.id, created.id));
    expect(row.expiresAt.getTime()).toBeGreaterThan(created.expiresAt.getTime());
    expect(row.authenticatedAt).toEqual(T);
  });

  it("reads a session created before the column existed as null", async () => {
    await pgDb.db
      .insert(sessions)
      .values({ id: "old", userId: "u1", expiresAt: new Date(T.getTime() + DAY) });

    const { session } = await lucia.validateSession("old");

    expect(session).not.toBeNull();
    expect(session?.authenticatedAt).toBeNull();
  });

  it("adds the column nullable and with no default, so existing sessions stay not-recent", async () => {
    const res = await pgDb.client.query<{ column_default: string | null; is_nullable: string }>(
      `select column_default, is_nullable from information_schema.columns
       where table_name = 'sessions' and column_name = 'authenticated_at'`,
    );

    expect(res.rows).toEqual([{ column_default: null, is_nullable: "YES" }]);
  });
});
