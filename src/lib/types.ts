import type { InferSelectModel } from "drizzle-orm";
import type { users, medications, doseLogs, userPreferences } from "$lib/server/db/schema";

export type User = InferSelectModel<typeof users>;
export type Medication = InferSelectModel<typeof medications>;
/**
 * A dose log as the CLIENT sees it.
 *
 * `inventoryApplied` is deliberately omitted: it is server-side bookkeeping
 * for how much stock a row removed (see `doses.ts`), it is not on the
 * `/api/v1` wire either, and including it here would oblige every page query
 * that returns doses to select a column none of them render.
 */
export type DoseLog = Omit<InferSelectModel<typeof doseLogs>, "inventoryApplied">;

export type SessionUser = Pick<
  User,
  "id" | "email" | "name" | "avatarUrl" | "timezone" | "twoFactorEnabled" | "emailVerified"
>;

export type UserPreferences = InferSelectModel<typeof userPreferences>;

export type SideEffect = {
  name: string;
  severity: "mild" | "moderate" | "severe";
};

export type DoseLogWithMedication = DoseLog & {
  medication: Pick<
    Medication,
    "name" | "dosageAmount" | "dosageUnit" | "form" | "colour" | "colourSecondary" | "pattern"
  >;
};

export type MedicationWithStats = Medication & {
  lastTakenAt: Date | null;
  weeklyDoseCount: number;
  avgDailyConsumption: number;
  daysUntilRefill: number | null;
  // Schedule-aware doses/day (medication_schedules first, legacy
  // interval as fallback); null for PRN. Drives the adherence bar's
  // expected-dose denominator. Optional so older constructors compile.
  expectedDailyDoses?: number | null;
  // 14-day daily-dose count series, oldest → newest. Optional so
  // existing callers don't need to populate it.
  sparkline?: number[];
  // Refill severity tier from src/lib/server/inventory.ts. Optional;
  // populated only by the Medications-list loader.
  refillSeverity?: "critical" | "warning" | "watch" | "ok";
};

// Analytics insight returned from buildInsights (server-side) and
// rendered by InsightsCard (client-side). Lives here so client
// components don't reach into $lib/server/* — type-only imports are
// technically erased, but keeping the boundary clean avoids accidental
// runtime imports and matches SvelteKit conventions.
export type Insight = {
  id: string;
  severity: "info" | "positive" | "warning";
  text: string;
};

export type RefillSeverity = "critical" | "warning" | "watch" | "ok";

export type RefillForecastEntry = {
  medicationId: string;
  medicationName: string;
  colour: string;
  inventoryCount: number;
  dailyRate: number;
  daysUntilRefill: number | null;
  severity: RefillSeverity;
};

/**
 * The dashboard payload (docs/superpowers/specs/2026-09-24-dashboard-due-now-design.md).
 * Built by `composeDashboardPageData` in `$lib/server/dashboard/page-data.ts`.
 * Every instant is an ISO string so the client never re-derives a civil day
 * from one; the client formats them against `todayStart`.
 */

/** First matching predicate wins, in this order: as-needed-only, due, caught-up, all-done, none-today. */
export type DashboardStatusKind =
  | "due"
  | "caught-up"
  | "all-done"
  | "none-today"
  | "as-needed-only";

export type DashboardStatus = {
  kind: DashboardStatusKind;
  /** Every Due row, Earlier and nested rows included. */
  dueCount: number;
  /** Today's slots resolved (taken or skipped). Earlier rows are not counted. */
  doneToday: number;
  /** Today's slots, resolved or not. */
  totalToday: number;
  /** Taken dose events among the Done rows; a skip is not a dose logged. */
  loggedToday: number;
  /** The earliest outstanding slot ahead, set only for `caught-up`; `alsoCount` = other slots at that instant. */
  next: {
    name: string;
    dosageAmount: string;
    dosageUnit: string;
    expectedTime: string;
    alsoCount: number;
  } | null;
};

/**
 * One outstanding slot on a Due card. `tookItAt` / `skipAt` are the exact
 * instants those buttons post, or null when the row does not offer them —
 * decided by simulation in `slotActions`, never by the component.
 */
export type DueRow = {
  key: string;
  kind: "interval" | "fixed_time";
  expectedTime: string;
  state: "earlier" | "overdue" | "due-now";
  logNow: boolean;
  tookItAt: string | null;
  skipAt: string | null;
};

/** One medication in one Due sub-group; `key` is `${subGroup}:${medicationId}`. `rows[0]` is the top row. */
export type DueCard = {
  key: string;
  medicationId: string;
  name: string;
  dosageAmount: string;
  dosageUnit: string;
  colour: string;
  colourSecondary: string | null;
  pattern: string;
  rows: DueRow[];
};

/** One dose event in Done. `covers` = ISO slot instants this dose resolved, other than its own minute. */
export type DoneRow = {
  key: string;
  dose: DoseLogWithMedication;
  covers: string[];
  dayLabel: "yesterday" | null;
};

/** A read-only line for a slot of today's more than an hour ahead. */
export type LaterRow = {
  key: string;
  medicationId: string;
  name: string;
  dosageAmount: string;
  dosageUnit: string;
  colour: string;
  colourSecondary: string | null;
  pattern: string;
  expectedTime: string;
};

export type DashboardPageData = {
  now: string;
  nextRefreshAt: string;
  timezone: string;
  todayStart: string;
  status: DashboardStatus;
  earlier: DueCard[];
  today: DueCard[];
  done: DoneRow[];
  later: LaterRow[];
  /** Active medications in `sortOrder` — the chip list. */
  medications: Medication[];
  /** Merged in by the page load beside `loadDashboard`. */
  refillForecast: RefillForecastEntry[];
};
