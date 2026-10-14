// @vitest-environment node
//
// The walkthrough's demo facts against the one dose list (`DEMO_DOSES`) and
// against the real code that computes each fact in the app. The scenes'
// strings stay hand-written where the spec keeps them so, and this file is
// what stops them drifting from the instants and the analytics fold.
//
// `node` is load-bearing: the suite default is jsdom, under which `render()`
// from `svelte/server` throws before an assertion runs (see
// tests/unit/error-page-ssr.test.ts).
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { render } from "svelte/server";

// analytics.ts imports `db` for its queries; this file calls only its pure
// `expectedPerDayForSchedules`. unusedDb THROWS on any access, so an
// accidental query fails loudly. Do not "upgrade" it to createFakeDb().
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).unusedDb);

import { expectedPerDayForSchedules } from "$lib/server/analytics";
import { clampEffectiveDays } from "$lib/server/analytics/lifecycle";
import {
  foldDoseStatusBreakdown,
  type MedicationStatusCounts,
} from "$lib/server/analytics/status-breakdown";
import type { MedicationSchedule } from "$lib/server/schedules";
import {
  formatTimeSince,
  formatUserDate,
  formatUserTime,
  isoDayKey,
  shiftDayKey,
} from "$lib/utils/time";
import {
  DEMO_DOSES,
  DEMO_STARTED_AT,
  DESKTOP_NOW,
  HISTORY,
  LOGGED_DOSE,
  LOG_ALL,
  MEDICATIONS,
  PHONE_NOW,
  SESSION_EXPIRIES,
  STATUS_BREAKDOWN,
  WALKTHROUGH_TZ,
  storyClock,
  type DemoDose,
  type DemoMedication,
} from "$lib/components/walkthrough/demo-data";
import AnalyticsScene from "$lib/components/walkthrough/scenes/AnalyticsScene.svelte";
import SecurityScene from "$lib/components/walkthrough/scenes/SecurityScene.svelte";
import StatusBreakdownBar from "$lib/components/StatusBreakdownBar.svelte";
import { ssrDocument } from "./helpers/axe-ssr";
import { textOf } from "./helpers/dom-names";

/** A medication's DemoSchedule as the medication_schedules rows seed-demo.ts writes. */
function scheduleRows(m: DemoMedication): MedicationSchedule[] {
  const base = {
    medicationId: m.id,
    userId: "demo",
    daysOfWeek: null,
    effectiveFrom: DEMO_STARTED_AT,
    effectiveTo: null,
    createdAt: DEMO_STARTED_AT,
  };
  if (m.schedule.kind === "interval") {
    return [
      {
        ...base,
        id: `${m.id}-0`,
        scheduleKind: "interval",
        timeOfDay: null,
        intervalHours: m.schedule.intervalHours,
        sortOrder: 0,
      },
    ];
  }
  return m.schedule.timesOfDay.map(
    (timeOfDay, i): MedicationSchedule => ({
      ...base,
      id: `${m.id}-${i}`,
      scheduleKind: "fixed_time",
      timeOfDay,
      intervalHours: null,
      sortOrder: i,
    }),
  );
}

/** The Dose Status Breakdown card under its title: the bar's segments, then the legend. */
function breakdownOf(doc: Document) {
  const title = [...doc.querySelectorAll("h2, p")].find(
    (el) => textOf(el) === "Dose Status Breakdown",
  );
  if (!title?.nextElementSibling) throw new Error("no Dose Status Breakdown card");
  const [bar, legend] = title.nextElementSibling.children;
  return {
    segments: [...bar.children].map((el) => ({
      fill: [...el.classList].find((c) => c.startsWith("bg-")),
      width: (el as HTMLElement).style.width,
    })),
    legend: [...legend.children].map(textOf),
  };
}

describe("DEMO_DOSES", () => {
  it("ids each dose dose-<med>-<yyyymmdd>-<hhmm> from its own instant, uniquely", () => {
    for (const dose of DEMO_DOSES) {
      const iso = dose.takenAt.toISOString();
      const stamp = `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 16).replace(":", "")}`;
      expect(dose.id).toBe(`dose-${dose.medicationId}-${stamp}`);
    }
    expect(new Set(DEMO_DOSES.map((d) => d.id)).size).toBe(DEMO_DOSES.length);
  });

  it("holds the dose each log beat writes, at that beat's story clock", () => {
    const byId = new Map(DEMO_DOSES.map((d) => [d.id, d]));
    expect(byId.get(LOGGED_DOSE.desktop)).toEqual({
      id: LOGGED_DOSE.desktop,
      medicationId: "lis",
      takenAt: DESKTOP_NOW,
      quantity: 1,
      status: "taken",
    });
    expect(byId.get(LOGGED_DOSE.phone)).toEqual({
      id: LOGGED_DOSE.phone,
      medicationId: "vitd",
      takenAt: PHONE_NOW,
      quantity: 1,
      status: "taken",
    });
  });
});

describe("the demo medications' schedules", () => {
  it("are the schedules scripts/seed-demo.ts seeds, medication by medication", () => {
    const seed = readFileSync(
      fileURLToPath(new URL("../../scripts/seed-demo.ts", import.meta.url)),
      "utf8",
    );
    // Each SEED_MEDS entry's `name: "…"` and the `schedule: { … }` literal
    // after it, with the literal's bare keys quoted so JSON can read it.
    const seeded = [...seed.matchAll(/name: "([^"]+)",[\s\S]*?schedule: (\{[^}]*\})/g)].map(
      ([, name, literal]) => ({
        name,
        schedule: JSON.parse(literal.replace(/([{,]\s*)(\w+):/g, '$1"$2":')),
      }),
    );
    expect(seeded).toEqual(MEDICATIONS.map((m) => ({ name: m.name, schedule: m.schedule })));
  });

  it("expect perDay doses a day, by the analytics denominator's own rule", () => {
    for (const m of MEDICATIONS) {
      expect(expectedPerDayForSchedules(scheduleRows(m)), m.id).toBe(m.perDay);
    }
  });
});

describe("the History scene", () => {
  it("lists DEMO_DOSES up to DESKTOP_NOW by day, newest first, as /log groups them", () => {
    // /log orders by takenAt descending, groups by day key in the user's
    // zone, and names today's and yesterday's keys.
    const todayKey = isoDayKey(DESKTOP_NOW, WALKTHROUGH_TZ);
    const yesterdayKey = shiftDayKey(todayKey, -1);
    const groups = new Map<string, DemoDose[]>();
    const logged = DEMO_DOSES.filter((d) => d.takenAt.getTime() <= DESKTOP_NOW.getTime()).sort(
      (a, b) => b.takenAt.getTime() - a.takenAt.getTime(),
    );
    for (const dose of logged) {
      const key = isoDayKey(dose.takenAt, WALKTHROUGH_TZ);
      groups.set(key, [...(groups.get(key) ?? []), dose]);
    }
    const expected = [...groups].map(([key, doses]) => ({
      label: key === todayKey ? "Today" : key === yesterdayKey ? "Yesterday" : key,
      doses: doses.map((d) => ({
        id: d.medicationId,
        time: formatUserTime(d.takenAt, WALKTHROUGH_TZ, "24h"),
        since: formatTimeSince(d.takenAt, DESKTOP_NOW),
      })),
    }));

    const shown = LOG_ALL.map((group) => ({
      label: group.label,
      doses: group.doses.map((d) => ({
        id: d.id,
        time: storyClock(d.time, "24h"),
        since: d.since,
      })),
    }));
    expect(shown).toEqual(expected);
  });
});

describe("the Medications scene", () => {
  it("times each medication's last taken dose as formatTimeSince does, at DESKTOP_NOW and a minute on", () => {
    const aMinuteOn = new Date(DESKTOP_NOW.getTime() + 60_000);
    for (const m of MEDICATIONS) {
      const taken = DEMO_DOSES.filter(
        (d) =>
          d.medicationId === m.id &&
          d.status === "taken" &&
          d.takenAt.getTime() <= DESKTOP_NOW.getTime(),
      );
      expect(taken.length, m.id).toBeGreaterThan(0);
      const latest = new Date(Math.max(...taken.map((d) => d.takenAt.getTime())));
      expect(m.lastTaken, m.id).toBe(formatTimeSince(latest, DESKTOP_NOW));
      expect(m.lastTakenNext, m.id).toBe(formatTimeSince(latest, aMinuteOn));
    }
  });
});

describe("the Security scene", () => {
  it("prints each session's expiry through formatUserDate, current session first", () => {
    expect(SESSION_EXPIRIES.length).toBeGreaterThan(0);
    const doc = ssrDocument(render(SecurityScene).body);
    const expiries = [...doc.querySelectorAll("p")]
      .map(textOf)
      .filter((text) => text.startsWith("Expires "));
    expect(expiries).toEqual(
      SESSION_EXPIRIES.map((d) => `Expires ${formatUserDate(d, WALKTHROUGH_TZ, "DD/MM/YYYY")}`),
    );
  });
});

describe("the Analytics scene's Dose Status Breakdown", () => {
  it("is the real per-medication fold over the demo history", () => {
    // getPerMedicationStats' default window for `days = 90`, read at DESKTOP_NOW.
    const windowFrom = new Date(DESKTOP_NOW.getTime() - 90 * 86_400_000);
    const counts: MedicationStatusCounts[] = MEDICATIONS.map((m, i) => {
      const { taken } = HISTORY.perMedication[i];
      // getPerMedicationStats' expectation: the schedule's daily rate times
      // the whole days of the window the medication's lifecycle covers.
      const days = clampEffectiveDays(windowFrom, DESKTOP_NOW, DEMO_STARTED_AT, null);
      const expectedTotal = Math.round(expectedPerDayForSchedules(scheduleRows(m)) * days);
      return { takenEvents: taken, takenQuantity: taken, skippedEvents: 0, expectedTotal };
    });
    const real = foldDoseStatusBreakdown(counts);
    expect(STATUS_BREAKDOWN).toEqual({
      takenEvents: real.takenEvents,
      skippedEvents: real.skippedEvents,
      missedEvents: real.missedEvents,
      expectedTotal: real.expectedTotal,
      adherencePercent: real.adherencePercent,
    });
  });

  // Pinned as well as derived. STATUS_BREAKDOWN is a literal in demo-data.ts,
  // and the test above makes a new seed or draw order fail until that literal
  // is re-typed to the new fold. This one then fails too, so the change to the
  // numbers the spec quotes is made twice, on purpose, and cannot go unseen.
  it("shows the totals the seed decides", () => {
    expect(STATUS_BREAKDOWN).toEqual({
      takenEvents: 602,
      skippedEvents: 0,
      missedEvents: 118,
      expectedTotal: 720,
      adherencePercent: 83.6,
    });
  });

  it("draws the bar and legend the real StatusBreakdownBar draws for the same counts", () => {
    const { takenEvents, skippedEvents, missedEvents, expectedTotal } = STATUS_BREAKDOWN;
    const real = breakdownOf(
      ssrDocument(
        render(StatusBreakdownBar, {
          props: { takenEvents, skippedEvents, missedEvents, expectedTotal },
        }).body,
      ),
    );
    const scene = breakdownOf(
      ssrDocument(render(AnalyticsScene, { props: { load: 10, heat: 1 } }).body),
    );
    expect(real.segments.length).toBeGreaterThan(0);
    expect(scene).toEqual(real);
  });
});
