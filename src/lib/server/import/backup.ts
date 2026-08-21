// `version: 1` JSON backup -> ImportBundle. Pure — no DB, no I/O.
//
// All trust decisions happen in `backupEnvelopeSchema`
// (src/lib/utils/validation.ts): it strips `userId`, every credential
// field and the whole `auditLogs` array, so nothing this module returns
// can carry another account's identity. `id` survives only as
// `sourceId`, used to resolve references between arrays in the same
// file and never written to the database.
import {
  backupEnvelopeSchema,
  importDoseLogSchema,
  importInventoryEventSchema,
  IMPORT_SUPPORTED_VERSION,
} from "$lib/utils/validation";
import { parseIntervalHours, MAX_INTERVAL_HOURS } from "$lib/utils/schedule-rate";
import type { z } from "zod";
import { stripBom } from "./detect";
import type { ImportBundle, ImportMedication } from "./types";

export type ParseResult = { ok: true; bundle: ImportBundle } | { ok: false; reason: string };

/**
 * Turn a Zod issue path into something a person can act on, e.g.
 * `medications[3].dosageUnit: Too small`.
 */
function describeIssues(issues: Array<{ path: PropertyKey[]; message: string }>): string {
  return issues
    .slice(0, 5)
    .map((issue) => {
      const path = issue.path
        .map((segment) => (typeof segment === "number" ? `[${segment}]` : `.${String(segment)}`))
        .join("")
        .replace(/^\./, "");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

export function parseBackup(rawText: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(stripBom(rawText));
  } catch {
    return { ok: false, reason: "The file isn't valid JSON." };
  }

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "A backup file must be a JSON object." };
  }

  const version = (raw as { version?: unknown }).version;
  if (version !== IMPORT_SUPPORTED_VERSION) {
    return {
      ok: false,
      reason:
        typeof version === "number"
          ? `This backup is version ${version}, but this app can only read version ${IMPORT_SUPPORTED_VERSION}. Update the app, or export a fresh backup.`
          : `This file has no usable \`version\` field, so it isn't a MedTracker backup.`,
    };
  }

  const parsed = backupEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: `The backup didn't pass validation — ${describeIssues(parsed.error.issues)}`,
    };
  }

  const data = parsed.data;
  const warnings: string[] = [];

  const medications: ImportMedication[] = data.medications.map((med) => ({
    sourceId: med.id,
    name: med.name,
    dosageAmount: med.dosageAmount,
    dosageUnit: med.dosageUnit,
    form: med.form,
    category: med.category,
    colour: med.colour,
    colourSecondary: med.colourSecondary,
    pattern: med.pattern,
    notes: med.notes,
    scheduleType: med.scheduleType,
    scheduleIntervalHours: med.scheduleIntervalHours,
    inventoryCount: med.inventoryCount,
    inventoryAlertThreshold: med.inventoryAlertThreshold,
    sortOrder: med.sortOrder,
    isArchived: med.isArchived,
    archivedAt: med.archivedAt,
    startedAt: med.startedAt,
    endedAt: med.endedAt,
    // importMedicationSchema leaves these `undefined` for an older
    // backup that predates the feature — collapse that to the same
    // "inherit" / "enabled" default apply.ts would otherwise supply,
    // so ImportMedication never has to represent "unknown" separately
    // from "inherit".
    notificationsEnabled: med.notificationsEnabled ?? true,
    notifyOverdueEmail: med.notifyOverdueEmail ?? null,
    notifyOverduePush: med.notifyOverduePush ?? null,
    notifyLowInventoryEmail: med.notifyLowInventoryEmail ?? null,
    notifyLowInventoryPush: med.notifyLowInventoryPush ?? null,
    // `scheduleKind` and its payload are validated independently, so a
    // hand-edited file can carry a fixed_time row with no timeOfDay (or
    // an interval row with no intervalHours). Rather than writing a row
    // the schedule engine can't interpret — or dropping it and leaving
    // the medication with no schedule at all, which the dashboard and
    // analytics don't expect — demote it to PRN, which is the honest
    // reading of "we don't know when this is taken".
    schedules: med.schedules.map((schedule, index) => {
      // Parse FIRST, then bound the parsed number. `intervalHours` is a string
      // off the wire and `"100" <= 72` is a string/number comparison — exactly
      // the coercion class the primitive exists to eliminate.
      const hours = parseIntervalHours(schedule.intervalHours);
      const usable =
        (schedule.scheduleKind === "fixed_time" && schedule.timeOfDay !== null) ||
        (schedule.scheduleKind === "interval" && hours !== null && hours <= MAX_INTERVAL_HOURS) ||
        schedule.scheduleKind === "prn";

      if (!usable) {
        const kindLabel = schedule.scheduleKind.replace("_", " ");
        const article = schedule.scheduleKind === "interval" ? "An" : "A";
        warnings.push(
          `${article} ${kindLabel} schedule on "${med.name}" was missing a detail or had an unusable value, and was imported as "as needed".`,
        );
      }

      return {
        scheduleKind: usable ? schedule.scheduleKind : ("prn" as const),
        timeOfDay: usable ? schedule.timeOfDay : null,
        intervalHours: usable ? schedule.intervalHours : null,
        daysOfWeek: usable ? schedule.daysOfWeek : null,
        sortOrder: schedule.sortOrder || index,
        effectiveFrom: schedule.effectiveFrom,
        effectiveTo: schedule.effectiveTo,
      };
    }),
  }));

  // A dose or event whose medicationId doesn't appear in `medications`
  // has nothing to attach to. Drop it here rather than letting the
  // planner emit a confusing "unmatched" entry for an id the user
  // never sees.
  const knownIds = new Set(medications.map((med) => med.sourceId).filter(Boolean) as string[]);

  // Row-at-a-time validation. One malformed dose in a 5000-dose backup
  // must not make the whole file unimportable, so a bad row is counted
  // and reported rather than aborting the import.
  const doses: z.infer<typeof importDoseLogSchema>[] = [];
  let invalidDoses = 0;
  let orphanDoses = 0;
  for (const row of data.doseLogs) {
    const parsed = importDoseLogSchema.safeParse(row);
    if (!parsed.success) {
      invalidDoses++;
      continue;
    }
    if (!knownIds.has(parsed.data.medicationId)) {
      orphanDoses++;
      continue;
    }
    doses.push(parsed.data);
  }

  const inventoryEvents: z.infer<typeof importInventoryEventSchema>[] = [];
  let invalidEvents = 0;
  let orphanEvents = 0;
  for (const row of data.inventoryEvents) {
    const parsed = importInventoryEventSchema.safeParse(row);
    if (!parsed.success) {
      invalidEvents++;
      continue;
    }
    if (!knownIds.has(parsed.data.medicationId)) {
      orphanEvents++;
      continue;
    }
    inventoryEvents.push(parsed.data);
  }

  if (orphanDoses > 0) {
    warnings.push(
      `${orphanDoses} dose ${orphanDoses === 1 ? "entry" : "entries"} referenced a medication that isn't in the file and were skipped.`,
    );
  }
  if (invalidDoses > 0) {
    warnings.push(
      `${invalidDoses} dose ${invalidDoses === 1 ? "entry" : "entries"} could not be read (bad timestamp or value) and were skipped.`,
    );
  }
  if (orphanEvents > 0) {
    warnings.push(
      `${orphanEvents} inventory ${orphanEvents === 1 ? "event" : "events"} referenced a medication that isn't in the file and were skipped.`,
    );
  }
  if (invalidEvents > 0) {
    warnings.push(
      `${invalidEvents} inventory ${invalidEvents === 1 ? "event" : "events"} could not be read and were skipped.`,
    );
  }

  return {
    ok: true,
    bundle: {
      format: "backup-json",
      exportedAt: data.exportedAt,
      profile: data.profile,
      preferences: data.preferences,
      medications,
      doses: doses.map((dose) => ({
        sourceMedicationId: dose.medicationId,
        medicationName: null,
        quantity: dose.quantity,
        takenAt: dose.takenAt,
        loggedAt: dose.loggedAt,
        notes: dose.notes,
        sideEffects: dose.sideEffects,
        status: dose.status,
      })),
      inventoryEvents: inventoryEvents.map((event) => ({
        sourceMedicationId: event.medicationId,
        eventType: event.eventType,
        quantityChange: event.quantityChange,
        previousCount: event.previousCount,
        newCount: event.newCount,
        note: event.note,
        createdAt: event.createdAt,
      })),
      warnings,
    },
  };
}
