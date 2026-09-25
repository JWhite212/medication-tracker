// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { getDosesInRange } = await import("../../../src/lib/server/doses");

/**
 * The dashboard's dose read. It runs on PGlite because the property under
 * test is which rows a real WHERE returns at its two edges: `fake-db`
 * captures the predicate without evaluating it, so `lt` and `lte` would
 * look identical there.
 *
 * FROM/TO are dashboardWindow's doseFetchFrom/doseFetchTo for London at
 * 13:30 BST on 2026-04-16. They are copied here as plain constants; nothing
 * in this file depends on the window.
 */
const FROM = new Date("2026-04-14T22:00:00.000Z");
const TO = new Date("2026-04-17T01:00:00.000Z");
const shift = (d: Date, ms: number) => new Date(d.getTime() + ms);

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  await pgDb.seedMedication({ name: "Metformin", dosageAmount: "500", dosageUnit: "mg" });
});

describe("getDosesInRange", () => {
  it("is half-open: a dose at `from` is in, a dose at `to` is out", async () => {
    await pgDb.seedDose({ id: "before-from", takenAt: shift(FROM, -1) });
    await pgDb.seedDose({ id: "at-from", takenAt: FROM });
    await pgDb.seedDose({ id: "before-to", takenAt: shift(TO, -1) });
    await pgDb.seedDose({ id: "at-to", takenAt: TO });

    const rows = await getDosesInRange("u1", FROM, TO);

    // Newest first, like the read it replaces.
    expect(rows.map((r) => r.id)).toEqual(["before-to", "at-from"]);
  });

  it("returns only the requesting user's doses", async () => {
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    await pgDb.seedMedication({ id: "m2", userId: "u2" });
    await pgDb.seedDose({ id: "mine", takenAt: new Date("2026-04-16T10:00:00.000Z") });
    await pgDb.seedDose({
      id: "theirs",
      userId: "u2",
      medicationId: "m2",
      takenAt: new Date("2026-04-16T10:00:00.000Z"),
    });

    const rows = await getDosesInRange("u1", FROM, TO);

    expect(rows.map((r) => r.id)).toEqual(["mine"]);
  });

  it("joins the medication fields a row renders and keeps milliseconds", async () => {
    // Pass 0 compares takenAt with a slot instant to the millisecond, so the
    // read must hand back exactly what was written.
    await pgDb.seedDose({
      id: "d1",
      takenAt: new Date("2026-04-16T10:00:00.123Z"),
      status: "skipped",
    });

    const [row] = await getDosesInRange("u1", FROM, TO);

    expect(row.takenAt.toISOString()).toBe("2026-04-16T10:00:00.123Z");
    expect(row.status).toBe("skipped");
    expect(row.medication).toEqual({
      name: "Metformin",
      dosageAmount: "500",
      dosageUnit: "mg",
      form: "tablet",
      colour: "#ffffff",
      colourSecondary: null,
      pattern: "solid",
    });
    // Server-side bookkeeping never reaches the page (see DoseLog in $lib/types).
    expect(row).not.toHaveProperty("inventoryApplied");
  });
});
