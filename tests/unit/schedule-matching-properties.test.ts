/**
 * Seeded properties of the dashboard slot matcher: passes 0–2 inside the
 * window.
 *
 * 1. Differential against production. The oracle is
 *    helpers/legacy-slot-matcher.ts, a verbatim copy of the matcher as it
 *    shipped before passes 0–2. It runs the way production ran it: over
 *    [todayStart, end) with doses >= todayStart. On the domain the two can
 *    be compared over, every resolution production made must survive
 *    unchanged. The only new
 *    resolutions allowed are late ones: pass 2, from a dose taken AFTER the
 *    slot.
 * 2. Stability across midnight and noon. With no new dose in between,
 *    every slot visible just after the boundary has the same resolution it
 *    had just before.
 *
 * The fixtures are seeded, not random. A failure names its fixture index
 * and reproduces on every run. The draw order is part of each seed, so
 * reordering one `random()` call changes every fixture. Both tests set a
 * 60s timeout because vite.config.ts sets no testTimeout.
 *
 * The oracle must stay verbatim. From the repo root, this prints VERBATIM:
 *
 *   EXPECTED=$(git show fd9ff74:src/lib/utils/schedule.ts | sed -n '51,293p' \
 *     | sed -e 's/^export function getLocalDateString/function getLocalDateString/' \
 *           -e 's/ScheduleSlotStatus/LegacyScheduleSlotStatus/g' \
 *           -e 's/ScheduleSlot\[\]/LegacyScheduleSlot[]/g' \
 *           -e 's/computeScheduleSlots(/legacyComputeScheduleSlots(/')
 *   ACTUAL=$(sed -n '/VERBATIM-START/,/VERBATIM-END/p' \
 *     tests/unit/helpers/legacy-slot-matcher.ts | sed '1d;$d')
 *   [ "$EXPECTED" = "$ACTUAL" ] && echo VERBATIM || echo DIFFERS
 */
import { describe, it, expect } from "vitest";
import {
  computeScheduleSlots,
  dashboardWindow,
  matchMedicationSlots,
  projectFixedTimes,
  projectMedicationSlots,
  segmentsFor,
} from "$lib/utils/schedule";
import type { DashboardWindow, MatchDose, MatchedSlot } from "$lib/utils/schedule";
import { shiftDayKey, wallClockToInstant } from "$lib/utils/time";
import type { Medication, DoseLogWithMedication } from "$lib/types";
import type { MedicationSchedule } from "$lib/server/schedules";
import { legacyComputeScheduleSlots } from "./helpers/legacy-slot-matcher";

// ── Fixture builders (same shapes as tests/unit/schedule.test.ts) ──

function makeMed(overrides: Partial<Medication> = {}): Medication {
  return {
    id: "med-1",
    userId: "user-1",
    name: "TestMed",
    dosageAmount: "200",
    dosageUnit: "mg",
    form: "tablet",
    category: "pain",
    colour: "#6366f1",
    colourSecondary: null,
    pattern: "solid",
    notes: null,
    scheduleType: "scheduled",
    scheduleIntervalHours: "8",
    inventoryCount: null,
    inventoryAlertThreshold: null,
    notificationsEnabled: true,
    notifyOverdueEmail: null,
    notifyOverduePush: null,
    notifyLowInventoryEmail: null,
    notifyLowInventoryPush: null,
    notifyOffsetMinutes: 0,
    notifyRepeatEveryMinutes: null,
    notifyMaxRepeats: 3,
    sortOrder: 0,
    isArchived: false,
    archivedAt: null,
    startedAt: new Date("2026-01-01T00:00:00Z"),
    endedAt: null,
    lowInventoryEpisodeAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeFixedTimeSchedule(
  medicationId: string,
  timeOfDay: string,
  daysOfWeek: number[] | null = null,
  sortOrder = 0,
): MedicationSchedule {
  return {
    id: `sched-${medicationId}-${timeOfDay}`,
    medicationId,
    userId: "user-1",
    scheduleKind: "fixed_time",
    timeOfDay,
    intervalHours: null,
    daysOfWeek,
    sortOrder,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveTo: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function schedMap(schedules: MedicationSchedule[]): Map<string, MedicationSchedule[]> {
  const m = new Map<string, MedicationSchedule[]>();
  for (const s of schedules) {
    let arr = m.get(s.medicationId);
    if (!arr) {
      arr = [];
      m.set(s.medicationId, arr);
    }
    arr.push(s);
  }
  return m;
}

function makeDose(overrides: Partial<DoseLogWithMedication> = {}): DoseLogWithMedication {
  return {
    id: "dose-1",
    userId: "user-1",
    medicationId: "med-1",
    quantity: 1,
    takenAt: new Date("2026-04-16T08:00:00Z"),
    loggedAt: new Date("2026-04-16T08:00:00Z"),
    updatedAt: new Date("2026-04-16T08:00:00Z"),
    notes: null,
    sideEffects: null,
    status: "taken",
    medication: {
      name: "TestMed",
      dosageAmount: "200",
      dosageUnit: "mg",
      form: "tablet",
      colour: "#6366f1",
      colourSecondary: null,
      pattern: "solid",
    },
    ...overrides,
  };
}

// ── Seeded generation ──

const H = 60 * 60 * 1000;
const FIXTURES = 400;
const DIFFERENTIAL_SEED = 20260925;
const STABILITY_SEED = 20260926;

type Random = () => number;

/** mulberry32 — the generator walkthrough/demo-data.ts uses, inlined because that one is private. */
function mulberry32(seed: number): Random {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: Random, xs: readonly T[]): T {
  return xs[Math.floor(random() * xs.length)];
}

function int(random: Random, lo: number, hi: number): number {
  return lo + Math.floor(random() * (hi - lo + 1));
}

function hhmm(minuteOfDay: number): string {
  const h = String(Math.floor(minuteOfDay / 60)).padStart(2, "0");
  const m = String(minuteOfDay % 60).padStart(2, "0");
  return `${h}:${m}`;
}

const ZONES = [
  "UTC",
  "Europe/London",
  "America/New_York",
  "Pacific/Auckland",
  "Asia/Kolkata",
] as const;
// One ordinary day, plus every DST transition these zones have in 2026.
const DAYS = [
  "2026-04-16",
  "2026-03-29",
  "2026-10-25",
  "2026-11-01",
  "2026-03-08",
  "2026-04-05",
  "2026-09-27",
] as const;
// 30% of drawn schedule minutes fall in the first hour of the day. That
// makes tomorrow's first hour, which midnight stability depends on, common
// enough for the check to mean something.
const FIRST_HOUR_BIAS = 0.3;

function fixedTimeFixture(random: Random): {
  timezone: string;
  dayKey: string;
  schedules: MedicationSchedule[];
} {
  const timezone = pick(random, ZONES);
  const dayKey = pick(random, DAYS);
  const count = int(random, 1, 4);
  const minutes = new Set<number>();
  while (minutes.size < count) {
    minutes.add(random() < FIRST_HOUR_BIAS ? int(random, 0, 59) : int(random, 0, 1439));
  }
  const schedules = [...minutes]
    .sort((a, b) => a - b)
    .map((minute, index) =>
      makeFixedTimeSchedule(
        "med-1",
        hhmm(minute),
        random() < 0.2 ? [int(random, 0, 6)] : null,
        index,
      ),
    );
  return { timezone, dayKey, schedules };
}

// ── 1. Differential ──

describe("slot matching — differential against the shipped matcher", () => {
  it("keeps every resolution production made and adds only late ones", () => {
    let unchanged = 0;
    let late = 0;
    for (let i = 0; i < FIXTURES; i++) {
      const random = mulberry32(DIFFERENTIAL_SEED + i);
      const { timezone, dayKey, schedules } = fixedTimeFixture(random);
      const todayStart = wallClockToInstant(dayKey, "00:00", timezone);
      const end = wallClockToInstant(shiftDayKey(dayKey, 1), "00:00", timezone);
      const span = end.getTime() - todayStart.getTime();
      const now = new Date(todayStart.getTime() + Math.floor(random() * span));

      // The domain the two matchers can be compared over:
      // - no dose in [todayStart − 1h, todayStart) or at/after `end`
      // - no dose on a slot instant (slots are whole minutes; every dose
      //   is 1–59 seconds past a minute)
      // - no missed rows
      // - startedAt and effectiveFrom (2026-01-01) long before the window
      const doses: DoseLogWithMedication[] = [];
      const doseCount = int(random, 0, 6);
      for (let j = 0; j < doseCount; j++) {
        const yesterday = random() < 0.2;
        const base = yesterday
          ? todayStart.getTime() - 2 * H - Math.floor(random() * 22 * H)
          : todayStart.getTime() + Math.floor(random() * span);
        const takenAt = new Date(Math.floor(base / 60_000) * 60_000 + int(random, 1, 59) * 1000);
        const status = random() < 0.7 ? "taken" : "skipped";
        const quantity = status === "taken" ? int(random, 1, 3) : 1;
        doses.push(makeDose({ id: `dose-${j}`, takenAt, loggedAt: takenAt, status, quantity }));
      }

      const label = `fixture ${i} (${timezone} ${dayKey}, now ${now.toISOString()})`;
      const window = dashboardWindow(now, timezone);
      expect(window.todayStart, label).toEqual(todayStart);

      const next = computeScheduleSlots(
        [makeMed()],
        schedMap(schedules),
        doses,
        {},
        todayStart,
        end,
        timezone,
        now,
        { window },
      ).filter((s) => !s.isEarlier);
      const shipped = legacyComputeScheduleSlots(
        [makeMed()],
        schedMap(schedules),
        doses.filter((d) => d.takenAt.getTime() >= todayStart.getTime()),
        {},
        todayStart,
        end,
        timezone,
        now,
      );

      expect(
        next.map((s) => s.expectedTime),
        label,
      ).toEqual(shipped.map((s) => s.expectedTime));
      shipped.forEach((old, k) => {
        const slot = next[k];
        const where = `${label} slot ${old.expectedTime}`;
        if (old.status === "taken" || old.status === "skipped") {
          unchanged++;
          expect({ status: slot.status, matchedDoseId: slot.matchedDoseId }, where).toEqual({
            status: old.status,
            matchedDoseId: old.matchedDoseId,
          });
        } else if (old.status === "upcoming") {
          expect(slot.status, where).toBe("upcoming");
        } else if (slot.status === "overdue") {
          expect(slot.resolvedByDoseId, where).toBeNull();
        } else {
          late++;
          expect(["taken", "skipped"], where).toContain(slot.status);
          const by = doses.find((d) => d.id === slot.resolvedByDoseId);
          expect(by, where).toBeDefined();
          expect(by!.takenAt.getTime(), where).toBeGreaterThan(
            new Date(slot.expectedTime).getTime(),
          );
        }
      });
    }
    // Non-vacuity. The designing simulation saw 144 unchanged and 184 late.
    expect(unchanged).toBeGreaterThan(100);
    expect(late).toBeGreaterThan(100);
  }, 60_000);
});

// ── 2. Stability ──

function view(schedules: MedicationSchedule[], timezone: string, doses: MatchDose[], now: Date) {
  const window = dashboardWindow(now, timezone);
  const segments = segmentsFor(window);
  const fixedInstants = projectFixedTimes(schedules, segments, timezone);
  const projected = projectMedicationSlots({
    med: makeMed(),
    schedules,
    fixedInstants,
    lastTakenAt: null,
    segments,
  });
  return {
    window,
    slots: matchMedicationSlots(projected, doses, {
      now,
      segments,
      pass2Bound: window.visibleStart,
    }),
  };
}

/**
 * Visible: any slot of today's before `end`, or an outstanding Earlier slot
 * under twelve hours old.
 */
function isVisible(slot: MatchedSlot, window: DashboardWindow): boolean {
  const t = slot.expectedTime.getTime();
  if (t >= window.end.getTime()) return false;
  if (t >= window.todayStart.getTime()) return true;
  return slot.status === "overdue" && t >= window.visibleStart.getTime();
}

function resolution(slot: MatchedSlot): string {
  return slot.status === "taken" || slot.status === "skipped"
    ? `${slot.status}:${slot.resolvedByDoseId}`
    : "open";
}

function randomDoses(
  random: Random,
  timezone: string,
  dayKey: string,
  schedules: MedicationSchedule[],
  from: Date,
  to: Date,
  prefix: string,
): MatchDose[] {
  const out: MatchDose[] = [];
  const count = int(random, 0, 6);
  for (let j = 0; j < count; j++) {
    let takenAt: Date | undefined;
    const roll = random();
    if (roll < 0.3) {
      // Exactly on one of the day's slot instants: exercises pass 0 and reserved skips.
      const onSlot = wallClockToInstant(dayKey, pick(random, schedules).timeOfDay!, timezone);
      if (onSlot.getTime() >= from.getTime() && onSlot.getTime() <= to.getTime()) takenAt = onSlot;
    } else if (roll < 0.6) {
      // The two hours before `to`, where tomorrow's first hour competes for doses.
      const lo = Math.max(from.getTime(), to.getTime() - 2 * H);
      takenAt = new Date(lo + Math.floor(random() * (to.getTime() - lo + 1)));
    }
    if (!takenAt) {
      takenAt = new Date(
        from.getTime() + Math.floor(random() * (to.getTime() - from.getTime() + 1)),
      );
    }
    const status = random() < 0.7 ? "taken" : "skipped";
    out.push({
      id: `${prefix}-${j}`,
      takenAt,
      status,
      quantity: status === "taken" ? int(random, 1, 3) : 1,
    });
  }
  return out;
}

function compareViews(
  schedules: MedicationSchedule[],
  timezone: string,
  doses: MatchDose[],
  earlier: Date,
  later: Date,
  label: string,
): { compared: number; earlierRows: number } {
  const before = view(schedules, timezone, doses, earlier);
  const after = view(schedules, timezone, doses, later);
  const beforeByInstant = new Map(before.slots.map((s) => [s.expectedTime.getTime(), s]));
  let compared = 0;
  let earlierRows = 0;
  for (const slot of after.slots) {
    if (!isVisible(slot, after.window)) continue;
    const where = `${label} slot ${slot.expectedTime.toISOString()}`;
    const was = beforeByInstant.get(slot.expectedTime.getTime());
    if (!was) {
      // Only a slot beyond the earlier view's projection may be new.
      expect(slot.expectedTime.getTime(), where).toBeGreaterThanOrEqual(
        before.window.projectEnd.getTime(),
      );
      continue;
    }
    expect(resolution(slot), where).toBe(resolution(was));
    compared++;
    if (slot.expectedTime.getTime() < after.window.todayStart.getTime()) earlierRows++;
  }
  return { compared, earlierRows };
}

describe("slot matching — stability across midnight and noon", () => {
  it("every slot visible just after midnight or noon had the same resolution just before", () => {
    let comparedAtMidnight = 0;
    let earlierRowsAtMidnight = 0;
    let comparedAtNoon = 0;
    for (let i = 0; i < FIXTURES; i++) {
      const random = mulberry32(STABILITY_SEED + i);
      const { timezone, dayKey, schedules } = fixedTimeFixture(random);
      const nextKey = shiftDayKey(dayKey, 1);
      const dayStart = wallClockToInstant(dayKey, "00:00", timezone);
      const beforeMidnight = wallClockToInstant(dayKey, "23:59", timezone);
      const afterMidnight = wallClockToInstant(nextKey, "00:01", timezone);
      const beforeNoon = wallClockToInstant(nextKey, "11:59", timezone);
      const afterNoon = wallClockToInstant(nextKey, "12:01", timezone);

      // Midnight uses only day-D doses, all at or before 23:59, so no dose
      // happens between the two views. Noon adds D+1 doses up to 11:59
      // for the same reason.
      const dayDoses = randomDoses(
        random,
        timezone,
        dayKey,
        schedules,
        dayStart,
        beforeMidnight,
        "d",
      );
      const morningDoses = randomDoses(
        random,
        timezone,
        nextKey,
        schedules,
        wallClockToInstant(nextKey, "00:00", timezone),
        beforeNoon,
        "m",
      );

      const fixture = `fixture ${i} (${timezone} ${dayKey})`;
      const midnight = compareViews(
        schedules,
        timezone,
        dayDoses,
        beforeMidnight,
        afterMidnight,
        `${fixture} midnight`,
      );
      const noon = compareViews(
        schedules,
        timezone,
        [...dayDoses, ...morningDoses],
        beforeNoon,
        afterNoon,
        `${fixture} noon`,
      );
      comparedAtMidnight += midnight.compared;
      earlierRowsAtMidnight += midnight.earlierRows;
      comparedAtNoon += noon.compared;
    }
    // Non-vacuity. The designing simulation saw 344 / 78 / 807.
    expect(comparedAtMidnight).toBeGreaterThan(200);
    expect(earlierRowsAtMidnight).toBeGreaterThan(40);
    expect(comparedAtNoon).toBeGreaterThan(500);
  }, 60_000);
});
