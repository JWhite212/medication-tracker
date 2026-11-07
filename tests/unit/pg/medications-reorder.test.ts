// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { createMedicationWithSchedules, swapSortOrder, getActiveMedications } =
  await import("../../../src/lib/server/medications");

/**
 * Reordering medications created in the app.
 *
 * On PGlite because the defect is decided by the database: the column
 * default (`sort_order DEFAULT 0`) gives every app-created medication the
 * same sort order, and `swapSortOrder` then swaps 0 with 0. What the user
 * sees — the order `getActiveMedications` returns — is a property of the
 * stored rows, which a fixture handing back canned rows cannot show.
 */

function input(name: string) {
  return {
    name,
    dosageAmount: "500",
    dosageUnit: "mg",
    form: "tablet" as const,
    category: "otc" as const,
    colour: "#3b82f6",
  };
}

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
});

describe("reordering app-created medications", () => {
  it("swapping two medications created in the app reverses their order", async () => {
    const a = await createMedicationWithSchedules("u1", input("Paracetamol") as never, [
      { scheduleKind: "prn" },
    ]);
    const b = await createMedicationWithSchedules("u1", input("Ibuprofen") as never, [
      { scheduleKind: "prn" },
    ]);

    const before = (await getActiveMedications("u1")).map((m) => m.id);
    expect(before).toHaveLength(2);
    expect(new Set(before)).toEqual(new Set([a.id, b.id]));

    await swapSortOrder("u1", before[0], before[1]);

    const after = (await getActiveMedications("u1")).map((m) => m.id);
    expect(after).toEqual([before[1], before[0]]);
  });
});

describe("swapSortOrder scoping and repair", () => {
  it("renumbers tied legacy rows so a move lands, and refuses another user's id", async () => {
    await pgDb.seedMedication({
      id: "m1",
      sortOrder: 0,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    await pgDb.seedMedication({
      id: "m2",
      sortOrder: 0,
      createdAt: new Date("2026-01-02T00:00:00Z"),
    });
    await pgDb.seedMedication({
      id: "m3",
      sortOrder: 0,
      createdAt: new Date("2026-01-03T00:00:00Z"),
    });

    expect((await getActiveMedications("u1")).map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(await swapSortOrder("u1", "m3", "m2")).toBe(true);
    expect((await getActiveMedications("u1")).map((m) => m.id)).toEqual(["m1", "m3", "m2"]);

    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    expect(await swapSortOrder("u2", "m1", "m3")).toBe(false);
    expect((await getActiveMedications("u1")).map((m) => m.id)).toEqual(["m1", "m3", "m2"]);
  });

  it("a medication created in the app goes to the end of the list", async () => {
    await pgDb.seedMedication({ id: "m1", sortOrder: 4 });
    const created = await createMedicationWithSchedules("u1", input("Ibuprofen") as never, [
      { scheduleKind: "prn" },
    ]);
    expect(created.sortOrder).toBe(5);
  });
});
