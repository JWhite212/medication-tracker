// Fixed data for the landing-page walkthrough. The five medications match the
// demo account in scripts/seed-demo.ts; the 90 days of history behind the
// analytics and sparklines are generated from a seeded PRNG so every visitor
// (and every prerender) sees the same numbers.
//
// The story clock is Thursday 24 September 2026, 08:02. Times are wall-clock
// strings formatted in UTC, so the video reads the same in every timezone.

import { formatUserTime, type TimeFormat } from "$lib/utils/time";

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
const HISTORY_DAYS = 90;
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
  // Today is only part-way through: three doses were due by 08:02.
  const expected = expectedPerDay * (HISTORY_DAYS - 1) + 3;

  return {
    daily,
    dailyAdherence,
    max: Math.max(...daily),
    total,
    expected,
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

// ── My Day ──
export type DayGroupKey = "morning" | "afternoon" | "evening" | "night";
export type SlotStatus = "taken" | "upcoming" | "overdue";
export type DaySlot = { group: DayGroupKey; id: MedicationId; time: string; status: SlotStatus };

// Emoji because the dashboard's former My Day timeline used them.
export const DAY_GROUPS: ReadonlyArray<{ key: DayGroupKey; label: string; icon: string }> = [
  { key: "morning", label: "Morning", icon: "☀️" },
  { key: "afternoon", label: "Afternoon", icon: "🌤️" },
  { key: "evening", label: "Evening", icon: "🌅" },
  { key: "night", label: "Night", icon: "🌙" },
];

export function daySlots(lisinopril: SlotStatus, vitaminD: SlotStatus): DaySlot[] {
  return [
    { group: "morning", id: "ibu", time: "06:10", status: "taken" },
    { group: "morning", id: "met", time: "07:48", status: "taken" },
    { group: "morning", id: "lis", time: "08:00", status: lisinopril },
    { group: "morning", id: "vitd", time: "09:05", status: vitaminD },
    { group: "afternoon", id: "ibu", time: "14:10", status: "upcoming" },
    { group: "evening", id: "met", time: "19:48", status: "upcoming" },
    { group: "night", id: "mag", time: "22:05", status: "upcoming" },
    { group: "night", id: "ibu", time: "22:10", status: "upcoming" },
  ];
}

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
      { id: "mag", time: "22:05", since: "9h 57m ago" },
      { id: "ibu", time: "22:14", since: "9h 48m ago" },
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
  return formatUserTime(new Date(Date.UTC(2026, 8, 24, hours, minutes)), "UTC", format);
}

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
