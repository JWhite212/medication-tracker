// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The two bulk deletes of medication rows lock them in ascending id order.
 *
 * `wipeDoseHistory` locks every one of the user's medications
 * `ORDER BY id FOR UPDATE` before it deletes anything (D7). "Delete archived
 * medications" (`wipeArchivedMedications`) and import's replace mode used to
 * delete medication rows with a bare `DELETE … WHERE`, which locks them in
 * scan order. With two archived medications A < B whose heap order is B, A,
 * the delete holds B and waits for A while the history wipe holds A and
 * waits for B, and Postgres aborts one of them with 40P01.
 *
 * PGlite is one backend and serialises transactions, so the deadlock cannot
 * be raced here. The lock is pinned by its SQL in `queryLog` instead, and the
 * deletes are checked to still remove exactly the rows they did.
 */

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb, queryLog } from "../helpers/pg-db";
import { medications } from "../../../src/lib/server/db/schema";
import { asc } from "drizzle-orm";
import { NO_SECTIONS, type ImportPlan } from "../../../src/lib/server/import/types";

const { wipeArchivedMedications } = await import("../../../src/lib/server/api/wipe");
const { applyImport } = await import("../../../src/lib/server/import/apply");

/** The medication lock, as the delete of medication rows must carry it. */
const ORDERED_LOCK =
  /select "medications"\."id" from "medications" where .* order by "medications"\."id" asc for update/;

function medicationDeletes(): string[] {
  return queryLog.filter((q) => q.startsWith(`delete from "medications"`));
}

/** No statement before `index` locks or writes a medication row. */
function nothingLockedOrWrittenBefore(index: number): boolean {
  return queryLog
    .slice(0, index)
    .every(
      (q) =>
        !/^(insert into|update|delete from) /.test(q) &&
        !(q.includes(`from "medications"`) && /for update/.test(q)),
    );
}

async function medicationIds(): Promise<string[]> {
  const rows = await pgDb.db
    .select({ id: medications.id })
    .from(medications)
    .orderBy(asc(medications.id));
  return rows.map((r) => r.id);
}

function emptyReplacePlan(): ImportPlan {
  return {
    format: "json",
    mode: "replace",
    sections: NO_SECTIONS,
    medications: [],
    doses: [],
    inventoryEvents: [],
    profile: null,
    preferences: null,
    unresolvedNames: [],
    summary: {
      medicationsCreated: 0,
      medicationsReused: 0,
      medicationsSkipped: 0,
      schedulesCreated: 0,
      dosesCreated: 0,
      dosesSkipped: 0,
      inventoryEventsCreated: 0,
      inventoryEventsSkipped: 0,
      medicationsDeleted: 2,
      dosesDeleted: 0,
      profileUpdated: false,
      preferencesUpdated: false,
    },
  } as unknown as ImportPlan;
}

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
  // Seeded B before A, so a sequential scan meets the higher id first.
  await pgDb.seedMedication({ id: "m-b", isArchived: true });
  await pgDb.seedMedication({ id: "m-a", isArchived: true });
  await pgDb.seedMedication({ id: "m-active" });
  await pgDb.seedMedication({ id: "m-u2", userId: "u2", isArchived: true });
  queryLog.length = 0;
});

describe("wipeArchivedMedications", () => {
  it("locks the archived medications in ascending id order before anything else", async () => {
    await wipeArchivedMedications("u1");

    const deletes = medicationDeletes();
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toMatch(ORDERED_LOCK);
    expect(nothingLockedOrWrittenBefore(queryLog.indexOf(deletes[0]))).toBe(true);
  });

  it("still deletes exactly this user's archived medications", async () => {
    await expect(wipeArchivedMedications("u1")).resolves.toEqual({ deleted: 2 });

    expect(await medicationIds()).toEqual(["m-active", "m-u2"]);
  });
});

describe("applyImport in replace mode", () => {
  it("locks the user's medications in ascending id order before anything else", async () => {
    await applyImport("u1", emptyReplacePlan());

    const deletes = medicationDeletes();
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toMatch(ORDERED_LOCK);
    expect(nothingLockedOrWrittenBefore(queryLog.indexOf(deletes[0]))).toBe(true);
  });

  it("still deletes every one of this user's medications and no one else's", async () => {
    await applyImport("u1", emptyReplacePlan());

    expect(await medicationIds()).toEqual(["m-u2"]);
  });
});
