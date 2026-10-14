// Fixed data for the landing-page walkthrough. The five medications match the
// demo account in scripts/seed-demo.ts; the 90 days of history behind the
// analytics and sparklines are generated from a seeded PRNG so every visitor
// (and every prerender) sees the same numbers.
//
// The story is Thursday 24 September 2026, on two clocks: the desktop scenes
// at 08:02 (DESKTOP_NOW) and the phone at 10:12 (PHONE_NOW). Every instant is
// UTC and every string is formatted in WALKTHROUGH_TZ, never the visitor's
// zone, so the video reads the same everywhere.

import { formatUserTime, type TimeFormat } from "$lib/utils/time";

// ── Story clocks ──
/** The zone every walkthrough string is formatted in. */
export const WALKTHROUGH_TZ = "UTC";
/** The desktop scenes. Lisinopril's 08:00 dose is due, and is logged now. */
export const DESKTOP_NOW = new Date("2026-09-24T08:02:00.000Z");
/** The phone scene. Vitamin D's 09:05 dose is overdue, and is logged now. */
export const PHONE_NOW = new Date("2026-09-24T10:12:00.000Z");
/** Days of history behind the analytics shot, ending at DESKTOP_NOW. */
const HISTORY_DAYS = 90;
/**
 * When every demo medication, and each of its schedules, began: the start of
 * the 90-day analytics window. Any later and the lifecycle and schedule-edit
 * clips would drop slots from the dashboard and days from the denominator.
 */
export const DEMO_STARTED_AT = new Date(DESKTOP_NOW.getTime() - HISTORY_DAYS * 86_400_000);

/** A medication's schedule rows, as scripts/seed-demo.ts writes them. */
export type DemoSchedule =
  | { kind: "interval"; intervalHours: string }
  | { kind: "fixed_time"; timesOfDay: string[] };

export type DemoMedication = {
  id: "vitd" | "lis" | "met" | "ibu" | "mag";
  name: string;
  amount: string;
  unit: string;
  form: string;
  category: string;
  colour: string;
  colourSecondary: string | null;
  pattern: string;
  /** The same schedule scripts/seed-demo.ts gives this medication. */
  schedule: DemoSchedule;
  /** Expected doses a day under `schedule`, by the analytics denominator's rule. */
  perDay: number;
  /** Chance each expected dose was taken, used only to generate history. */
  takeRate: number;
  supplyDays: number;
  refillWatch?: boolean;
  /** "Last taken" before and after the live timer ticks over a minute. */
  lastTaken: string;
  lastTakenNext: string;
};

export const MEDICATIONS: readonly DemoMedication[] = [
  {
    id: "vitd",
    name: "Vitamin D",
    amount: "1000",
    unit: "IU",
    form: "tablet",
    category: "supplement",
    colour: "#f59e0b",
    colourSecondary: null,
    pattern: "solid",
    schedule: { kind: "interval", intervalHours: "24" },
    perDay: 1,
    takeRate: 0.92,
    supplyDays: 60,
    lastTaken: "22h 57m ago",
    lastTakenNext: "22h 58m ago",
  },
  {
    id: "lis",
    name: "Lisinopril",
    amount: "10",
    unit: "mg",
    form: "tablet",
    category: "prescription",
    colour: "#3b82f6",
    colourSecondary: null,
    pattern: "solid",
    schedule: { kind: "fixed_time", timesOfDay: ["08:00"] },
    perDay: 1,
    takeRate: 0.96,
    supplyDays: 27,
    lastTaken: "just now",
    lastTakenNext: "1m ago",
  },
  {
    id: "met",
    name: "Metformin",
    amount: "500",
    unit: "mg",
    form: "tablet",
    category: "prescription",
    colour: "#10b981",
    colourSecondary: "#06b6d4",
    pattern: "stripes",
    schedule: { kind: "interval", intervalHours: "12" },
    perDay: 2,
    takeRate: 0.88,
    supplyDays: 28,
    lastTaken: "14m ago",
    lastTakenNext: "15m ago",
  },
  {
    id: "ibu",
    name: "Ibuprofen",
    amount: "200",
    unit: "mg",
    form: "tablet",
    category: "otc",
    colour: "#ef4444",
    colourSecondary: null,
    pattern: "solid",
    schedule: { kind: "interval", intervalHours: "8" },
    perDay: 3,
    takeRate: 0.7,
    supplyDays: 8,
    refillWatch: true,
    lastTaken: "1h 52m ago",
    lastTakenNext: "1h 53m ago",
  },
  {
    id: "mag",
    name: "Magnesium Glycinate",
    amount: "300",
    unit: "mg",
    form: "capsule",
    category: "supplement",
    colour: "#8b5cf6",
    colourSecondary: null,
    pattern: "solid",
    schedule: { kind: "interval", intervalHours: "24" },
    perDay: 1,
    takeRate: 0.85,
    supplyDays: 90,
    lastTaken: "9h 57m ago",
    lastTakenNext: "9h 58m ago",
  },
];

export type MedicationId = DemoMedication["id"];

export const MEDICATION_BY_ID = Object.fromEntries(MEDICATIONS.map((m) => [m.id, m])) as Record<
  MedicationId,
  DemoMedication
>;

// ── History ──
// Doses already logged on the story day (the last of the 90).
const TAKEN_TODAY: Record<MedicationId, number> = { vitd: 0, lis: 1, met: 1, ibu: 1, mag: 0 };

/** mulberry32: tiny, fast and good enough for plausible-looking demo data. */
function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sum = (values: readonly number[]) => values.reduce((s, v) => s + v, 0);

function buildHistory() {
  const random = seededRandom(20260924);
  // The draw order (medication by medication, day by day, dose by dose) is
  // part of the seed; changing it changes every number on the analytics shot.
  const perMedication = MEDICATIONS.map((m) =>
    Array.from({ length: HISTORY_DAYS }, (_, day) => {
      if (day === HISTORY_DAYS - 1) return TAKEN_TODAY[m.id];
      let taken = 0;
      for (let k = 0; k < m.perDay; k++) if (random() < m.takeRate) taken++;
      return taken;
    }),
  );
  const daily = Array.from({ length: HISTORY_DAYS }, (_, day) =>
    perMedication.reduce((s, doses) => s + doses[day], 0),
  );
  const expectedPerDay = sum(MEDICATIONS.map((m) => m.perDay));
  const dailyAdherence = daily.map((count) =>
    Math.min(100, Math.round((count / expectedPerDay) * 100)),
  );
  const total = sum(daily);

  return {
    daily,
    dailyAdherence,
    max: Math.max(...daily),
    total,
    // Placeholder, as in the design: the streak is not derived from the history.
    streak: 12,
    averageAdherence: Math.round(
      sum(dailyAdherence.slice(0, HISTORY_DAYS - 1)) / (HISTORY_DAYS - 1),
    ),
    weeklyAdherence: MEDICATIONS.map((m, i) =>
      Math.min(
        100,
        Math.round(
          (sum(perMedication[i].slice(HISTORY_DAYS - 8, HISTORY_DAYS - 1)) / (7 * m.perDay)) * 100,
        ),
      ),
    ),
    sparklines: perMedication.map((doses) => doses.slice(HISTORY_DAYS - 14)),
    perMedication: MEDICATIONS.map((m, i) => {
      const taken = sum(perMedication[i]);
      const expectedTotal = m.perDay * HISTORY_DAYS;
      return {
        taken,
        expected: expectedTotal,
        adherence: Math.min(100, Math.round((taken / expectedTotal) * 100)),
      };
    }),
  };
}

export const HISTORY = buildHistory();

/**
 * The analytics page's Dose Status Breakdown over `getPerMedicationStats`'
 * default 90-day window, read at DESKTOP_NOW. A literal on purpose: the real
 * fold (`foldDoseStatusBreakdown`, PER MEDICATION) lives under $lib/server,
 * which this client module cannot import, and arithmetic here would be a
 * second owner of it. walkthrough-demo-facts.test.ts folds the demo's
 * per-medication counts through the real function and holds this to it.
 *
 * What the numbers say: every medication started at DEMO_STARTED_AT, so each
 * expects `perDay × 90`, 720 in all. 602 were taken, and the 118 untaken are
 * Missed, never Skipped: Skipped counts explicit skips, and the demo history
 * has none. 83.6 is `calculateAdherence(602, 720)`.
 *
 * AnalyticsScene renders these fields and does no arithmetic of its own.
 */
export const STATUS_BREAKDOWN: {
  takenEvents: number;
  skippedEvents: number;
  missedEvents: number;
  expectedTotal: number;
  adherencePercent: number;
} = {
  takenEvents: 602,
  skippedEvents: 0,
  missedEvents: 118,
  expectedTotal: 720,
  adherencePercent: 83.6,
};

export type HeatmapCell = { row: number; count: number };

/** 90 days as week columns, Sunday-first rows, ending on the story day. */
function buildHeatmapWeeks(): HeatmapCell[][] {
  const columns: HeatmapCell[][] = [];
  let column: HeatmapCell[] = [];
  for (let i = 0; i < HISTORY_DAYS; i++) {
    // Noon UTC so the weekday cannot slip across a date boundary.
    const row = new Date(Date.UTC(2026, 8, 24 - (HISTORY_DAYS - 1) + i, 12)).getUTCDay();
    if (i > 0 && row === 0) {
      columns.push(column);
      column = [];
    }
    column.push({ row, count: HISTORY.daily[i] });
  }
  columns.push(column);
  return columns;
}

export const HEATMAP_WEEKS = buildHeatmapWeeks();

export function heatmapIntensity(count: number): number {
  if (count === 0) return 0;
  const ratio = count / HISTORY.max;
  return ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 0.75 ? 3 : 4;
}

// Adherence trend arrows beside the per-medication bars.
export const ADHERENCE_TRENDS: Partial<Record<MedicationId, { up: boolean; points: number }>> = {
  vitd: { up: true, points: 2 },
  met: { up: true, points: 1 },
  ibu: { up: false, points: 4 },
};

// ── Doses ──
export type DemoDose = {
  id: string;
  medicationId: MedicationId;
  takenAt: Date;
  quantity: number;
  status: "taken" | "skipped";
};

/** One taken unit at `iso` ("2026-09-24T08:02Z"), id'd `dose-<med>-<yyyymmdd>-<hhmm>`. */
function demoDose(medicationId: MedicationId, iso: string): DemoDose {
  const day = iso.slice(0, 10).replace(/-/g, "");
  const time = iso.slice(11, 16).replace(":", "");
  return {
    id: `dose-${medicationId}-${day}-${time}`,
    medicationId,
    takenAt: new Date(iso),
    quantity: 1,
    status: "taken",
  };
}

/**
 * Every dose the story depends on, oldest first: the History scene's
 * Yesterday and Today groups, plus Vitamin D at PHONE_NOW, which the phone
 * logs on screen. Yesterday's Vitamin D 09:05 and Magnesium 22:05, and
 * today's Ibuprofen 06:10 and Metformin 07:48, are also the interval anchors
 * the dashboard projects today's slots from.
 *
 * LOG_ALL and each MEDICATIONS[].lastTaken stay hand-written;
 * walkthrough-demo-facts.test.ts holds both to this list.
 */
export const DEMO_DOSES: readonly DemoDose[] = [
  demoDose("lis", "2026-09-23T08:01Z"),
  demoDose("vitd", "2026-09-23T09:05Z"),
  demoDose("ibu", "2026-09-23T14:12Z"),
  demoDose("met", "2026-09-23T19:51Z"),
  demoDose("mag", "2026-09-23T22:05Z"),
  demoDose("ibu", "2026-09-23T22:14Z"),
  demoDose("ibu", "2026-09-24T06:10Z"),
  demoDose("met", "2026-09-24T07:48Z"),
  demoDose("lis", "2026-09-24T08:02Z"),
  demoDose("vitd", "2026-09-24T10:12Z"),
];

/** The dose each log beat writes: the desktop's Log now and the phone's tap. */
export const LOGGED_DOSE = {
  desktop: "dose-lis-20260924-0802",
  phone: "dose-vitd-20260924-1012",
} as const;

// ── Dose history ──
export type LoggedDose = { id: MedicationId; time: string; since: string; sideEffect?: string };
export type DoseGroup = { label: string; doses: LoggedDose[] };

const DAY_LABEL = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const septemberDay = (day: number) => DAY_LABEL.format(new Date(Date.UTC(2026, 8, day)));

// Newest first within each day, as /log orders by takenAt descending.
export const LOG_ALL: readonly DoseGroup[] = [
  {
    label: "Today",
    doses: [
      { id: "lis", time: "08:02", since: "just now" },
      { id: "met", time: "07:48", since: "14m ago" },
      { id: "ibu", time: "06:10", since: "1h 52m ago" },
    ],
  },
  {
    label: "Yesterday",
    doses: [
      { id: "ibu", time: "22:14", since: "9h 48m ago" },
      { id: "mag", time: "22:05", since: "9h 57m ago" },
      { id: "met", time: "19:51", since: "12h 11m ago" },
      { id: "ibu", time: "14:12", since: "17h 50m ago", sideEffect: "Upset stomach" },
      { id: "vitd", time: "09:05", since: "22h 57m ago" },
      { id: "lis", time: "08:01", since: "1d ago" },
    ],
  },
];

export const LOG_WITH_SIDE_EFFECTS: readonly DoseGroup[] = [
  {
    label: "Yesterday",
    doses: [{ id: "ibu", time: "14:12", since: "17h 50m ago", sideEffect: "Upset stomach" }],
  },
  {
    label: septemberDay(21),
    doses: [{ id: "ibu", time: "22:20", since: "2d ago", sideEffect: "Upset stomach" }],
  },
  {
    label: septemberDay(17),
    doses: [{ id: "ibu", time: "14:05", since: "6d ago", sideEffect: "Upset stomach" }],
  },
];

/** Format an "HH:MM" wall-clock string on the story day. */
export function storyClock(hhmm: string, format: TimeFormat): string {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return formatUserTime(new Date(Date.UTC(2026, 8, 24, hours, minutes)), WALKTHROUGH_TZ, format);
}

// ── Security ──
/**
 * The Security scene's session expiries, current session first. The scene
 * prints them through formatUserDate, as the real page does.
 */
export const SESSION_EXPIRIES: readonly Date[] = [
  new Date("2026-10-22T08:00Z"),
  new Date("2026-10-15T20:30Z"),
];

// ── Pages shown in the fake browser ──
export type NavKey = "dash" | "meds" | "log" | "ana" | "set";

export const PAGES = {
  dash: { url: "/dashboard", title: "Dashboard — MedTracker", nav: "dash" },
  meds: { url: "/medications", title: "Medications — MedTracker", nav: "meds" },
  add: { url: "/medications/new", title: "Add Medication — MedTracker", nav: "meds" },
  log: { url: "/log", title: "Dose History — MedTracker", nav: "log" },
  ana: { url: "/analytics", title: "Analytics — MedTracker", nav: "ana" },
  sec: { url: "/settings/security", title: "Security — MedTracker", nav: "set" },
  data: { url: "/settings/data", title: "Data Management — MedTracker", nav: "set" },
} as const satisfies Record<string, { url: string; title: string; nav: NavKey }>;

export const SITE_HOST = "medication-tracker.jamiewhite.site";
