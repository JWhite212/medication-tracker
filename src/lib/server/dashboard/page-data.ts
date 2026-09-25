import type {
  DashboardPageData,
  DashboardStatus,
  DoneRow,
  DoseLogWithMedication,
  DueCard,
  DueRow,
  LaterRow,
  Medication,
} from "$lib/types";
import type { MedicationSchedule } from "$lib/server/schedules";
import {
  CARRY_OVER_MS,
  LOG_NOW_COOLDOWN_MS,
  MATCH_TOLERANCE_MS,
  dashboardWindow,
  isVisibleSlot,
  matchMedicationSlots,
  projectFixedTimes,
  projectMedicationSlots,
  segmentsFor,
  slotActions,
  type DashboardWindow,
  type MatchDose,
  type MatchedSlot,
} from "$lib/utils/schedule";

/**
 * The dashboard's composition: everything the page shows, built from data
 * already fetched. `load.ts` is the I/O; nothing here touches the database,
 * so every rule the page renders is testable from plain fixtures — the
 * `analytics/page-data.ts` precedent.
 *
 * It owns no matching rule. The window, both clips, passes 0–2 and which
 * buttons a row offers belong to `utils/schedule.ts`; this module sorts
 * their answers into the page's sections and adds exactly one presentation
 * rule (Took it at is not shown beside Log now on a due-now row).
 */

/** A refresh timer is never armed for less than this. */
const MIN_REFRESH_DELAY_MS = 5_000;

export type DashboardCompositionInputs = {
  /** Active medications, in `sortOrder` — also the chip list. */
  medications: Medication[];
  /**
   * Every schedule row the user has. Only `medications`' rows are read, so an
   * archived medication's schedule never reaches the page.
   */
  schedulesByMedId: Map<string, MedicationSchedule[]>;
  /** `getDosesInRange` over `dashboardWindow`'s `doseFetchFrom` / `doseFetchTo`. */
  doses: DoseLogWithMedication[];
  /** `getLastDosePerMedication` — all-time, so an interval row anchors on a dose older than the fetch. */
  lastDoses: Array<{ medicationId: string; lastTakenAt: Date | null; lastEventAt: Date }>;
  /** One instant for the whole request. */
  now: Date;
  timezone: string;
};

/**
 * The earliest instant after `now` at which the page would change without a
 * write: a row changes group, a button appears or disappears, or an Earlier
 * row expires. Clamped to at least `now + 5s`. Status, rows and buttons
 * change only through the load, so the client reloads at this instant rather
 * than recomputing anything itself.
 */
export function computeNextRefreshAt(input: {
  now: Date;
  window: DashboardWindow;
  slots: readonly MatchedSlot[];
  doses: ReadonlyArray<Pick<DoseLogWithMedication, "status" | "takenAt">>;
}): Date {
  const { now, window, slots, doses } = input;
  const nowMs = now.getTime();
  // `end` is always after `now`, so the minimum below is always finite.
  const candidates: number[] = [window.end.getTime()];

  for (const slot of slots) {
    const t = slot.expectedTime.getTime();
    if (slot.segment === "tomorrow") {
      // From here a dose logged now can land on it in pass 1.
      candidates.push(t - MATCH_TOLERANCE_MS);
      continue;
    }
    if (!isVisibleSlot(slot, window)) continue;
    // Enters due-now, reaches its time, leaves due-now.
    candidates.push(t - MATCH_TOLERANCE_MS, t, t + MATCH_TOLERANCE_MS);
    // An Earlier row disappears at exactly twelve hours old.
    if (t < window.todayStart.getTime()) candidates.push(t + CARRY_OVER_MS);
  }

  for (const dose of doses) {
    const t = dose.takenAt.getTime();
    // A future-dated dose starts counting when its time arrives.
    if (t > nowMs) candidates.push(t);
    // Log now returns when the one-hour cooldown ends.
    else if (dose.status === "taken" && t > nowMs - LOG_NOW_COOLDOWN_MS) {
      candidates.push(t + LOG_NOW_COOLDOWN_MS);
    }
  }

  const next = Math.min(...candidates.filter((c) => c > nowMs));
  return new Date(Math.max(next, nowMs + MIN_REFRESH_DELAY_MS));
}

const MINUTE_MS = 60_000;

type DisplayState = DueRow["state"] | "later";

/** Sort key shared by cards and Later rows: time, then the user's order, then arrival. */
type Placed<T> = { value: T; at: number; sortOrder: number; index: number };

function byPlacement<T>(a: Placed<T>, b: Placed<T>): number {
  return a.at - b.at || a.sortOrder - b.sortOrder || a.index - b.index;
}

function isResolved(slot: MatchedSlot): boolean {
  return slot.status === "taken" || slot.status === "skipped";
}

/** A row that projects slots. PRN rows never do. */
function isTimed(schedule: MedicationSchedule): boolean {
  return schedule.scheduleKind === "interval" || schedule.scheduleKind === "fixed_time";
}

/**
 * Where an outstanding visible slot goes: Earlier if before today's
 * midnight; due-now within ±1h of now, inclusive; overdue further past;
 * Later further ahead. Null for a slot the page does not list.
 */
function displayStateOf(
  slot: MatchedSlot,
  window: DashboardWindow,
  now: Date,
): DisplayState | null {
  if (!isVisibleSlot(slot, window) || isResolved(slot)) return null;
  const t = slot.expectedTime.getTime();
  if (t < window.todayStart.getTime()) return "earlier";
  const ahead = t - now.getTime();
  if (Math.abs(ahead) <= MATCH_TOLERANCE_MS) return "due-now";
  return ahead < 0 ? "overdue" : "later";
}

/**
 * One card per medication per sub-group. Its top row is the Log-now target
 * when this sub-group holds it, else the latest outstanding row; the rest
 * nest below, latest first.
 */
function placeCard(
  subGroup: "earlier" | "today",
  med: Medication,
  index: number,
  rows: DueRow[],
): Placed<DueCard> {
  const latestFirst = [...rows].sort(
    (a, b) => Date.parse(b.expectedTime) - Date.parse(a.expectedTime),
  );
  const top = latestFirst.find((row) => row.logNow) ?? latestFirst[0];
  const card: DueCard = {
    key: `${subGroup}:${med.id}`,
    medicationId: med.id,
    name: med.name,
    dosageAmount: med.dosageAmount,
    dosageUnit: med.dosageUnit,
    colour: med.colour,
    colourSecondary: med.colourSecondary,
    pattern: med.pattern,
    rows: [top, ...latestFirst.filter((row) => row !== top)],
  };
  return { value: card, at: Date.parse(top.expectedTime), sortOrder: med.sortOrder, index };
}

/**
 * Done: today's doses, plus doses logged today for before midnight (a
 * backdated Took it at on an Earlier row, which must stay reachable to
 * undo), oldest first. `covers` reads `resolvedByDoseId` only — a missed
 * row resolves nothing.
 */
function buildDoneRows(
  doses: DoseLogWithMedication[],
  slots: readonly MatchedSlot[],
  window: DashboardWindow,
): DoneRow[] {
  const todayStartMs = window.todayStart.getTime();
  const endMs = window.end.getTime();
  const projectStartMs = window.projectStart.getTime();

  const takenAtById = new Map(doses.map((d) => [d.id, d.takenAt.getTime()]));
  const covers = new Map<string, number[]>();
  for (const slot of slots) {
    // Tomorrow's first hour is matched so that today's choices hold at
    // midnight, but it is never shown, counted or credited.
    if (slot.segment === "tomorrow" || slot.resolvedByDoseId === null) continue;
    const takenAt = takenAtById.get(slot.resolvedByDoseId);
    if (takenAt === undefined) continue;
    const t = slot.expectedTime.getTime();
    // A dose at its own slot's minute adds nothing its time column doesn't say.
    if (Math.floor(t / MINUTE_MS) === Math.floor(takenAt / MINUTE_MS)) continue;
    covers.set(slot.resolvedByDoseId, [...(covers.get(slot.resolvedByDoseId) ?? []), t]);
  }

  return doses
    .filter((d) => {
      const t = d.takenAt.getTime();
      if (t >= todayStartMs && t < endMs) return true;
      // Bounded below by projectStart so "yesterday" is true of every row it labels.
      return d.loggedAt.getTime() >= todayStartMs && t < todayStartMs && t >= projectStartMs;
    })
    .sort(
      (a, b) =>
        a.takenAt.getTime() - b.takenAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .map(
      (d): DoneRow => ({
        key: d.id,
        dose: d,
        covers: (covers.get(d.id) ?? [])
          .sort((x, y) => x - y)
          .map((t) => new Date(t).toISOString()),
        dayLabel: d.takenAt.getTime() < todayStartMs ? "yesterday" : null,
      }),
    );
}

/**
 * The header's kind and counts. First match wins: as-needed-only, due,
 * caught-up, all-done, none-today.
 */
function headerStatus(input: {
  anyTimed: boolean;
  earlier: DueCard[];
  today: DueCard[];
  later: LaterRow[];
  done: DoneRow[];
  doneToday: number;
  totalToday: number;
}): DashboardStatus {
  const dueCount = [...input.earlier, ...input.today].reduce((n, card) => n + card.rows.length, 0);
  const loggedToday = input.done.filter((row) => row.dose.status === "taken").length;
  const counts = {
    dueCount,
    doneToday: input.doneToday,
    totalToday: input.totalToday,
    loggedToday,
  };

  if (!input.anyTimed) return { kind: "as-needed-only", ...counts, next: null };
  if (dueCount > 0) return { kind: "due", ...counts, next: null };
  // With Due empty, today's unresolved slots ahead of now are exactly Later.
  const first = input.later[0];
  if (first) {
    return {
      kind: "caught-up",
      ...counts,
      next: {
        name: first.name,
        dosageAmount: first.dosageAmount,
        dosageUnit: first.dosageUnit,
        expectedTime: first.expectedTime,
        alsoCount: input.later.filter((row) => row.expectedTime === first.expectedTime).length - 1,
      },
    };
  }
  if (input.totalToday > 0 && input.doneToday === input.totalToday) {
    return { kind: "all-done", ...counts, next: null };
  }
  return { kind: "none-today", ...counts, next: null };
}

/** Build the dashboard payload (everything but `refillForecast`) from already-fetched data. */
export function composeDashboardPageData(
  input: DashboardCompositionInputs,
): Omit<DashboardPageData, "refillForecast"> {
  const { medications, schedulesByMedId, doses, lastDoses, now, timezone } = input;
  const window = dashboardWindow(now, timezone);
  const segments = segmentsFor(window);

  const lastTakenByMed = new Map(lastDoses.map((d) => [d.medicationId, d.lastTakenAt]));
  const dosesByMed = new Map<string, MatchDose[]>();
  for (const d of doses) {
    const list = dosesByMed.get(d.medicationId) ?? [];
    list.push({ id: d.id, takenAt: d.takenAt, status: d.status, quantity: d.quantity });
    dosesByMed.set(d.medicationId, list);
  }

  const allSlots: MatchedSlot[] = [];
  const earlierCards: Placed<DueCard>[] = [];
  const todayCards: Placed<DueCard>[] = [];
  const laterRows: Placed<LaterRow>[] = [];
  let anyTimed = false;
  let totalToday = 0;
  let doneToday = 0;

  for (const [index, med] of medications.entries()) {
    const schedules = schedulesByMedId.get(med.id) ?? [];
    if (!schedules.some(isTimed)) continue;
    anyTimed = true;

    // The only projection step that touches Intl: computed once here and
    // handed to every simulation slotActions runs.
    const fixedInstants = projectFixedTimes(schedules, segments, timezone);
    const lastTakenAt = lastTakenByMed.get(med.id) ?? null;
    const medDoses = dosesByMed.get(med.id) ?? [];
    const slots = matchMedicationSlots(
      projectMedicationSlots({ med, schedules, fixedInstants, lastTakenAt, segments }),
      medDoses,
      { now, segments, pass2Bound: window.visibleStart },
    );
    const actions = slotActions({
      med,
      schedules,
      fixedInstants,
      doses: medDoses,
      lastTakenAt,
      window,
    });
    allSlots.push(...slots);

    const earlierRows: DueRow[] = [];
    const todayRows: DueRow[] = [];
    for (const slot of slots) {
      if (slot.segment === "today") {
        totalToday += 1;
        if (isResolved(slot)) doneToday += 1;
      }

      const state = displayStateOf(slot, window, now);
      if (state === null) continue;
      const expectedTime = slot.expectedTime.toISOString();
      const key = `${med.id}:${expectedTime}`;

      if (state === "later") {
        laterRows.push({
          value: {
            key,
            medicationId: med.id,
            name: med.name,
            dosageAmount: med.dosageAmount,
            dosageUnit: med.dosageUnit,
            colour: med.colour,
            colourSecondary: med.colourSecondary,
            pattern: med.pattern,
            expectedTime,
          },
          at: slot.expectedTime.getTime(),
          sortOrder: med.sortOrder,
          index,
        });
        continue;
      }

      const logNow = actions.logNowTarget === expectedTime;
      const offered = actions.rows.get(expectedTime);
      (state === "earlier" ? earlierRows : todayRows).push({
        key,
        kind: slot.kind,
        expectedTime,
        state,
        logNow,
        // The one presentation rule on top of the simulations: a due-now row
        // showing Log now does not also show Took it at, because both would
        // resolve the same row.
        tookItAt: state === "due-now" && logNow ? null : (offered?.tookItAt ?? null),
        skipAt: offered?.skipAt ?? null,
      });
    }

    if (earlierRows.length > 0) earlierCards.push(placeCard("earlier", med, index, earlierRows));
    if (todayRows.length > 0) todayCards.push(placeCard("today", med, index, todayRows));
  }

  const earlier = earlierCards.sort(byPlacement).map((p) => p.value);
  const today = todayCards.sort(byPlacement).map((p) => p.value);
  const later = laterRows.sort(byPlacement).map((p) => p.value);
  const done = buildDoneRows(doses, allSlots, window);

  return {
    now: now.toISOString(),
    nextRefreshAt: computeNextRefreshAt({ now, window, slots: allSlots, doses }).toISOString(),
    timezone,
    todayStart: window.todayStart.toISOString(),
    status: headerStatus({ anyTimed, earlier, today, later, done, doneToday, totalToday }),
    earlier,
    today,
    done,
    later,
    medications,
  };
}
