// @vitest-environment node
/**
 * What an edited dose leaves in the audit log.
 *
 * Audit rows are synced to the Mac app and exported, and nothing ever purges
 * them, so a dose's delete and restore rows carry no diff at all. The update
 * row used to diff the whole RETURNING row, which put two things there that
 * do not belong:
 *
 *   - the note and side effects verbatim. A note added through Edit survived
 *     the dose's delete, its trash purge and a history wipe, in every sync and
 *     every export. The diff now says that they changed, never what they said.
 *   - `updatedAt`, which every save rewrites, so a Save with nothing changed
 *     still wrote an audit row.
 *
 * On PGlite because the diff is computed from the row Postgres hands back.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs } from "../../../src/lib/server/db/schema";

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { updateDose, deleteDose } = await import("../../../src/lib/server/doses");
const { REDACTED } = await import("../../../src/lib/server/audit");

const NOTE = "sentinel-note-felt-dizzy-after-second-tablet";
const SIDE_EFFECT = "sentinel-side-effect-blurred-vision";

async function updateRows() {
  return pgDb.db
    .select({ changes: auditLogs.changes })
    .from(auditLogs)
    .where(eq(auditLogs.action, "update"));
}

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  await pgDb.seedMedication({ inventoryCount: 10 });
  await pgDb.seedDose({ id: "d1", quantity: 1, inventoryApplied: 1 });
});

describe("updateDose's audit row", () => {
  it("records that the note and side effects changed, without their text", async () => {
    await updateDose("u1", "d1", {
      notes: NOTE,
      sideEffects: [{ name: SIDE_EFFECT, severity: "mild" }],
    });

    const rows = await updateRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].changes).toEqual({
      notes: { from: null, to: REDACTED },
      sideEffects: { from: null, to: REDACTED },
    });
    expect(JSON.stringify(rows)).not.toContain(NOTE);
    expect(JSON.stringify(rows)).not.toContain(SIDE_EFFECT);
  });

  it("redacts both sides when a note is rewritten or cleared", async () => {
    await updateDose("u1", "d1", { notes: `${NOTE}-first` });
    await updateDose("u1", "d1", { notes: `${NOTE}-second` });
    await updateDose("u1", "d1", { notes: "" });

    const rows = await updateRows();
    expect(rows.map((r) => r.changes)).toEqual(
      expect.arrayContaining([
        { notes: { from: null, to: REDACTED } },
        { notes: { from: REDACTED, to: REDACTED } },
        { notes: { from: REDACTED, to: null } },
      ]),
    );
    expect(rows).toHaveLength(3);
    expect(JSON.stringify(rows)).not.toContain(NOTE);
  });

  it("leaves no note text anywhere in the audit log once the dose is deleted", async () => {
    await updateDose("u1", "d1", {
      notes: NOTE,
      sideEffects: [{ name: SIDE_EFFECT, severity: "severe" }],
    });
    await deleteDose("u1", "d1", { keepForUndo: false });

    const all = await pgDb.db.select().from(auditLogs);
    expect(all.map((r) => r.action).sort()).toEqual(["delete", "update"]);
    expect(JSON.stringify(all)).not.toContain(NOTE);
    expect(JSON.stringify(all)).not.toContain(SIDE_EFFECT);
  });

  it("still records the other fields in full", async () => {
    await updateDose("u1", "d1", { quantity: 2 });

    const [row] = await updateRows();
    expect(row.changes).toEqual({
      quantity: { from: 1, to: 2 },
      inventoryApplied: { from: 1, to: 2 },
    });
  });

  it("writes no audit row for a Save that changes nothing", async () => {
    // Same quantity, same (absent) note: the only column that moves is
    // updatedAt, which is bookkeeping, not a change the user made.
    await updateDose("u1", "d1", { quantity: 1, notes: "" });

    expect(await updateRows()).toEqual([]);
  });

  it("never lists updatedAt in a real edit's diff", async () => {
    await updateDose("u1", "d1", { takenAt: new Date("2026-08-01T09:00:00Z") });

    const [row] = await updateRows();
    expect(Object.keys(row.changes ?? {})).toEqual(["takenAt"]);
  });
});
