// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { sessions } from "../../../src/lib/server/db/schema";

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { RETENTION_POLICIES } = await import("../../../src/lib/server/retention");
const { load } = await import("../../../src/routes/(app)/settings/security/+page.server");

/**
 * Lucia deletes an expired session only when that same cookie comes back, so
 * a session on a device that never returns stayed in the table, and on the
 * Security page's "Active sessions" list, forever. Which rows survive is a
 * predicate the database decides, so this lives on PGlite.
 */
const NOW = new Date("2026-04-15T12:00:00Z");
const HOUR = 3_600_000;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  await pgDb.db.insert(sessions).values([
    { id: "s-live", userId: "u1", expiresAt: new Date(NOW.getTime() + HOUR) },
    { id: "s-dead", userId: "u1", expiresAt: new Date(NOW.getTime() - HOUR) },
  ]);
});

describe("expired sessions", () => {
  it("retention purges sessions past their expiry and keeps live ones", async () => {
    await RETENTION_POLICIES.find((p) => p.name === "expired-sessions")!.purge(NOW);

    const remaining = await pgDb.db.select({ id: sessions.id }).from(sessions);
    expect(remaining.map((r) => r.id)).toEqual(["s-live"]);
  });

  it("the Security page lists only sessions that can still sign someone in", async () => {
    const data = (await load({
      locals: {
        user: { id: "u1", twoFactorEnabled: false },
        session: { id: "s-live" },
      },
    } as never)) as { sessions: { id: string }[] };

    expect(data.sessions.map((s) => s.id)).toEqual(["s-live"]);
  });
});
