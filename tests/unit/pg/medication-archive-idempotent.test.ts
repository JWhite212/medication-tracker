// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";
import { auditLogs, medications } from "../../../src/lib/server/db/schema";

const { archiveMedication } = await import("../../../src/lib/server/medications");

/**
 * Archiving is the web user's only "I stopped taking this" event, and
 * `lifecycleEnd` closes the expected-doses window at `archivedAt`. A second
 * archive (a stale tab, a native double submit, a replayed /api/v1 command)
 * must therefore not move `archivedAt` later — every day in between would be
 * charged as expected and shown as Missed — and must not write an audit row
 * claiming a false→true change that never happened.
 *
 * On PGlite because whether the UPDATE happens at all is decided by its WHERE
 * clause, which fake-db captures but never evaluates.
 */

const { db } = pgDb;

beforeAll(() => {
  // Date only — faking all timers stalls PGlite's WASM layer.
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
  await pgDb.seedMedication();
});

async function medicationAudits(userId: string) {
  return db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.userId, userId), eq(auditLogs.entityType, "medication")));
}

describe("archiveMedication is idempotent", () => {
  it("re-archiving keeps the original archivedAt and writes no second audit row", async () => {
    const firstArchive = new Date("2026-10-01T09:00:00Z");
    vi.setSystemTime(firstArchive);
    await archiveMedication("u1", "m1");

    vi.setSystemTime(new Date("2026-10-20T09:00:00Z"));
    await archiveMedication("u1", "m1");

    const [row] = await db
      .select({ isArchived: medications.isArchived, archivedAt: medications.archivedAt })
      .from(medications)
      .where(eq(medications.id, "m1"));
    expect(row.isArchived).toBe(true);
    expect(row.archivedAt?.toISOString()).toBe(firstArchive.toISOString());

    expect(await medicationAudits("u1")).toHaveLength(1);
  });

  it("archiving another user's medication changes nothing and audits nothing", async () => {
    vi.setSystemTime(new Date("2026-10-01T09:00:00Z"));
    await archiveMedication("u2", "m1");

    const [row] = await db
      .select({ isArchived: medications.isArchived })
      .from(medications)
      .where(eq(medications.id, "m1"));
    expect(row.isArchived).toBe(false);
    expect(await medicationAudits("u2")).toHaveLength(0);
  });
});
