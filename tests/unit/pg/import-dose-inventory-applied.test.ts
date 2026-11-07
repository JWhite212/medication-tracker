// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * An imported dose never took anything from this account's stock: merge mode
 * reuses an existing medication and leaves its `inventoryCount` alone, and a
 * created medication carries the backup's post-decrement count. So deleting
 * an imported dose must give back nothing. `inventoryApplied` NULL means "the
 * row predates the column" and `deleteDose` falls back to `quantity`, so an
 * import that leaves it NULL mints stock on every delete.
 *
 * The credit is `inventory_count + applied` in SQL, so this lives on PGlite.
 */

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";
import { doseLogs, medications } from "../../../src/lib/server/db/schema";
import { eq } from "drizzle-orm";
import { NO_SECTIONS, type ImportPlan } from "../../../src/lib/server/import/types";

const { applyImport } = await import("../../../src/lib/server/import/apply");
const { deleteDose } = await import("../../../src/lib/server/doses");

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  await pgDb.seedMedication({ id: "m1", inventoryCount: 30 });
});

function mergePlanReusingM1(): ImportPlan {
  const summary = {
    medicationsCreated: 0,
    medicationsReused: 1,
    medicationsSkipped: 0,
    schedulesCreated: 0,
    dosesCreated: 1,
    dosesSkipped: 0,
    inventoryEventsCreated: 0,
    inventoryEventsSkipped: 0,
    medicationsDeleted: 0,
    dosesDeleted: 0,
    profileUpdated: false,
    preferencesUpdated: false,
  };
  return {
    format: "dose-csv",
    mode: "merge",
    sections: NO_SECTIONS,
    medications: [
      {
        // Only `ref` and `existingId` are read for a reuse.
        source: {} as ImportPlan["medications"][number]["source"],
        action: "reuse",
        existingId: "m1",
        ref: "ref-m1",
        reason: null,
      },
    ],
    doses: [
      {
        source: {
          sourceMedicationId: null,
          medicationName: "Test Med",
          quantity: 1,
          takenAt: new Date("2026-07-01T08:00:00Z"),
          loggedAt: null,
          notes: null,
          sideEffects: null,
          status: "taken",
        },
        action: "create",
        medicationRef: "ref-m1",
        reason: null,
      },
    ],
    inventoryEvents: [],
    profile: null,
    preferences: null,
    unresolvedNames: [],
    summary,
  } as unknown as ImportPlan;
}

async function stock(): Promise<number | null> {
  const [row] = await pgDb.db
    .select({ n: medications.inventoryCount })
    .from(medications)
    .where(eq(medications.id, "m1"));
  return row?.n ?? null;
}

describe("imported doses and inventory", () => {
  it("deleting an imported dose on a reused medication does not mint stock", async () => {
    await applyImport("u1", mergePlanReusingM1());
    // The import itself leaves the count alone.
    expect(await stock()).toBe(30);

    const [imported] = await pgDb.db.select().from(doseLogs).where(eq(doseLogs.medicationId, "m1"));
    expect(imported).toBeDefined();

    await deleteDose("u1", imported.id, { keepForUndo: true });

    // Nothing left the bottle for this dose, so nothing comes back.
    expect(await stock()).toBe(30);
  });
});
