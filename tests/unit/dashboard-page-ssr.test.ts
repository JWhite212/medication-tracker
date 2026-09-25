// @vitest-environment node
//
// `@vitest-environment node` is load-bearing: under the suite's default jsdom
// environment, vite resolves `svelte` to its client entry, and `render()` from
// `svelte/server` throws `effect_orphan` (see appearance-page-ssr.test.ts).
//
// This covers the dashboard page's COMPOSITION only: which sections render,
// in what order, under which headings, and the chip forms the 1–9 shortcuts
// select. What a card, the header or a Done row SAYS is tested in
// due-card-ssr.test.ts, dashboard-copy.test.ts and dashboard-page-data.test.ts.
// `$app/*` is not mocked: the appearance page SSR-renders `$app/forms` and
// `$app/navigation` unmocked, and nothing here runs an effect or a submit.
import { describe, it, expect } from "vitest";
import { render } from "svelte/server";
import Page from "../../src/routes/(app)/dashboard/+page.svelte";
import { BASE_MEDICATION_ROW } from "./fixtures/medication-row";
import type {
  DashboardPageData,
  DashboardStatus,
  DoneRow,
  DueCard,
  DueRow,
  LaterRow,
  Medication,
  RefillForecastEntry,
} from "$lib/types";

// 09:30 BST on Thursday 16 April 2026. Local midnight was 23:00Z the day before.
const NOW = "2026-04-16T08:30:00.000Z";
const TODAY_START = "2026-04-15T23:00:00.000Z";

// The (app) layout adds `user` and `preferences` to the merged PageData, and
// svelte-check types this fixture against it.
const preferences = {
  userId: "u1",
  accentColor: "#4f46e5",
  theme: "dark",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24h",
  uiDensity: "comfortable",
  reducedMotion: false,
  overdueEmailReminders: true,
  overduePushReminders: true,
  lowInventoryEmailAlerts: true,
  lowInventoryPushAlerts: false,
  doseLogPageSize: 20,
  heatmapPeriod: 90,
  exportFormat: "pdf",
  updatedAt: new Date("2026-04-01T00:00:00Z"),
};

const user = {
  id: "u1",
  email: "person@example.com",
  name: "Test Person",
  avatarUrl: null,
  timezone: "Europe/London",
  twoFactorEnabled: false,
  emailVerified: true,
};

const metformin: Medication = {
  ...BASE_MEDICATION_ROW,
  id: "m1",
  name: "Metformin",
  lowInventoryEpisodeAt: null,
};
const ibuprofen: Medication = {
  ...BASE_MEDICATION_ROW,
  id: "m2",
  name: "Ibuprofen",
  dosageAmount: "200",
  sortOrder: 1,
  lowInventoryEpisodeAt: null,
};

const lowStock: RefillForecastEntry = {
  medicationId: "m1",
  medicationName: "Metformin",
  colour: "#ff0000",
  inventoryCount: 2,
  dailyRate: 1,
  daysUntilRefill: 2,
  severity: "critical",
};

function status(
  kind: DashboardStatus["kind"],
  counts: Partial<Omit<DashboardStatus, "kind">> = {},
): DashboardStatus {
  return { kind, dueCount: 0, doneToday: 0, totalToday: 0, loggedToday: 0, next: null, ...counts };
}

function dueCard(
  subGroup: "earlier" | "today",
  med: Medication,
  expectedTime: string,
  state: DueRow["state"],
): DueCard {
  return {
    key: `${subGroup}:${med.id}`,
    medicationId: med.id,
    name: med.name,
    dosageAmount: med.dosageAmount,
    dosageUnit: med.dosageUnit,
    colour: med.colour,
    colourSecondary: med.colourSecondary,
    pattern: med.pattern,
    rows: [
      {
        key: `${med.id}:${expectedTime}`,
        kind: "fixed_time",
        expectedTime,
        state,
        logNow: true,
        tookItAt: state === "due-now" ? null : expectedTime,
        skipAt: expectedTime,
      },
    ],
  };
}

function doneRow(id: string, med: Medication, takenAt: string): DoneRow {
  return {
    key: id,
    dose: {
      id,
      userId: "u1",
      medicationId: med.id,
      quantity: 1,
      status: "taken",
      takenAt: new Date(takenAt),
      loggedAt: new Date(takenAt),
      updatedAt: new Date(takenAt),
      notes: null,
      sideEffects: null,
      medication: {
        name: med.name,
        dosageAmount: med.dosageAmount,
        dosageUnit: med.dosageUnit,
        form: med.form,
        colour: med.colour,
        colourSecondary: med.colourSecondary,
        pattern: med.pattern,
      },
    },
    covers: [],
    dayLabel: null,
  };
}

function laterRow(med: Medication, expectedTime: string): LaterRow {
  return {
    key: `later:${med.id}:${expectedTime}`,
    medicationId: med.id,
    name: med.name,
    dosageAmount: med.dosageAmount,
    dosageUnit: med.dosageUnit,
    colour: med.colour,
    colourSecondary: med.colourSecondary,
    pattern: med.pattern,
    expectedTime,
  };
}

function renderPage(overrides: Partial<DashboardPageData> = {}) {
  const dash: DashboardPageData = {
    now: NOW,
    nextRefreshAt: "2026-04-16T09:00:00.000Z",
    timezone: "Europe/London",
    todayStart: TODAY_START,
    status: status("none-today"),
    earlier: [],
    today: [],
    done: [],
    later: [],
    medications: [metformin, ibuprofen],
    refillForecast: [],
    ...overrides,
  };
  // No `form`: the page destructures only `data`, and svelte-check rejects an unknown prop.
  return render(Page, { props: { data: { ...dash, user, preferences } } });
}

/** Whitespace or Svelte hydration comments (`<!--[-->`, `<!---->`). */
const GAP = String.raw`(?:\s|<!--[^>]*-->)*`;

/** Offset of the first `<hN>` whose whole text is `text`, or -1. */
function headingAt(html: string, level: 1 | 2 | 3, text: string): number {
  return new RegExp(`<h${level}\\b[^>]*>${GAP}${text}${GAP}</h${level}>`).exec(html)?.index ?? -1;
}

/** The markup from `text`'s h2 up to the next h2 (or the end of the page). */
function sectionAfter(html: string, text: string): string {
  const start = headingAt(html, 2, text);
  if (start === -1) return "";
  const next = html.slice(start + 1).search(/<h2\b/);
  return next === -1 ? html.slice(start) : html.slice(start, start + 1 + next);
}

function chipForms(html: string): string[] {
  return html.match(/<form\b[^>]*\bdata-quick-log\b[^>]*>[\s\S]*?<\/form>/g) ?? [];
}

function hiddenValue(formHtml: string, name: string): string | undefined {
  const tag = formHtml.match(new RegExp(`<input\\b[^>]*\\bname="${name}"[^>]*>`))?.[0];
  return tag?.match(/\bvalue="([^"]*)"/)?.[1];
}

const SCHEDULED: Partial<DashboardPageData> = {
  status: status("due", { dueCount: 2, doneToday: 1, totalToday: 3 }),
  // 23:00 BST yesterday, 10.5h old: an Earlier row.
  earlier: [dueCard("earlier", metformin, "2026-04-15T22:00:00.000Z", "earlier")],
  // 09:00 BST, 30 minutes ago: due now.
  today: [dueCard("today", metformin, "2026-04-16T08:00:00.000Z", "due-now")],
  done: [doneRow("d1", ibuprofen, "2026-04-16T06:00:00.000Z")],
  later: [laterRow(ibuprofen, "2026-04-16T19:00:00.000Z")],
  refillForecast: [lowStock],
};

describe("dashboard page composition (SSR)", () => {
  it("orders a scheduled account's page by what the user has to do", () => {
    const html = renderPage(SCHEDULED).body;
    const order = [
      headingAt(html, 1, "Today"),
      headingAt(html, 2, "Due"),
      headingAt(html, 3, "Earlier"),
      headingAt(html, 3, "Today"),
      headingAt(html, 2, "Done today"),
      headingAt(html, 2, "Later today"),
      headingAt(html, 2, "Log something else"),
      headingAt(html, 2, "Refills"),
    ];
    expect(
      order.every((i) => i >= 0),
      `missing heading: ${JSON.stringify(order)}`,
    ).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("gives the Today sub-group a visible heading only when Earlier is also shown", () => {
    const html = renderPage({ ...SCHEDULED, earlier: [] }).body;
    expect(headingAt(html, 2, "Due")).toBeGreaterThan(-1);
    expect(headingAt(html, 3, "Earlier")).toBe(-1);
    expect(headingAt(html, 3, "Today")).toBe(-1);
  });

  it("holds the Due cards themselves in role=list lists (focus finds them by position)", () => {
    const html = renderPage(SCHEDULED).body;
    for (const group of ["earlier", "today"]) {
      const open = html.match(new RegExp(`<ul\\b[^>]*data-due-list="${group}"[^>]*>`))?.[0];
      expect(open, `no Due list for ${group}`).toBeDefined();
      expect(open).toContain('role="list"');
      const after = html.slice(html.indexOf(open!) + open!.length);
      expect(after).toMatch(new RegExp(`^${GAP}<li\\b`));
    }
  });

  it("renders neither Due nor Later when nothing is outstanding or ahead", () => {
    const html = renderPage({
      status: status("all-done", { doneToday: 1, totalToday: 1 }),
      done: [doneRow("d1", metformin, "2026-04-16T07:00:00.000Z")],
    }).body;
    expect(headingAt(html, 2, "Due")).toBe(-1);
    expect(headingAt(html, 2, "Later today")).toBe(-1);
    expect(headingAt(html, 2, "Done today")).toBeGreaterThan(-1);
    expect(headingAt(html, 2, "Log something else")).toBeGreaterThan(-1);
  });

  it("keeps the Done heading as a focus target and says so when nothing is logged", () => {
    const html = renderPage().body;
    expect(sectionAfter(html, "Done today")).toContain("Nothing logged yet today");
  });

  it("moves the chips under the header, retitled, for an as-needed-only account", () => {
    const html = renderPage({ status: status("as-needed-only") }).body;
    const order = [
      headingAt(html, 1, "Today"),
      headingAt(html, 2, "Log a dose"),
      headingAt(html, 2, "Logged today"),
    ];
    expect(
      order.every((i) => i >= 0),
      `missing heading: ${JSON.stringify(order)}`,
    ).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (const absent of ["Due", "Later today", "Log something else", "Done today"]) {
      expect(headingAt(html, 2, absent), absent).toBe(-1);
    }
  });

  it("renders one quick-log chip per active medication, in list order, logging one dose now", () => {
    const forms = chipForms(renderPage(SCHEDULED).body);
    expect(forms.map((f) => hiddenValue(f, "medicationId"))).toEqual(["m1", "m2"]);
    for (const form of forms) {
      expect(form).toMatch(/action="\?\/logDose"/);
      expect(hiddenValue(form, "quantity")).toBe("1");
      expect(form).not.toMatch(/name="(takenAt|forSlot)"/);
    }
  });

  it("never paints a medication's colours behind chip text, and keeps − in place at quantity 1", () => {
    const chips = sectionAfter(renderPage(SCHEDULED).body, "Log something else");
    expect(chips).toMatch(/<ul\b[^>]*role="list"/);
    // getReadableTextColor's text-shadow was the signature of text on colour.
    expect(chips).not.toMatch(/text-shadow/);
    // Visible label first, context in sr-only text. The old aria-label that
    // hid the visible label is gone.
    expect(chips).toContain('<span class="sr-only">Log </span>');
    expect(chips).not.toMatch(/aria-label="Log /);
    const minus = chips.match(
      /<button\b[^>]*aria-label="Decrease quantity for Metformin"[^>]*>/,
    )?.[0];
    expect(minus, "the − segment must render at quantity 1").toBeDefined();
    expect(minus).toContain('aria-disabled="true"');
    expect(chips).toMatch(/<button\b[^>]*aria-label="Increase quantity for Metformin"/);
  });

  it("keeps the tab title matching the nav", () => {
    expect(renderPage(SCHEDULED).head).toContain("<title>Dashboard — MedTracker</title>");
  });

  it("shows onboarding, not the page, to an account with no active medications", () => {
    const html = renderPage({ medications: [] }).body;
    expect(html).toContain("Welcome to MedTracker");
    expect(headingAt(html, 1, "Today")).toBe(-1);
    expect(chipForms(html)).toEqual([]);
  });
});
