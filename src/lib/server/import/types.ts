// Shared shapes for the import pipeline.
//
// The pipeline is deliberately split so that everything up to (and
// including) planning is pure and DB-free — only `apply.ts` writes.
//
//   file bytes -> detect -> backup.ts | csv.ts -> ImportBundle
//   ImportBundle + AccountSnapshot   -> plan.ts -> ImportPlan
//   ImportPlan                       -> apply.ts -> ImportResult
//
// `ImportBundle` is the normalised, format-agnostic middle: whatever a
// JSON backup and a dose CSV disagree about is resolved by the parser,
// not by the planner or the writer.
import type { DoseLogStatus, InventoryEventType, ScheduleKind } from "$lib/server/db/schema";
import type { SideEffect } from "$lib/types";

export type ImportFormat = "backup-json" | "dose-csv";
export type ImportMode = "merge" | "replace";

/** Optional sections a restore may write. Medications, schedules and
 * dose logs are always in scope — they're the point of the feature. */
export type ImportSections = {
  inventory: boolean;
  preferences: boolean;
  profile: boolean;
};

export const ALL_SECTIONS: ImportSections = {
  inventory: true,
  preferences: true,
  profile: true,
};

export type ImportSchedule = {
  scheduleKind: ScheduleKind;
  timeOfDay: string | null;
  // Drizzle `numeric` round-trips as a string; keep it a string all the
  // way through so the wire shape is byte-identical on re-export.
  intervalHours: string | null;
  daysOfWeek: number[] | null;
  sortOrder: number;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
};

export type ImportMedication = {
  /** `id` as it appeared in the file. Used ONLY to resolve references
   * within the same file — never written to the database. */
  sourceId: string | null;
  name: string;
  dosageAmount: string;
  dosageUnit: string;
  form: string;
  category: string;
  colour: string;
  colourSecondary: string | null;
  pattern: string;
  notes: string | null;
  scheduleType: string;
  scheduleIntervalHours: string | null;
  inventoryCount: number | null;
  inventoryAlertThreshold: number | null;
  sortOrder: number;
  isArchived: boolean;
  archivedAt: Date | null;
  /** null means "not carried by this format" — the planner back-dates
   * it to the medication's earliest imported dose so analytics doesn't
   * treat the whole back-catalogue as not-yet-existing. */
  startedAt: Date | null;
  endedAt: Date | null;
  schedules: ImportSchedule[];
};

export type ImportDose = {
  /** FK into `ImportMedication.sourceId` (JSON path). */
  sourceMedicationId: string | null;
  /** Name-based reference (CSV path), matched case-insensitively. */
  medicationName: string | null;
  quantity: number;
  takenAt: Date;
  loggedAt: Date | null;
  notes: string | null;
  sideEffects: SideEffect[] | null;
  status: DoseLogStatus;
};

export type ImportInventoryEvent = {
  sourceMedicationId: string | null;
  eventType: InventoryEventType;
  quantityChange: number;
  previousCount: number | null;
  newCount: number | null;
  note: string | null;
  createdAt: Date;
};

export type ImportProfile = {
  name: string;
  timezone: string;
};

export type ImportPreferences = {
  accentColor?: string;
  dateFormat?: string;
  timeFormat?: string;
  uiDensity?: string;
  reducedMotion?: boolean;
  overdueEmailReminders?: boolean;
  overduePushReminders?: boolean;
  lowInventoryEmailAlerts?: boolean;
  lowInventoryPushAlerts?: boolean;
  doseLogPageSize?: number;
  heatmapPeriod?: number;
  exportFormat?: string;
};

export type ImportBundle = {
  format: ImportFormat;
  exportedAt: Date | null;
  profile: ImportProfile | null;
  preferences: ImportPreferences | null;
  medications: ImportMedication[];
  doses: ImportDose[];
  inventoryEvents: ImportInventoryEvent[];
  /** Non-fatal parse problems — skipped CSV rows, dropped side effects.
   * Surfaced in the preview so nothing is silently lost. */
  warnings: string[];
};

/** What the user chose to do with a CSV medication name that doesn't
 * match anything in the account. */
export type NameMappingChoice =
  | { action: "create" }
  | { action: "map"; medicationId: string }
  | { action: "skip" };

export type NameMapping = Record<string, NameMappingChoice>;

export type PlannedMedication = {
  source: ImportMedication;
  action: "create" | "reuse" | "skip";
  /** Set when `action === "reuse"` — the existing row to attach doses to. */
  existingId: string | null;
  /** Stable handle used by planned doses/events to refer back here. */
  ref: string;
  reason: string | null;
};

export type PlannedDose = {
  source: ImportDose;
  action: "create" | "skip";
  medicationRef: string | null;
  reason: string | null;
};

export type PlannedInventoryEvent = {
  source: ImportInventoryEvent;
  action: "create" | "skip";
  medicationRef: string | null;
  reason: string | null;
};

export type ImportSummary = {
  medicationsCreated: number;
  medicationsReused: number;
  medicationsSkipped: number;
  schedulesCreated: number;
  dosesCreated: number;
  dosesSkipped: number;
  inventoryEventsCreated: number;
  inventoryEventsSkipped: number;
  /** Rows deleted by replace mode. Zero in merge mode, always. */
  medicationsDeleted: number;
  dosesDeleted: number;
  profileUpdated: boolean;
  preferencesUpdated: boolean;
};

export type ImportPlan = {
  format: ImportFormat;
  mode: ImportMode;
  sections: ImportSections;
  medications: PlannedMedication[];
  doses: PlannedDose[];
  inventoryEvents: PlannedInventoryEvent[];
  profile: ImportProfile | null;
  preferences: ImportPreferences | null;
  /** CSV names with no match in the account and no user mapping yet.
   * A non-empty list blocks commit until the user decides. */
  unmatchedNames: string[];
  warnings: string[];
  summary: ImportSummary;
};

export type ImportResult = {
  importId: string;
  summary: ImportSummary;
};

/** Read-only view of the target account, used for duplicate detection. */
export type AccountSnapshot = {
  /** Active first, then archived — so name matching prefers a live
   * medication over an archived namesake. */
  medications: Array<{ id: string; name: string; isArchived: boolean }>;
  /** `medicationId|minute|status|quantity` — see `doseKey`. */
  doseKeys: Set<string>;
  /** `medicationId|epochMs|eventType|quantityChange`. */
  inventoryEventKeys: Set<string>;
  existingDoseCount: number;
  /** Highest `sortOrder` in use. Imported medications are appended above
   * it: `getActiveMedications` orders by `sortOrder` alone, so reusing
   * the file's values would interleave imported rows into the user's
   * existing hand-ordered list. */
  maxSortOrder: number;
};

/**
 * Duplicate key for a dose.
 *
 * Bucketed to the **minute**, not the millisecond, because the CSV
 * export only carries `HH:mm`. Keying on exact epoch ms would mean a
 * CSV re-import could never dedupe against rows that arrived via a JSON
 * backup, and the same file imported through both paths would double.
 *
 * `quantity` is part of the key: a row whose quantity was edited after
 * export is a genuinely different record, and surfacing it as an extra
 * row is recoverable, whereas silently dropping it is not.
 */
export function doseKey(
  medicationId: string,
  takenAt: Date,
  status: DoseLogStatus,
  quantity: number,
): string {
  const minute = Math.floor(takenAt.getTime() / 60_000);
  return `${medicationId}|${minute}|${status}|${quantity}`;
}

export function inventoryEventKey(
  medicationId: string,
  createdAt: Date,
  eventType: InventoryEventType,
  quantityChange: number,
): string {
  return `${medicationId}|${createdAt.getTime()}|${eventType}|${quantityChange}`;
}

/** Medications are matched on name, case- and whitespace-insensitively. */
export function normaliseName(name: string): string {
  return name.trim().toLowerCase();
}

export function emptySummary(): ImportSummary {
  return {
    medicationsCreated: 0,
    medicationsReused: 0,
    medicationsSkipped: 0,
    schedulesCreated: 0,
    dosesCreated: 0,
    dosesSkipped: 0,
    inventoryEventsCreated: 0,
    inventoryEventsSkipped: 0,
    medicationsDeleted: 0,
    dosesDeleted: 0,
    profileUpdated: false,
    preferencesUpdated: false,
  };
}
