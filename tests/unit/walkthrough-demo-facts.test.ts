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
import { createRawSnippet } from "svelte";
import { render } from "svelte/server";

// analytics.ts imports `db` for its queries; this file calls only its pure
// `expectedPerDayForSchedules`. unusedDb THROWS on any access, so an
// accidental query fails loudly. Do not "upgrade" it to createFakeDb().
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).unusedDb);

import { expectedPerDayForSchedules } from "$lib/server/analytics";
import {
  composeAnalyticsPageData,
  resolveAnalyticsQuery,
  type AnalyticsCompositionInputs,
} from "$lib/server/analytics/page-data";
import { clampEffectiveDays } from "$lib/server/analytics/lifecycle";
import {
  foldDoseStatusBreakdown,
  type MedicationStatusCounts,
} from "$lib/server/analytics/status-breakdown";
import { classifyRefillSeverity } from "$lib/server/inventory";
import type { RefillForecastEntry, RefillSeverity } from "$lib/types";
import { toneClass, toneOf } from "$lib/utils/status-tone";
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
  LOG_WITH_SIDE_EFFECTS,
  MEDICATIONS,
  PHONE_NOW,
  SESSION_EXPIRIES,
  STATUS_BREAKDOWN,
  WALKTHROUGH_TZ,
  storyClock,
  type DemoDose,
  type DemoMedication,
} from "$lib/components/walkthrough/demo-data";
import { STAGE_REFILLS } from "$lib/components/walkthrough/stage-dashboard";
import { stageButton, stageToggle } from "$lib/components/walkthrough/parts/stage-controls";
import StageRefills from "$lib/components/walkthrough/parts/dashboard/StageRefills.svelte";
import AnalyticsScene from "$lib/components/walkthrough/scenes/AnalyticsScene.svelte";
import DataScene from "$lib/components/walkthrough/scenes/DataScene.svelte";
import HistoryScene from "$lib/components/walkthrough/scenes/HistoryScene.svelte";
import MedicationsScene from "$lib/components/walkthrough/scenes/MedicationsScene.svelte";
import SecurityScene from "$lib/components/walkthrough/scenes/SecurityScene.svelte";
import RefillsCard, { refillChip } from "$lib/components/RefillsCard.svelte";
import StatusBreakdownBar from "$lib/components/StatusBreakdownBar.svelte";
import Button from "$lib/components/ui/Button.svelte";
import Toggle from "$lib/components/ui/Toggle.svelte";
import { ssrDocument } from "./helpers/axe-ssr";
import { textOf } from "./helpers/dom-names";
import { STATUS_TOKEN } from "./helpers/status-token";

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
    // The dot's fill as well as the words: STATUS_BREAKDOWN.skippedEvents is 0,
    // so no skipped segment is ever drawn and the legend is where its colour
    // shows.
    legend: [...legend.children].map((el) => ({
      dot: [...(el.querySelector("span")?.classList ?? [])].find((c) => c.startsWith("bg-")),
      text: textOf(el),
    })),
  };
}

const LABEL = createRawSnippet(() => ({ render: () => "<span>Label</span>" }));
/** Class tokens at rest: no variant-prefixed or transition token, sorted. */
const resting = (el: Element) =>
  [...el.classList].filter((t) => !t.includes(":") && !t.startsWith("transition")).sort();
const split = (classes: string) => classes.split(/\s+/).filter(Boolean).sort();
const first = (body: string) => ssrDocument(body).querySelector("main > *")!;
// STATUS_TOKEN is global: read it with .match, never .test (lastIndex sticks).
const statusTokens = (root: Element) =>
  [root, ...root.querySelectorAll("*")].flatMap((el) =>
    [...el.classList].filter((t) => t.match(STATUS_TOKEN) !== null),
  );
/** The one drawn element whose own text is `label`: the innermost span or div that reads it (HistoryScene draws divs). */
function drawnControl(body: string, label: string): Element {
  const found = [...ssrDocument(body).querySelectorAll("span, div")].filter(
    (el) => textOf(el) === label && ![...el.children].some((c) => textOf(c) === label),
  );
  expect(found, label).toHaveLength(1);
  return found[0];
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

describe("the History scene's side effects", () => {
  it("gives the side effect the severity scripts/seed-demo.ts seeds", () => {
    const seed = readFileSync(
      fileURLToPath(new URL("../../scripts/seed-demo.ts", import.meta.url)),
      "utf8",
    );
    const [, name, severity] = seed.match(/\{ name: "([^"]+)", severity: "(\w+)" as const \}/)!;
    for (const list of [LOG_ALL, LOG_WITH_SIDE_EFFECTS]) {
      const shown = list.flatMap((group) => group.doses).filter((d) => d.sideEffect !== undefined);
      expect(shown.length).toBeGreaterThan(0);
      for (const dose of shown) expect(dose.sideEffect).toEqual({ name, severity });
    }
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

describe("the Security scene's state chip", () => {
  it("draws the 2FA state as T8's neutral chip", () => {
    const enabled = drawnControl(render(SecurityScene).body, "Enabled");
    expect(resting(enabled)).toEqual(
      expect.arrayContaining(
        split(`${toneClass(toneOf("state"), "chip")} rounded-md px-2 py-0.5 text-xs font-semibold`),
      ),
    );
    expect(statusTokens(enabled)).toEqual([]);
  });
});

describe("the Analytics scene's stat cards", () => {
  it("draws the stat cards with no status or accent colour, as the page does", () => {
    const doc = ssrDocument(render(AnalyticsScene, { props: { load: 10, heat: 1 } }).body);
    const grid = doc.querySelector(".grid.grid-cols-3")!;
    expect(statusTokens(grid)).toEqual([]);
    expect(grid.innerHTML.match(STATUS_TOKEN)).toBeNull();
    expect(grid.innerHTML).not.toMatch(/color:\s*var\(--color-accent-ink\)/);
    for (const t of ["↑3%", "↑2%"]) {
      expect([...drawnControl(grid.outerHTML, t).classList], t).toContain("text-text-secondary");
    }
    expect(
      [...grid.querySelectorAll("svg")].map((s) =>
        [...s.parentElement!.classList].includes("text-text-secondary"),
      ),
    ).toEqual([true, true]);
    const perMedication = [...doc.querySelectorAll("p")].find(
      (p) => textOf(p) === "Per-Medication Adherence (90 days)",
    )!.parentElement!;
    expect(statusTokens(perMedication)).toEqual([]);
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

// The scene highlights the 90d preset. On the real page a preset button's
// setPeriod drops `from` and `to` from the URL, and the From/To inputs show
// only what the payload echoes back, so under a preset they are empty. The
// scene once filled them with a 90-day span, a state the page never shows
// beside a preset it was reached by.
describe("the Analytics scene's date range", () => {
  it("is empty under the 90d preset, as the real page's From/To inputs are", () => {
    // The default `heatmapPeriod` (schema.ts) is 90, so both a first visit
    // and a press of 90d land on the scene's highlighted preset.
    for (const search of ["", "period=90"]) {
      const query = resolveAnalyticsQuery(new URLSearchParams(search), 90);
      expect(query.period, search).toBe(90);
      const page = composeAnalyticsPageData({
        timezone: WALKTHROUGH_TZ,
        period: query.period,
        fromParam: query.fromParam,
        toParam: query.toParam,
        medicationIds: undefined,
        medicationOptions: [],
        dailyCounts: [],
        medStats: [],
        hourly: [],
        dayOfWeek: [],
        sideEffects: { frequency: [] },
        dailyAdherence: [],
        statusBreakdown: {},
        scheduleVariance: [],
        schedulesByMed: new Map(),
        prevDailyCounts: [],
        prevMedStats: [],
        refillForecast: [],
      } as unknown as AnalyticsCompositionInputs);
      expect([page.from, page.to], search).toEqual(["", ""]);
    }

    const doc = ssrDocument(render(AnalyticsScene, { props: { load: 10, heat: 1 } }).body);
    const edges = [...doc.querySelectorAll("[data-stage-date]")];
    expect(edges.map((el) => el.getAttribute("data-stage-date"))).toEqual(["From", "To"]);
    for (const el of edges)
      expect(textOf(el), el.getAttribute("data-stage-date")!).not.toMatch(/\d/);
  });
});

// The tier a supply earns is classifyRefillSeverity's alone (inventory.ts).
// The demo picks its Refills rows by a hand-set flag and states their tier as
// a literal, so a moved supplyDays or threshold would draw the wrong tint, or
// drop a row the app shows, with every other test green. The flag also
// decides the Medications scene's refill badge.
describe("the Refills card and the refill badge", () => {
  it("flags exactly the medications classifyRefillSeverity would list", () => {
    expect(MEDICATIONS.some((m) => m.refillWatch)).toBe(true);
    for (const m of MEDICATIONS) {
      expect(Boolean(m.refillWatch), m.name).toBe(classifyRefillSeverity(m.supplyDays) !== "ok");
    }
  });

  it("tints each row with the tier classifyRefillSeverity gives its supply", () => {
    expect(STAGE_REFILLS.length).toBeGreaterThan(0);
    for (const row of STAGE_REFILLS) {
      expect(row.severity, row.medicationName).toBe(classifyRefillSeverity(row.daysUntilRefill));
    }
  });

  it("draws each card's chip and stats row as MedicationCard does", () => {
    const html = render(MedicationsScene, { props: { load: 10, tick: 0 } }).body;
    const doc = ssrDocument(html);
    for (const m of MEDICATIONS) {
      // With a forecast and no alert threshold, refillChip never reads the
      // stock count, so the demo needs no stock figure.
      const chip = refillChip({
        severity: classifyRefillSeverity(m.supplyDays),
        daysUntilRefill: m.supplyDays,
        inventoryCount: null,
        inventoryAlertThreshold: null,
      });
      const card = [...doc.querySelectorAll("p")]
        .find((p) => textOf(p) === m.name)!
        .closest(".rounded-xl")!;
      if (chip) {
        const words = chip.glyph ? `${chip.glyph} ${chip.text}` : chip.text;
        expect(resting(drawnControl(card.outerHTML, words)), m.name).toEqual(
          expect.arrayContaining(
            split(`rounded-md px-2 py-1 text-xs font-semibold ${toneClass(chip.tone, "chip")}`),
          ),
        );
      } else {
        const spans = [...card.querySelectorAll("span")].map(textOf);
        expect(
          spans.filter((text) => text.endsWith("days left")),
          m.name,
        ).toEqual([]);
      }
      expect([...card.querySelectorAll("span")].map(textOf), m.name).toContain(
        `~${m.supplyDays}d supply left`,
      );
    }
    // Ibuprofen's 8 days is the watch tier, which is neutral, and the supply
    // line is neutral at every count.
    expect(statusTokens(doc.body)).toEqual([]);
  });

  it("draws each row as RefillsCard draws it, for every tier", () => {
    const row = (
      medicationId: string,
      severity: RefillSeverity,
      daysUntilRefill: number,
    ): RefillForecastEntry => ({
      medicationId,
      medicationName: `Medication ${medicationId}`,
      colour: "#3b82f6",
      inventoryCount: daysUntilRefill * 2,
      dailyRate: 2,
      daysUntilRefill,
      severity,
    });
    const entries = [
      row("a", "critical", 2),
      row("b", "warning", 6),
      row("c", "watch", 8),
      row("d", "ok", 30),
    ];
    const card = ssrDocument(render(RefillsCard, { props: { entries } }).body);
    const stage = ssrDocument(render(StageRefills, { props: { entries } }).body);
    const cardRows = [...card.querySelectorAll("section a")];
    const stageRows = [...stage.querySelectorAll(".space-y-2 > div")];
    expect(cardRows).toHaveLength(entries.length);
    expect(stageRows).toHaveLength(entries.length);
    cardRows.forEach((real, i) => {
      const drawn = stageRows[i];
      expect(textOf(drawn), entries[i].severity).toBe(textOf(real));
      // The stage's documented difference is exactly the hover and transition
      // classes, which `resting` drops.
      expect([drawn, ...drawn.querySelectorAll("*")].map(resting), entries[i].severity).toEqual(
        [real, ...real.querySelectorAll("*")].map(resting),
      );
    });
  });
});

describe("the stage's drawn controls", () => {
  it.each([
    ["primary", "md"],
    ["primary", "sm"],
    ["secondary", "md"],
    ["secondary", "sm"],
    ["ghost", "md"],
    ["ghost", "sm"],
  ] as const)("stageButton(%s, %s) is Button's look at rest", (variant, size) => {
    expect(split(stageButton(variant, size))).toEqual(
      resting(first(render(Button, { props: { variant, size, children: LABEL } }).body)),
    );
  });
  it.each([
    [true, "sm"],
    [false, "sm"],
    [true, "md"],
    [false, "md"],
  ] as const)("stageToggle(%s, %s) is Toggle's look at rest", (pressed, size) => {
    expect(split(stageToggle(pressed, size))).toEqual(
      resting(first(render(Toggle, { props: { pressed, size, children: LABEL } }).body)),
    );
  });

  // Each row: the variant and size the real page passes. If a page task
  // landed a different one, the row and the scene both follow the page.
  const security = () => render(SecurityScene).body;
  const data = () => render(DataScene, { props: { hover: false } }).body;
  const history = () =>
    render(HistoryScene, { props: { checked: true, filtered: 1, timeFormat: "24h" } }).body;
  const medications = () => render(MedicationsScene, { props: { load: 10, tick: 0 } }).body;
  const analytics = () => render(AnalyticsScene, { props: { load: 10, heat: 1 } }).body;
  const DRAWN = [
    { scene: "Security", body: security, label: "Update Password", look: stageButton("primary") },
    { scene: "Security", body: security, label: "Disable 2FA", look: stageButton("secondary") },
    { scene: "Security", body: security, label: "Revoke", look: stageButton("secondary", "sm") },
    { scene: "Data", body: data, label: "Save Format", look: stageButton("primary") },
    { scene: "Data", body: data, label: "Download Export", look: stageButton("secondary") },
    {
      scene: "Data",
      body: data,
      label: "Download Full Backup (JSON)",
      look: stageButton("secondary"),
    },
    { scene: "Data", body: data, label: "Import Data", look: stageButton("secondary") },
    {
      scene: "Medications",
      body: medications,
      label: "+ Add Medication",
      look: stageButton("primary", "sm"),
    },
    { scene: "Analytics", body: analytics, label: "90d", look: stageToggle(true) },
    { scene: "Analytics", body: analytics, label: "7d", look: stageToggle(false) },
    { scene: "History", body: history, label: "Apply", look: stageButton("secondary", "sm") },
    {
      scene: "History",
      body: history,
      label: "Clear filters",
      look: stageButton("secondary", "sm"),
    },
  ];
  it.each(DRAWN)("$scene draws $label as its page's control", ({ body, label, look }) => {
    const el = drawnControl(body(), label);
    expect(resting(el)).toEqual(expect.arrayContaining(split(look)));
    expect(statusTokens(el)).toEqual([]);
  });
});
