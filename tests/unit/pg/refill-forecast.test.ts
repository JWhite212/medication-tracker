// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { medicationSchedules } from "../../../src/lib/server/db/schema";

// getRefillForecast is named in CLAUDE.md as the single source of truth for
// daily-rate selection and severity classification, and it is called from
// three page loads — but it had no test at all, only vi.mock stubs. Its
// pure helpers (classifyRefillSeverity, dailyRateFor, daysUntilRefill) are
// already covered in inventory.test.ts, which stays on unusedDb. What is
// untested is the composition: the three parallel queries, their scoping,
// and the join between them. Several parts of that are decided by SQL.
vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { getRefillForecast } = await import("../../../src/lib/server/inventory");

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

/** A medication whose rate comes from the legacy interval column: one
    dose per day, so `inventoryCount` reads directly as days remaining. */
async function onePerDayMed(id: string, inventoryCount: number | null, extra = {}) {
  await pgDb.seedMedication({
    id,
    name: `Med ${id}`,
    inventoryCount,
    scheduleType: "scheduled",
    scheduleIntervalHours: "24",
    ...extra,
  });
}

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
});

describe("getRefillForecast — what it includes", () => {
  it("reports a medication that will run out inside the warning band", async () => {
    await onePerDayMed("m-warn", 5);

    const [entry, ...rest] = await getRefillForecast("u1");

    expect(rest).toHaveLength(0);
    expect(entry).toMatchObject({
      medicationId: "m-warn",
      inventoryCount: 5,
      dailyRate: 1,
      daysUntilRefill: 5,
      severity: "warning",
    });
  });

  it("sorts the most urgent medication first", async () => {
    await onePerDayMed("m-watch", 10);
    await onePerDayMed("m-critical", 2);
    await onePerDayMed("m-warn", 5);

    const entries = await getRefillForecast("u1");

    expect(entries.map((e) => e.medicationId)).toEqual(["m-critical", "m-warn", "m-watch"]);
  });
});

describe("getRefillForecast — what it leaves out", () => {
  it("omits a medication with plenty of stock", async () => {
    await onePerDayMed("m-fine", 100);
    expect(await getRefillForecast("u1")).toHaveLength(0);
  });

  it("omits a medication that does not track inventory", async () => {
    // Note on what this can and cannot prove. Two guards enforce it
    // independently — the explicit `inventoryCount === null` skip, and
    // the fact that daysUntilRefill(null, …) is null, which classifies
    // as "ok" and hits the severity skip. Removing EITHER one alone
    // leaves this test green; removing both fails it. So it pins the
    // behaviour, not the specific guard, and the null check is defence
    // in depth rather than the load-bearing line it looks like.
    await onePerDayMed("m-untracked", null);
    expect(await getRefillForecast("u1")).toHaveLength(0);
  });

  it("omits an archived medication even when it is critical", async () => {
    await onePerDayMed("m-archived", 1, { isArchived: true });
    expect(await getRefillForecast("u1")).toHaveLength(0);
  });

  it("never reports another user's medication", async () => {
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    await pgDb.seedMedication({
      id: "m-other",
      userId: "u2",
      name: "Someone else's",
      inventoryCount: 1,
      scheduleType: "scheduled",
      scheduleIntervalHours: "24",
    });

    // u2's medication is critical. If the medications query were not
    // scoped by user_id it would surface here.
    expect(await getRefillForecast("u1")).toHaveLength(0);
    expect((await getRefillForecast("u2")).map((e) => e.medicationId)).toEqual(["m-other"]);
  });
});

describe("getRefillForecast — the historical rate for PRN medications", () => {
  // A PRN medication has no schedule rate, so dailyRateFor falls back to
  // thirtyDayDoseCount / 30. Both tests below turn on how that count is
  // computed in SQL, which no fake could exercise.

  it("counts DOSES, not log rows — quantity is load-bearing", async () => {
    await pgDb.seedMedication({
      id: "m-prn",
      name: "PRN",
      inventoryCount: 5,
      scheduleType: "prn",
    });
    // ONE log row, fifteen doses. inventoryCount is measured in doses
    // (CLAUDE.md), so the rate must be 15/30 = 0.5/day → 10 days left.
    // Counting rows instead would give 1/30 ≈ 0.033/day → 150 days, and
    // the medication would drop out of the forecast entirely.
    await pgDb.seedDose({ medicationId: "m-prn", quantity: 15, takenAt: daysAgo(2) });

    const [entry] = await getRefillForecast("u1");

    expect(entry).toMatchObject({
      medicationId: "m-prn",
      dailyRate: 0.5,
      daysUntilRefill: 10,
      severity: "watch",
    });
  });

  it("ignores doses older than thirty days", async () => {
    await pgDb.seedMedication({
      id: "m-prn",
      name: "PRN",
      inventoryCount: 5,
      scheduleType: "prn",
    });
    await pgDb.seedDose({ medicationId: "m-prn", quantity: 15, takenAt: daysAgo(2) });
    // Far larger, and just outside the window. Including it would push the
    // rate to 165/30 = 5.5/day and the severity from watch to critical.
    await pgDb.seedDose({ medicationId: "m-prn", quantity: 150, takenAt: daysAgo(31) });

    const [entry] = await getRefillForecast("u1");

    expect(entry.dailyRate).toBe(0.5);
    expect(entry.severity).toBe("watch");
  });

  it("ignores doses belonging to a different medication", async () => {
    await pgDb.seedMedication({ id: "m-prn", name: "PRN", inventoryCount: 5, scheduleType: "prn" });
    await pgDb.seedMedication({
      id: "m-other",
      name: "Other",
      inventoryCount: 5,
      scheduleType: "prn",
    });
    await pgDb.seedDose({ medicationId: "m-other", quantity: 150, takenAt: daysAgo(2) });

    // The grouped count must not leak across medications: m-prn has no
    // doses, so it has no rate and drops out.
    expect((await getRefillForecast("u1")).map((e) => e.medicationId)).toEqual(["m-other"]);
  });
});

describe("getRefillForecast — schedule rows win over the legacy column", () => {
  it("prefers the schedule rate when both are present", async () => {
    // Legacy column says one per day; the schedule row says every 12
    // hours, i.e. two per day. CLAUDE.md makes the schedule table the
    // canonical source, so 10 units must read as 5 days, not 10.
    await onePerDayMed("m-both", 10);
    await pgDb.db.insert(medicationSchedules).values({
      id: "s1",
      medicationId: "m-both",
      userId: "u1",
      scheduleKind: "interval",
      intervalHours: "12",
    });

    const [entry] = await getRefillForecast("u1");

    expect(entry).toMatchObject({
      dailyRate: 2,
      daysUntilRefill: 5,
      severity: "warning",
    });
  });

  it("does not apply another user's schedule rows", async () => {
    await onePerDayMed("m-both", 10);
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    // Same medication id, but owned by u2 in the schedules table. If
    // getSchedulesForUser were not scoped, this would halve u1's forecast.
    await pgDb.db.insert(medicationSchedules).values({
      id: "s2",
      medicationId: "m-both",
      userId: "u2",
      scheduleKind: "interval",
      intervalHours: "12",
    });

    const [entry] = await getRefillForecast("u1");

    expect(entry.dailyRate).toBe(1);
    expect(entry.daysUntilRefill).toBe(10);
  });
});
