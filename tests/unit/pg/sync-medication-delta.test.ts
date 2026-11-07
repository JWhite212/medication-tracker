// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * `/api/v1/sync` sends a medication only when `medications.updatedAt > since`
 * (docs/api-v1-contract.md, cursor rules). So every write that changes a
 * synced medication column has to move `updatedAt`, or the Mac app keeps the
 * old value until some unrelated edit touches the row.
 *
 * The stock writes in `doses.ts` (a taken dose, a delete's credit, a quantity
 * edit, a restore) and the reorder in `medications.ts` changed
 * `inventoryCount` / `sortOrder` and left `updatedAt` alone: a web Log now
 * took the count from 10 to 9 and the next delta did not carry the
 * medication at all.
 *
 * On PGlite because the delta is a `gt(updatedAt, since)` predicate the
 * database evaluates, and the counts come from `GREATEST`/`+` arithmetic in
 * SQL; `fake-db` evaluates neither (CLAUDE.md, test-seam rule). Each step
 * syncs with the cursor the previous sync returned, as the Mac client does,
 * and the clock moves between steps so the strict `>` can tell them apart.
 */

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { logDose, deleteDose, restoreDose, updateDose } =
  await import("../../../src/lib/server/doses");
const { swapSortOrder } = await import("../../../src/lib/server/medications");
const { refillMedication, adjustInventory } =
  await import("../../../src/lib/server/inventory-events");
const { buildSyncResponse } = await import("../../../src/lib/server/api/sync");

const LONG_AGO = new Date("2026-01-01T00:00:00Z");
let clock = new Date("2026-08-01T09:00:00Z").getTime();

/** Move the clock on a minute, so this step's writes land after the last cursor. */
function tick() {
  clock += 60_000;
  vi.setSystemTime(clock);
}

/** One delta pull from `cursor`; returns the medications it carried and the next cursor. */
async function pull(cursor: string) {
  const res = await buildSyncResponse("u1", cursor, 0);
  expect(res.fullResync).toBe(false);
  return { meds: res.medications, cursor: res.cursor };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock);
  await pgDb.reset();
  await pgDb.seedUser();
  await pgDb.seedMedication({
    id: "m1",
    inventoryCount: 10,
    sortOrder: 0,
    createdAt: LONG_AGO,
    updatedAt: LONG_AGO,
  });
  await pgDb.seedMedication({
    id: "m2",
    name: "Other Med",
    inventoryCount: 5,
    sortOrder: 1,
    createdAt: LONG_AGO,
    updatedAt: LONG_AGO,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("delta sync carries every stock change", () => {
  it("a log, an edit, a delete and its restore each put the new count in the next delta", async () => {
    // The Mac app is up to date: nothing has changed since its cursor.
    let { meds, cursor } = await pull(new Date(clock).toISOString());
    expect(meds).toEqual([]);

    tick();
    const dose = await logDose("u1", "m1", 1);
    ({ meds, cursor } = await pull(cursor));
    expect(meds.map((m) => [m.id, m.inventoryCount])).toEqual([["m1", 9]]);

    tick();
    await updateDose("u1", dose.id, { quantity: 3 });
    ({ meds, cursor } = await pull(cursor));
    expect(meds.map((m) => [m.id, m.inventoryCount])).toEqual([["m1", 7]]);

    tick();
    const deleted = await deleteDose("u1", dose.id, { keepForUndo: true });
    expect(deleted).not.toBeNull();
    ({ meds, cursor } = await pull(cursor));
    expect(meds.map((m) => [m.id, m.inventoryCount])).toEqual([["m1", 10]]);

    tick();
    const restored = await restoreDose("u1", dose.id, deleted!.deletedAt);
    expect(restored).toBe("restored");
    ({ meds, cursor } = await pull(cursor));
    expect(meds.map((m) => [m.id, m.inventoryCount])).toEqual([["m1", 7]]);

    // And once synced, a quiet interval sends nothing again.
    tick();
    ({ meds } = await pull(cursor));
    expect(meds).toEqual([]);
  });

  it("a refill and a manual adjustment each put the new count in the next delta", async () => {
    let cursor = new Date(clock).toISOString();
    let meds;

    tick();
    await refillMedication("u1", "m1", 20);
    ({ meds, cursor } = await pull(cursor));
    expect(meds.map((m) => [m.id, m.inventoryCount])).toEqual([["m1", 30]]);

    tick();
    await adjustInventory("u1", "m1", 4);
    ({ meds } = await pull(cursor));
    expect(meds.map((m) => [m.id, m.inventoryCount])).toEqual([["m1", 4]]);
  });
});

describe("delta sync carries a reorder", () => {
  it("both medications whose position changed are in the next delta with their new sortOrder", async () => {
    const cursor = new Date(clock).toISOString();

    tick();
    expect(await swapSortOrder("u1", "m1", "m2")).toBe(true);
    const { meds } = await pull(cursor);
    expect(
      meds.map((m) => [m.id, m.sortOrder]).sort(([a], [b]) => String(a).localeCompare(String(b))),
    ).toEqual([
      ["m1", 1],
      ["m2", 0],
    ]);
  });
});
