/**
 * Binds the dashboard composer to the function the matcher's proofs test.
 *
 * `computeScheduleSlots` has no production caller: `composeDashboardPageData`
 * runs the same steps itself (projectFixedTimes → projectMedicationSlots →
 * matchMedicationSlots over `segmentsFor(dashboardWindow(...))` with
 * `pass2Bound: window.visibleStart`). Yet the differential against the
 * shipped matcher, the midnight/noon stability check, the DST tests and most
 * of schedule.test.ts all drive `computeScheduleSlots`. Without this file a
 * change to the composer's wiring — a different pass-2 bound, a dropped
 * anchor, other segments — would pass every one of those proofs while the
 * page showed something none of them checked.
 *
 * For seeded multi-medication fixtures (fixed-time and interval rows, PRN
 * rows beside them, missed rows, lifecycle and schedule-edit clips, DST days
 * in five zones) this asserts that what the page shows is exactly what
 * `computeScheduleSlots(..., { window })` says:
 *
 * 1. Outstanding rows. Every overdue/upcoming slot the page lists, and no
 *    other, in the group its status and instant put it in.
 * 2. Header counts. `totalToday` and `doneToday` count the same slots.
 * 3. Which dose resolved which slot. Done rows' `covers` name exactly the
 *    slots `resolvedByDoseId` credits to them.
 *
 * Nothing here re-derives matching: the only rules restated are the
 * composer's own presentation rules (CLAUDE.md, "page-data.ts owns the
 * dashboard's composition"), so a failure means the two pipelines resolved a
 * slot differently, not that this file disagrees about matching.
 */
import { describe, it, expect } from "vitest";
import { composeDashboardPageData } from "$lib/server/dashboard/page-data";
import {
  MATCH_TOLERANCE_MS,
  computeScheduleSlots,
  dashboardWindow,
  type ScheduleSlot,
} from "$lib/utils/schedule";
import { shiftDayKey, wallClockToInstant } from "$lib/utils/time";
import type { DoseLogWithMedication, Medication } from "$lib/types";
import type { MedicationSchedule } from "$lib/server/schedules";
import {
  DAYS,
  ZONES,
  hhmm,
  int,
  mulberry32,
  pick,
  scheduleMinutes,
  type Random,
} from "./helpers/schedule-property-fixtures";

const H = 60 * 60 * 1000;
const MINUTE_MS = 60_000;
const FIXTURES = 300;
const SEED = 20261107;
const EPOCH = new Date("2026-01-01T00:00:00Z");

function makeMed(id: string, sortOrder: number, overrides: Partial<Medication> = {}): Medication {
  return {
    id,
    userId: "user-1",
    name: `Med ${id}`,
    dosageAmount: "1",
    dosageUnit: "mg",
    form: "tablet",
    category: "other",
    colour: "#6366f1",
    colourSecondary: null,
    pattern: "solid",
    notes: null,
    scheduleType: "scheduled",
    scheduleIntervalHours: null,
    inventoryCount: null,
    inventoryAlertThreshold: null,
    lowInventoryEpisodeAt: null,
    notificationsEnabled: true,
    notifyOverdueEmail: null,
    notifyOverduePush: null,
    notifyLowInventoryEmail: null,
    notifyLowInventoryPush: null,
    notifyOffsetMinutes: 0,
    notifyRepeatEveryMinutes: null,
    notifyMaxRepeats: 3,
    sortOrder,
    isArchived: false,
    archivedAt: null,
    startedAt: EPOCH,
    endedAt: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...overrides,
  };
}

function scheduleRow(
  medicationId: string,
  index: number,
  fields: Pick<MedicationSchedule, "scheduleKind" | "timeOfDay" | "intervalHours" | "daysOfWeek">,
  effectiveFrom: Date,
): MedicationSchedule {
  return {
    id: `sched-${medicationId}-${index}`,
    medicationId,
    userId: "user-1",
    sortOrder: index,
    effectiveFrom,
    effectiveTo: null,
    createdAt: effectiveFrom,
    ...fields,
  };
}

function makeDose(
  id: string,
  medicationId: string,
  takenAt: Date,
  loggedAt: Date,
  status: DoseLogWithMedication["status"],
  quantity: number,
): DoseLogWithMedication {
  return {
    id,
    userId: "user-1",
    medicationId,
    quantity,
    takenAt,
    loggedAt,
    updatedAt: loggedAt,
    notes: null,
    sideEffects: null,
    status,
    medication: {
      name: `Med ${medicationId}`,
      dosageAmount: "1",
      dosageUnit: "mg",
      form: "tablet",
      colour: "#6366f1",
      colourSecondary: null,
      pattern: "solid",
    },
  };
}

function between(random: Random, from: number, to: number): Date {
  return new Date(from + Math.floor(random() * (to - from)));
}

type Fixture = {
  label: string;
  timezone: string;
  now: Date;
  medications: Medication[];
  schedulesByMedId: Map<string, MedicationSchedule[]>;
  doses: DoseLogWithMedication[];
  lastDoses: Array<{ medicationId: string; lastTakenAt: Date | null; lastEventAt: Date }>;
};

function buildFixture(i: number): Fixture {
  const random = mulberry32(SEED + i);
  const timezone = pick(random, ZONES);
  const dayKey = pick(random, DAYS);
  const todayStart = wallClockToInstant(dayKey, "00:00", timezone);
  const end = wallClockToInstant(shiftDayKey(dayKey, 1), "00:00", timezone);
  const now = between(random, todayStart.getTime(), end.getTime());
  const window = dashboardWindow(now, timezone);
  const projectStartMs = window.projectStart.getTime();
  const nowMs = now.getTime();

  const medications: Medication[] = [];
  const schedulesByMedId = new Map<string, MedicationSchedule[]>();
  const doses: DoseLogWithMedication[] = [];
  const lastDoses: Fixture["lastDoses"] = [];

  const medCount = int(random, 1, 3);
  for (let m = 0; m < medCount; m++) {
    const id = `med-${m}`;
    // Lifecycle clip: a medication started (or ended) inside the window.
    const startedAt = random() < 0.2 ? between(random, projectStartMs, nowMs) : EPOCH;
    const endedAt = random() < 0.1 ? between(random, startedAt.getTime(), end.getTime()) : null;
    medications.push(makeMed(id, int(random, 0, 5), { startedAt, endedAt }));

    // Schedule-edit clip: a save rewrites rows with effectiveFrom = now.
    const effectiveFrom = random() < 0.2 ? between(random, projectStartMs, nowMs) : EPOCH;
    const rows: MedicationSchedule[] = [];
    const roll = random();
    if (roll < 0.6) {
      const minutes = scheduleMinutes(random, int(random, 1, 4));
      minutes.forEach((minute, k) =>
        rows.push(
          scheduleRow(
            id,
            k,
            {
              scheduleKind: "fixed_time",
              timeOfDay: hhmm(minute),
              intervalHours: null,
              daysOfWeek: random() < 0.2 ? [int(random, 0, 6)] : null,
            },
            effectiveFrom,
          ),
        ),
      );
    } else if (roll < 0.9) {
      rows.push(
        scheduleRow(
          id,
          0,
          {
            scheduleKind: "interval",
            timeOfDay: null,
            intervalHours: pick(random, ["4", "6", "8", "12", "24"] as const),
            daysOfWeek: null,
          },
          effectiveFrom,
        ),
      );
    }
    // A PRN row on its own (projects nothing) or beside a timed one.
    if (roll >= 0.9 || random() < 0.15) {
      rows.push(
        scheduleRow(
          id,
          rows.length,
          { scheduleKind: "prn", timeOfDay: null, intervalHours: null, daysOfWeek: null },
          effectiveFrom,
        ),
      );
    }
    schedulesByMedId.set(id, rows);

    const fixedInstants = rows
      .filter((r) => r.scheduleKind === "fixed_time")
      .flatMap((r) =>
        [shiftDayKey(dayKey, -1), dayKey].map((key) =>
          wallClockToInstant(key, r.timeOfDay!, timezone),
        ),
      );
    const doseCount = int(random, 0, 6);
    for (let j = 0; j < doseCount; j++) {
      let takenAt: Date;
      const where = random();
      if (where < 0.25 && fixedInstants.length > 0) {
        // Exactly on a slot instant: exercises pass 0 and reserved skips.
        takenAt = pick(random, fixedInstants);
      } else if (where < 0.45) {
        // Late: up to 12h after a random point yesterday or today.
        takenAt = between(random, projectStartMs, nowMs);
      } else {
        takenAt = between(random, window.doseFetchFrom.getTime(), window.doseFetchTo.getTime());
      }
      const s = random();
      const status = s < 0.65 ? "taken" : s < 0.85 ? "skipped" : "missed";
      const quantity = status === "taken" ? int(random, 1, 3) : 1;
      // Some doses are backdated from today (a Took it at on an Earlier row).
      const loggedAt =
        random() < 0.3 && takenAt.getTime() < nowMs
          ? between(random, Math.max(takenAt.getTime(), todayStart.getTime()), nowMs + 1)
          : takenAt;
      doses.push(makeDose(`dose-${m}-${j}`, id, takenAt, loggedAt, status, quantity));
    }

    const latestTaken = doses
      .filter((d) => d.medicationId === id && d.status === "taken" && d.takenAt.getTime() <= nowMs)
      .reduce<Date | null>((a, d) => (a && a >= d.takenAt ? a : d.takenAt), null);
    const lastTakenAt =
      latestTaken ?? (random() < 0.5 ? new Date(projectStartMs - int(random, 0, 48) * H) : null);
    if (lastTakenAt) lastDoses.push({ medicationId: id, lastTakenAt, lastEventAt: lastTakenAt });
  }

  return {
    label: `fixture ${i} (${timezone} ${dayKey}, now ${now.toISOString()})`,
    timezone,
    now,
    medications,
    schedulesByMedId,
    doses,
    lastDoses,
  };
}

type Group = "earlier" | "due-now" | "overdue" | "later";

/** The composer's presentation rule for an outstanding slot, or null when it is not listed. */
function expectedGroup(slot: ScheduleSlot, visibleStartMs: number, nowMs: number): Group | null {
  if (slot.status !== "overdue" && slot.status !== "upcoming") return null;
  const t = Date.parse(slot.expectedTime);
  if (slot.isEarlier) {
    return slot.status === "overdue" && t >= visibleStartMs ? "earlier" : null;
  }
  const ahead = t - nowMs;
  if (Math.abs(ahead) <= MATCH_TOLERANCE_MS) return "due-now";
  return ahead < 0 ? "overdue" : "later";
}

describe("dashboard composer ↔ computeScheduleSlots binding", () => {
  it("the page shows exactly the slots and resolutions computeScheduleSlots computes", () => {
    const seen = {
      earlier: 0,
      dueNow: 0,
      overdue: 0,
      later: 0,
      covers: 0,
      resolvedToday: 0,
      interval: 0,
      missed: 0,
      clipped: 0,
    };

    for (let i = 0; i < FIXTURES; i++) {
      const f = buildFixture(i);
      const window = dashboardWindow(f.now, f.timezone);
      const nowMs = f.now.getTime();

      const page = composeDashboardPageData({
        medications: f.medications,
        schedulesByMedId: f.schedulesByMedId,
        doses: f.doses,
        lastDoses: f.lastDoses,
        now: f.now,
        timezone: f.timezone,
      });

      const lastDoseByMedication: Record<string, Date> = {};
      for (const d of f.lastDoses)
        if (d.lastTakenAt) lastDoseByMedication[d.medicationId] = d.lastTakenAt;
      const slots = computeScheduleSlots(
        f.medications,
        f.schedulesByMedId,
        f.doses,
        lastDoseByMedication,
        window.todayStart,
        window.end,
        f.timezone,
        f.now,
        { window },
      );

      // 1. Outstanding rows: same set, same group, same kind.
      const expectedRows: string[] = [];
      for (const slot of slots) {
        const group = expectedGroup(slot, window.visibleStart.getTime(), nowMs);
        if (group === null) continue;
        const kind = group === "later" ? "-" : slot.kind;
        expectedRows.push(`${slot.medicationId}:${slot.expectedTime} ${group} ${kind}`);
      }
      const pageRows: string[] = [
        ...page.earlier.flatMap((card) => card.rows.map((row) => `${row.key} earlier ${row.kind}`)),
        ...page.today.flatMap((card) =>
          card.rows.map((row) => `${row.key} ${row.state} ${row.kind}`),
        ),
        ...page.later.map((row) => `${row.key} later -`),
      ];
      expect(pageRows.sort(), `${f.label}: outstanding rows`).toEqual(expectedRows.sort());

      // 2. Header counts.
      const todaySlots = slots.filter((s) => !s.isEarlier);
      const resolvedToday = todaySlots.filter(
        (s) => s.status === "taken" || s.status === "skipped",
      ).length;
      expect(
        { totalToday: page.status.totalToday, doneToday: page.status.doneToday },
        `${f.label}: header counts`,
      ).toEqual({ totalToday: todaySlots.length, doneToday: resolvedToday });

      // 3. Which dose resolved which slot, read through Done's covers.
      const doneById = new Map(page.done.map((row) => [row.key, row]));
      const expectedCovers: string[] = [];
      for (const slot of slots) {
        if (slot.resolvedByDoseId === null) continue;
        const row = doneById.get(slot.resolvedByDoseId);
        if (!row) continue;
        const t = Date.parse(slot.expectedTime);
        if (Math.floor(t / MINUTE_MS) === Math.floor(row.dose.takenAt.getTime() / MINUTE_MS)) {
          continue;
        }
        expectedCovers.push(`${slot.resolvedByDoseId}@${slot.expectedTime}`);
      }
      const pageCovers = page.done.flatMap((row) => row.covers.map((at) => `${row.key}@${at}`));
      expect(pageCovers.sort(), `${f.label}: covers`).toEqual(expectedCovers.sort());

      for (const line of pageRows) {
        if (line.includes(" earlier ")) seen.earlier++;
        else if (line.includes(" due-now ")) seen.dueNow++;
        else if (line.includes(" overdue ")) seen.overdue++;
        else seen.later++;
      }
      seen.covers += pageCovers.length;
      seen.resolvedToday += resolvedToday;
      seen.interval += slots.filter((s) => s.kind === "interval").length;
      seen.missed += slots.filter((s) => s.missedByDoseId !== null).length;
      if (f.medications.some((m) => m.startedAt !== EPOCH || m.endedAt !== null)) seen.clipped++;
    }

    // Non-vacuity: every branch of the binding is exercised.
    expect(seen.earlier).toBeGreaterThan(30);
    expect(seen.dueNow).toBeGreaterThan(30);
    expect(seen.overdue).toBeGreaterThan(100);
    expect(seen.later).toBeGreaterThan(100);
    expect(seen.covers).toBeGreaterThan(50);
    expect(seen.resolvedToday).toBeGreaterThan(100);
    expect(seen.interval).toBeGreaterThan(100);
    expect(seen.missed).toBeGreaterThan(10);
    expect(seen.clipped).toBeGreaterThan(30);
  }, 60_000);
});
